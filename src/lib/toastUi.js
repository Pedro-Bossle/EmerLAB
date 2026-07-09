import { useEffect } from 'react'

/** Duração máxima de toasts com fechamento automático (15 segundos). */
export const TOAST_AUTO_DISMISS_MS = 15_000

/**
 * Chama onDismiss após `ms` enquanto `ativo` for verdadeiro (reinicia se `ativo` mudar).
 */
export function useAutoDismiss(ativo, onDismiss, ms = TOAST_AUTO_DISMISS_MS) {
    useEffect(() => {
        if (!ativo) return undefined
        const t = window.setTimeout(() => {
            onDismiss?.()
        }, ms)
        return () => window.clearTimeout(t)
    }, [ativo, onDismiss, ms])
}

/** Fecha confirmações estilo toast após o tempo padrão (equivale a Cancelar). */
export function useConfirmacaoExclusaoAutoDismiss(confirmacao, setConfirmacao, ms = TOAST_AUTO_DISMISS_MS) {
    useAutoDismiss(!!confirmacao, () => setConfirmacao(null), ms)
}
