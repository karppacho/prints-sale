import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { ShiftProvider } from './auth/ShiftContext'
import { CartProvider } from './cart/CartContext'
import { RequireAuth, RequireRole, RequireShift } from './auth/ProtectedRoute'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import ShiftModePage from './pages/ShiftModePage'
import ArtistsPage from './pages/ArtistsPage'
import EditionsPage from './pages/EditionsPage'
import CopiesPage from './pages/CopiesPage'
import TransfersPage from './pages/TransfersPage'
import IntakePage from './pages/IntakePage'
import CartPage from './pages/CartPage'
import CancelSalesPage from './pages/CancelSalesPage'
import ProductionQueuePage from './pages/ProductionQueuePage'
import DebtorsPage from './pages/DebtorsPage'
import ReportsPage from './pages/ReportsPage'
import PayoutsPage from './pages/PayoutsPage'
import AdminPage from './pages/AdminPage'

export default function App() {
  return (
    <AuthProvider>
      <ShiftProvider>
        <CartProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />

              <Route element={<RequireAuth />}>
                <Route path="/shift" element={<ShiftModePage />} />

                <Route element={<RequireShift />}>
                  <Route element={<Layout />}>
                    <Route index element={<ArtistsPage />} />
                    <Route path="artists/:artistId" element={<EditionsPage />} />
                    <Route path="editions/:editionId" element={<CopiesPage />} />
                    <Route path="cart" element={<CartPage />} />
                    <Route path="transfers" element={<TransfersPage />} />
                    {/* Отмена чеков: все роли; охват (свой филиал / все) ограничивает БД */}
                    <Route path="cancel-sales" element={<CancelSalesPage />} />

                    <Route element={<RequireRole allow={['admin', 'owner']} />}>
                      <Route path="queue" element={<ProductionQueuePage />} />
                      <Route path="intake" element={<IntakePage />} />
                      <Route path="admin" element={<AdminPage />} />
                    </Route>

                    <Route element={<RequireRole allow={['owner']} />}>
                      <Route path="debtors" element={<DebtorsPage />} />
                      <Route path="reports" element={<ReportsPage />} />
                      <Route path="payouts" element={<PayoutsPage />} />
                    </Route>

                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Route>
                </Route>
              </Route>
            </Routes>
          </BrowserRouter>
        </CartProvider>
      </ShiftProvider>
    </AuthProvider>
  )
}
