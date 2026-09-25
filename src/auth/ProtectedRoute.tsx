import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { useShift } from './ShiftContext'
import type { Role } from '../types'

export function RequireAuth() {
  const { session, loading, role } = useAuth()
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">
        Загрузка…
      </div>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  if (!role) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center text-gray-600">
        Учётке не назначена роль. Обратитесь к администратору.
      </div>
    )
  }
  return <Outlet />
}

/** Требует выбранного режима смены (магазин/ярмарка) */
export function RequireShift() {
  const { mode } = useShift()
  const location = useLocation()
  if (!mode) return <Navigate to="/shift" replace state={{ from: location.pathname }} />
  return <Outlet />
}

/** Ограничение раздела по ролям (удобство UI; защита данных — RLS в БД) */
export function RequireRole({ allow }: { allow: Role[] }) {
  const { role } = useAuth()
  if (!role || !allow.includes(role)) return <Navigate to="/" replace />
  return <Outlet />
}
