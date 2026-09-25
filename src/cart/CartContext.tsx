import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { CopyStatus } from '../types'

export interface CartItem {
  copyId: string
  editionId: string
  copyNumber: number
  editionSize: number
  title: string | null
  artistName: string
  imagePath: string | null
  /** Статус на момент добавления — для бейджа «требует печати» */
  status: CopyStatus
  priceUnframed: number
  priceFramed: number
  framed: boolean
  discount: number
}

export function itemPrice(item: CartItem): number {
  const base = item.framed ? item.priceFramed : item.priceUnframed
  return Math.max(0, base - item.discount)
}

interface CartContextValue {
  items: CartItem[]
  total: number
  add: (item: Omit<CartItem, 'framed' | 'discount'>) => void
  remove: (copyId: string) => void
  setFramed: (copyId: string, framed: boolean) => void
  setDiscount: (copyId: string, discount: number) => void
  has: (copyId: string) => boolean
  clear: () => void
}

const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([])

  const add = useCallback((item: Omit<CartItem, 'framed' | 'discount'>) => {
    setItems((prev) =>
      prev.some((i) => i.copyId === item.copyId)
        ? prev
        : [...prev, { ...item, framed: false, discount: 0 }],
    )
  }, [])

  const remove = useCallback((copyId: string) => {
    setItems((prev) => prev.filter((i) => i.copyId !== copyId))
  }, [])

  const setFramed = useCallback((copyId: string, framed: boolean) => {
    setItems((prev) => prev.map((i) => (i.copyId === copyId ? { ...i, framed } : i)))
  }, [])

  const setDiscount = useCallback((copyId: string, discount: number) => {
    setItems((prev) => prev.map((i) => (i.copyId === copyId ? { ...i, discount } : i)))
  }, [])

  const has = useCallback(
    (copyId: string) => items.some((i) => i.copyId === copyId),
    [items],
  )

  const clear = useCallback(() => setItems([]), [])

  const total = useMemo(() => items.reduce((s, i) => s + itemPrice(i), 0), [items])

  return (
    <CartContext.Provider value={{ items, total, add, remove, setFramed, setDiscount, has, clear }}>
      {children}
    </CartContext.Provider>
  )
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart вне CartProvider')
  return ctx
}
