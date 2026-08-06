import React, { useEffect, useMemo, useState } from 'react'
import './CadastroExportarPdfModal.css'

function ymdHoje() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function ymdPrimeiroDiaMes() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/**
 * Modal: período + situações antes de exportar o PDF de cadastros.
 */
export default function CadastroExportarPdfModal({
    aberto,
    onClose,
    onConfirmar,
    exportando = false,
    situacoes = [],
    situacaoIdsIniciais = null,
}) {
    const idsTodas = useMemo(
        () => (situacoes || []).map((s) => Number(s.id)).filter(Boolean),
        [situacoes],
    )

    const [periodoDe, setPeriodoDe] = useState(ymdPrimeiroDiaMes)
    const [periodoAte, setPeriodoAte] = useState(ymdHoje)
    const [situacaoIds, setSituacaoIds] = useState(() => idsTodas)
    const [erroLocal, setErroLocal] = useState('')

    useEffect(() => {
        if (!aberto) return
        setPeriodoDe(ymdPrimeiroDiaMes())
        setPeriodoAte(ymdHoje())
        setErroLocal('')
        const iniciais = Array.isArray(situacaoIdsIniciais)
            ? situacaoIdsIniciais.map(Number).filter((id) => idsTodas.includes(id))
            : []
        setSituacaoIds(iniciais.length ? iniciais : [...idsTodas])
    }, [aberto, idsTodas, situacaoIdsIniciais])

    if (!aberto) return null

    const todasMarcadas = idsTodas.length > 0 && idsTodas.every((id) => situacaoIds.includes(id))

    const alternarSituacao = (id) => {
        const nid = Number(id)
        setSituacaoIds((prev) =>
            prev.includes(nid) ? prev.filter((x) => x !== nid) : [...prev, nid],
        )
    }

    const alternarTodas = () => {
        setSituacaoIds(todasMarcadas ? [] : [...idsTodas])
    }

    const confirmar = () => {
        setErroLocal('')
        if (!periodoDe || !periodoAte) {
            setErroLocal('Informe a data inicial e a data final.')
            return
        }
        if (periodoDe > periodoAte) {
            setErroLocal('A data inicial não pode ser maior que a data final.')
            return
        }
        if (!situacaoIds.length) {
            setErroLocal('Selecione ao menos uma situação.')
            return
        }
        onConfirmar?.({ periodoDe, periodoAte, situacaoIds: [...situacaoIds] })
    }

    return (
        <div
            className="ccad_exp_backdrop"
            role="presentation"
            onClick={() => !exportando && onClose?.()}
        >
            <div
                className="ccad_exp_modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="ccad-exp-titulo"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="ccad_exp_head">
                    <h3 id="ccad-exp-titulo">Exportar relatório PDF</h3>
                    <button
                        type="button"
                        className="ccad_exp_close"
                        aria-label="Fechar"
                        disabled={exportando}
                        onClick={() => onClose?.()}
                    >
                        ×
                    </button>
                </div>
                <p className="ccad_exp_sub">
                    O relatório usa os cadastros da base conforme o período de{' '}
                    <strong>Credenciado Em</strong> e as <strong>situações</strong> marcadas
                    (não depende da busca ou filtros da tela).
                </p>

                <div className="ccad_exp_periodo">
                    <label className="ccad_exp_field">
                        <span>De</span>
                        <input
                            type="date"
                            className="ccad_exp_input_date"
                            value={periodoDe}
                            disabled={exportando}
                            max={periodoAte || undefined}
                            onChange={(e) => setPeriodoDe(e.target.value)}
                        />
                    </label>
                    <label className="ccad_exp_field">
                        <span>Até</span>
                        <input
                            type="date"
                            className="ccad_exp_input_date"
                            value={periodoAte}
                            disabled={exportando}
                            min={periodoDe || undefined}
                            onChange={(e) => setPeriodoAte(e.target.value)}
                        />
                    </label>
                </div>

                <fieldset className="ccad_exp_fieldset" disabled={exportando}>
                    <legend>Situações</legend>
                    <div className="ccad_exp_situacoes_toolbar">
                        <button type="button" className="ccad_exp_link_btn" onClick={alternarTodas}>
                            {todasMarcadas ? 'Desmarcar todas' : 'Marcar todas'}
                        </button>
                        <span className="ccad_exp_situacoes_qtd">
                            {situacaoIds.length}/{idsTodas.length}
                        </span>
                    </div>
                    <div className="ccad_exp_situacoes_lista">
                        {(situacoes || []).map((s) => {
                            const id = Number(s.id)
                            return (
                                <label key={id} className="ccad_exp_check">
                                    <input
                                        type="checkbox"
                                        checked={situacaoIds.includes(id)}
                                        onChange={() => alternarSituacao(id)}
                                    />
                                    <span>{s.descricao || `Situação ${id}`}</span>
                                </label>
                            )
                        })}
                        {!idsTodas.length ? (
                            <p className="ccad_exp_sub">Nenhuma situação carregada.</p>
                        ) : null}
                    </div>
                </fieldset>

                {erroLocal ? <p className="ccad_exp_erro">{erroLocal}</p> : null}

                <div className="ccad_exp_acoes">
                    <button
                        type="button"
                        className="credenciamento_main_action_btn secondary"
                        disabled={exportando}
                        onClick={() => onClose?.()}
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        className="credenciamento_main_action_btn"
                        disabled={exportando}
                        onClick={confirmar}
                    >
                        {exportando ? 'Gerando PDF…' : 'Exportar PDF'}
                    </button>
                </div>
            </div>
        </div>
    )
}
