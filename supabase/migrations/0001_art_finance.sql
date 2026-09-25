-- ============================================================
-- Миграция 0001: схемы art + finance по ТЗ §4.2 (версия 2.1)
--
-- Отличия от SQL в ТЗ (исправления, согласованные с логикой ТЗ):
--   1. send_transfer: строгая проверка «все экземпляры в одном
--      филиале» (в ТЗ select into + group by молча брал первую
--      строку) + блокировка строк for update.
--   2. cancel_sale: при возврате экземпляра в not_printed
--      очищается branch_id (у неотпечатанных филиала нет).
--   3. sell: одновременная повторная отправка чека с тем же id
--      обрабатывается идемпотентно (unique_violation -> return),
--      а не ошибкой.
--   4. production_queue: продавцу — явный отказ (raise), а не
--      пустой список (приёмка ТЗ §4.5 п.5).
--   5. finance.transactions_report вынесен в миграцию 0002 —
--      его ветка «Багет» требует сверки с фактической схемой
--      public.orders (ТЗ §4.5 п.4).
--
-- После выполнения: добавить art и finance в exposed schemas
-- PostgREST (self-hosted: PGRST_DB_SCHEMAS в .env docker-compose,
-- перезапустить сервис rest). См. docs/DB_SETUP.md.
-- ============================================================

-- ============================================================
-- 0. Схемы и общий справочник способов оплаты
-- ============================================================
create schema if not exists art;
create schema if not exists finance;

create table finance.payment_methods (
  code        text primary key,
  label       text not null,
  is_deferred boolean not null default false, -- true: деньги в момент оформления не получены (постоплата)
  is_active   boolean not null default true,
  sort_order  int not null default 100
);

insert into finance.payment_methods (code, label, is_deferred, sort_order) values
  ('cash',     'Наличные',   false, 10),
  ('card',     'Карта',      false, 20),
  ('transfer', 'Перевод',    false, 30),
  ('invoice',  'Счёт',       false, 40),
  ('postpaid', 'Постоплата', true,  50),
  ('other',    'Другое',     false, 90);

-- ============================================================
-- 1. Филиалы и роли
-- ============================================================
create table art.branches (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

insert into art.branches (name) values ('Москва'), ('Санкт-Петербург');

create table art.user_roles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  role         text not null check (role in ('owner', 'admin', 'seller')),
  branch_id    uuid references art.branches(id), -- обязателен для seller/admin;
                                                 -- у владельца может быть пуст
  display_name text,
  created_at   timestamptz not null default now(),
  constraint staff_branch_required
    check (role = 'owner' or branch_id is not null)
);

create or replace function art.my_role()
returns text
language sql stable security definer
set search_path = art, public
as $$
  select role from art.user_roles where user_id = auth.uid();
$$;

create or replace function art.my_branch()
returns uuid
language sql stable security definer
set search_path = art, public
as $$
  select branch_id from art.user_roles where user_id = auth.uid();
$$;

-- ============================================================
-- 2. Художники
-- ============================================================
create table art.artists (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  contact    text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 3. Тиражи
-- ============================================================
create table art.editions (
  id             uuid primary key default gen_random_uuid(),
  artist_id      uuid not null references art.artists(id),
  title          text,
  alt_titles     text[] not null default '{}',  -- теги/альтернативные названия (поиск, будущий сайт)
  image_path     text,
  edition_size   int  not null check (edition_size > 0),
  price_unframed numeric(10,2) not null,
  price_framed   numeric(10,2) not null,
  royalty_amount numeric(10,2) not null check (royalty_amount >= 0), -- фикс ₽ художнику за экземпляр
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now()
);

create index editions_artist_idx on art.editions(artist_id);

-- ============================================================
-- 4. Экземпляры
--    not_printed -> printed -> signed -> sold; reserved — бронь.
--    branch_id — где экземпляр находится ФИЗИЧЕСКИ; для
--    not_printed пуст (номер существует только в тираже).
-- ============================================================
create table art.edition_copies (
  id          uuid primary key default gen_random_uuid(),
  edition_id  uuid not null references art.editions(id) on delete cascade,
  copy_number int  not null,
  status      text not null default 'not_printed'
              check (status in ('not_printed', 'printed', 'signed',
                                'reserved', 'sold')),
  branch_id   uuid references art.branches(id),
  location    text,
  unique (edition_id, copy_number),
  constraint physical_copy_has_branch
    check (status = 'not_printed' or branch_id is not null)
);

create index copies_edition_idx on art.edition_copies(edition_id);
create index copies_status_idx  on art.edition_copies(status);
create index copies_branch_idx  on art.edition_copies(branch_id);

-- ============================================================
-- 4а. История перемещений между филиалами.
--     Перемещаются только ПОДПИСАННЫЕ экземпляры; филиал
--     меняется сразу при оформлении (без этапа приёмки),
--     запись — для истории «кто, что, когда, куда».
-- ============================================================
create table art.transfers (
  id             uuid primary key default gen_random_uuid(),
  from_branch_id uuid not null references art.branches(id),
  to_branch_id   uuid not null references art.branches(id),
  sent_by        uuid not null,
  sent_at        timestamptz not null default now(),
  comment        text,
  check (from_branch_id <> to_branch_id)
);

create table art.transfer_items (
  transfer_id uuid not null references art.transfers(id),
  copy_id     uuid not null references art.edition_copies(id),
  primary key (transfer_id, copy_id)
);

-- ============================================================
-- 5. Типы покупателей (финальный список предоставит заказчик)
-- ============================================================
create table art.buyer_types (
  code       text primary key,
  label      text not null,
  is_active  boolean not null default true,
  sort_order int not null default 100
);

insert into art.buyer_types (code, label, sort_order) values
  ('retail', 'Покупатель', 10),
  ('fair',   'Ярмарка',    20);

-- ============================================================
-- 6. Чеки и позиции
-- ============================================================
create table art.sales (
  id             uuid primary key default gen_random_uuid(),
  sold_at        timestamptz not null default now(),
  branch_id      uuid not null references art.branches(id), -- проставляется из учётки сотрудника
  buyer_type     text not null references art.buyer_types(code),
  fair_name      text,                          -- название ярмарки (режим «ярмарка»)
  payment_method text not null references finance.payment_methods(code), -- выбран при оформлении
  is_paid        boolean not null,
  paid_at        timestamptz,
  paid_method    text references finance.payment_methods(code), -- ФАКТИЧЕСКИЙ способ (для постоплаты — при закрытии)
  debtor_name    text,                          -- обязательны при постоплате
  debtor_contact text,
  total          numeric(10,2) not null,
  royalty_total  numeric(10,2) not null,
  comment        text,
  created_by     uuid not null,
  is_cancelled   boolean not null default false,
  cancelled_at   timestamptz,
  cancelled_by   uuid
);

create index sales_sold_at_idx on art.sales(sold_at);
create index sales_unpaid_idx  on art.sales(is_paid) where not is_paid;

create table art.sale_items (
  id               uuid primary key default gen_random_uuid(),
  sale_id          uuid not null references art.sales(id),
  copy_id          uuid not null references art.edition_copies(id),
  framed           boolean not null,
  base_price       numeric(10,2) not null,
  discount         numeric(10,2) not null default 0 check (discount >= 0),
  final_price      numeric(10,2) not null check (final_price >= 0),
  royalty_amount   numeric(10,2) not null,      -- снимок с тиража на момент продажи
  needs_production boolean not null default false, -- продан номер, не имевший статуса signed
  produced_at      timestamptz                  -- отметка «отпечатан и подписан»
);

create index items_sale_idx on art.sale_items(sale_id);
create index items_production_idx on art.sale_items(needs_production)
  where needs_production and produced_at is null;

-- ============================================================
-- 7. Выплаты художникам
-- ============================================================
create table art.artist_payouts (
  id         uuid primary key default gen_random_uuid(),
  artist_id  uuid not null references art.artists(id),
  amount     numeric(10,2) not null check (amount > 0),
  paid_at    date not null default current_date,
  comment    text,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 8. VIEW: балансы художников (фактически доступен владельцу —
--    security_invoker применяет RLS нижележащих таблиц)
-- ============================================================
create or replace view art.artist_balances
with (security_invoker = true) as
select
  a.id   as artist_id,
  a.name as artist_name,
  coalesce(s.accrued, 0)                       as accrued,
  coalesce(p.paid, 0)                          as paid,
  coalesce(s.accrued, 0) - coalesce(p.paid, 0) as balance
from art.artists a
left join (
  select e.artist_id, sum(i.royalty_amount) as accrued
  from art.sale_items i
  join art.sales s          on s.id = i.sale_id and not s.is_cancelled
  join art.edition_copies c on c.id = i.copy_id
  join art.editions e       on e.id = c.edition_id
  group by e.artist_id
) s on s.artist_id = a.id
left join (
  select artist_id, sum(amount) as paid
  from art.artist_payouts
  group by artist_id
) p on p.artist_id = a.id;

-- ============================================================
-- 9. RPC: приход тиража
--    p_printed / p_signed — номера отпечатанных и подписанных
--    (подписанные автоматически считаются отпечатанными).
--    p_branch_id — филиал, куда физически поступают отпечатанные
--    и подписанные экземпляры; по умолчанию — филиал сотрудника.
-- ============================================================
create or replace function art.add_edition(
  p_artist_id      uuid,
  p_title          text,
  p_alt_titles     text[],
  p_image_path     text,
  p_edition_size   int,
  p_royalty_amount numeric,
  p_printed        int[] default '{}',
  p_signed         int[] default '{}',
  p_price_unframed numeric default null,
  p_price_framed   numeric default null,
  p_branch_id      uuid    default null
)
returns uuid
language plpgsql security definer
set search_path = art, public
as $$
declare
  v_edition_id uuid;
  v_branch     uuid := coalesce(p_branch_id, art.my_branch());
begin
  if art.my_role() not in ('admin', 'owner') then
    raise exception 'Приход тиража доступен администратору и владельцу';
  end if;
  if p_edition_size is null or p_edition_size <= 0 then
    raise exception 'Некорректный размер тиража';
  end if;
  if p_royalty_amount is null or p_royalty_amount < 0 then
    raise exception 'Укажите роялти художника (₽ за экземпляр)';
  end if;
  if p_price_unframed is null or p_price_unframed < 0
     or p_price_framed is null or p_price_framed < 0 then
    raise exception 'Укажите цены без рамки и с рамкой';
  end if;
  if v_branch is null
     and (coalesce(array_length(p_printed, 1), 0) > 0
          or coalesce(array_length(p_signed, 1), 0) > 0) then
    raise exception 'Укажите филиал поступления экземпляров';
  end if;

  insert into art.editions
    (artist_id, title, alt_titles, image_path, edition_size,
     royalty_amount, price_unframed, price_framed, created_by)
  values
    (p_artist_id, nullif(trim(p_title), ''), coalesce(p_alt_titles, '{}'),
     p_image_path, p_edition_size, p_royalty_amount,
     p_price_unframed, p_price_framed, auth.uid())
  returning id into v_edition_id;

  insert into art.edition_copies (edition_id, copy_number, status, branch_id)
  select
    v_edition_id, n,
    case
      when n = any(coalesce(p_signed,  '{}')) then 'signed'
      when n = any(coalesce(p_printed, '{}')) then 'printed'
      else 'not_printed'
    end,
    case
      when n = any(coalesce(p_signed, '{}')) or n = any(coalesce(p_printed, '{}'))
      then v_branch
      else null
    end
  from generate_series(1, p_edition_size) as n;

  return v_edition_id;
end;
$$;

-- ============================================================
-- 10. RPC: изменение статусов печати/подписи (админ, владелец)
--     Не затрагивает проданные, забронированные и едущие номера.
--     При печати фиксируется филиал (по умолчанию — филиал
--     сотрудника); при возврате в «не отпечатан» филиал
--     очищается.
-- ============================================================
create or replace function art.update_copies_status(
  p_edition_id uuid,
  p_numbers    int[],
  p_status     text,
  p_branch_id  uuid default null
)
returns int
language plpgsql security definer
set search_path = art, public
as $$
declare
  v_count  int;
  v_branch uuid := coalesce(p_branch_id, art.my_branch());
begin
  if art.my_role() not in ('admin', 'owner') then
    raise exception 'Недостаточно прав';
  end if;
  if p_status not in ('not_printed', 'printed', 'signed') then
    raise exception 'Недопустимый статус';
  end if;
  if p_status <> 'not_printed' and v_branch is null then
    raise exception 'Укажите филиал';
  end if;

  update art.edition_copies
     set status = p_status,
         branch_id = case when p_status = 'not_printed'
                          then null else v_branch end
   where edition_id = p_edition_id
     and copy_number = any(p_numbers)
     and status in ('not_printed', 'printed', 'signed');

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ============================================================
-- 10а. RPC: перемещение между филиалами.
--      Без приёмки: экземпляры сразу меняют филиал, история
--      перемещений сохраняется в transfers. Работает в любом
--      направлении (Москва -> Питер, Питер -> Москва и т.д.).
--      Отправлять могут админ и владелец из любого филиала;
--      продавец — только из своего.
-- ============================================================
create or replace function art.send_transfer(
  p_copy_ids     uuid[],
  p_to_branch_id uuid,
  p_comment      text default null
)
returns uuid
language plpgsql security definer
set search_path = art, public
as $$
declare
  v_role        text := art.my_role();
  v_transfer_id uuid;
  v_from        uuid;
  v_branches    int;
  v_locked      int;
  v_count       int;
begin
  if v_role not in ('seller', 'admin', 'owner') then
    raise exception 'Недостаточно прав';
  end if;
  if coalesce(array_length(p_copy_ids, 1), 0) = 0 then
    raise exception 'Не выбраны экземпляры';
  end if;

  -- Блокируем строки и проверяем: все экземпляры существуют,
  -- подписаны и лежат в одном филиале
  select count(*), count(distinct branch_id), min(branch_id::text)::uuid
    into v_locked, v_branches, v_from
    from (
      select branch_id
        from art.edition_copies
       where id = any(p_copy_ids)
         and status = 'signed'
         and branch_id is not null
         for update
    ) t;

  if v_locked <> array_length(p_copy_ids, 1) then
    raise exception 'Перемещать можно только подписанные экземпляры';
  end if;
  if v_branches <> 1 then
    raise exception 'Экземпляры должны находиться в одном филиале';
  end if;
  if v_from = p_to_branch_id then
    raise exception 'Филиал отправления совпадает с получателем';
  end if;
  if v_role = 'seller' and art.my_branch() <> v_from then
    raise exception 'Продавец перемещает экземпляры только из своего филиала';
  end if;

  insert into art.transfers (from_branch_id, to_branch_id, sent_by, comment)
  values (v_from, p_to_branch_id, auth.uid(), nullif(trim(p_comment), ''))
  returning id into v_transfer_id;

  update art.edition_copies
     set branch_id = p_to_branch_id
   where id = any(p_copy_ids)
     and status = 'signed'
     and branch_id = v_from;

  get diagnostics v_count = row_count;
  if v_count <> array_length(p_copy_ids, 1) then
    raise exception 'Перемещать можно только подписанные экземпляры';
  end if;

  insert into art.transfer_items (transfer_id, copy_id)
  select v_transfer_id, unnest(p_copy_ids);

  return v_transfer_id;
end;
$$;

-- ============================================================
-- 11. RPC: продажа (корзина одним чеком)
--     p_items: [{"copy_id": "...", "framed": true, "discount": 0}, ...]
--     Продавать можно: not_printed (печать в филиале продажи),
--     printed / signed — только физически находящиеся в филиале
--     продавца. Филиал чека берётся из учётки сотрудника (клиент
--     подделать его не может); владелец без филиала передаёт
--     p_branch_id явно. Цены и роялти фиксируются внутри БД.
-- ============================================================
create or replace function art.sell(
  p_items          jsonb,
  p_payment_method text,
  p_buyer_type     text,
  p_fair_name      text default null,
  p_debtor_name    text default null,
  p_debtor_contact text default null,
  p_comment        text default null,
  p_sale_id        uuid default null, -- id чека, сгенерированный клиентом:
                                      -- повторная отправка того же чека при
                                      -- плохой связи не создаёт дубль
  p_branch_id      uuid default null  -- используется, только если у
                                      -- сотрудника не задан филиал (владелец)
)
returns uuid
language plpgsql security definer
set search_path = art, finance, public
as $$
declare
  v_role       text := art.my_role();
  v_branch     uuid := coalesce(art.my_branch(), p_branch_id);
  v_deferred   boolean;
  v_sale_id    uuid := coalesce(p_sale_id, gen_random_uuid());
  v_item       jsonb;
  v_copy       art.edition_copies%rowtype;
  v_edition    art.editions%rowtype;
  v_framed     boolean;
  v_discount   numeric;
  v_base       numeric;
  v_final      numeric;
  v_total      numeric := 0;
  v_royalty    numeric := 0;
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

  if v_deferred and (nullif(trim(p_debtor_name), '') is null) then
    raise exception 'Для постоплаты укажите должника и контакт';
  end if;

  begin
    insert into art.sales
      (id, branch_id, buyer_type, fair_name, payment_method,
       is_paid, paid_at, paid_method,
       debtor_name, debtor_contact, total, royalty_total, comment, created_by)
    values
      (v_sale_id, v_branch, p_buyer_type, nullif(trim(p_fair_name), ''),
       p_payment_method,
       not v_deferred,
       case when v_deferred then null else now() end,
       case when v_deferred then null else p_payment_method end,
       nullif(trim(p_debtor_name), ''), nullif(trim(p_debtor_contact), ''),
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

-- ============================================================
-- 12. RPC: закрытие постоплаты (владелец)
--     Фиксируется ФАКТИЧЕСКИЙ способ получения денег — именно
--     он попадает в финансовую отчётность.
-- ============================================================
create or replace function art.confirm_payment(
  p_sale_id     uuid,
  p_paid_method text
)
returns void
language plpgsql security definer
set search_path = art, finance, public
as $$
begin
  if art.my_role() <> 'owner' then
    raise exception 'Доступно только владельцу';
  end if;
  if not exists (select 1 from finance.payment_methods
                 where code = p_paid_method and not is_deferred) then
    raise exception 'Укажите фактический способ оплаты (не постоплату)';
  end if;

  update art.sales
     set is_paid = true, paid_at = now(), paid_method = p_paid_method
   where id = p_sale_id and not is_paid and not is_cancelled;

  if not found then
    raise exception 'Чек не найден, уже оплачен или отменён';
  end if;
end;
$$;

-- ============================================================
-- 13. RPC: отмена чека (владелец)
--     Начисления художникам снимаются автоматически (VIEW
--     исключает отменённые чеки). Экземпляры возвращаются:
--     если печать не выполнялась — в not_printed (без филиала),
--     иначе в signed (в филиале продажи).
-- ============================================================
create or replace function art.cancel_sale(
  p_sale_id uuid,
  p_reason  text default null
)
returns void
language plpgsql security definer
set search_path = art, public
as $$
begin
  if art.my_role() <> 'owner' then
    raise exception 'Отмена доступна только владельцу';
  end if;

  update art.sales
     set is_cancelled = true,
         cancelled_at = now(),
         cancelled_by = auth.uid(),
         comment = trim(coalesce(comment, '') ||
                        case when p_reason is not null
                             then E'\nОтмена: ' || p_reason else '' end)
   where id = p_sale_id and not is_cancelled;

  if not found then
    raise exception 'Чек не найден или уже отменён';
  end if;

  update art.edition_copies c
     set status = case
                    when i.needs_production and i.produced_at is null
                    then 'not_printed'
                    else 'signed'
                  end,
         branch_id = case
                       when i.needs_production and i.produced_at is null
                       then null
                       else c.branch_id
                     end
    from art.sale_items i
   where i.sale_id = p_sale_id
     and c.id = i.copy_id;
end;
$$;

-- ============================================================
-- 14. RPC: очередь «К печати» (админ, владелец) — проданные
--     номера, требующие печати/подписи. Без денежных полей —
--     администратор не видит суммы. Остальным ролям — отказ.
-- ============================================================
create or replace function art.production_queue()
returns table (
  item_id     uuid,
  sold_at     timestamptz,
  artist_name text,
  title       text,
  copy_number int,
  framed      boolean,
  branch_name text   -- филиал продажи = где печатать и подписывать
)
language plpgsql stable security definer
set search_path = art, public
as $$
begin
  if art.my_role() not in ('admin', 'owner') then
    raise exception 'Недостаточно прав';
  end if;

  return query
  select i.id, s.sold_at, a.name,
         coalesce(e.title, 'Без названия'), c.copy_number, i.framed, b.name
  from art.sale_items i
  join art.sales s          on s.id = i.sale_id and not s.is_cancelled
  join art.edition_copies c on c.id = i.copy_id
  join art.editions e       on e.id = c.edition_id
  join art.artists a        on a.id = e.artist_id
  join art.branches b       on b.id = s.branch_id
  where i.needs_production and i.produced_at is null
  order by s.sold_at;
end;
$$;

create or replace function art.mark_produced(p_item_id uuid)
returns void
language plpgsql security definer
set search_path = art, public
as $$
begin
  if art.my_role() not in ('admin', 'owner') then
    raise exception 'Недостаточно прав';
  end if;
  update art.sale_items
     set produced_at = now()
   where id = p_item_id and needs_production and produced_at is null;
end;
$$;

-- ============================================================
-- 15. RLS
-- ============================================================
alter table art.user_roles      enable row level security;
alter table art.branches        enable row level security;
alter table art.artists         enable row level security;
alter table art.editions        enable row level security;
alter table art.edition_copies  enable row level security;
alter table art.transfers       enable row level security;
alter table art.transfer_items  enable row level security;
alter table art.buyer_types     enable row level security;
alter table art.sales           enable row level security;
alter table art.sale_items      enable row level security;
alter table art.artist_payouts  enable row level security;
alter table finance.payment_methods enable row level security;

-- Филиалы: читают все сотрудники, управляет владелец
create policy branches_select on art.branches
  for select to authenticated
  using (art.my_role() in ('seller', 'admin', 'owner'));
create policy branches_owner_write on art.branches
  for all to authenticated
  using (art.my_role() = 'owner')
  with check (art.my_role() = 'owner');

-- Перемещения (история): видят все сотрудники; создание — через RPC;
-- прямые правки — только владелец
create policy transfers_select on art.transfers
  for select to authenticated
  using (art.my_role() in ('seller', 'admin', 'owner'));
create policy transfers_owner_write on art.transfers
  for all to authenticated
  using (art.my_role() = 'owner')
  with check (art.my_role() = 'owner');

create policy transfer_items_select on art.transfer_items
  for select to authenticated
  using (art.my_role() in ('seller', 'admin', 'owner'));
create policy transfer_items_owner_write on art.transfer_items
  for all to authenticated
  using (art.my_role() = 'owner')
  with check (art.my_role() = 'owner');

-- user_roles: свою роль видит каждый; админ видит и управляет
-- ТОЛЬКО продавцами; владелец — всеми
create policy roles_select on art.user_roles
  for select to authenticated
  using (user_id = auth.uid() or art.my_role() in ('admin', 'owner'));

create policy roles_admin_sellers on art.user_roles
  for all to authenticated
  using (art.my_role() = 'admin' and role = 'seller')
  with check (art.my_role() = 'admin' and role = 'seller');

create policy roles_owner_all on art.user_roles
  for all to authenticated
  using (art.my_role() = 'owner')
  with check (art.my_role() = 'owner');

-- Каталог (художники, тиражи, экземпляры, типы покупателей):
-- читают все роли; пишут админ и владелец (плюс RPC)
create policy artists_select on art.artists
  for select to authenticated
  using (art.my_role() in ('seller', 'admin', 'owner'));
create policy artists_write on art.artists
  for all to authenticated
  using (art.my_role() in ('admin', 'owner'))
  with check (art.my_role() in ('admin', 'owner'));

create policy editions_select on art.editions
  for select to authenticated
  using (art.my_role() in ('seller', 'admin', 'owner'));
create policy editions_write on art.editions
  for all to authenticated
  using (art.my_role() in ('admin', 'owner'))
  with check (art.my_role() in ('admin', 'owner'));

create policy copies_select on art.edition_copies
  for select to authenticated
  using (art.my_role() in ('seller', 'admin', 'owner'));
create policy copies_write on art.edition_copies
  for all to authenticated
  using (art.my_role() in ('admin', 'owner'))
  with check (art.my_role() in ('admin', 'owner'));

create policy buyer_types_select on art.buyer_types
  for select to authenticated
  using (art.my_role() in ('seller', 'admin', 'owner'));
create policy buyer_types_write on art.buyer_types
  for all to authenticated
  using (art.my_role() in ('admin', 'owner'))
  with check (art.my_role() in ('admin', 'owner'));

-- Деньги: ТОЛЬКО владелец. У продавца и админа нет даже SELECT.
-- Записи создаются через RPC sell (security definer).
create policy sales_owner_all on art.sales
  for all to authenticated
  using (art.my_role() = 'owner')
  with check (art.my_role() = 'owner');

create policy items_owner_all on art.sale_items
  for all to authenticated
  using (art.my_role() = 'owner')
  with check (art.my_role() = 'owner');

create policy payouts_owner_all on art.artist_payouts
  for all to authenticated
  using (art.my_role() = 'owner')
  with check (art.my_role() = 'owner');

-- Способы оплаты: читают все сотрудники, изменяет владелец
create policy pm_select on finance.payment_methods
  for select to authenticated using (true);
create policy pm_owner_write on finance.payment_methods
  for all to authenticated
  using (art.my_role() = 'owner')
  with check (art.my_role() = 'owner');

-- ============================================================
-- 16. Grants
-- ============================================================
grant usage on schema art to authenticated;
grant select, insert, update, delete on all tables in schema art to authenticated;
grant execute on all functions in schema art to authenticated;

grant usage on schema finance to authenticated;
grant select on finance.payment_methods to authenticated;
grant execute on all functions in schema finance to authenticated;

revoke all on all tables in schema art from anon;
revoke usage on schema art from anon;
revoke all on all tables in schema finance from anon;
revoke usage on schema finance from anon;

-- ============================================================
-- 17. Storage: приватный bucket для фото
-- ============================================================
insert into storage.buckets (id, name, public)
values ('art-images', 'art-images', false)
on conflict (id) do nothing;

create policy art_images_read on storage.objects
  for select to authenticated
  using (bucket_id = 'art-images'
         and art.my_role() in ('seller', 'admin', 'owner'));

create policy art_images_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'art-images'
              and art.my_role() in ('admin', 'owner'));

create policy art_images_manage on storage.objects
  for delete to authenticated
  using (bucket_id = 'art-images' and art.my_role() = 'owner');
