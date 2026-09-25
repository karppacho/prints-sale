import * as XLSX from 'xlsx-js-style'
import { supabase } from '../lib/supabase'
import { royaltyPaidDates, type HistoryItem, type PayoutRow } from '../lib/royalty'

/**
 * Excel-выгрузки в браузере (SheetJS-форк с поддержкой стилей, ТЗ §5.8):
 * листы «Детализация» и «Сводка по художникам», плюс разрезы по способам
 * оплаты и филиалам. Неоплаченные чеки (должники) выделяются жёлтым.
 * Файл пригоден для отправки художнику как основание выплаты.
 */
export interface SaleItemDetail {
  saleId: string
  itemId: string
  artistId: string
  soldAt: string
  paidAt: string | null
  isPaid: boolean
  isCancelled: boolean
  branch: string
  buyerType: string
  fairName: string | null
  paymentMethod: string
  paidMethod: string | null
  debtorName: string | null
  artist: string
  title: string
  copyNumber: number
  framed: boolean
  basePrice: number
  discount: number
  finalPrice: number
  royalty: number
}

const d = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ru-RU') : '')

/** Дата без времени (paid_at выплат — тип date): разбор строки, без таймзон */
const dDate = (s: string | null) => {
  if (!s) return ''
  const [y, m, day] = s.split('T')[0].split('-')
  return day && m && y ? `${day}.${m}.${y}` : ''
}

const YELLOW_FILL = { fill: { patternType: 'solid', fgColor: { rgb: 'FFF59D' } } }

/**
 * Полная история роялти (не только выгружаемый период — иначе FIFO неверен).
 * Постранично: PostgREST режет ответы по max-rows.
 */
async function fetchRoyaltyHistory(): Promise<HistoryItem[]> {
  const PAGE = 1000
  const out: HistoryItem[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('sale_items')
      .select(
        'id, royalty_amount, sales!inner(sold_at, is_cancelled), edition_copies!inner(editions!inner(artist_id))',
      )
      .eq('sales.is_cancelled', false)
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as unknown as {
      id: string
      royalty_amount: number
      sales: { sold_at: string }
      edition_copies: { editions: { artist_id: string } }
    }[]
    for (const r of rows) {
      out.push({
        id: r.id,
        artist_id: r.edition_copies.editions.artist_id,
        sold_at: r.sales.sold_at,
        royalty: r.royalty_amount,
      })
    }
    if (rows.length < PAGE) break
  }
  return out
}

export async function exportSalesReport(
  rows: SaleItemDetail[],
  filename: string,
): Promise<void> {
  // Дата оплаты роялти: FIFO по полной истории продаж и выплат
  const [history, payoutsRes] = await Promise.all([
    fetchRoyaltyHistory(),
    supabase.from('artist_payouts').select('artist_id, amount, paid_at'),
  ])
  if (payoutsRes.error) throw payoutsRes.error
  const royaltyDates = royaltyPaidDates(
    history,
    (payoutsRes.data ?? []) as PayoutRow[],
  )

  const wb = XLSX.utils.book_new()

  // 1. Детализация (порядок ключей = порядок столбцов)
  const detail = rows.map((r) => ({
    'Художник': r.artist,
    'Картина': r.title,
    'Номер': r.copyNumber,
    'Рама': r.framed ? 'с рамой' : 'без рамы',
    'Тип покупателя': r.buyerType,
    'Филиал': r.branch,
    'Способ оплаты': r.paidMethod ?? r.paymentMethod,
    'Дата продажи': d(r.soldAt),
    'Дата оплаты': d(r.paidAt),
    'Цена': r.basePrice,
    'Скидка': r.discount,
    'Итог': r.finalPrice,
    'Роялти': r.royalty,
    'Дата оплаты роялти': dDate(royaltyDates.get(r.itemId) ?? null),
  }))
  const ws = XLSX.utils.json_to_sheet(detail)
  const COLS = 14
  rows.forEach((r, idx) => {
    if (r.isPaid || r.isCancelled) return // жёлтым — только должники
    for (let c = 0; c < COLS; c++) {
      const addr = XLSX.utils.encode_cell({ r: idx + 1, c })
      const cell = ws[addr] ?? (ws[addr] = { t: 's', v: '' })
      cell.s = YELLOW_FILL
    }
  })
  XLSX.utils.book_append_sheet(wb, ws, 'Детализация')

  // 2. Сводка по художникам
  const byArtist = new Map<string, { n: number; revenue: number; royalty: number }>()
  for (const r of rows) {
    const a = byArtist.get(r.artist) ?? { n: 0, revenue: 0, royalty: 0 }
    a.n += 1
    a.revenue += r.finalPrice
    a.royalty += r.royalty
    byArtist.set(r.artist, a)
  }
  const artistRows = [...byArtist.entries()]
    .sort((x, y) => x[0].localeCompare(y[0], 'ru'))
    .map(([artist, a]) => ({
      'Художник': artist,
      'Продано, шт.': a.n,
      'Выручка': a.revenue,
      'Роялти начислено': a.royalty,
    }))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(artistRows), 'Сводка по художникам')

  // 3. По способам оплаты (фактические поступления)
  const byMethod = new Map<string, number>()
  for (const r of rows.filter((x) => x.isPaid && x.paidMethod)) {
    const key = `${r.paidMethod}||${r.branch}`
    byMethod.set(key, (byMethod.get(key) ?? 0) + r.finalPrice)
  }
  const methodRows = [...byMethod.entries()]
    .sort()
    .map(([key, sum]) => {
      const [method, branch] = key.split('||')
      return { 'Способ оплаты': method, 'Филиал': branch, 'Поступило': sum }
    })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(methodRows), 'По способам оплаты')

  // 4. По филиалам
  const byBranch = new Map<string, { n: number; revenue: number }>()
  for (const r of rows) {
    const b = byBranch.get(r.branch) ?? { n: 0, revenue: 0 }
    b.n += 1
    b.revenue += r.finalPrice
    byBranch.set(r.branch, b)
  }
  const branchRows = [...byBranch.entries()]
    .sort((x, y) => x[0].localeCompare(y[0], 'ru'))
    .map(([branch, b]) => ({
      'Филиал': branch,
      'Продано, шт.': b.n,
      'Выручка': b.revenue,
    }))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(branchRows), 'По филиалам')

  XLSX.writeFile(wb, filename)
}
