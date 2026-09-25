import { supabase } from './supabase'
import type {
  Artist,
  Branch,
  BuyerType,
  CancelSaleRow,
  Debtor,
  Edition,
  EditionCopy,
  PaymentMethod,
} from '../types'

export interface EditionStats {
  edition_id: string
  signed_cnt: number
  printed_cnt: number
  sold_cnt: number
  not_printed_cnt: number
  reserved_cnt: number
}

export async function fetchArtists(): Promise<Artist[]> {
  const { data, error } = await supabase
    .from('artists')
    .select('*')
    .eq('is_active', true)
    .order('name')
  if (error) throw error
  return (data ?? []) as Artist[]
}

export async function fetchEditionStats(): Promise<EditionStats[]> {
  const { data, error } = await supabase.from('edition_stats').select('*')
  if (error) throw error
  return (data ?? []) as EditionStats[]
}

export interface EditionWithArtist extends Edition {
  artists: { name: string }
}

export async function fetchEditionsWithArtists(): Promise<EditionWithArtist[]> {
  const { data, error } = await supabase
    .from('editions')
    .select('*, artists(name)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as EditionWithArtist[]
}

export async function fetchEdition(id: string): Promise<EditionWithArtist | null> {
  const { data, error } = await supabase
    .from('editions')
    .select('*, artists(name)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data as unknown as EditionWithArtist | null
}

export async function fetchCopies(editionId: string): Promise<EditionCopy[]> {
  const { data, error } = await supabase
    .from('edition_copies')
    .select('*')
    .eq('edition_id', editionId)
    .order('copy_number')
  if (error) throw error
  return (data ?? []) as EditionCopy[]
}

export async function fetchBranches(): Promise<Branch[]> {
  const { data, error } = await supabase
    .from('branches')
    .select('*')
    .order('name')
  if (error) throw error
  return (data ?? []) as Branch[]
}

export async function fetchBuyerTypes(): Promise<BuyerType[]> {
  const { data, error } = await supabase
    .from('buyer_types')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')
  if (error) throw error
  return (data ?? []) as BuyerType[]
}

export async function fetchDebtors(): Promise<Debtor[]> {
  const { data, error } = await supabase
    .from('debtors')
    .select('*')
    .eq('is_active', true)
    .order('name')
  if (error) throw error
  return (data ?? []) as Debtor[]
}

/** Создание должника при продаже (доступно всем ролям, контакт необязателен) */
export async function createDebtor(name: string, contact: string | null): Promise<Debtor> {
  const { data, error } = await supabase
    .from('debtors')
    .insert({ name: name.trim(), contact: contact?.trim() || null })
    .select('*')
    .single()
  if (error) throw error
  return data as Debtor
}

export async function fetchPaymentMethods(): Promise<PaymentMethod[]> {
  const { data, error } = await supabase
    .schema('finance')
    .from('payment_methods')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')
  if (error) throw error
  return (data ?? []) as PaymentMethod[]
}

/** Чеки филиала для экрана «Отмена чека» (продавец/админ — свой филиал, владелец — все) */
export async function fetchSalesForCancel(limit = 100, offset = 0): Promise<CancelSaleRow[]> {
  const { data, error } = await supabase.rpc('sales_for_cancel', {
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw error
  return (data ?? []) as CancelSaleRow[]
}

/** Имена сотрудников по uuid (для отчёта владельца: кто продал) */
export async function fetchUserDisplayNames(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('user_roles').select('user_id, display_name')
  if (error) throw error
  const m = new Map<string, string>()
  for (const r of (data ?? []) as { user_id: string; display_name: string | null }[]) {
    if (r.display_name) m.set(r.user_id, r.display_name)
  }
  return m
}

/** Поиск по названию и тегам (клиентская фильтрация — каталог небольшой) */
export function editionMatches(e: EditionWithArtist, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    (e.title ?? '').toLowerCase().includes(q) ||
    e.artists.name.toLowerCase().includes(q) ||
    e.alt_titles.some((t) => t.toLowerCase().includes(q))
  )
}
