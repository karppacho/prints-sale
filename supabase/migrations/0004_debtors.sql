-- ============================================================
-- Миграция 0004: справочник должников (постоплата)
--
-- По итогам тестирования заказчиком:
--   1. Должник — не свободный текст, а справочник (обычно юрлица):
--      выбирается из списка или создаётся при продаже (как художники).
--   2. Контакт должника — НЕобязательный.
--
-- В art.sales добавляется debtor_id (ссылка на справочник);
-- debtor_name / debtor_contact остаются как снимок на момент
-- продажи — история не зависит от переименований в справочнике,
-- существующие чеки продолжают работать.
-- ============================================================

create table art.debtors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  contact    text,                       -- необязательный
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

alter table art.sales
  add column debtor_id uuid references art.debtors(id);

-- RLS: читают все сотрудники (нужно продавцу при оформлении постоплаты);
-- создавать может любой сотрудник (продавец заводит юрлицо прямо при
-- продаже); править/скрывать — владелец.
alter table art.debtors enable row level security;

create policy debtors_select on art.debtors
  for select to authenticated
  using (art.my_role() in ('seller', 'admin', 'owner'));

create policy debtors_insert on art.debtors
  for insert to authenticated
  with check (art.my_role() in ('seller', 'admin', 'owner'));

create policy debtors_owner_update on art.debtors
  for update to authenticated
  using (art.my_role() = 'owner')
  with check (art.my_role() = 'owner');

create policy debtors_owner_delete on art.debtors
  for delete to authenticated
  using (art.my_role() = 'owner');

-- grant "on all tables" из 0001 новую таблицу не покрывает
grant select, insert, update, delete on art.debtors to authenticated;

-- ============================================================
-- Обновлённый RPC sell: вместо p_debtor_name/p_debtor_contact —
-- p_debtor_id (для постоплаты обязателен ТОЛЬКО должник, контакт
-- берётся из справочника и может быть пустым). Имя/контакт
-- фиксируются в чеке снимком.
-- CREATE OR REPLACE с другим списком параметров создал бы
-- перегрузку — старую версию нужно удалить.
-- ============================================================
drop function if exists art.sell(jsonb, text, text, text, text, text, text, uuid, uuid);

create or replace function art.sell(
  p_items          jsonb,
  p_payment_method text,
  p_buyer_type     text,
  p_fair_name      text default null,
  p_debtor_id      uuid default null,  -- должник из справочника (обязателен при постоплате)
  p_comment        text default null,
  p_sale_id        uuid default null,  -- id чека, сгенерированный клиентом:
                                       -- повторная отправка того же чека при
                                       -- плохой связи не создаёт дубль
  p_branch_id      uuid default null   -- используется, только если у
                                       -- сотрудника не задан филиал (владелец)
)
returns uuid
language plpgsql security definer
set search_path = art, finance, public
as $$
declare
  v_role           text := art.my_role();
  v_branch         uuid := coalesce(art.my_branch(), p_branch_id);
  v_deferred       boolean;
  v_sale_id        uuid := coalesce(p_sale_id, gen_random_uuid());
  v_debtor_name    text;
  v_debtor_contact text;
  v_item           jsonb;
  v_copy           art.edition_copies%rowtype;
  v_edition        art.editions%rowtype;
  v_framed         boolean;
  v_discount       numeric;
  v_base           numeric;
  v_final          numeric;
  v_total          numeric := 0;
  v_royalty        numeric := 0;
begin
  if v_role not in ('seller', 'admin', 'owner') then
    raise exception 'Недостаточно прав';
  end if;
  if v_branch is null then
    raise exception 'Не определён филиал продажи';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Корзина пуста';
  end if;

  -- Идемпотентность: чек с таким id уже создан — просто вернуть его
  if exists (select 1 from art.sales where id = v_sale_id) then
    return v_sale_id;
  end if;

  select is_deferred into v_deferred
    from finance.payment_methods
   where code = p_payment_method and is_active;
  if not found then
    raise exception 'Неизвестный способ оплаты';
  end if;

  if v_deferred then
    if p_debtor_id is null then
      raise exception 'Для постоплаты выберите должника';
    end if;
    select name, contact into v_debtor_name, v_debtor_contact
      from art.debtors
     where id = p_debtor_id and is_active;
    if not found then
      raise exception 'Должник не найден в справочнике';
    end if;
  end if;

  begin
    insert into art.sales
      (id, branch_id, buyer_type, fair_name, payment_method,
       is_paid, paid_at, paid_method,
       debtor_id, debtor_name, debtor_contact,
       total, royalty_total, comment, created_by)
    values
      (v_sale_id, v_branch, p_buyer_type, nullif(trim(p_fair_name), ''),
       p_payment_method,
       not v_deferred,
       case when v_deferred then null else now() end,
       case when v_deferred then null else p_payment_method end,
       case when v_deferred then p_debtor_id else null end,
       v_debtor_name, v_debtor_contact,
       0, 0, nullif(trim(p_comment), ''), auth.uid());
  exception when unique_violation then
    -- Параллельная повторная отправка того же чека — идемпотентный ответ
    return v_sale_id;
  end;

  for v_item in select * from jsonb_array_elements(p_items) loop
    -- Блокировка от параллельной продажи того же номера
    select * into v_copy
      from art.edition_copies
     where id = (v_item->>'copy_id')::uuid
     for update;

    if not found then
      raise exception 'Экземпляр не найден';
    end if;
    if v_copy.status not in ('not_printed', 'printed', 'signed') then
      raise exception 'Номер % недоступен для продажи (статус: %)',
        v_copy.copy_number, v_copy.status;
    end if;
    -- Физический экземпляр можно продать только в его филиале;
    -- неотпечатанный номер печатается в филиале продажи
    if v_copy.status in ('printed', 'signed')
       and v_copy.branch_id <> v_branch then
      raise exception 'Номер % находится в другом филиале — оформите перемещение',
        v_copy.copy_number;
    end if;

    select * into v_edition from art.editions where id = v_copy.edition_id;

    v_framed   := coalesce((v_item->>'framed')::boolean, false);
    v_discount := coalesce((v_item->>'discount')::numeric, 0);
    v_base     := case when v_framed then v_edition.price_framed
                       else v_edition.price_unframed end;

    if v_discount < 0 or v_discount > v_base then
      raise exception 'Некорректная скидка по номеру %', v_copy.copy_number;
    end if;
    v_final := v_base - v_discount;

    insert into art.sale_items
      (sale_id, copy_id, framed, base_price, discount, final_price,
       royalty_amount, needs_production)
    values
      (v_sale_id, v_copy.id, v_framed, v_base, v_discount, v_final,
       v_edition.royalty_amount,          -- фикс ₽, скидка и рамка не влияют
       v_copy.status <> 'signed');

    update art.edition_copies
       set status = 'sold', branch_id = v_branch
     where id = v_copy.id;

    v_total   := v_total + v_final;
    v_royalty := v_royalty + v_edition.royalty_amount;
  end loop;

  update art.sales
     set total = v_total, royalty_total = v_royalty
   where id = v_sale_id;

  return v_sale_id;
end;
$$;

grant execute on function art.sell(jsonb, text, text, text, uuid, text, uuid, uuid) to authenticated;

-- Обновить кэш PostgREST (новая таблица + новая сигнатура sell)
notify pgrst, 'reload schema';
