import React from 'react'
import '../../styles/sfsc-exclusao-confirm.css'

export default function SfscExclusaoConfirmToast({
    titulo,
    mensagem,
    onConfirmar,
    onCancelar,
    variante = 'danger',
    rotuloConfirmar = 'Confirmar',
}) {
    const primaria = variante === 'primary'
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
