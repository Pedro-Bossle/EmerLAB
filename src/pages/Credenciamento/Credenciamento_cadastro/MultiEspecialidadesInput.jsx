import React, { useEffect, useMemo, useRef, useState } from 'react'

const normalizar = (t) =>
    String(t || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()

/**
 * @param {{ especialidades: {id:number,nome:string,tipo?:string}[], principalId: string|number, secundariasIds: number[], onChangeSecundarias: (ids:number[]) => void, disabled?: boolean, layout?: 'stacked' | 'inline', onAtivoChange?: (ativo: boolean) => void }} props
 */
export default function MultiEspecialidadesInput({
    especialidades,
    principalId,
    secundariasIds,
    onChangeSecundarias,
    disabled,
    layout = 'stacked',
    onAtivoChange,
}) {
    const [ativo, setAtivo] = useState(secundariasIds.length > 0)
    const [texto, setTexto] = useState('')

    useEffect(() => {
        if (secundariasIds.length > 0) setAtivo(true)
    }, [secundariasIds.length])

    useEffect(() => {
        onAtivoChange?.(ativo)
    }, [ativo, onAtivoChange])
    const [sugestoesAbertas, setSugestoesAbertas] = useState(false)
    const wrapRef = useRef(null)
    const inputRef = useRef(null)
    const removendoTagRef = useRef(false)
    const inputFocadoRef = useRef(false)
    const textoEditadoRef = useRef(false)

    const mapaNome = useMemo(() => {
        const m = new Map()
        ;(especialidades || []).forEach((e) => m.set(normalizar(e.nome), e))
        return m
    }, [especialidades])

    const idsSec = useMemo(() => new Set((secundariasIds || []).map(Number)), [secundariasIds])

    useEffect(() => {
        if (inputFocadoRef.current) return
        const labels = idsParaNomesTexto(secundariasIds)
        setTexto(labels.length ? `${labels.join(', ')}, ` : '')
    }, [secundariasIds, especialidades])

    const segmentoAtual = useMemo(() => {
        const partes = texto.split(',')
        return partes[partes.length - 1].trim()
    }, [texto])

    const sugestoes = useMemo(() => {
        const seg = normalizar(segmentoAtual)
        if (!seg) return []
        return (especialidades || [])
            .filter((e) => Number(e.id) !== Number(principalId))
            .filter((e) => !idsSec.has(Number(e.id)))
            .filter((e) => normalizar(e.nome).includes(seg))
            .slice(0, 12)
    }, [especialidades, segmentoAtual, principalId, idsSec])

    const adicionarPorNome = (nome) => {
        const esp = mapaNome.get(normalizar(nome))
        if (!esp || Number(esp.id) === Number(principalId)) return
        if (idsSec.has(Number(esp.id))) return
        onChangeSecundarias([...secundariasIds, Number(esp.id)])
        const partes = texto.split(',').map((p) => p.trim()).filter(Boolean)
        partes.pop()
        const nomesSec = [...secundariasIds, Number(esp.id)]
            .map((id) => especialidades.find((x) => Number(x.id) === id)?.nome)
            .filter(Boolean)
        setTexto(nomesSec.length ? `${nomesSec.join(', ')}, ` : '')
        setSugestoesAbertas(false)
    }

    const idsParaNomesTexto = (ids) =>
        (ids || [])
            .map((eid) => especialidades.find((e) => Number(e.id) === Number(eid))?.nome)
            .filter(Boolean)

    const removerSec = (id) => {
        const next = secundariasIds.filter((x) => Number(x) !== Number(id))
        onChangeSecundarias(next)
        const labels = idsParaNomesTexto(next)
        setTexto(labels.length ? `${labels.join(', ')}, ` : '')
    }

    const restaurarTextoDasTags = () => {
        const labels = idsParaNomesTexto(secundariasIds)
        setTexto(labels.length ? `${labels.join(', ')}, ` : '')
    }

    const sincronizarTextoParaIds = () => {
        const partes = texto.split(',').map((p) => p.trim()).filter(Boolean)
        const idsDoTexto = []
        partes.forEach((nome) => {
            const esp = mapaNome.get(normalizar(nome))
            if (esp && Number(esp.id) !== Number(principalId) && !idsDoTexto.includes(Number(esp.id))) {
                idsDoTexto.push(Number(esp.id))
            }
        })
        onChangeSecundarias(idsDoTexto)
        const labels = idsParaNomesTexto(idsDoTexto)
        setTexto(labels.length ? `${labels.join(', ')}, ` : '')
    }

    const onBlurCampo = (event) => {
        const alvo = event.relatedTarget
        if (alvo && wrapRef.current?.contains(alvo)) return
        setTimeout(() => {
            setSugestoesAbertas(false)
            inputFocadoRef.current = false
            if (removendoTagRef.current) {
                removendoTagRef.current = false
                return
            }
            if (wrapRef.current?.contains(document.activeElement)) return
            if (!textoEditadoRef.current) {
                restaurarTextoDasTags()
                return
            }
            textoEditadoRef.current = false
            sincronizarTextoParaIds()
        }, 0)
    }

    const onMouseDownWrap = (event) => {
        if (event.target.closest('.pcad_multi_esp_tag_remove')) return
        if (event.target.closest('.pcad_sugestoes')) return
        if (event.target.closest('input')) return
        event.preventDefault()
        inputRef.current?.focus()
    }

    const tagsSecundarias = secundariasIds.map((id) => {
        const esp = especialidades.find((e) => Number(e.id) === Number(id))
        if (!esp) return null
        return (
            <span key={id} className="pcad_multi_esp_tag">
                <span className="pcad_multi_esp_tag_label">{esp.nome}</span>
                {!disabled && (
                    <button
                        type="button"
                        className="pcad_multi_esp_tag_remove"
                        aria-label={`Remover ${esp.nome}`}
                        onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            removendoTagRef.current = true
                        }}
                        onClick={(e) => {
                            e.stopPropagation()
                            removerSec(id)
                        }}
                    >
                        ×
                    </button>
                )}
            </span>
        )
    })

    const campoTexto = (
        <div className="pcad_multi_esp_input_wrap" ref={wrapRef} onMouseDown={onMouseDownWrap}>
            {secundariasIds.length > 0 && (
                <div className="pcad_multi_esp_tags pcad_multi_esp_tags_inline">{tagsSecundarias}</div>
            )}
            <input
                ref={inputRef}
                className="credenciamento_main_input"
                disabled={disabled}
                placeholder="Ex.: Cardiologia, Dermatologia (Insira as especialidades separadas por vírgula)"
                value={texto}
                onChange={(e) => {
                    textoEditadoRef.current = true
                    setTexto(e.target.value)
                    setSugestoesAbertas(true)
                }}
                onFocus={() => {
                    inputFocadoRef.current = true
                    if (ativo) setSugestoesAbertas(true)
                }}
                onBlur={onBlurCampo}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && sugestoes[0]) {
                        e.preventDefault()
                        adicionarPorNome(sugestoes[0].nome)
                    }
                }}
            />
            {ativo && sugestoesAbertas && sugestoes.length > 0 && (
                <ul className="pcad_sugestoes" role="listbox">
                    {sugestoes.map((s) => (
                        <li key={s.id}>
                            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => adicionarPorNome(s.nome)}>
                                {s.nome}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )

    if (layout === 'inline') {
        return (
            <>
                <div className="pcad_multi_esp_btn_cell">
                    <button
                        type="button"
                        className={`credenciamento_main_action_btn secondary pcad_multi_esp_toggle ${ativo ? 'is-on' : ''}`}
                        disabled={disabled}
                        onClick={() => setAtivo((v) => !v)}
                    >
                        Múltiplas especialidades
                    </button>
                </div>
                {ativo && (
                    <div className="pcad_field pcad_multi_esp_outras_col">
                        <span className="pcad_field_label">Outras especialidades</span>
                        {campoTexto}
                    </div>
                )}
            </>
        )
    }

    return (
        <div className="pcad_multi_esp">
            <button
                type="button"
                className={`credenciamento_main_action_btn secondary pcad_multi_esp_toggle ${ativo ? 'is-on' : ''}`}
                disabled={disabled}
                onClick={() => setAtivo((v) => !v)}
            >
                Múltiplas especialidades
            </button>
            {ativo && (
                <div className="pcad_multi_esp_panel">
                    <p className="pcad_muted">Separe por vírgula. Só entram especialidades já cadastradas; use as sugestões.</p>
                    <div className="pcad_multi_esp_tags" onMouseDown={onMouseDownWrap}>
                        {tagsSecundarias}
                    </div>
                    {campoTexto}
                </div>
            )}
        </div>
    )
}
