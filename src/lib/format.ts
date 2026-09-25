export function fmtRub(n: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' ₽'
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU')
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Локальная дата YYYY-MM-DD (не UTC) — ключ рабочей смены */
export function todayStr(): string {
  return new Date().toLocaleDateString('sv')
}

/** Короткая метка филиала для бейджей на сетке номеров (ТЗ §5.3) */
export function branchAbbr(name: string): string {
  const known: Record<string, string> = {
    'Москва': 'МСК',
    'Санкт-Петербург': 'СПб',
  }
  return known[name] ?? name.slice(0, 3).toUpperCase()
}
