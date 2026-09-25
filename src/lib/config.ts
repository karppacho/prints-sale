// Настройки конкретной инсталляции — из .env.local (см. .env.example)

/** Название в шапке, на экране входа и во вкладке браузера */
export const APP_NAME =
  (import.meta.env.VITE_APP_NAME as string | undefined) || 'Учёт картин'

/** Домен технической почты: логин хранится в Supabase Auth как <login>@<домен> */
export const LOGIN_DOMAIN = import.meta.env.VITE_LOGIN_DOMAIN as string

if (!LOGIN_DOMAIN) {
  throw new Error('Не задан VITE_LOGIN_DOMAIN (см. .env.example)')
}

/** Цены, которыми предзаполняется приход тиража; пусто — вводятся вручную */
export const DEFAULT_PRICE_UNFRAMED =
  (import.meta.env.VITE_DEFAULT_PRICE_UNFRAMED as string | undefined) ?? ''
export const DEFAULT_PRICE_FRAMED =
  (import.meta.env.VITE_DEFAULT_PRICE_FRAMED as string | undefined) ?? ''
