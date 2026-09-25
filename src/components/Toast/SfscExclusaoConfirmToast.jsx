import React, { useEffect, useState } from 'react'
import '../../styles/sfsc-exclusao-confirm.css'
import { TOAST_AUTO_DISMISS_MS } from '../../lib/toastUi.js'

function normalizarTextoConfirmacao(s) {
    return String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase()
}

export default function SfscExclusaoConfirmToast({
    titulo,
    mensagem,
    onConfirmar,
    onCancelar,
    variante = 'danger',
    rotuloConfirmar = 'Confirmar',
    confirmacaoExata = '',
    rotuloCampoConfirmacao = '',
    autoDismissMs = TOAST_AUTO_DISMISS_MS,
}) {
    const primaria = variante === 'primary'
    const exigeTexto = Boolean(String(confirmacaoExata || '').trim())
    const [digitado, setDigitado] = useState('')
    const textoBate =
        !exigeTexto ||
        normalizarTextoConfirmacao(digitado) === normalizarTextoConfirmacao(confirmacaoExata)

    useEffect(() => {
        if (exigeTexto) return undefined
        const t = window.setTimeout(() => onCancelar?.(), autoDismissMs)
        return () => window.clearTimeout(t)
    }, [onCancelar, autoDismissMs, titulo, mensagem, exigeTexto])

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
            {exigeTexto ? (
                <label className="sfsc_exclusao_confirm_campo">
                    <span>
                        {rotuloCampoConfirmacao ||
                            `Digite «${String(confirmacaoExata).trim()}» para confirmar`}
                    </span>
                    <input
                        type="text"
                        className="sfsc_exclusao_confirm_input"
                        value={digitado}
                        autoFocus
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={String(confirmacaoExata).trim()}
                        onChange={(e) => setDigitado(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && textoBate) {
                                e.preventDefault()
                                void onConfirmar()
                            }
                        }}
                    />
                </label>
            ) : null}
            <div className="sfsc_exclusao_confirm_actions">
                <button
                    type="button"
                    className={`sfsc_exclusao_confirm_btn${primaria ? ' sfsc_exclusao_confirm_btn--primary' : ' sfsc_exclusao_confirm_btn--danger'}`}
                    disabled={!textoBate}
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
