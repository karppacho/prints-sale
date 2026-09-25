-- ============================================================
-- Миграция 0003: view для счётчиков каталога (ТЗ §5.2)
-- «Тираж 30 · подписано 5 · продано 3 · можно допечатать 22»
-- security_invoker: применяется RLS art.edition_copies —
-- счётчики видят те же роли, что и каталог.
-- ============================================================
create or replace view art.edition_stats
with (security_invoker = true) as
select
  e.id as edition_id,
  count(c.*) filter (where c.status = 'signed')      as signed_cnt,
  count(c.*) filter (where c.status = 'printed')     as printed_cnt,
  count(c.*) filter (where c.status = 'sold')        as sold_cnt,
  count(c.*) filter (where c.status = 'not_printed') as not_printed_cnt,
  count(c.*) filter (where c.status = 'reserved')    as reserved_cnt
from art.editions e
left join art.edition_copies c on c.edition_id = e.id
group by e.id;

-- grant "on all tables" из 0001 новые объекты не покрывает
grant select on art.edition_stats to authenticated;
