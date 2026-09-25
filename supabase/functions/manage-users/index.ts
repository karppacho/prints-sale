// Edge Function manage-users (ТЗ §4.3)
//
// Создание/удаление/список учёток сотрудников. Требует service_role,
// поэтому выполняется на сервере; роль вызывающего проверяется по JWT:
//   - владелец (owner)  — создаёт/удаляет администраторов и продавцов;
//   - админ (admin)     — только продавцов;
//   - остальным         — отказ.
//
// Логин хранится как <login>@<LOGIN_DOMAIN>, почта нигде не показывается.
// LOGIN_DOMAIN задаётся в окружении сервиса functions и должен совпадать
// с VITE_LOGIN_DOMAIN фронтенда.
//
// Запросы (POST, JSON):
//   { action: "create", login, password, role: "admin"|"seller",
//     branch_id, display_name? }
//   { action: "delete", user_id }
//   { action: "list" }

import { createClient } from 'npm:@supabase/supabase-js@2'

const LOGIN_DOMAIN = Deno.env.get('LOGIN_DOMAIN') ?? ''
const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }
  if (!LOGIN_DOMAIN) {
    return json({ error: 'Не задан LOGIN_DOMAIN в окружении функции' }, 500)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const artAdmin = admin.schema('art')

  // --- Кто вызывает ---------------------------------------------------
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Не авторизован' }, 401)

  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData?.user) return json({ error: 'Не авторизован' }, 401)
  const callerId = userData.user.id

  const { data: callerRole } = await artAdmin
    .from('user_roles')
    .select('role')
    .eq('user_id', callerId)
    .maybeSingle()

  const role = callerRole?.role as string | undefined
  if (role !== 'owner' && role !== 'admin') {
    return json({ error: 'Недостаточно прав' }, 403)
  }
  // Какими ролями может управлять вызывающий
  const manageable = role === 'owner' ? ['admin', 'seller'] : ['seller']

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Некорректный JSON' }, 400)
  }

  const action = body.action as string

  // --- Список ----------------------------------------------------------
  if (action === 'list') {
    const { data: roles, error } = await artAdmin
      .from('user_roles')
      .select('user_id, role, branch_id, display_name, created_at')
    if (error) return json({ error: error.message }, 500)

    const { data: usersPage, error: listErr } =
      await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (listErr) return json({ error: listErr.message }, 500)

    const loginById = new Map(
      usersPage.users.map((u) => [
        u.id,
        (u.email ?? '').replace(`@${LOGIN_DOMAIN}`, ''),
      ]),
    )
    const users = (roles ?? []).map((r) => ({
      ...r,
      login: loginById.get(r.user_id) ?? null,
    }))
    return json({ users })
  }

  // --- Создание ---------------------------------------------------------
  if (action === 'create') {
    const login = String(body.login ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    const newRole = String(body.role ?? '')
    const branchId = body.branch_id ? String(body.branch_id) : null
    const displayName = body.display_name
      ? String(body.display_name).trim()
      : null

    if (!LOGIN_RE.test(login)) {
      return json(
        { error: 'Логин: 2–32 символа, латиница/цифры/точка/дефис/подчёркивание' },
        400,
      )
    }
    if (password.length < 6) {
      return json({ error: 'Пароль: минимум 6 символов' }, 400)
    }
    if (!manageable.includes(newRole)) {
      return json({ error: 'Нет прав на создание этой роли' }, 403)
    }
    if (!branchId) {
      return json({ error: 'Укажите филиал сотрудника' }, 400)
    }

    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email: `${login}@${LOGIN_DOMAIN}`,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName },
      })
    if (createErr || !created?.user) {
      const msg = createErr?.message ?? 'Не удалось создать пользователя'
      const friendly = /already|registered|exists/i.test(msg)
        ? 'Такой логин уже занят'
        : msg
      return json({ error: friendly }, 400)
    }

    const { error: roleErr } = await artAdmin.from('user_roles').insert({
      user_id: created.user.id,
      role: newRole,
      branch_id: branchId,
      display_name: displayName,
    })
    if (roleErr) {
      // Учётка без роли бесполезна — откатываем
      await admin.auth.admin.deleteUser(created.user.id)
      return json({ error: `Не удалось назначить роль: ${roleErr.message}` }, 400)
    }

    return json({ ok: true, user_id: created.user.id, login })
  }

  // --- Удаление ----------------------------------------------------------
  if (action === 'delete') {
    const targetId = String(body.user_id ?? '')
    if (!targetId) return json({ error: 'Не указан пользователь' }, 400)
    if (targetId === callerId) {
      return json({ error: 'Нельзя удалить собственную учётку' }, 400)
    }

    const { data: target } = await artAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', targetId)
      .maybeSingle()
    if (!target) return json({ error: 'Пользователь не найден' }, 404)
    if (!manageable.includes(target.role)) {
      return json({ error: 'Нет прав на удаление этой роли' }, 403)
    }

    const { error: delErr } = await admin.auth.admin.deleteUser(targetId)
    if (delErr) return json({ error: delErr.message }, 500)
    // Строка art.user_roles удаляется каскадом (FK on delete cascade)

    return json({ ok: true })
  }

  return json({ error: 'Неизвестное действие' }, 400)
})
