export interface HistoryItem {
  id: string
  artist_id: string
  sold_at: string
  royalty: number
}

export interface PayoutRow {
  artist_id: string
  amount: number
  paid_at: string
}

/**
 * FIFO-привязка выплат к продажам: роялти накапливаются в порядке продаж,
 * выплаты закрывают их в порядке дат. Дата оплаты роялти позиции — paid_at
 * выплаты, которая первой покрыла её накопительную сумму; пусто, если ещё
 * не покрыта.
 */
export function royaltyPaidDates(
  items: HistoryItem[],
  payouts: PayoutRow[],
): Map<string, string> {
  const result = new Map<string, string>()
  const itemsByArtist = new Map<string, HistoryItem[]>()
  for (const it of items) {
    const list = itemsByArtist.get(it.artist_id) ?? []
    list.push(it)
    itemsByArtist.set(it.artist_id, list)
  }
  const payoutsByArtist = new Map<string, PayoutRow[]>()
  for (const p of payouts) {
    const list = payoutsByArtist.get(p.artist_id) ?? []
    list.push(p)
    payoutsByArtist.set(p.artist_id, list)
  }

  const EPS = 1e-6
  for (const [artistId, list] of itemsByArtist) {
    list.sort((a, b) => a.sold_at.localeCompare(b.sold_at) || a.id.localeCompare(b.id))
    const pays = (payoutsByArtist.get(artistId) ?? []).sort((a, b) =>
      a.paid_at.localeCompare(b.paid_at),
    )
    let cumRoyalty = 0
    let cumPaid = 0
    let payIdx = 0
    for (const it of list) {
      cumRoyalty += it.royalty
      while (payIdx < pays.length && cumPaid + EPS < cumRoyalty) {
        cumPaid += pays[payIdx].amount
        payIdx++
      }
      if (payIdx > 0 && cumPaid + EPS >= cumRoyalty) {
        result.set(it.id, pays[payIdx - 1].paid_at)
      }
    }
  }
  return result
}
