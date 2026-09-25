export type Role = 'seller' | 'admin' | 'owner'

export type CopyStatus = 'not_printed' | 'printed' | 'signed' | 'reserved' | 'sold'

export interface Branch {
  id: string
  name: string
  is_active: boolean
}

export interface Artist {
  id: string
  name: string
  contact: string | null
  is_active: boolean
}

export interface Edition {
  id: string
  artist_id: string
  title: string | null
  alt_titles: string[]
  image_path: string | null
  edition_size: number
  price_unframed: number
  price_framed: number
  royalty_amount: number
}

export interface EditionCopy {
  id: string
  edition_id: string
  copy_number: number
  status: CopyStatus
  branch_id: string | null
  location: string | null
}

export interface BuyerType {
  code: string
  label: string
  is_active: boolean
  sort_order: number
}

export interface PaymentMethod {
  code: string
  label: string
  is_deferred: boolean
  is_active: boolean
  sort_order: number
}

export interface Debtor {
  id: string
  name: string
  contact: string | null
  is_active: boolean
}

export interface Sale {
  id: string
  sold_at: string
  branch_id: string
  buyer_type: string
  fair_name: string | null
  payment_method: string
  is_paid: boolean
  paid_at: string | null
  paid_method: string | null
  debtor_id: string | null
  debtor_name: string | null
  debtor_contact: string | null
  total: number
  royalty_total: number
  comment: string | null
  created_by: string
  is_cancelled: boolean
  cancelled_at: string | null
  cancel_reason: string | null
}

/** Позиция чека в списке экрана «Отмена чека» (RPC sales_for_cancel) */
export interface CancelSaleItem {
  artist_name: string
  title: string
  copy_number: number
  framed: boolean
  image_path: string | null
}

/** Чек в списке экрана «Отмена чека» (RPC sales_for_cancel) */
export interface CancelSaleRow {
  sale_id: string
  sold_at: string
  total: number
  payment_method: string
  is_paid: boolean
  is_cancelled: boolean
  cancel_reason: string | null
  sale_comment: string | null
  seller_name: string
  items: CancelSaleItem[]
}

export interface SaleItem {
  id: string
  sale_id: string
  copy_id: string
  framed: boolean
  base_price: number
  discount: number
  final_price: number
  royalty_amount: number
  needs_production: boolean
  produced_at: string | null
}

export interface ArtistPayout {
  id: string
  artist_id: string
  amount: number
  paid_at: string
  comment: string | null
}

export interface ArtistBalance {
  artist_id: string
  artist_name: string
  accrued: number
  paid: number
  balance: number
}

export interface UserRole {
  user_id: string
  role: Role
  branch_id: string | null
  display_name: string | null
  created_at: string
  login?: string | null
}

export interface Transfer {
  id: string
  from_branch_id: string
  to_branch_id: string
  sent_by: string
  sent_at: string
  comment: string | null
}
