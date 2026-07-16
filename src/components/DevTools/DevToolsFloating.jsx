import React, { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { isDevToolsEnabled, useStoredAccessProfile } from '../../lib/accessControl'

import {
    alternarColunaDevTools,
    alternarDevToolsUiFlag,
    DEFAULT_COLUNAS_NEGOCIACOES,
    useDevToolsUi,
} from '../../lib/devToolsUi'

import './DevToolsFloating.css'



const ITENS_GLOBAIS = [

    {

        chave: 'exclusaoMassa',

        rotulo: 'Exclusão por lista',

        descricao: 'Somente Super-Tabela › Planos (modo Ver diferenças).',

    },

    {

        chave: 'contagemRealizadoresPlanos',

        rotulo: 'Prestadores por procedimento',

        descricao:
            'Super-Tabela › Planos (diferenças) e › Cidades: coluna com quantos realizam o procedimento (cidade + paralelas) e sugestões no fim da página.',

    },

]



const ITENS_NEGOCIACOES = [
    {
        chave: 'vinculoPrestadorLista',
        rotulo: 'Coluna Prestador vinculado',
        descricao: 'Negociações (lista): exibe e permite editar o vínculo com prestador credenciado.',
    },
]

const ITENS_CADASTRO = [

    { chave: 'perfil', rotulo: 'Coluna Perfil %', descricao: 'Cadastro de prestadores: barra de completude da ficha.' },

    { chave: 'crmv', rotulo: 'Coluna CRMV', descricao: 'Cadastro de prestadores: exibe CRMV na lista.' },

    { chave: 'procs', rotulo: 'Coluna Procedimentos', descricao: 'Cadastro de prestadores: quantidade de procedimentos (vets e clínicas).' },

    {
        chave: 'copiarCodigosProcs',
        rotulo: 'Copiar códigos do perfil',
        descricao:
            'Cadastro: botão para copiar só os códigos dos procedimentos do perfil (lista e ficha do prestador).',
    },

    {

        chave: 'ocultarVetsClinica',

        rotulo: 'Ocultar vets em clínicas',

        descricao: 'Cadastro: esconde veterinários vinculados a estabelecimentos.',

    },

    {
        chave: 'coordenadasMapa',
        rotulo: 'Latitude / longitude',
        descricao: 'Cadastro: campos editáveis de coordenadas (mapa).',
    },

]



export default function DevToolsFloating() {

    const profile = useStoredAccessProfile()
    const permitido = isDevToolsEnabled(profile)

    const { pathname } = useLocation()
    const acimaRodapeFormulario = /\/credenciamento\/cadastro\/[^/]+/.test(pathname)

    const [aberto, setAberto] = useState(false)

    const { ui } = useDevToolsUi()

    const painelRef = useRef(null)

    const btnRef = useRef(null)



    useEffect(() => {

        if (!aberto) return undefined

        const onDoc = (e) => {

            const alvo = e.target

            if (painelRef.current?.contains(alvo) || btnRef.current?.contains(alvo)) return

            setAberto(false)

        }

        const onKey = (e) => {

            if (e.key === 'Escape') setAberto(false)

        }

        document.addEventListener('mousedown', onDoc)

        document.addEventListener('keydown', onKey)

        return () => {

            document.removeEventListener('mousedown', onDoc)

            document.removeEventListener('keydown', onKey)

        }

    }, [aberto])



    if (!permitido) return null



    const colCad = ui.colunasCadastro || {}
    const colNeg = ui.colunasNegociacoes || {}

    const algumAtivo =
        ui.exclusaoMassa ||
        ui.contagemRealizadoresPlanos ||
        Object.values(ui.colunasProcessos || {}).some(Boolean) ||
        Object.values(colCad).some(Boolean) ||
        colNeg.vinculoPrestadorLista !== DEFAULT_COLUNAS_NEGOCIACOES.vinculoPrestadorLista



    return (

        <div
            className={`dev_tools_float${acimaRodapeFormulario ? ' dev_tools_float--rodape_fixo' : ''}`}
            aria-live="polite"
        >

            {aberto && (

                <div ref={painelRef} className="dev_tools_float_panel" role="dialog" aria-label="Ferramentas de desenvolvimento">

                    <p className="dev_tools_float_titulo">Dev Tool</p>

                    <ul className="dev_tools_float_lista">

                        {ITENS_GLOBAIS.map((item) => (

                            <li key={item.chave}>

                                <label className="dev_tools_float_item">

                                    <input

                                        type="checkbox"

                                        className="dev_tools_float_checkbox"

                                        checked={Boolean(ui[item.chave])}

                                        onChange={() => alternarDevToolsUiFlag(item.chave)}

                                    />

                                    <span className="dev_tools_float_item_texto">

                                        <strong>{item.rotulo}</strong>

                                        <small>{item.descricao}</small>

                                    </span>

                                </label>

                            </li>

                        ))}

                    </ul>

                    <p className="dev_tools_float_subtitulo">Super-Tabela › Negociações</p>

                    <ul className="dev_tools_float_lista">
                        {ITENS_NEGOCIACOES.map((item) => (
                            <li key={item.chave}>
                                <label className="dev_tools_float_item">
                                    <input
                                        type="checkbox"
                                        className="dev_tools_float_checkbox"
                                        checked={Boolean(colNeg[item.chave])}
                                        onChange={() => alternarColunaDevTools('negociacoes', item.chave)}
                                    />
                                    <span className="dev_tools_float_item_texto">
                                        <strong>{item.rotulo}</strong>
                                        <small>{item.descricao}</small>
                                    </span>
                                </label>
                            </li>
                        ))}
                    </ul>

                    <p className="dev_tools_float_subtitulo">Cadastro de prestadores</p>

                    <ul className="dev_tools_float_lista">

                        {ITENS_CADASTRO.map((item) => (

                            <li key={item.chave}>

                                <label className="dev_tools_float_item">

                                    <input

                                        type="checkbox"

                                        className="dev_tools_float_checkbox"

                                        checked={Boolean(colCad[item.chave])}

                                        onChange={() => alternarColunaDevTools('cadastro', item.chave)}

                                    />

                                    <span className="dev_tools_float_item_texto">

                                        <strong>{item.rotulo}</strong>

                                        <small>{item.descricao}</small>

                                    </span>

                                </label>

                            </li>

                        ))}

                    </ul>

                </div>

            )}

            <button

                ref={btnRef}

                type="button"

                className={`dev_tools_float_btn${aberto ? ' is-open' : ''}${algumAtivo ? ' is-active' : ''}`}

                aria-label="Ferramentas Dev Tool"

                aria-expanded={aberto}

                title="Dev Tool"

                onClick={() => setAberto((v) => !v)}

            >

                <span className="dev_tools_float_btn_ico" aria-hidden="true">

                    🔧

                </span>

            </button>

        </div>

    )

}


