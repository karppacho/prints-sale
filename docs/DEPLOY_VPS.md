# Деплой фронтенда на VPS

Домены ниже — примеры, подставить свои: приложение — **app.example.com**, Supabase — supabase.example.com,
веб-сервер — nginx. База развёрнута по [DB_SETUP.md](DB_SETUP.md).

## 0. DNS

A-запись `app.example.com` → IP VPS (тот же, что у supabase.example.com).

## 1. Сборка

На машине разработки:

```bash
# .env.local должен содержать боевые VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run build
```

Результат — папка `dist/` (статические файлы, ~800 КБ + фото грузятся из Storage).

## 2. Загрузка на сервер

Из папки проекта (PowerShell; USER@SERVER заменить на свои):

```powershell
scp -r .\dist USER@SERVER:/tmp/art-dist
```

На сервере:

```bash
sudo mkdir -p /var/www/app
sudo cp -r /tmp/art-dist/* /var/www/app/
rm -rf /tmp/art-dist
```

## 3. nginx

`/etc/nginx/sites-available/app.example.com`:

```nginx
server {
    listen 80;
    server_name app.example.com;

    root /var/www/app;
    index index.html;

    # SPA: все пути отдают index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Кэш статики (файлы с хэшем в имени)
    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/app.example.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

HTTPS (certbot сам перепишет конфиг на 443 и добавит редирект):

```bash
sudo certbot --nginx -d app.example.com
```

## 4. CORS

Браузер ходит с `https://app.example.com` напрямую в Supabase (Kong).
CORS уже подтверждён рабочим: вход с localhost:5173 (другой origin) работал —
значит, Kong пропускает кросс-доменные запросы. Если после деплоя в консоли
браузера всё же появятся ошибки CORS — смотреть `volumes/api/kong.yml`, плагин cors.

## 5. Обновление версии

```powershell
npm run build
scp -r .\dist USER@SERVER:/tmp/art-dist
```

```bash
sudo cp -r /tmp/art-dist/* /var/www/app/ && rm -rf /tmp/art-dist
```

(имена файлов содержат хэш — кэш браузеров обновится сам).

## 6. Перед боевым запуском

1. Очистить тестовые данные (порядок важен из-за FK):

```sql
truncate art.sale_items, art.sales, art.transfer_items, art.transfers,
         art.artist_payouts, art.edition_copies, art.editions, art.artists
         restart identity cascade;
```

2. Завести реальные учётки (владелец → «Управление» → «Сотрудники»).
3. Оприходовать реальные тиражи.
4. Неделя наблюдения (этап 7 ТЗ).
