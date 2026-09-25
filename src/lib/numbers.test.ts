import { describe, expect, it } from 'vitest'
import { parseNumbers } from './numbers'

describe('parseNumbers', () => {
  it('разбирает номера и диапазоны, сортирует и убирает дубли', () => {
    expect(parseNumbers('8, 1-3, 2, 5–6', 10)).toEqual([1, 2, 3, 5, 6, 8])
  })

  it('пустой ввод и лишние запятые', () => {
    expect(parseNumbers('   ', 10)).toEqual([])
    expect(parseNumbers(' , 4 ,, ', 10)).toEqual([4])
  })

  it('пробелы вокруг дефиса', () => {
    expect(parseNumbers('1 - 3', 10)).toEqual([1, 2, 3])
  })

  it('границы тиража включительно', () => {
    expect(parseNumbers('1, 30', 30)).toEqual([1, 30])
    expect(parseNumbers('1-30', 30)).toHaveLength(30)
  })

  it('номер вне тиража — ошибка', () => {
    expect(() => parseNumbers('31', 30)).toThrow('Номер 31 вне тиража 1–30')
    expect(() => parseNumbers('0', 30)).toThrow('Номер 0 вне тиража 1–30')
  })

  it('диапазон за пределами тиража — ошибка', () => {
    expect(() => parseNumbers('28-31', 30)).toThrow('Диапазон «28-31» вне тиража 1–30')
  })

  it('перевёрнутый диапазон — ошибка', () => {
    expect(() => parseNumbers('5-2', 10)).toThrow('начало больше конца')
  })

  it('непонятный ввод — ошибка с подсказкой формата', () => {
    for (const bad of ['abc', '1-', '-3', '2.5']) {
      expect(() => parseNumbers(bad, 10)).toThrow('Не понял')
    }
  })
})
