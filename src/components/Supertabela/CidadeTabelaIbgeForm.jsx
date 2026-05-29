import React, { useEffect, useMemo, useState } from 'react'
import { UFS_BRASIL, buscarMunicipiosPorUf } from '../../lib/ibgeLocalidades.js'
import { normalizarMunicipioChave } from '../../lib/cidadesSupertabelaVinculos.js'

const filtrarPorTexto = (lista, texto) => {
    const q = normalizarMunicipioChave(texto)
    if (!q) return lista
    return lista.filter((m) => normalizarMunicipioChave(m.nome).includes(q))
}

/**
 * UF + município principal (IBGE) + checkboxes de municípios englobados na mesma UF.
 */
export default function CidadeTabelaIbgeForm({
    uf,
    onUfChange,
    municipioPrincipal,
    onMunicipioPrincipalChange,
    municipiosEnglobados,
    onMunicipiosEnglobadosChange,
    disabled = false,
    somenteLeituraEnglobados = false,
}) {
    const [municipiosIbge, setMunicipiosIbge] = useState([])
    const [loadingMun, setLoadingMun] = useState(false)
    const [buscaEnglobados, setBuscaEnglobados] = useState('')

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
    }, [uf, municipioPrincipal])

    const outrosMunicipios = useMemo(() => {
        const chavePrincipal = normalizarMunicipioChave(municipioPrincipal)
        return (municipiosIbge || []).filter((m) => normalizarMunicipioChave(m.nome) !== chavePrincipal)
    }, [municipiosIbge, municipioPrincipal])

    const outrosMunicipiosFiltrados = useMemo(
        () => filtrarPorTexto(outrosMunicipios, buscaEnglobados),
        [outrosMunicipios, buscaEnglobados],
    )

    const englobadosSet = useMemo(
        () => new Set((municipiosEnglobados || []).map((n) => normalizarMunicipioChave(n))),
        [municipiosEnglobados],
    )

    const toggleEnglobado = (nome) => {
        const chave = normalizarMunicipioChave(nome)
        const next = new Set(englobadosSet)
        if (next.has(chave)) next.delete(chave)
        else next.add(chave)
        const nomes = (municipiosIbge || [])
            .map((m) => m.nome)
            .filter(
                (n) =>
                    next.has(normalizarMunicipioChave(n)) &&
                    normalizarMunicipioChave(n) !== normalizarMunicipioChave(municipioPrincipal),
            )
        onMunicipiosEnglobadosChange(nomes)
    }

    return (
        <div className='cidade_tabela_ibge_form'>
            <div className='cidade_tabela_ibge_form_row'>
                <label className='cidade_tabela_field_label'>
                    <span>UF</span>
                    <div className='cidade_tabela_field_wrap cidade_tabela_field_wrap_select'>
                        <select
                            className='cidade_tabela_field'
                            value={uf}
                            disabled={disabled}
                            onChange={(e) => onUfChange(e.target.value)}
                        >
                            <option value=''>—</option>
                            {UFS_BRASIL.map((sigla) => (
                                <option key={sigla} value={sigla}>
                                    {sigla}
                                </option>
                            ))}
                        </select>
                    </div>
                </label>
                <label className='cidade_tabela_field_label cidade_tabela_field_label_grow'>
                    <span>Tabela (município principal)</span>
                    <div className='cidade_tabela_field_wrap cidade_tabela_field_wrap_select'>
                        <select
                            className='cidade_tabela_field'
                            value={municipioPrincipal}
                            disabled={disabled || !uf || loadingMun}
                            onChange={(e) => onMunicipioPrincipalChange(e.target.value)}
                        >
                            <option value=''>{loadingMun ? 'Carregando…' : '— Selecione —'}</option>
                            {municipiosIbge.map((m) => (
                                <option key={m.id} value={m.nome}>
                                    {m.nome}
                                </option>
                            ))}
                        </select>
                    </div>
                </label>
            </div>
            {uf && municipioPrincipal && (
                <div className='cidade_tabela_englobados'>
                    <p className='cidade_tabela_englobados_titulo'>
                        Municípios que usam os mesmos valores desta tabela
                    </p>
                    {!somenteLeituraEnglobados && (
                        <>
                            <div className='cidade_tabela_englobados_busca'>
                                <input
                                    type='search'
                                    className='cidade_tabela_field cidade_tabela_field_search'
                                    placeholder='Buscar na lista de municípios…'
                                    value={buscaEnglobados}
                                    disabled={disabled}
                                    onChange={(e) => setBuscaEnglobados(e.target.value)}
                                    aria-label='Buscar municípios para vincular'
                                />
                            </div>
                            <p className='cidade_tabela_englobados_meta'>
                                {outrosMunicipiosFiltrados.length} de {outrosMunicipios.length} municípios
                                {englobadosSet.size > 0 ? ` · ${englobadosSet.size} selecionado(s)` : ''}
                            </p>
                            {outrosMunicipiosFiltrados.length === 0 ? (
                                <p className='cidade_tabela_englobados_vazio'>Nenhum município corresponde à busca.</p>
                            ) : (
                                <div className='cidade_tabela_englobados_grid'>
                                    {outrosMunicipiosFiltrados.map((m) => (
                                        <label key={m.id} className='cidade_tabela_englobados_item'>
                                            <input
                                                type='checkbox'
                                                checked={englobadosSet.has(normalizarMunicipioChave(m.nome))}
                                                disabled={disabled}
                                                onChange={() => toggleEnglobado(m.nome)}
                                            />
                                            <span>{m.nome}</span>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                    {somenteLeituraEnglobados && (
                        <p className='cidade_tabela_englobados_hint'>
                            {(municipiosEnglobados || []).length
                                ? municipiosEnglobados.join(', ')
                                : 'Nenhum município adicional.'}
                        </p>
                    )}
                </div>
            )}
        </div>
    )
}
