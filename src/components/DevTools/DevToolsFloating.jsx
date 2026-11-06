import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { isDevToolsEnabled, useStoredAccessProfile } from '../../lib/accessControl'
import {
    alternarColunaDevTools,
    alternarDevToolsUiFlag,
    devToolsAlgumRecursoAtivo,
    useDevToolsUi,
} from '../../lib/devToolsUi'
import './DevToolsFloating.css'

/** Recursos liberados pelo Dev Tool, por seção. `tipo: 'flag'` é global; `'coluna'` é de uma tela. */
const SECOES = [
    {
        id: 'geral',
        titulo: 'Geral',
        itens: [
            {
                tipo: 'flag',
                chave: 'exclusaoMassa',
                rotulo: 'Exclusão por lista',
                descricao: 'Somente Super-Tabela › Planos (modo Ver diferenças).',
            },
        ],
    },
    {
        id: 'cadastro',
        titulo: 'Cadastro de prestadores',
        itens: [
            { tipo: 'coluna', tela: 'cadastro', chave: 'perfil', rotulo: 'Coluna Perfil %', descricao: 'Barra de completude da ficha.' },
            { tipo: 'coluna', tela: 'cadastro', chave: 'crmv', rotulo: 'Coluna CRMV', descricao: 'Exibe o CRMV na lista.' },
            {
                tipo: 'coluna',
                tela: 'cadastro',
                chave: 'procs',
                rotulo: 'Coluna Procedimentos',
                descricao: 'Quantidade de procedimentos (vets e clínicas).',
            },
            {
                tipo: 'coluna',
                tela: 'cadastro',
                chave: 'ocultarVetsClinica',
                rotulo: 'Ocultar vets em clínicas',
                descricao: 'Esconde veterinários vinculados a estabelecimentos.',
            },
        ],
    },
]

function Chave({ tamanho = 18 }) {
    return (
        <svg
            width={tamanho}
            height={tamanho}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
        >
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
    )
}

function Fechar() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
        </svg>
    )
}

/**
 * Dev Tool: interruptores de recursos de desenvolvimento (colunas extras, exclusão por lista…).
 * Mesmo padrão da Central de Notificações: botão fixo pequeno + painel lateral (folha inferior no celular).
 *
 * Props
 * - mode: 'dock' no celular/tablet. Sem botão próprio: quem abre é a dock de ferramentas (via `open`).
 * - open / onOpenChange: abertura controlada pelo Layout2.
 */
export default function DevToolsFloating({ mode = 'fab', open: openControlled, onOpenChange } = {}) {
    const profile = useStoredAccessProfile()
    const permitido = isDevToolsEnabled(profile)
    const { pathname } = useLocation()
    // Na ficha de cadastro existe uma barra de ações fixa no rodapé: o botão sobe para não ficar embaixo dela.
    const acimaRodapeFormulario = /\/credenciamento\/cadastro\/[^/]+/.test(pathname)
    const isDock = mode === 'dock'
    const controlado = typeof openControlled === 'boolean'

    const [abertoInterno, setAbertoInterno] = useState(false)
    const aberto = controlado ? openControlled : abertoInterno
    const setAberto = useCallback(
        (v) => {
            if (!controlado) setAbertoInterno(v)
            onOpenChange?.(v)
        },
        [controlado, onOpenChange],
    )
    const { ui } = useDevToolsUi()

    const botaoRef = useRef(null)
    const fecharRef = useRef(null)

    // Esc fecha; ao abrir leva o foco para «Fechar»
    useEffect(() => {
        if (!aberto || !permitido) return undefined
        fecharRef.current?.focus({ preventScroll: true })
        const onKey = (e) => {
            if (e.key === 'Escape') {
                setAberto(false)
                botaoRef.current?.focus({ preventScroll: true })
            }
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [aberto, permitido, setAberto])

    if (!permitido) return null

    const colCad = ui.colunasCadastro || {}
    const ligado = (item) => (item.tipo === 'flag' ? Boolean(ui[item.chave]) : Boolean((ui.colunasCadastro || {})[item.chave]))
    const alternar = (item) => {
        if (item.tipo === 'flag') alternarDevToolsUiFlag(item.chave)
        else alternarColunaDevTools(item.tela, item.chave)
    }
    const totalAtivos = SECOES.reduce((n, s) => n + s.itens.filter(ligado).length, 0)
    // inclui colunas de outras telas que o painel não lista, para o ponto de «recurso ligado» no botão
    const algumAtivo = totalAtivos > 0 || devToolsAlgumRecursoAtivo(ui) || Boolean(colCad.ocultarVetsClinica)

    return (
        <div className={`dt_root${acimaRodapeFormulario ? ' is-rodape' : ''}`}>
            {!isDock ? (
                <button
                    ref={botaoRef}
                    type="button"
                    className={`dt_btn${aberto ? ' is-open' : ''}${algumAtivo ? ' is-ativo' : ''}`}
                    aria-label={totalAtivos > 0 ? `Dev Tool, ${totalAtivos} ${totalAtivos === 1 ? 'recurso ligado' : 'recursos ligados'}` : 'Dev Tool'}
                    aria-expanded={aberto}
                    aria-controls="dt-painel"
                    title="Dev Tool"
                    onClick={() => setAberto(!aberto)}
                >
                    <Chave />
                </button>
            ) : null}

            <div className={`dt_scrim${aberto ? ' is-on' : ''}`} onClick={() => setAberto(false)} aria-hidden="true" />

            <aside
                id="dt-painel"
                className={`dt_panel${aberto ? ' is-open' : ''}`}
                role="dialog"
                aria-label="Ferramentas de desenvolvimento"
                aria-hidden={!aberto}
            >
                <div className="dt_grip" aria-hidden="true" />
                <header className="dt_head">
                    <h2 className="dt_title">Dev Tool</h2>
                    {totalAtivos > 0 ? <span className="dt_count">{totalAtivos} {totalAtivos === 1 ? 'ligado' : 'ligados'}</span> : null}
                    <button ref={fecharRef} type="button" className="dt_iconbtn" aria-label="Fechar Dev Tool" onClick={() => setAberto(false)}>
                        <Fechar />
                    </button>
                </header>

                <div className="dt_body">
                    {SECOES.map((secao) => (
                        <section key={secao.id} className="dt_sec" aria-labelledby={`dt-sec-${secao.id}`}>
                            <h3 id={`dt-sec-${secao.id}`} className="dt_sec_tit">
                                {secao.titulo}
                            </h3>
                            <ul className="dt_lista">
                                {secao.itens.map((item) => (
                                    <li key={`${item.tipo}-${item.chave}`}>
                                        <label className="dt_row">
                                            <span className="dt_row_txt">
                                                <strong>{item.rotulo}</strong>
                                                <small>{item.descricao}</small>
                                            </span>
                                            <input
                                                type="checkbox"
                                                role="switch"
                                                className="dt_switch"
                                                checked={ligado(item)}
                                                onChange={() => alternar(item)}
                                            />
                                        </label>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ))}
                    <p className="dt_nota">As opções valem só para este navegador.</p>
                </div>
            </aside>
        </div>
    )
}
