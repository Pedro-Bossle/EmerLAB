import React, { useEffect, useMemo, useState } from 'react'
import { UFS_BRASIL, buscarMunicipiosPorUf } from '../../lib/ibgeLocalidades.js'
import { normalizarMunicipioChave } from '../../lib/cidadesSupertabelaVinculos.js'
import {
    MAX_KM_SUGESTAO_MALHA,
    filtrarMunicipiosPorDistanciaDoPrincipal,
} from '../../lib/municipiosCoordenadas.js'

const MIN_CHARS_BUSCA = 2
const MAX_SUGESTOES = 24

const filtrarPorTexto = (lista, texto) => {
    const q = normalizarMunicipioChave(texto)
    if (!q) return []
    return lista.filter((m) => normalizarMunicipioChave(m.nome).includes(q))
}

/**
 * UF + município principal (IBGE) + municípios englobados (busca com sugestões).
 * Prop opcional `municipiosForaMalha`: nomes credenciados fora da malha na UF.
 * Sugestões são filtradas a no máximo {@link MAX_KM_SUGESTAO_MALHA} km do município principal.
 */
export default function CidadeTabelaIbgeForm({
    uf,
    onUfChange,
    municipioPrincipal,
    onMunicipioPrincipalChange,
    municipiosEnglobados,
    onMunicipiosEnglobadosChange,
    municipiosForaMalha = [],
    disabled = false,
    somenteLeituraEnglobados = false,
}) {
    const [municipiosIbge, setMunicipiosIbge] = useState([])
    const [loadingMun, setLoadingMun] = useState(false)
    const [sugestoesProximas, setSugestoesProximas] = useState([])
    const [loadingDistancia, setLoadingDistancia] = useState(false)
    const [buscaEnglobados, setBuscaEnglobados] = useState('')
    const [sugestoesAbertas, setSugestoesAbertas] = useState(false)

    useEffect(() => {
        if (!uf) {
            setMunicipiosIbge([])
            return
        }
        let cancelado = false
        setLoadingMun(true)
        buscarMunicipiosPorUf(uf)
            .then((lista) => {
                if (!cancelado) setMunicipiosIbge(lista || [])
            })
            .catch(() => {
                if (!cancelado) setMunicipiosIbge([])
            })
            .finally(() => {
                if (!cancelado) setLoadingMun(false)
            })
        return () => {
            cancelado = true
        }
    }, [uf])

    useEffect(() => {
        setBuscaEnglobados('')
        setSugestoesAbertas(false)
    }, [uf, municipioPrincipal])

    const chavePrincipal = useMemo(
        () => normalizarMunicipioChave(municipioPrincipal),
        [municipioPrincipal],
    )

    const outrosMunicipios = useMemo(() => {
        return (municipiosIbge || []).filter((m) => normalizarMunicipioChave(m.nome) !== chavePrincipal)
    }, [municipiosIbge, chavePrincipal])

    const englobadosSet = useMemo(
        () => new Set((municipiosEnglobados || []).map((n) => normalizarMunicipioChave(n))),
        [municipiosEnglobados],
    )

    const nomeCanonicoIbge = (nome) => {
        const chave = normalizarMunicipioChave(nome)
        if (!chave) return ''
        const hit = (municipiosIbge || []).find((m) => normalizarMunicipioChave(m.nome) === chave)
        return hit?.nome || String(nome || '').trim()
    }

    const sugestoesEnglobados = useMemo(() => {
        const termo = String(buscaEnglobados || '').trim()
        if (termo.length < MIN_CHARS_BUSCA) return []
        return filtrarPorTexto(outrosMunicipios, termo)
            .filter((m) => !englobadosSet.has(normalizarMunicipioChave(m.nome)))
            .slice(0, MAX_SUGESTOES)
    }, [outrosMunicipios, buscaEnglobados, englobadosSet])

    const selecionadosLista = useMemo(
        () =>
            (municipiosEnglobados || []).filter(
                (n) => normalizarMunicipioChave(n) !== chavePrincipal,
            ),
        [municipiosEnglobados, chavePrincipal],
    )

    const candidatosForaMalha = useMemo(() => {
        return (municipiosForaMalha || []).filter((nome) => {
            const chave = normalizarMunicipioChave(nome)
            if (!chave) return false
            if (chave === chavePrincipal) return false
            if (englobadosSet.has(chave)) return false
            return true
        })
    }, [municipiosForaMalha, chavePrincipal, englobadosSet])

    useEffect(() => {
        let cancelado = false
        if (!uf || !municipioPrincipal || candidatosForaMalha.length === 0) {
            setSugestoesProximas([])
            setLoadingDistancia(false)
            return undefined
        }
        setLoadingDistancia(true)
        filtrarMunicipiosPorDistanciaDoPrincipal({
            uf,
            municipioPrincipal,
            nomes: candidatosForaMalha,
            maxKm: MAX_KM_SUGESTAO_MALHA,
        })
            .then((res) => {
                if (!cancelado) setSugestoesProximas(res.nomes || [])
            })
            .catch(() => {
                if (!cancelado) setSugestoesProximas([])
            })
            .finally(() => {
                if (!cancelado) setLoadingDistancia(false)
            })
        return () => {
            cancelado = true
        }
    }, [uf, municipioPrincipal, candidatosForaMalha])

    const sugestoesForaMalhaVisiveis = municipioPrincipal ? sugestoesProximas : []

    const adicionarEnglobado = (nome) => {
        const chave = normalizarMunicipioChave(nome)
        if (!chave || englobadosSet.has(chave) || chave === chavePrincipal) return
        const nomeFinal = nomeCanonicoIbge(nome)
        if (!nomeFinal) return
        const next = [...(municipiosEnglobados || []).filter((n) => normalizarMunicipioChave(n) !== chavePrincipal)]
        next.push(nomeFinal)
        onMunicipiosEnglobadosChange(next)
        setBuscaEnglobados('')
        setSugestoesAbertas(false)
    }

    const removerEnglobado = (nome) => {
        const chave = normalizarMunicipioChave(nome)
        onMunicipiosEnglobadosChange(
            (municipiosEnglobados || []).filter((n) => normalizarMunicipioChave(n) !== chave),
        )
    }

    const onKeyDownBusca = (event) => {
        if (event.key === 'Enter' && sugestoesEnglobados[0]) {
            event.preventDefault()
            adicionarEnglobado(sugestoesEnglobados[0].nome)
        }
        if (event.key === 'Escape') {
            setSugestoesAbertas(false)
        }
    }

    return (
        <div className="cidade_tabela_ibge_form">
            <div className="cidade_tabela_ibge_form_row">
                <label className="cidade_tabela_field_label">
                    <span>UF</span>
                    <div className="cidade_tabela_field_wrap cidade_tabela_field_wrap_select">
                        <select
                            className="cidade_tabela_field"
                            value={uf}
                            disabled={disabled}
                            onChange={(e) => onUfChange(e.target.value)}
                        >
                            <option value="">—</option>
                            {UFS_BRASIL.map((sigla) => (
                                <option key={sigla} value={sigla}>
                                    {sigla}
                                </option>
                            ))}
                        </select>
                    </div>
                </label>
                <label className="cidade_tabela_field_label cidade_tabela_field_label_grow">
                    <span>Tabela (município principal)</span>
                    <div className="cidade_tabela_field_wrap cidade_tabela_field_wrap_select">
                        <select
                            className="cidade_tabela_field"
                            value={municipioPrincipal}
                            disabled={disabled || !uf || loadingMun}
                            onChange={(e) => onMunicipioPrincipalChange(e.target.value)}
                        >
                            <option value="">{loadingMun ? 'Carregando…' : '— Selecione —'}</option>
                            {municipiosIbge.map((m) => (
                                <option key={m.id} value={m.nome}>
                                    {m.nome}
                                </option>
                            ))}
                        </select>
                    </div>
                </label>
            </div>

            {uf ? (
                <div className="cidade_tabela_fora_malha">
                    <p className="cidade_tabela_fora_malha_titulo">
                        Sugestões — credenciadas fora da malha, até {MAX_KM_SUGESTAO_MALHA} km da
                        cidade principal
                    </p>
                    {!municipioPrincipal ? (
                        <p className="cidade_tabela_fora_malha_vazio">
                            Selecione o município principal para ver sugestões próximas.
                        </p>
                    ) : loadingDistancia ? (
                        <p className="cidade_tabela_fora_malha_vazio">Filtrando por distância…</p>
                    ) : sugestoesForaMalhaVisiveis.length > 0 ? (
                        <div className="cidade_tabela_fora_malha_chips">
                            {sugestoesForaMalhaVisiveis.map((nome) => (
                                <button
                                    key={normalizarMunicipioChave(nome)}
                                    type="button"
                                    className="cidade_tabela_fora_malha_chip"
                                    disabled={disabled || somenteLeituraEnglobados}
                                    title={`Adicionar ${nome} aos municípios englobados`}
                                    onClick={() => adicionarEnglobado(nome)}
                                >
                                    + {nome}
                                </button>
                            ))}
                        </div>
                    ) : (
                        <p className="cidade_tabela_fora_malha_vazio">
                            Nenhuma cidade credenciada fora da malha a até {MAX_KM_SUGESTAO_MALHA} km
                            da cidade principal.
                        </p>
                    )}
                </div>
            ) : null}

            {uf && municipioPrincipal ? (
                <div className="cidade_tabela_englobados">
                    <p className="cidade_tabela_englobados_titulo">
                        Municípios que usam os mesmos valores desta tabela
                    </p>
                    {!somenteLeituraEnglobados ? (
                        <>
                            <div className="cidade_tabela_englobados_busca">
                                <input
                                    type="search"
                                    className="cidade_tabela_field cidade_tabela_field_search"
                                    placeholder="Digite para buscar e adicionar municípios…"
                                    value={buscaEnglobados}
                                    disabled={disabled}
                                    onChange={(e) => {
                                        setBuscaEnglobados(e.target.value)
                                        setSugestoesAbertas(true)
                                    }}
                                    onFocus={() => setSugestoesAbertas(true)}
                                    onBlur={() => {
                                        window.setTimeout(() => setSugestoesAbertas(false), 150)
                                    }}
                                    onKeyDown={onKeyDownBusca}
                                    aria-label="Buscar municípios para vincular"
                                    aria-autocomplete="list"
                                    aria-expanded={sugestoesAbertas && sugestoesEnglobados.length > 0}
                                />
                                {sugestoesAbertas &&
                                buscaEnglobados.trim().length >= MIN_CHARS_BUSCA &&
                                sugestoesEnglobados.length > 0 ? (
                                    <ul className="cidade_tabela_englobados_sugestoes" role="listbox">
                                        {sugestoesEnglobados.map((m) => (
                                            <li key={m.id} role="option">
                                                <button
                                                    type="button"
                                                    className="cidade_tabela_englobados_sugestao_btn"
                                                    onMouseDown={(e) => e.preventDefault()}
                                                    onClick={() => adicionarEnglobado(m.nome)}
                                                >
                                                    {m.nome}
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                ) : null}
                                {sugestoesAbertas &&
                                buscaEnglobados.trim().length >= MIN_CHARS_BUSCA &&
                                sugestoesEnglobados.length === 0 ? (
                                    <p className="cidade_tabela_englobados_vazio">
                                        Nenhum município encontrado ou já vinculado.
                                    </p>
                                ) : null}
                            </div>
                            <p className="cidade_tabela_englobados_meta">
                                {selecionadosLista.length} município(s) vinculado(s)
                                {outrosMunicipios.length > 0
                                    ? ` · ${outrosMunicipios.length} disponíveis na UF (use a busca)`
                                    : ''}
                            </p>
                            {selecionadosLista.length > 0 ? (
                                <div className="cidade_tabela_englobados_tags">
                                    {selecionadosLista.map((nome) => (
                                        <span
                                            key={normalizarMunicipioChave(nome)}
                                            className="cidade_tabela_englobados_tag"
                                        >
                                            <span className="cidade_tabela_englobados_tag_label">{nome}</span>
                                            {!disabled ? (
                                                <button
                                                    type="button"
                                                    className="cidade_tabela_englobados_tag_remove"
                                                    aria-label={`Remover ${nome}`}
                                                    onClick={() => removerEnglobado(nome)}
                                                >
                                                    ×
                                                </button>
                                            ) : null}
                                        </span>
                                    ))}
                                </div>
                            ) : (
                                <p className="cidade_tabela_englobados_hint">
                                    Nenhum município adicional. Busque pelo nome ou use as sugestões acima.
                                </p>
                            )}
                        </>
                    ) : (
                        <p className="cidade_tabela_englobados_hint">
                            {selecionadosLista.length
                                ? selecionadosLista.join(', ')
                                : 'Nenhum município adicional.'}
                        </p>
                    )}
                </div>
            ) : null}
        </div>
    )
}
