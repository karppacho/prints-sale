import { supabase } from '../lib/supabase'

/**
 * Отправка чека одним запросом (ТЗ §5.4а, устойчивость к плохой связи):
 * id чека генерируется на клиенте ДО отправки — повторная отправка того же
 * чека не создаёт дубль (идемпотентность внутри RPC sell). При сетевой
 * ошибке заполненный чек сохраняется на устройстве с кнопкой «Повторить».
 */
export interface SalePayload {
  saleId: string
  items: { copy_id: string; framed: boolean; discount: number }[]
  paymentMethod: string
  buyerType: string
  fairName: string | null
  /** Должник из справочника art.debtors (обязателен при постоплате) */
  debtorId: string | null
  comment: string | null
  /** Только для владельца без филиала */
  branchId: string | null
  /** Для показа в баннере неотправленного чека */
  totalHint: number
  savedAt?: string
}

const PENDING_KEY = 'art.pendingSale'

export function newSaleId(): string {
  return crypto.randomUUID()
}

export function loadPending(): SalePayload | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    return raw ? (JSON.parse(raw) as SalePayload) : null
  } catch {
    return null
  }
}

export function savePending(p: SalePayload): void {
  localStorage.setItem(PENDING_KEY, JSON.stringify({ ...p, savedAt: new Date().toISOString() }))
}

export function clearPending(): void {
  localStorage.removeItem(PENDING_KEY)
}

export type SubmitResult =
  | { ok: true; saleId: string }
  | { ok: false; error: string; retriable: boolean }

function isNetworkError(message: string): boolean {
  return /failed to fetch|networkerror|load failed|network request failed|timeout/i.test(
    message,
  )
}

export async function submitSale(p: SalePayload): Promise<SubmitResult> {
  try {
    const { data, error } = await supabase.rpc('sell', {
      p_items: p.items,
      p_payment_method: p.paymentMethod,
      p_buyer_type: p.buyerType,
      p_fair_name: p.fairName,
      p_debtor_id: p.debtorId,
      p_comment: p.comment,
      p_sale_id: p.saleId,
      p_branch_id: p.branchId,
    })
    if (error) {
      const retriable = isNetworkError(error.message)
      if (retriable) savePending(p)
      return { ok: false, error: error.message, retriable }
    }
    clearPending()
    return { ok: true, saleId: data as string }
  } catch (e) {
    const msg = (e as Error).message ?? String(e)
    const retriable = isNetworkError(msg)
    if (retriable) savePending(p)
    return {
      ok: false,
      error: retriable ? 'Нет связи — чек сохранён, повторите отправку' : msg,
      retriable,
    }
  }
}
