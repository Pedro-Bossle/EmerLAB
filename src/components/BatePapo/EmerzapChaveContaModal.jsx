import { useEffect, useState } from 'react'
import { Modal, Button, Input } from '../ui'
import {
  CHAVE_CONTA_ATIVAR_SYNC,
  CHAVE_CONTA_BLOQUEADO,
  CHAVE_CONTA_SETUP,
  CHAVE_CONTA_UNLOCK,
  configurarChaveContaComSenha,
  desbloquearChaveContaComSenha,
  inspecionarChaveConta,
} from '../../lib/homeBatePapo'

const TITULOS = {
  [CHAVE_CONTA_SETUP]: 'Senha da chave Emerzap',
  [CHAVE_CONTA_UNLOCK]: 'Desbloquear Emerzap',
  [CHAVE_CONTA_ATIVAR_SYNC]: 'Sincronizar entre aparelhos',
  [CHAVE_CONTA_BLOQUEADO]: 'Chave de conta',
}

/**
 * Modal de setup / unlock da chave de conta (obrigatório — sem skip).
 */
export default function EmerzapChaveContaModal({ open, modo, mensagem, onResolvido }) {
  const [senha, setSenha] = useState('')
  const [senha2, setSenha2] = useState('')
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) {
      setSenha('')
      setSenha2('')
      setErro('')
      setLoading(false)
    }
  }, [open, modo])

  if (!open || !modo) return null

  const precisaConfirm = modo === CHAVE_CONTA_SETUP || modo === CHAVE_CONTA_ATIVAR_SYNC
  const soLeitura = modo === CHAVE_CONTA_BLOQUEADO

  const onSubmit = async (e) => {
    e.preventDefault()
    if (soLeitura) return
    setErro('')
    setLoading(true)
    try {
      if (modo === CHAVE_CONTA_UNLOCK) {
        await desbloquearChaveContaComSenha(senha)
      } else {
        await configurarChaveContaComSenha(senha, senha2)
      }
      onResolvido?.()
    } catch (err) {
      setErro(err?.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={undefined}
      title={TITULOS[modo] || 'Chave Emerzap'}
      description={
        mensagem ||
        (modo === CHAVE_CONTA_UNLOCK
          ? 'Introduza a senha da chave definida noutro aparelho.'
          : 'Esta senha protege o histórico cifrado entre telemóvel, tablet e PC. Não é a senha de login.')
      }
      footer={
        soLeitura ? (
          <p className="text-xs text-ink-soft dark:text-[#9eb4c8]">
            Resolva noutro aparelho ou peça apoio ao administrador (redefinir senha Emerzap).
          </p>
        ) : (
          <Button type="submit" form="emerzap-chave-conta-form" disabled={loading}>
            {loading ? 'A guardar…' : modo === CHAVE_CONTA_UNLOCK ? 'Desbloquear' : 'Guardar senha'}
          </Button>
        )
      }
    >
      {soLeitura ? (
        <p className="text-sm text-ink-soft dark:text-[#9eb4c8]">{mensagem}</p>
      ) : (
        <form id="emerzap-chave-conta-form" className="flex flex-col gap-3" onSubmit={onSubmit}>
          <Input
            label="Senha da chave"
            type="password"
            autoComplete="new-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
            minLength={6}
            autoFocus
          />
          {precisaConfirm ? (
            <Input
              label="Confirmar senha da chave"
              type="password"
              autoComplete="new-password"
              value={senha2}
              onChange={(e) => setSenha2(e.target.value)}
              required
              minLength={6}
            />
          ) : null}
          {erro ? <p className="text-sm text-red-600 dark:text-red-300">{erro}</p> : null}
          <p className="text-xs text-ink-soft dark:text-[#9eb4c8]">
            Obrigatório para usar o Emerzap. Guarde esta senha: sem ela, um aparelho novo não lê as conversas
            cifradas.
          </p>
        </form>
      )}
    </Modal>
  )
}

/** Inicializa / sincroniza estado da chave de conta para a UI Emerzap. */
export function useEmerzapChaveConta(permitido) {
  const [modo, setModo] = useState(null)
  const [mensagem, setMensagem] = useState('')
  const [chavePronta, setChavePronta] = useState(false)

  const revalidar = async () => {
    if (!permitido) return
    try {
      const est = await inspecionarChaveConta()
      if (est.status === 'ok') {
        setChavePronta(true)
        setModo(null)
        setMensagem('')
        return
      }
      // setup / unlock / ativar_sync / bloqueado: chat bloqueado até resolver
      setChavePronta(false)
      if (est.status === 'setup') setModo(CHAVE_CONTA_SETUP)
      else if (est.status === 'unlock') setModo(CHAVE_CONTA_UNLOCK)
      else if (est.status === 'ativar_sync') setModo(CHAVE_CONTA_ATIVAR_SYNC)
      else setModo(CHAVE_CONTA_BLOQUEADO)
      setMensagem(est.message || '')
    } catch (e) {
      setChavePronta(false)
      setModo(CHAVE_CONTA_BLOQUEADO)
      setMensagem(e?.message || String(e))
    }
  }

  useEffect(() => {
    if (!permitido) return undefined
    let cancelado = false
    void (async () => {
      if (cancelado) return
      await revalidar()
    })()
    const t = setInterval(() => {
      if (!cancelado) void revalidar()
    }, 45_000)
    return () => {
      cancelado = true
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permitido])

  return {
    modo,
    mensagem,
    chavePronta,
    modalAberto: Boolean(modo),
    revalidar,
    onResolvido: async () => {
      setModo(null)
      setChavePronta(true)
      await revalidar()
    },
  }
}
