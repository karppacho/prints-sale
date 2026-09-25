-- ============================================================
-- Миграция 0002: сводный отчёт по транзакциям направлений компании
-- (только владелец). Для картин используется ФАКТИЧЕСКАЯ оплата
-- (paid_at / paid_method); неоплаченные постоплаты в денежный
-- отчёт не попадают, пока долг не закрыт.
--
-- Ветка «Багет» сверена с фактической схемой public.orders
-- (июль 2026, подтверждено заказчиком):
--   - деньги считаются полученными при статусах 'done' и 'issued';
--   - даты оплаты багет не хранит — используется created_at
--     (дата оформления заказа; updated_at не годится: меняется
--     при любой правке и «переносил» бы заказы между периодами);
--   - способ оплаты багет не хранит — null;
--   - ссылка — человекочитаемый order_number.
-- ============================================================
create or replace function finance.transactions_report(
  p_from timestamptz default '-infinity',
  p_to   timestamptz default 'infinity'
)
returns table (
  direction      text,
  branch         text,   -- филиал (для направлений без филиального учёта — null)
  happened_at    timestamptz,
  amount         numeric,
  payment_method text,
  reference      text
)
language plpgsql stable security definer
set search_path = finance, art, public
as $$
begin
  if art.my_role() <> 'owner' then
    raise exception 'Отчёт доступен только владельцу';
  end if;

  return query
  select
    'Картины'::text,
    b.name,
    s.paid_at,
    s.total,
    s.paid_method,
    'Чек от ' || to_char(s.sold_at, 'DD.MM.YYYY') ||
      case when s.fair_name is not null then ' · ' || s.fair_name else '' end
  from art.sales s
  join art.branches b on b.id = s.branch_id
  where not s.is_cancelled
    and s.is_paid
    and s.paid_at between p_from and p_to

  union all

  select
    'Багет'::text,
    null::text,                 -- филиальный учёт багета не ведётся
    o.created_at,               -- даты оплаты в багете нет; дата заказа
    coalesce(o.total_price, 0),
    null::text,                 -- способ оплаты багет не хранит
    'Заказ №' || coalesce(o.order_number::text, o.id::text)
  from public.orders o
  where o.status in ('done', 'issued')          -- деньги получены (подтверждено заказчиком)
    and coalesce(o.is_active_draft, false) = false
    and o.created_at between p_from and p_to

  order by 3 desc;  -- по дате
end;
$$;

grant execute on function finance.transactions_report(timestamptz, timestamptz) to authenticated;

-- Подключение направления 3, 4… = ещё один блок UNION ALL.

notify pgrst, 'reload schema';
