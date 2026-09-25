import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { todayStr } from '../lib/format'

export type ShiftMode = 'store' | 'fair'

const SHIFT_KEY = 'art.shift'

interface StoredShift {
  date: string
  mode: ShiftMode
  fairName: string | null
}

interface ShiftContextValue {
  mode: ShiftMode | null
  fairName: string | null
  setStoreMode: () => void
  setFairMode: (name: string) => void
  clearShift: () => void
}

const ShiftContext = createContext<ShiftContextValue | null>(null)

function load(): StoredShift | null {
  try {
    const raw = localStorage.getItem(SHIFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredShift
    // Смена живёт в рамках календарной даты (ТЗ §5.1)
    if (parsed.date !== todayStr()) {
      localStorage.removeItem(SHIFT_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function ShiftProvider({ children }: { children: ReactNode }) {
  const [shift, setShift] = useState<StoredShift | null>(load)

  const save = useCallback((next: StoredShift | null) => {
    setShift(next)
    if (next) localStorage.setItem(SHIFT_KEY, JSON.stringify(next))
    else localStorage.removeItem(SHIFT_KEY)
  }, [])

  // Наступила новая дата — смена завершена
  useEffect(() => {
    const check = () => {
      if (shift && shift.date !== todayStr()) save(null)
    }
    const interval = setInterval(check, 60_000)
    window.addEventListener('focus', check)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', check)
    }
  }, [shift, save])

  const setStoreMode = useCallback(
    () => save({ date: todayStr(), mode: 'store', fairName: null }),
    [save],
  )

  const setFairMode = useCallback(
    (name: string) => save({ date: todayStr(), mode: 'fair', fairName: name }),
    [save],
  )

  const clearShift = useCallback(() => save(null), [save])

  return (
    <ShiftContext.Provider
      value={{
        mode: shift?.mode ?? null,
        fairName: shift?.fairName ?? null,
        setStoreMode,
        setFairMode,
        clearShift,
      }}
    >
      {children}
    </ShiftContext.Provider>
  )
}

export function useShift(): ShiftContextValue {
  const ctx = useContext(ShiftContext)
  if (!ctx) throw new Error('useShift вне ShiftProvider')
  return ctx
}
