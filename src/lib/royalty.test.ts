import { describe, expect, it } from 'vitest'
import { royaltyPaidDates, type HistoryItem, type PayoutRow } from './royalty'

const sale = (id: string, soldAt: string, royalty: number, artist = 'A'): HistoryItem => ({
  id,
  artist_id: artist,
  sold_at: soldAt,
  royalty,
})

const payout = (paidAt: string, amount: number, artist = 'A'): PayoutRow => ({
  artist_id: artist,
  amount,
  paid_at: paidAt,
})

describe('royaltyPaidDates (FIFO)', () => {
  it('выплата закрывает продажи по порядку, остаток не оплачен', () => {
    const dates = royaltyPaidDates(
      [sale('s1', '2026-01-10', 100), sale('s2', '2026-01-20', 100), sale('s3', '2026-02-01', 100)],
      [payout('2026-02-05', 200)],
    )
    expect(dates.get('s1')).toBe('2026-02-05')
    expect(dates.get('s2')).toBe('2026-02-05')
    expect(dates.has('s3')).toBe(false)
  })

  it('частичная выплата не закрывает позицию — дата у выплаты, которая её докрыла', () => {
    const dates = royaltyPaidDates(
      [sale('s1', '2026-01-10', 100)],
      [payout('2026-03-01', 60), payout('2026-03-15', 40)],
    )
    expect(dates.get('s1')).toBe('2026-03-15')
  })

  it('порядок — по дате продажи и выплаты, а не по порядку во входных данных', () => {
    const dates = royaltyPaidDates(
      [sale('late', '2026-02-01', 100), sale('early', '2026-01-01', 100)],
      [payout('2026-03-20', 100), payout('2026-03-10', 100)],
    )
    expect(dates.get('early')).toBe('2026-03-10')
    expect(dates.get('late')).toBe('2026-03-20')
  })

  it('художники считаются раздельно', () => {
    const dates = royaltyPaidDates(
      [sale('a1', '2026-01-10', 100, 'A'), sale('b1', '2026-01-10', 100, 'B')],
      [payout('2026-02-01', 500, 'A')],
    )
    expect(dates.get('a1')).toBe('2026-02-01')
    expect(dates.has('b1')).toBe(false)
  })

  it('переплата засчитывается в следующие продажи', () => {
    const dates = royaltyPaidDates(
      [sale('s1', '2026-01-10', 100), sale('s2', '2026-03-01', 50)],
      [payout('2026-02-01', 150)],
    )
    expect(dates.get('s2')).toBe('2026-02-01')
  })

  it('копейки не ломают сравнение сумм', () => {
    const dates = royaltyPaidDates(
      [sale('s1', '2026-01-10', 0.1), sale('s2', '2026-01-11', 0.2)],
      [payout('2026-02-01', 0.3)],
    )
    expect(dates.get('s2')).toBe('2026-02-01')
  })

  it('без выплат ничего не оплачено', () => {
    expect(royaltyPaidDates([sale('s1', '2026-01-10', 100)], []).size).toBe(0)
  })
})
