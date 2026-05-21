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

    const mapaNome = useMemo(() => {
        const m = new Map()
        ;(especialidades || []).forEach((e) => m.set(normalizar(e.nome), e))
        return m
    }, [especialidades])

    const idsSec = useMemo(() => new Set((secundariasIds || []).map(Number)), [secundariasIds])

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

    const removerSec = (id) => {
        onChangeSecundarias(secundariasIds.filter((x) => Number(x) !== Number(id)))
    }

    const onBlurValidar = () => {
        setTimeout(() => setSugestoesAbertas(false), 150)
        const partes = texto.split(',').map((p) => p.trim()).filter(Boolean)
        const novosIds = []
        partes.forEach((nome) => {
            const esp = mapaNome.get(normalizar(nome))
            if (esp && Number(esp.id) !== Number(principalId) && !novosIds.includes(Number(esp.id))) {
                novosIds.push(Number(esp.id))
            }
        })
        if (novosIds.length) onChangeSecundarias([...new Set([...secundariasIds, ...novosIds])])
        const labels = [...new Set([...secundariasIds, ...novosIds])]
            .map((id) => especialidades.find((e) => Number(e.id) === id)?.nome)
            .filter(Boolean)
        setTexto(labels.length ? `${labels.join(', ')}, ` : '')
    }

    const tagsSecundarias = secundariasIds.map((id) => {
        const esp = especialidades.find((e) => Number(e.id) === Number(id))
        if (!esp) return null
        return (
            <span key={id} className="pcad_multi_esp_tag">
                {esp.nome}
                {!disabled && (
                    <button type="button" aria-label="Remover" onClick={() => removerSec(id)}>
                        ×
                    </button>
                )}
            </span>
        )
    })

    const campoTexto = (
        <div className="pcad_multi_esp_input_wrap" ref={wrapRef}>
            {secundariasIds.length > 0 && <div className="pcad_multi_esp_tags pcad_multi_esp_tags_inline">{tagsSecundarias}</div>}
            <input
                className="credenciamento_main_input"
                disabled={disabled}
                placeholder="Ex.: Cardiologia, Dermatologia (Insira as especialidades separadas por vírgula)"
                value={texto}
                onChange={(e) => {
                    setTexto(e.target.value)
                    setSugestoesAbertas(true)
                }}
                onFocus={() => ativo && setSugestoesAbertas(true)}
                onBlur={onBlurValidar}
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
                    <label className="pcad_field pcad_multi_esp_outras_col">
                        Outras especialidades
                        {campoTexto}
                    </label>
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
                <div className="pcad_multi_esp_panel" ref={wrapRef}>
                    <p className="pcad_muted">Separe por vírgula. Só entram especialidades já cadastradas; use as sugestões.</p>
                    <div className="pcad_multi_esp_tags">{tagsSecundarias}</div>
                    {campoTexto}
                </div>
            )}
        </div>
    )
}
