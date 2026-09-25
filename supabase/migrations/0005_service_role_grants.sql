-- ============================================================
-- Миграция 0005: гранты для service_role (Edge Functions)
--
-- Edge Function manage-users ходит в art.user_roles сервисным
-- ключом через PostgREST. На кастомные схемы (в отличие от
-- public) Supabase не раздаёт права service_role автоматически —
-- без этих грантов функция не видит роли и отвечает
-- «Недостаточно прав» даже владельцу.
-- RLS на service_role не действует (bypassrls) — политики
-- ограничивать не будут, это ожидаемо для серверного ключа.
-- ============================================================
grant usage on schema art to service_role;
grant all on all tables in schema art to service_role;
alter default privileges in schema art grant all on tables to service_role;

grant usage on schema finance to service_role;
grant all on all tables in schema finance to service_role;
alter default privileges in schema finance grant all on tables to service_role;
