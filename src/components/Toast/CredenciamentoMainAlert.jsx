import React, { useCallback } from 'react'
import { useAutoDismiss } from '../../lib/toastUi.js'

/**
 * Faixa de alerta do credenciamento (erro / sucesso) com fechamento automático.
 */
export default function CredenciamentoMainAlert({
    message,
    children,
    onClose,
    role = 'alert',
    className = '',
    persist = false,
}) {
    const conteudo = children ?? message
    const visivel =
        conteudo != null &&
        (typeof conteudo === 'string' ? Boolean(String(conteudo).trim()) : true)
    const fechar = useCallback(() => onClose?.(), [onClose])

    useAutoDismiss(visivel && !persist, fechar)

    if (!visivel) return null

    return (
        <div className={`credenciamento_main_alert ${className}`.trim()} role={role}>
            <span>{conteudo}</span>
            {!persist ? (
                <button type="button" onClick={fechar} aria-label="Fechar">
                    ×
                </button>
            ) : null}
        </div>
    )
}
