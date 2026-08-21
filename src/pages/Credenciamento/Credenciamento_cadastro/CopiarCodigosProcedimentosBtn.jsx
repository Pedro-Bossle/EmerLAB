import React, { useState } from 'react'
import {
    carregarCodigosPrestadorProcedimentos,
    copiarCodigosProcedimentosParaClipboard,
} from '../../../lib/prestadorProcedimentos.js'

export default function CopiarCodigosProcedimentosBtn({
    prestadorId,
    codigosAtuais,
    className = 'credenciamento_main_action_btn secondary credenciamento_cadastro_copiar_codigos_btn',
    rotulo = 'Copiar códigos',
    rotuloVazio = 'Sem códigos',
    title = 'Copiar códigos dos procedimentos do perfil (um por linha)',
    compacto = false,
    disabled = false,
}) {
    const [busy, setBusy] = useState(false)
    const [feedback, setFeedback] = useState('')

    const copiar = async (e) => {
        e.stopPropagation()
        e.preventDefault()
        if (busy || disabled) return
        setBusy(true)
        setFeedback('')
        try {
            let codigos = Array.isArray(codigosAtuais) ? codigosAtuais : null
            if (!codigos?.length && prestadorId) {
                codigos = await carregarCodigosPrestadorProcedimentos(prestadorId)
            }
            if (!codigos?.length) {
                setFeedback(rotuloVazio)
                return
            }
            const qtd = await copiarCodigosProcedimentosParaClipboard(codigos)
            setFeedback(compacto ? `${qtd}` : `${qtd} copiado(s)`)
            window.setTimeout(() => setFeedback(''), 2200)
        } catch (err) {
            setFeedback('Erro')
            window.setTimeout(() => setFeedback(''), 2200)
        } finally {
            setBusy(false)
        }
    }

    const texto = feedback || (busy ? '…' : rotulo)

    return (
        <button
            type="button"
            className={className}
            title={title}
            aria-label={title}
            disabled={busy || disabled}
            onClick={(e) => void copiar(e)}
        >
            {texto}
        </button>
    )
}
