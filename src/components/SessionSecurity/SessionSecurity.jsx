import { useEffect } from 'react'
import {
  ACCESS_PROFILE_CHANGE_EVENT,
  getStoredAccessProfile,
} from '../../lib/accessControl'
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

function criarCallbacksMonitor(desativado) {
  return {
    desativado: Boolean(desativado),
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
 * Respeita o flag disableIdleLogout do perfil em controle de acessos.
 */
export default function SessionSecurity() {
  useEffect(() => {
    let cleanupMonitor = () => {}

    const armarMonitor = () => {
      cleanupMonitor()
      const desativado = Boolean(getStoredAccessProfile()?.disableIdleLogout)
      cleanupMonitor = iniciarMonitorInatividadeSessao(criarCallbacksMonitor(desativado))
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

    const onPerfil = () => {
      void obterSessaoSupabase().then(({ session }) => {
        if (session) armarMonitor()
        else {
          cleanupMonitor()
          cleanupMonitor = () => {}
        }
      })
    }
    window.addEventListener(ACCESS_PROFILE_CHANGE_EVENT, onPerfil)

    return () => {
      cleanupMonitor()
      sub?.subscription?.unsubscribe()
      window.removeEventListener(ACCESS_PROFILE_CHANGE_EVENT, onPerfil)
    }
  }, [])

  return null
}
