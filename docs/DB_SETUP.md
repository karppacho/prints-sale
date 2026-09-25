# Развёртывание БД на VPS (self-hosted Supabase)

Порядок действий на сервере, где уже работает Supabase с основной системой (схема `public`).
Схемы `art` и `finance` — новые, существующие данные не затрагиваются.

## 1. Применить миграции

Через Supabase Studio (SQL Editor) или psql внутри контейнера БД:

```bash
# путь к docker-compose Supabase — обычно ~/supabase/docker
docker compose exec db psql -U postgres -d postgres \
  -f /path/to/0001_art_finance.sql
```

Файлы: `supabase/migrations/0001_art_finance.sql`, затем `0002_transactions_report.sql`.

**Перед 0002** сверить схему багета (имена колонок даты/суммы и значения статусов
в `public.orders` — в ТЗ они помечены как предположение):

```sql
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'orders';
select distinct status from public.orders;
```

При расхождении поправить ветку «Багет» в 0002.

## 2. Открыть схемы для API (PostgREST)

В `.env` docker-compose Supabase найти `PGRST_DB_SCHEMAS` и добавить `art,finance`
к существующему списку (существующие значения не удалять!), например:

```
PGRST_DB_SCHEMAS=public,storage,graphql_public,art,finance
```

Перезапустить PostgREST:

```bash
docker compose up -d rest
```

## 3. Задеплоить Edge Function `manage-users`

Функция использует стандартные переменные окружения контейнера
(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) и одну свою — `LOGIN_DOMAIN`:
домен технической почты, тот же, что `VITE_LOGIN_DOMAIN` фронтенда. Без неё
функция отвечает ошибкой «Не задан LOGIN_DOMAIN». Добавить в сервис
`functions` docker-compose:

```yaml
  functions:
    environment:
      LOGIN_DOMAIN: company.local   # свой домен
```

Self-hosted: функции лежат в volume контейнера `functions` (обычно
`volumes/functions/`). Скопировать папку и пересоздать контейнер
(`up -d`, а не `restart` — иначе новая переменная не подхватится):

```bash
cp -r supabase/functions/manage-users /path/to/supabase/docker/volumes/functions/
docker compose up -d functions
```

URL функции: `<SUPABASE_URL>/functions/v1/manage-users`.

## 4. Создать владельца

Первый пользователь создаётся вручную (Edge Function требует уже существующего
владельца/админа). В Studio → Authentication → Add user, либо SQL:

```sql
-- в контейнере db; заменить ЛОГИН и ПАРОЛЬ
select auth.uid(); -- не нужно, просто создаём через API/Studio
```

Проще через Studio: email `<логин>@<домен>` (домен — значение `VITE_LOGIN_DOMAIN`),
пароль, Auto Confirm = on.
Затем назначить роль:

```sql
insert into art.user_roles (user_id, role, display_name)
select id, 'owner', 'Владелец'
from auth.users where email = '<логин>@<домен>';
```

Тестовых админа (Москва) и продавца (СПб) после этого можно создать
из приложения (раздел «Управление») или тем же способом с указанием
`branch_id` из `art.branches`.

## 5. Проверка прав (приёмка этапа 1, ТЗ §4.5 п.5)

Под каждой ролью (через приложение или REST с соответствующим JWT):

- **продавец**: `select * from art.sales` — пусто; `art.production_queue()` — ошибка
  «Недостаточно прав»; продажа экземпляра чужого филиала — ошибка;
- **админ**: очередь печати работает (без сумм); продажи не видны;
- **владелец**: видит всё; `finance.transactions_report()` возвращает оба направления;
- **аноним**: любой запрос к `art.*` — отказ.
