/**
 * Парсер номеров экземпляров «1-5, 8, 12» (ТЗ §5.6 п.6).
 * Возвращает отсортированный список без дублей или бросает ошибку
 * с человекочитаемым текстом.
 */
export function parseNumbers(input: string, max: number): number[] {
  const result = new Set<number>()
  const trimmed = input.trim()
  if (!trimmed) return []

  for (const part of trimmed.split(',')) {
    const p = part.trim()
    if (!p) continue
    const range = p.match(/^(\d+)\s*[-–]\s*(\d+)$/)
    if (range) {
      const from = parseInt(range[1], 10)
      const to = parseInt(range[2], 10)
      if (from > to) throw new Error(`Диапазон «${p}»: начало больше конца`)
      if (from < 1 || to > max) throw new Error(`Диапазон «${p}» вне тиража 1–${max}`)
      for (let n = from; n <= to; n++) result.add(n)
    } else if (/^\d+$/.test(p)) {
      const n = parseInt(p, 10)
      if (n < 1 || n > max) throw new Error(`Номер ${n} вне тиража 1–${max}`)
      result.add(n)
    } else {
      throw new Error(`Не понял «${p}» — используйте номера и диапазоны: 1-5, 8`)
    }
  }
  return [...result].sort((a, b) => a - b)
}
