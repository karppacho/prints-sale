-- ============================================================
-- Миграция 0006: отмена чеков продавцом/админом + печать ≡ подпись
--
-- По итогам эксплуатации:
--   1. Отменять чеки могут продавец и админ (свой филиал), а не
--      только владелец. Причина отмены обязательна и хранится в
--      отдельной колонке cancel_reason (comment больше не трогаем).
--   2. Новый RPC sales_for_cancel — список чеков филиала для
--      экрана отмены (без общей сводки продаж): сумма, продавец,
--      комментарий, позиции с картинками.
--   3. Очередь печати возвращает image_path — превью в интерфейсе.
--   4. Тиражи печатаются и подписываются одновременно: статус
--      «отпечатан, не подписан» упраздняется, существующие
--      printed переводятся в signed. CHECK-констрейнт и view
--      edition_stats не меняем ('printed' остаётся легальным
--      значением-«запаской», printed_cnt станет 0).
-- ============================================================

-- 1. Причина отмены — отдельная колонка
alter table art.sales add column cancel_reason text;

-- 2. Печать ≡ подпись: конвертация существующих статусов
--    (printed-строки уже имеют branch_id — physical_copy_has_branch
--    не нарушается)
update art.edition_copies set status = 'signed' where status = 'printed';

-- ============================================================
-- 3. update_copies_status: статус 'printed' больше не назначается.
--    В WHERE оставляем 'printed', чтобы случайные остатки можно
--    было исправить.
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
  if p_status not in ('not_printed', 'signed') then
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
-- 4. cancel_sale: продавец/админ — чеки своего филиала,
--    владелец — любые. Причина обязательна, пишется в
--    cancel_reason. Восстановление экземпляров — как раньше.
--    Сигнатура прежняя (default null оставлен, чтобы вызов без
--    p_reason получал читаемую ошибку, а не «function not found»).
-- ============================================================
create or replace function art.cancel_sale(
  p_sale_id uuid,
  p_reason  text default null
)
returns void
language plpgsql security definer
set search_path = art, public
as $$
declare
  v_role   text := art.my_role();
  v_reason text := nullif(trim(p_reason), '');
  v_sale   art.sales%rowtype;
begin
  if v_role not in ('seller', 'admin', 'owner') then
    raise exception 'Недостаточно прав';
  end if;
  if v_reason is null then
    raise exception 'Укажите причину отмены';
  end if;

  select * into v_sale from art.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Чек не найден';
  end if;
  if v_sale.is_cancelled then
    raise exception 'Чек уже отменён';
  end if;
  if v_role <> 'owner' and v_sale.branch_id is distinct from art.my_branch() then
    raise exception 'Можно отменять только чеки своего филиала';
  end if;

  update art.sales
     set is_cancelled  = true,
         cancelled_at  = now(),
         cancelled_by  = auth.uid(),
         cancel_reason = v_reason
   where id = p_sale_id;

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
-- 5. production_queue: + image_path для превью.
--    Тип возврата меняется — create or replace невозможен,
--    пересоздаём. Денежных полей по-прежнему нет.
-- ============================================================
drop function if exists art.production_queue();

create function art.production_queue()
returns table (
  item_id     uuid,
  sold_at     timestamptz,
  artist_name text,
  title       text,
  copy_number int,
  framed      boolean,
  branch_name text,  -- филиал продажи = где печатать и подписывать
  image_path  text
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
         coalesce(e.title, 'Без названия'), c.copy_number, i.framed, b.name,
         e.image_path
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

-- ============================================================
-- 6. sales_for_cancel: чеки для экрана «Отмена чека».
--    Продавец/админ — свой филиал, владелец — все. Намеренно
--    security definer поверх owner-only RLS: по решению заказчика
--    сотрудник видит чеки филиала с суммами (но не сводку).
-- ============================================================
create or replace function art.sales_for_cancel(
  p_limit  int default 100,
  p_offset int default 0
)
returns table (
  sale_id        uuid,
  sold_at        timestamptz,
  total          numeric,
  payment_method text,
  is_paid        boolean,
  is_cancelled   boolean,
  cancel_reason  text,
  sale_comment   text,
  seller_name    text,
  items          jsonb
)
language plpgsql stable security definer
set search_path = art, public
as $$
begin
  if art.my_role() not in ('seller', 'admin', 'owner') then
    raise exception 'Недостаточно прав';
  end if;

  return query
  select s.id, s.sold_at, s.total, s.payment_method, s.is_paid,
         s.is_cancelled, s.cancel_reason, s.comment,
         coalesce(ur.display_name, 'сотрудник'),
         (select jsonb_agg(jsonb_build_object(
                   'artist_name', a.name,
                   'title',       coalesce(e.title, 'Без названия'),
                   'copy_number', c.copy_number,
                   'framed',      i.framed,
                   'image_path',  e.image_path)
                 order by c.copy_number)
            from art.sale_items i
            join art.edition_copies c on c.id = i.copy_id
            join art.editions e       on e.id = c.edition_id
            join art.artists a        on a.id = e.artist_id
           where i.sale_id = s.id)
  from art.sales s
  left join art.user_roles ur on ur.user_id = s.created_by
  where art.my_role() = 'owner' or s.branch_id = art.my_branch()
  order by s.sold_at desc
  limit p_limit offset p_offset;
end;
$$;

-- ============================================================
-- 7. Гранты и кэш PostgREST
-- ============================================================
grant execute on function art.production_queue()          to authenticated;
grant execute on function art.sales_for_cancel(int, int)  to authenticated;
grant execute on function art.cancel_sale(uuid, text)     to authenticated;

notify pgrst, 'reload schema';
