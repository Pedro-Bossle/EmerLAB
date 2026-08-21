import {
  isErroChavePendente,
  listarMensagensConversa,
  sincronizarChavesConversaSePossivel,
} from '../../lib/homeBatePapo'
import { supabase } from '../../lib/supabase'

/**
 * Carrega mensagens e, se a chave E2EE estiver pendente, faz poll + realtime
 * até sincronizar — sem precisar recarregar a página.
 *
 * @returns {() => void} cleanup
 */
export function observarThreadEmerzap({
  conversaId,
  userId,
  ativo,
  onMensagens,
  onErro,
  onCarregando,
  onAposOk,
}) {
  if (!conversaId || !ativo) return () => {}

  let cancelado = false
  let precisaRetry = false
  let emCurso = false

  const carregar = async ({ silencioso = false } = {}) => {
    if (cancelado || emCurso) return
    emCurso = true
    if (!silencioso) onCarregando?.(true)
    try {
      // Quem já tem chave: re-envolve pendentes (ajuda o outro sem reload)
      await sincronizarChavesConversaSePossivel(conversaId)
      const lista = await listarMensagensConversa(conversaId)
      if (cancelado) return
      precisaRetry = false
      onMensagens?.(lista)
      onErro?.('')
      await onAposOk?.(lista)
    } catch (e) {
      if (cancelado) return
      if (Array.isArray(e?.mensagensParciais)) onMensagens?.(e.mensagensParciais)
      precisaRetry = isErroChavePendente(e)
      onErro?.(e?.message || String(e))
    } finally {
      emCurso = false
      if (!cancelado && !silencioso) onCarregando?.(false)
    }
  }

  void carregar()

  const channel = supabase
    .channel(`emerzap-thread:${conversaId}:${userId || 'anon'}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'home_bate_papo_participantes',
        filter: `conversa_id=eq.${conversaId}`,
      },
      () => {
        void carregar({ silencioso: true })
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'home_bate_papo_mensagens_v2',
        filter: `conversa_id=eq.${conversaId}`,
      },
      () => {
        void carregar({ silencioso: true })
      },
    )
    .subscribe()

  const poll = setInterval(() => {
    if (cancelado) return
    if (precisaRetry) {
      void carregar({ silencioso: true })
      return
    }
    // Quem já desencripta: re-envolve periodicamente (ajuda quem ficou pendente sem reload)
    void sincronizarChavesConversaSePossivel(conversaId)
  }, 2000)

  return () => {
    cancelado = true
    clearInterval(poll)
    void supabase.removeChannel(channel)
  }
}
