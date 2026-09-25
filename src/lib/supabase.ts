import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !anonKey) {
  throw new Error(
    'Не заданы VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (см. .env.example)',
  )
}

// Основной клиент работает со схемой art; финансовый слой — через supabase.schema('finance')
export const supabase = createClient(url, anonKey, {
  db: { schema: 'art' },
})

export const finance = supabase.schema('finance')
