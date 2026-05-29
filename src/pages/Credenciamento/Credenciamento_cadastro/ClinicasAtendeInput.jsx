import React, { useEffect, useMemo, useRef, useState } from 'react'
import { normalizarTextoBusca, prestadorEstabelecimentoVinculavel } from '../../../lib/prestadorCadastroHelpers'

/**
 * Vínculo de perfil (não LOCAL) a clínicas/locais — busca em todos os estabelecimentos vinculáveis.
 */
export default function ClinicasAtendeInput({
    prestadores,
    prestadorAtualId,
    selecionadosIds,
    onChangeSelecionados,
    disabled,
    ativo: ativoControlado,
    onAtivoChange,
    layout = 'inline',
}) {
    const [ativoInterno, setAtivoInterno] = useState(selecionadosIds.length > 0)
    const [texto, setTexto] = useState('')
    const [sugestoesAbertas, setSugestoesAbertas] = useState(false)
    const wrapRef = useRef(null)

    const ativo = ativoControlado !== undefined ? ativoControlado : ativoInterno
    const setAtivo = (valor) => {
        if (ativoControlado === undefined) setAtivoInterno(valor)
        onAtivoChange?.(valor)
    }

    useEffect(() => {
        if (selecionadosIds.length > 0) setAtivo(true)
    }, [selecionadosIds.length])

    const idsSel = useMemo(() => new Set((selecionadosIds || []).map(Number)), [selecionadosIds])

    const locaisVinculaveis = useMemo(
        () =>
            (prestadores || []).filter(
                (p) =>
                    prestadorEstabelecimentoVinculavel(p.especialidade_id) &&
                    Number(p.id) !== Number(prestadorAtualId || 0),
            ),
        [prestadores, prestadorAtualId],
    )

    const mapaPorId = useMemo(() => new Map(locaisVinculaveis.map((p) => [Number(p.id), p])), [locaisVinculaveis])

    const sugestoes = useMemo(() => {
        const termo = normalizarTextoBusca(texto)
        if (!termo) return []
        return locaisVinculaveis
            .filter((p) => !idsSel.has(Number(p.id)))
            .filter((p) => normalizarTextoBusca(p.nome).includes(termo))
            .slice(0, 12)
    }, [texto, locaisVinculaveis, idsSel])

    const adicionar = (id) => {
        const idNum = Number(id)
        if (!idNum || idsSel.has(idNum)) return
        onChangeSelecionados([...selecionadosIds, idNum])
        setTexto('')
        setSugestoesAbertas(false)
    }

    const remover = (id) => {
        onChangeSelecionados(selecionadosIds.filter((x) => Number(x) !== Number(id)))
    }

    const tags = selecionadosIds.map((id) => {
        const p = mapaPorId.get(Number(id))
        const nome = p?.nome || `Clínica #${id}`
        return (
            <span key={id} className="pcad_multi_esp_tag">
                <span className="pcad_multi_esp_tag_label">{nome}</span>
                {!disabled && (
                    <button
                        type="button"
                        className="pcad_multi_esp_tag_remove"
                        aria-label={`Remover ${nome}`}
                        onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                        }}
                        onClick={(e) => {
                            e.stopPropagation()
                            remover(id)
                        }}
                    >
                        ×
                    </button>
                )}
            </span>
        )
    })

    const campoTexto = (
        <div className="pcad_multi_esp_input_wrap" ref={wrapRef}>
            {selecionadosIds.length > 0 && (
                <div className="pcad_multi_esp_tags pcad_multi_esp_tags_inline">{tags}</div>
            )}
            <input
                className="credenciamento_main_input"
                disabled={disabled}
                placeholder="Buscar clínica ou local…"
                value={texto}
                onChange={(e) => {
                    setTexto(e.target.value)
                    setSugestoesAbertas(true)
                }}
                onFocus={() => ativo && setSugestoesAbertas(true)}
                onBlur={() => setTimeout(() => setSugestoesAbertas(false), 150)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && sugestoes[0]) {
                        e.preventDefault()
                        adicionar(sugestoes[0].id)
                    }
                }}
            />
            {ativo && sugestoesAbertas && sugestoes.length > 0 && (
                <ul className="pcad_sugestoes" role="listbox">
                    {sugestoes.map((s) => (
                        <li key={s.id}>
                            <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => adicionar(s.id)}
                            >
                                {s.nome}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )

    const toggleBtn = (
        <button
            type="button"
            className={`credenciamento_main_action_btn secondary pcad_multi_esp_toggle ${ativo ? 'is-on' : ''}`}
            disabled={disabled}
            onClick={() => {
                const next = !ativo
                setAtivo(next)
                if (!next) setTexto('')
            }}
        >
            Atende em clínica
        </button>
    )

    if (layout === 'inline') {
        return (
            <>
                <div className="pcad_multi_esp_btn_cell">{toggleBtn}</div>
                {ativo && (
                    <label className="pcad_field pcad_multi_esp_outras_col">
                        Clínicas vinculadas
                        {campoTexto}
                    </label>
                )}
            </>
        )
    }

    return (
        <div className="pcad_multi_esp">
            {toggleBtn}
            {ativo && (
                <div className="pcad_multi_esp_panel">
                    <div className="pcad_multi_esp_tags">{tags}</div>
                    {campoTexto}
                </div>
            )}
        </div>
    )
}
