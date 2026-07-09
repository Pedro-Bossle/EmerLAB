import { useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import {
  getSessionIdleWarnMs,
  iniciarMonitorInatividadeSessao,
  obterSessaoSupabase,
} from '../../lib/authSession'

function minutosLabel(ms) {
  const m = Math.max(1, Math.round(ms / 60_000))
  return m === 1 ? '1 minuto' : `${m} minutos`
}

function criarCallbacksMonitor() {
  return {
    onAvisoInatividade: () => {
      const warn = getSessionIdleWarnMs()
      if (warn <= 0) return
      window.alert(
        `Por segurança, sua sessão será encerrada por inatividade em cerca de ${minutosLabel(warn)}. Mova o mouse ou use o teclado para continuar.`,
      )
    },
    onEncerrarPorInatividade: () => {
      window.alert('Sessão encerrada por inatividade.')
    },
  }
}

/**
 * Timer de inatividade e sincronização entre abas (layouts autenticados).
 */
export default function SessionSecurity() {
  useEffect(() => {
    let cleanupMonitor = () => {}

    const armarMonitor = () => {
      cleanupMonitor()
      cleanupMonitor = iniciarMonitorInatividadeSessao(criarCallbacksMonitor())
    }

    void obterSessaoSupabase().then(({ session }) => {
      if (session) armarMonitor()
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) armarMonitor()
      if (event === 'SIGNED_OUT') {
        cleanupMonitor()
        cleanupMonitor = () => {}
      }
    })

    return () => {
      cleanupMonitor()
      sub?.subscription?.unsubscribe()
    }
  }, [])

  return null
}
