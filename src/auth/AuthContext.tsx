import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { LOGIN_DOMAIN } from '../lib/config'
import { todayStr } from '../lib/format'
import type { Role } from '../types'

const SESSION_DATE_KEY = 'art.sessionDate'

interface Profile {
  role: Role
  branchId: string | null
  branchName: string | null
  displayName: string | null
}

interface AuthContextValue {
  session: Session | null
  loading: boolean
  role: Role | null
  branchId: string | null
  branchName: string | null
  displayName: string | null
  login: string | null
  signIn: (login: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const signOut = useCallback(async () => {
    localStorage.removeItem(SESSION_DATE_KEY)
    await supabase.auth.signOut()
    setProfile(null)
  }, [])

  // Сессия Supabase
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) {
        setProfile(null)
        setLoading(false)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // Профиль (роль + филиал) из art.user_roles
  useEffect(() => {
    if (!session) return
    let stale = false
    setLoading(true)
    supabase
      .from('user_roles')
      .select('role, branch_id, display_name, branches(name)')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (stale) return
        if (data) {
          // PostgREST-вложение to-one без сгенерированных типов: объект или массив
          const b = data.branches as unknown
          const branchName = Array.isArray(b)
            ? ((b[0] as { name: string } | undefined)?.name ?? null)
            : ((b as { name: string } | null)?.name ?? null)
          setProfile({
            role: data.role as Role,
            branchId: data.branch_id,
            branchName,
            displayName: data.display_name,
          })
        } else {
          // Учётка без роли — работать не может
          setProfile(null)
        }
        setLoading(false)
      })
    return () => {
      stale = true
    }
  }, [session])

  // Автовыход в 23:59:59: сессия привязана к календарной дате (ТЗ §5.1).
  // Таймер до полуночи + проверка даты при возврате фокуса и раз в минуту.
  useEffect(() => {
    if (!session) return

    const stored = localStorage.getItem(SESSION_DATE_KEY)
    if (!stored) {
      localStorage.setItem(SESSION_DATE_KEY, todayStr())
    } else if (stored !== todayStr()) {
      void signOut()
      return
    }

    const check = () => {
      if (localStorage.getItem(SESSION_DATE_KEY) !== todayStr()) void signOut()
    }

    const midnight = new Date()
    midnight.setHours(24, 0, 0, 500)
    const toMidnight = setTimeout(() => void signOut(), midnight.getTime() - Date.now())
    const interval = setInterval(check, 60_000)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)

    return () => {
      clearTimeout(toMidnight)
      clearInterval(interval)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [session, signOut])

  const signIn = useCallback(async (loginName: string, password: string) => {
    const email = `${loginName.trim().toLowerCase()}@${LOGIN_DOMAIN}`
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      return /invalid/i.test(error.message)
        ? 'Неверный логин или пароль'
        : error.message
    }
    localStorage.setItem(SESSION_DATE_KEY, todayStr())
    return null
  }, [])

  const email = session?.user.email ?? null

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        role: profile?.role ?? null,
        branchId: profile?.branchId ?? null,
        branchName: profile?.branchName ?? null,
        displayName: profile?.displayName ?? null,
        login: email ? email.replace(`@${LOGIN_DOMAIN}`, '') : null,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth вне AuthProvider')
  return ctx
}
