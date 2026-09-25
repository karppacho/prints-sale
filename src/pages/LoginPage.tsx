import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { APP_NAME } from '../lib/config'

export default function LoginPage() {
  const { session, loading, signIn } = useAuth()
  const navigate = useNavigate()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!loading && session) return <Navigate to="/shift" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!login.trim() || !password) return
    setBusy(true)
    setError(null)
    const err = await signIn(login, password)
    setBusy(false)
    if (err) setError(err)
    else navigate('/shift', { replace: true })
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-xl">
        <h1 className="text-xl font-bold text-center">{APP_NAME}</h1>
        <p className="text-sm text-gray-500 text-center mt-1 mb-6">Вход для сотрудников</p>

        <label className="block text-sm font-medium text-gray-700">
          Логин
          <input
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
        </label>

        <label className="block text-sm font-medium text-gray-700 mt-4">
          Пароль
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
        </label>

        {error && <div className="mt-4 text-sm text-red-600 text-center">{error}</div>}

        <button
          type="submit"
          disabled={busy || !login.trim() || !password}
          className="mt-6 w-full bg-gray-900 text-white rounded-lg py-3 font-semibold disabled:opacity-50"
        >
          {busy ? 'Вход…' : 'Войти'}
        </button>
      </form>
    </div>
  )
}
