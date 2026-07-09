import React, { useEffect } from 'react'
import '../../styles/sfsc-exclusao-confirm.css'
import { TOAST_AUTO_DISMISS_MS } from '../../lib/toastUi.js'

export default function SfscExclusaoConfirmToast({
    titulo,
    mensagem,
    onConfirmar,
    onCancelar,
    variante = 'danger',
    rotuloConfirmar = 'Confirmar',
    autoDismissMs = TOAST_AUTO_DISMISS_MS,
}) {
    const primaria = variante === 'primary'

    useEffect(() => {
        const t = window.setTimeout(() => onCancelar?.(), autoDismissMs)
        return () => window.clearTimeout(t)
    }, [onCancelar, autoDismissMs, titulo, mensagem])

    return (
        <div
            className={`sfsc_exclusao_confirm_toast${primaria ? ' sfsc_exclusao_confirm_toast--primary' : ''}`}
            role="alertdialog"
            aria-live="assertive"
            aria-labelledby="sfsc-excl-title"
        >
            <div className="sfsc_exclusao_confirm_text">
                <strong id="sfsc-excl-title">{titulo}</strong>
                <span>{mensagem}</span>
            </div>
            <div className="sfsc_exclusao_confirm_actions">
                <button
                    type="button"
                    className={`sfsc_exclusao_confirm_btn${primaria ? ' sfsc_exclusao_confirm_btn--primary' : ' sfsc_exclusao_confirm_btn--danger'}`}
                    onClick={() => void onConfirmar()}
                >
                    {rotuloConfirmar}
                </button>
                <button type="button" className="sfsc_exclusao_confirm_btn" onClick={onCancelar}>
                    Cancelar
                </button>
            </div>
        </div>
    )
}
