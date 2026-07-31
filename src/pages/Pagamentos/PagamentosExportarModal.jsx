import React, { useEffect, useState } from 'react'
import { exportarPagamentosParaExcel } from '../../lib/exportPagamentosExcel.js'
import { listarPagamentosRegistros } from '../../lib/pagamentosRegistros.js'
import { rotuloMesAnoCurto } from '../../lib/pagamentosPrestador.js'
import './PagamentosExportarModal.css'

const OPCOES_STATUS = [
    { value: 'pagos', label: 'Somente pagos' },
    { value: 'nao_pagos', label: 'Não pagos' },
    { value: 'todos', label: 'Todos' },
]

function mesAnoParaInputMonth(mes, ano) {
    const m = Number(mes)
    const a = Number(ano)
    if (!m || m < 1 || m > 12 || !a) return ''
    return `${a}-${String(m).padStart(2, '0')}`
}

function parseInputMonth(value) {
    const hit = String(value || '').match(/^(\d{4})-(\d{2})$/)
    if (!hit) return null
    const ano = Number(hit[1])
    const mes = Number(hit[2])
    if (!Number.isFinite(ano) || !Number.isFinite(mes) || mes < 1 || mes > 12) return null
    return { mes, ano }
}

/**
 * Modal de exportação Excel dos registros de pagamento.
 * @param {{ aberto: boolean, onClose: () => void, mesInicial?: number, anoInicial?: number, onErro?: (msg: string) => void, onOk?: (msg: string) => void }} props
 */
export default function PagamentosExportarModal({
    aberto,
    onClose,
    mesInicial,
    anoInicial,
    onErro,
    onOk,
}) {
    const hoje = new Date()
    const [status, setStatus] = useState('todos')
    const [mes, setMes] = useState(mesInicial || hoje.getMonth() + 1)
    const [ano, setAno] = useState(anoInicial || hoje.getFullYear())
    const [exportando, setExportando] = useState(false)

    useEffect(() => {
        if (!aberto) return
        setStatus('todos')
        setMes(mesInicial || hoje.getMonth() + 1)
        setAno(anoInicial || hoje.getFullYear())
        setExportando(false)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- só reabre com defaults
    }, [aberto, mesInicial, anoInicial])

    if (!aberto) return null

    const competenciaInput = mesAnoParaInputMonth(mes, ano)

    const exportar = async () => {
        if (!mes || !ano) {
            onErro?.('Selecione o mês e o ano da competência.')
            return
        }
        setExportando(true)
        try {
            let registros = await listarPagamentosRegistros({ mes, ano })
            if (status === 'pagos') registros = registros.filter((r) => r.pago)
            else if (status === 'nao_pagos') registros = registros.filter((r) => !r.pago)

            const rotuloStatus =
                status === 'pagos' ? 'pagos' : status === 'nao_pagos' ? 'nao-pagos' : 'todos'
            const competencia = rotuloMesAnoCurto(mes, ano).replace('/', '-')
            const resultado = await exportarPagamentosParaExcel(registros, {
                nomeArquivoBase: `pagamentos-${competencia}-${rotuloStatus}`,
            })
            if (!resultado.ok) {
                onErro?.(resultado.erro || 'Não foi possível exportar.')
                return
            }
            onOk?.(
                `${resultado.totalLinhas} registro(s) exportado(s) · ${rotuloMesAnoCurto(mes, ano)}.`,
            )
            onClose?.()
        } catch (e) {
            onErro?.(e?.message || 'Falha ao exportar para Excel.')
        } finally {
            setExportando(false)
        }
    }

    return (
        <div
            className="pag_exp_backdrop"
            role="presentation"
            onClick={() => !exportando && onClose?.()}
        >
            <div
                className="pag_exp_modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="pag-exp-titulo"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="pag_exp_head">
                    <h3 id="pag-exp-titulo">Exportar para Excel</h3>
                    <button
                        type="button"
                        className="pag_exp_close"
                        aria-label="Fechar"
                        disabled={exportando}
                        onClick={() => onClose?.()}
                    >
                        ×
                    </button>
                </div>
                <p className="pag_exp_sub">
                    Escolha o status e a competência (mês/ano) dos registros a exportar.
                </p>

                <fieldset className="pag_exp_fieldset">
                    <legend>Status</legend>
                    <div className="pag_exp_radios">
                        {OPCOES_STATUS.map((o) => (
                            <label key={o.value} className="pag_exp_radio">
                                <input
                                    type="radio"
                                    name="pag-exp-status"
                                    value={o.value}
                                    checked={status === o.value}
                                    disabled={exportando}
                                    onChange={() => setStatus(o.value)}
                                />
                                <span>{o.label}</span>
                            </label>
                        ))}
                    </div>
                </fieldset>

                <label className="pag_exp_field">
                    <span>Mês e ano</span>
                    <input
                        type="month"
                        className="pag_exp_input_month"
                        value={competenciaInput}
                        disabled={exportando}
                        onChange={(e) => {
                            const parsed = parseInputMonth(e.target.value)
                            if (!parsed) return
                            setMes(parsed.mes)
                            setAno(parsed.ano)
                        }}
                    />
                </label>

                <div className="pag_exp_acoes">
                    <button
                        type="button"
                        className="pag_reg_btn pag_reg_btn--sec"
                        disabled={exportando}
                        onClick={() => onClose?.()}
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        className="pag_reg_btn"
                        disabled={exportando}
                        onClick={() => void exportar()}
                    >
                        {exportando ? 'Exportando…' : 'Exportar'}
                    </button>
                </div>
            </div>
        </div>
    )
}
