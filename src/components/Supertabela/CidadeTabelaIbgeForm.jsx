import React, { useEffect, useMemo, useState } from 'react'

import { UFS_BRASIL, buscarMunicipiosPorUf } from '../../lib/ibgeLocalidades.js'

import { normalizarMunicipioChave } from '../../lib/cidadesSupertabelaVinculos.js'



const MIN_CHARS_BUSCA = 2

const MAX_SUGESTOES = 24



const filtrarPorTexto = (lista, texto) => {

    const q = normalizarMunicipioChave(texto)

    if (!q) return []

    return lista.filter((m) => normalizarMunicipioChave(m.nome).includes(q))

}



/**

 * UF + município principal (IBGE) + municípios englobados (busca com sugestões, sem lista completa).

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



    const outrosMunicipios = useMemo(() => {

        const chavePrincipal = normalizarMunicipioChave(municipioPrincipal)

        return (municipiosIbge || []).filter((m) => normalizarMunicipioChave(m.nome) !== chavePrincipal)

    }, [municipiosIbge, municipioPrincipal])



    const englobadosSet = useMemo(

        () => new Set((municipiosEnglobados || []).map((n) => normalizarMunicipioChave(n))),

        [municipiosEnglobados],

    )



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

                (n) => normalizarMunicipioChave(n) !== normalizarMunicipioChave(municipioPrincipal),

            ),

        [municipiosEnglobados, municipioPrincipal],

    )



    const aplicarEnglobadosSet = (next) => {

        const nomes = (municipiosIbge || [])

            .map((m) => m.nome)

            .filter(

                (n) =>

                    next.has(normalizarMunicipioChave(n)) &&

                    normalizarMunicipioChave(n) !== normalizarMunicipioChave(municipioPrincipal),

            )

        onMunicipiosEnglobadosChange(nomes)

    }



    const adicionarEnglobado = (nome) => {

        const chave = normalizarMunicipioChave(nome)

        if (!chave || englobadosSet.has(chave)) return

        const next = new Set(englobadosSet)

        next.add(chave)

        aplicarEnglobadosSet(next)

        setBuscaEnglobados('')

        setSugestoesAbertas(false)

    }



    const removerEnglobado = (nome) => {

        const chave = normalizarMunicipioChave(nome)

        const next = new Set(englobadosSet)

        next.delete(chave)

        aplicarEnglobadosSet(next)

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

                                    placeholder='Digite para buscar e adicionar municípios…'

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

                                    aria-label='Buscar municípios para vincular'

                                    aria-autocomplete='list'

                                    aria-expanded={sugestoesAbertas && sugestoesEnglobados.length > 0}

                                />

                                {sugestoesAbertas &&

                                    buscaEnglobados.trim().length >= MIN_CHARS_BUSCA &&

                                    sugestoesEnglobados.length > 0 && (

                                        <ul className='cidade_tabela_englobados_sugestoes' role='listbox'>

                                            {sugestoesEnglobados.map((m) => (

                                                <li key={m.id} role='option'>

                                                    <button

                                                        type='button'

                                                        className='cidade_tabela_englobados_sugestao_btn'

                                                        onMouseDown={(e) => e.preventDefault()}

                                                        onClick={() => adicionarEnglobado(m.nome)}

                                                    >

                                                        {m.nome}

                                                    </button>

                                                </li>

                                            ))}

                                        </ul>

                                    )}

                                {sugestoesAbertas &&

                                    buscaEnglobados.trim().length >= MIN_CHARS_BUSCA &&

                                    sugestoesEnglobados.length === 0 && (

                                        <p className='cidade_tabela_englobados_vazio'>

                                            Nenhum município encontrado ou já vinculado.

                                        </p>

                                    )}

                            </div>

                            <p className='cidade_tabela_englobados_meta'>

                                {selecionadosLista.length} município(s) vinculado(s)

                                {outrosMunicipios.length > 0

                                    ? ` · ${outrosMunicipios.length} disponíveis na UF (use a busca)`

                                    : ''}

                            </p>

                            {selecionadosLista.length > 0 ? (

                                <div className='cidade_tabela_englobados_tags'>

                                    {selecionadosLista.map((nome) => (

                                        <span key={normalizarMunicipioChave(nome)} className='cidade_tabela_englobados_tag'>

                                            <span className='cidade_tabela_englobados_tag_label'>{nome}</span>

                                            {!disabled && (

                                                <button

                                                    type='button'

                                                    className='cidade_tabela_englobados_tag_remove'

                                                    aria-label={`Remover ${nome}`}

                                                    onClick={() => removerEnglobado(nome)}

                                                >

                                                    ×

                                                </button>

                                            )}

                                        </span>

                                    ))}

                                </div>

                            ) : (

                                <p className='cidade_tabela_englobados_hint'>

                                    Nenhum município adicional. Busque pelo nome para vincular.

                                </p>

                            )}

                        </>

                    )}

                    {somenteLeituraEnglobados && (

                        <p className='cidade_tabela_englobados_hint'>

                            {selecionadosLista.length

                                ? selecionadosLista.join(', ')

                                : 'Nenhum município adicional.'}

                        </p>

                    )}

                </div>

            )}

        </div>

    )

}


