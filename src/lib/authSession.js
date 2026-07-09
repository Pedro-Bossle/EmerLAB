import { clearAccessState, supabase, setReadOnlyFlag } from './supabase'
import { normalizarProfileAcesso, setStoredAccessProfile, usuarioSomenteLeituraGlobal } from './accessControl'

/** Última atividade (compartilhada entre abas via localStorage). */
export const SESSION_LAST_ACTIVITY_KEY = 'sfsc-last-activity'

export const SESSION_IDLE_BROADCAST = 'sfsc-session-idle-logout'

const DEFAULT_IDLE_MS = 30 * 60 * 1000
const DEFAULT_WARN_MS = 2 * 60 * 1000
const IDLE_CHECK_INTERVAL_MS = 30 * 1000

function parsePositiveMs(raw, fallback) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

export function getSessionIdleMs() {
  return parsePositiveMs(import.meta.env.VITE_SESSION_IDLE_MS, DEFAULT_IDLE_MS)
}

export function getSessionIdleWarnMs() {
  const idle = getSessionIdleMs()
  const warn = parsePositiveMs(import.meta.env.VITE_SESSION_IDLE_WARN_MS, DEFAULT_WARN_MS)
  return Math.min(warn, Math.max(0, idle - 60_000))
}

export function registrarAtividadeSessao() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SESSION_LAST_ACTIVITY_KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
}

export function limparRegistroAtividadeSessao() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(SESSION_LAST_ACTIVITY_KEY)
  } catch {
    /* ignore */
  }
}

let logoutEmAndamento = false

let sessaoInflight = null

/** Uma única getSession por vez (compartilhada entre PrivateRoute, Sidebar, etc.). */
export function obterSessaoSupabase() {
  if (!sessaoInflight) {
    sessaoInflight = supabase.auth
      .getSession()
      .then(({ data, error }) => ({
        session: data?.session ?? null,
        error: error ?? null,
      }))
      .catch((e) => ({
        session: null,
        error: e,
      }))
      .finally(() => {
        sessaoInflight = null
      })
  }
  return sessaoInflight
}

const perfilInflightPorUsuario = new Map()

async function buscarPerfilSupabasePorUserId(userId) {
  let { data: profileData, error } = await supabase
    .from('profiles')
    .select('id, name, email, credenciamento_read_only, permissions')
    .eq('id', userId)
    .maybeSingle()
  if (error && String(error.message || '').includes('email')) {
    const fallback = await supabase
      .from('profiles')
      .select('id, name, credenciamento_read_only, permissions')
      .eq('id', userId)
      .maybeSingle()
    profileData = fallback.data
    error = fallback.error
  }
  if (error || !profileData) {
    return { profile: null, error: error ?? new Error('Perfil não encontrado.') }
  }
  const profile = normalizarProfileAcesso(profileData)
  return { profile, error: null }
}

/**
 * Sessão + perfil normalizado (cache curto por userId).
 * @returns {Promise<{ session: import('@supabase/supabase-js').Session | null, profile: object | null, error?: unknown }>}
 */
export async function carregarSessaoEPerfilAcesso() {
  const { session, error: sessErr } = await obterSessaoSupabase()
  if (sessErr && !session) {
    return { session: null, profile: null, error: sessErr }
  }
  if (!session?.user?.id) {
    return { session: null, profile: null }
  }

  const uid = session.user.id
  if (!perfilInflightPorUsuario.has(uid)) {
    perfilInflightPorUsuario.set(
      uid,
      buscarPerfilSupabasePorUserId(uid).finally(() => {
        window.setTimeout(() => perfilInflightPorUsuario.delete(uid), 300)
      }),
    )
  }

  const { profile, error } = await perfilInflightPorUsuario.get(uid)
  if (profile) {
    setStoredAccessProfile(profile)
    setReadOnlyFlag(usuarioSomenteLeituraGlobal(profile))
  }
  return { session, profile, error }
}

/**
 * Encerra sessão Supabase e estado local de permissões.
 * @param {{ redirectTo?: string | null, onError?: (msg: string) => void }} opts
 */
export async function logoutSessao(opts = {}) {
  const { redirectTo = '/', onError, navigate } = opts
  if (logoutEmAndamento) return
  logoutEmAndamento = true
  try {
    const { error } = await supabase.auth.signOut()
    if (error) {
      onError?.(error.message || 'Erro ao sair da sessão')
      return
    }
    clearAccessState()
    limparRegistroAtividadeSessao()
    if (typeof window !== 'undefined') {
      try {
        const bc = new BroadcastChannel(SESSION_IDLE_BROADCAST)
        bc.postMessage({ type: 'logout' })
        bc.close()
      } catch {
        /* ignore */
      }
    }
    if (redirectTo != null) {
      if (typeof navigate === 'function') {
        navigate(redirectTo, { replace: true })
      } else {
        const base = import.meta.env.BASE_URL || '/'
        const path = redirectTo.startsWith('/') ? redirectTo : `/${redirectTo}`
        const url = `${window.location.origin}${base.replace(/\/$/, '')}${path}`.replace(
          /([^:]\/)\/+/g,
          '$1',
        )
        window.location.replace(url)
      }
    }
  } finally {
    logoutEmAndamento = false
  }
}

function msDesdeUltimaAtividade() {
  const raw = typeof window !== 'undefined' ? window.localStorage.getItem(SESSION_LAST_ACTIVITY_KEY) : null
  const last = Number(raw || 0)
  if (!last) return 0
  return Date.now() - last
}

/**
 * Monitor de inatividade (chamar uma vez em layout autenticado).
 * @param {{ onAvisoInatividade?: () => void, onEncerrarPorInatividade?: () => void }} callbacks
 * @returns {() => void} cleanup
 */
export function iniciarMonitorInatividadeSessao(callbacks = {}) {
  if (typeof window === 'undefined') return () => {}

  const idleMs = getSessionIdleMs()
  const warnMs = getSessionIdleWarnMs()
  const warnThreshold = idleMs - warnMs
  let avisoEmitido = false
  let ativo = true

  const touch = () => {
    if (!ativo) return
    avisoEmitido = false
    registrarAtividadeSessao()
  }

  const eventos = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']
  const onVisivel = () => {
    if (document.visibilityState === 'visible') touch()
  }

  eventos.forEach((ev) => window.addEventListener(ev, touch, { passive: true }))
  document.addEventListener('visibilitychange', onVisivel)

  let bc
  try {
    bc = new BroadcastChannel(SESSION_IDLE_BROADCAST)
    bc.onmessage = (e) => {
      if (e?.data?.type === 'logout' && ativo) {
        ativo = false
        void logoutSessao({ redirectTo: '/' })
      }
    }
  } catch {
    bc = null
  }

  const onStorage = (e) => {
    if (e.key === SESSION_LAST_ACTIVITY_KEY) {
      avisoEmitido = false
    }
  }
  window.addEventListener('storage', onStorage)

  const tick = () => {
    if (!ativo) return
    const elapsed = msDesdeUltimaAtividade()
    if (elapsed >= idleMs) {
      ativo = false
      callbacks.onEncerrarPorInatividade?.()
      void logoutSessao({ redirectTo: '/' })
      return
    }
    if (warnMs > 0 && elapsed >= warnThreshold && !avisoEmitido) {
      avisoEmitido = true
      callbacks.onAvisoInatividade?.()
    }
  }

  void obterSessaoSupabase().then(({ session }) => {
    if (!session) return
    touch()
    tick()
  })

  const intervalId = window.setInterval(tick, IDLE_CHECK_INTERVAL_MS)

  return () => {
    ativo = false
    window.clearInterval(intervalId)
    eventos.forEach((ev) => window.removeEventListener(ev, touch))
    document.removeEventListener('visibilitychange', onVisivel)
    window.removeEventListener('storage', onStorage)
    bc?.close()
  }
}
