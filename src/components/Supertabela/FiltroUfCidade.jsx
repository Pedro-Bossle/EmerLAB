import { useEffect, useMemo, useState } from 'react'
import { Dropdown } from '../ui/Dropdown.jsx'

/**
 * Filtro «UF + Cidade» das tabelas de valores (dois dropdowns do UI Kit lado a lado).
 *
 * opcoes: [{ value, uf, nome }] — uma por cidade. `value` = value da cidade ativa.
 * Trocar a UF mantém a cidade se ela pertence à UF; senão escolhe a primeira cidade da UF
 * (as tabelas sempre precisam de uma cidade). `onChange(opcao)` recebe a opção inteira.
 * Deve ser filho direto de <Toolbar> (renderiza dois `ek-field`).
 */
export default function FiltroUfCidade({ opcoes = [], value = '', onChange, disabled = false }) {
    const atual = useMemo(() => opcoes.find((o) => String(o.value) === String(value)) || null, [opcoes, value])
    const [ufEscolhida, setUfEscolhida] = useState('')

    // Acompanha a cidade ativa quando ela muda por fora (carga inicial, filtro de plano…).
    useEffect(() => {
        if (atual?.uf) setUfEscolhida(atual.uf)
    }, [atual?.uf])

    const ufs = useMemo(() => [...new Set(opcoes.map((o) => o.uf).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [opcoes])

    const cidades = useMemo(
        () =>
            opcoes
                .filter((o) => !ufEscolhida || o.uf === ufEscolhida)
                .map((o) => ({ value: String(o.value), label: o.nome })),
        [opcoes, ufEscolhida],
    )

    const aoMudarUf = (uf) => {
        setUfEscolhida(uf)
        if (atual && (!uf || atual.uf === uf)) return
        const primeira = opcoes.find((o) => !uf || o.uf === uf)
        if (primeira) onChange?.(primeira)
    }

    return (
        <>
            <div className="ek-field ek-field--half">
                <span className="ek-label">UF</span>
                <Dropdown
                    options={[{ value: '', label: 'Todas' }, ...ufs.map((u) => ({ value: u, label: u }))]}
                    value={ufEscolhida}
                    onChange={aoMudarUf}
                    disabled={disabled}
                    searchable={false}
                    aria-label="Filtrar por UF"
                />
            </div>
            <div className="ek-field">
                <span className="ek-label">Cidade</span>
                <Dropdown
                    options={cidades}
                    value={atual ? String(atual.value) : ''}
                    onChange={(v) => onChange?.(opcoes.find((o) => String(o.value) === v))}
                    disabled={disabled}
                    placeholder="Selecionar cidade…"
                    searchPlaceholder="Buscar cidade…"
                    searchable
                    aria-label="Filtrar por cidade"
                />
            </div>
        </>
    )
}
