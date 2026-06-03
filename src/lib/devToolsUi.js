import { useCallback, useEffect, useState } from 'react'
import { hasStoredDevTools } from './accessControl.js'

export const DEV_TOOLS_UI_STORAGE_KEY = 'emerdog_dev_tools_ui'
export const DEV_TOOLS_UI_CHANGE_EVENT = 'emerdog-dev-tools-ui-change'

export const DEFAULT_COLUNAS_PROCESSOS = {
    pdf: false,
    site: false,
    mapa: false,
}

export const DEFAULT_COLUNAS_CADASTRO = {
    perfil: false,
    crmv: false,
    procs: false,
    ocultarVetsClinica: false,
}

export const DEFAULT_COLUNAS_NEGOCIACOES = {
    /** Lista principal: coluna Prestador vinculado (edição inline). */
    vinculoPrestadorLista: true,
}

const DEFAULT_UI = {
    buscaNot: false,
    exclusaoMassa: false,
    colunasProcessos: { ...DEFAULT_COLUNAS_PROCESSOS },
    colunasCadastro: { ...DEFAULT_COLUNAS_CADASTRO },
    colunasNegociacoes: { ...DEFAULT_COLUNAS_NEGOCIACOES },
}

function normalizarColunasProcessos(raw) {
    const base = { ...DEFAULT_COLUNAS_PROCESSOS }
    if (raw && typeof raw === 'object') {
        base.pdf = !!raw.pdf
        base.site = !!raw.site
        base.mapa = !!raw.mapa
    }
    return base
}

function normalizarColunasCadastro(raw) {
    const base = { ...DEFAULT_COLUNAS_CADASTRO }
    if (raw && typeof raw === 'object') {
        base.perfil = !!raw.perfil
        base.crmv = !!raw.crmv
        base.procs = !!raw.procs
        base.ocultarVetsClinica = !!(raw.ocultarVetsClinica ?? raw.ocultarVets)
    }
    return base
}

function normalizarColunasNegociacoes(raw) {
    const base = { ...DEFAULT_COLUNAS_NEGOCIACOES }
    if (raw && typeof raw === 'object') {
        base.vinculoPrestadorLista =
            raw.vinculoPrestadorLista !== undefined
                ? !!raw.vinculoPrestadorLista
                : DEFAULT_COLUNAS_NEGOCIACOES.vinculoPrestadorLista
    }
    return base
}

export function lerDevToolsUi() {
    if (typeof window === 'undefined') {
        return {
            ...DEFAULT_UI,
            colunasProcessos: { ...DEFAULT_COLUNAS_PROCESSOS },
            colunasCadastro: { ...DEFAULT_COLUNAS_CADASTRO },
            colunasNegociacoes: { ...DEFAULT_COLUNAS_NEGOCIACOES },
        }
    }
    try {
        const raw = window.localStorage.getItem(DEV_TOOLS_UI_STORAGE_KEY)
        if (!raw) {
            return {
                ...DEFAULT_UI,
                colunasProcessos: { ...DEFAULT_COLUNAS_PROCESSOS },
                colunasCadastro: { ...DEFAULT_COLUNAS_CADASTRO },
                colunasNegociacoes: { ...DEFAULT_COLUNAS_NEGOCIACOES },
            }
        }
        const parsed = JSON.parse(raw)
        if (parsed.colunasExtras === true) {
            return {
                buscaNot: !!parsed.buscaNot,
                exclusaoMassa: !!parsed.exclusaoMassa,
                colunasProcessos: { pdf: true, site: true, mapa: true },
                colunasCadastro: { perfil: true, crmv: true, procs: true, ocultarVetsClinica: false },
                colunasNegociacoes: { vinculoPrestadorLista: true },
            }
        }
        return {
            buscaNot: !!parsed.buscaNot,
            exclusaoMassa: !!parsed.exclusaoMassa,
            colunasProcessos: normalizarColunasProcessos(parsed.colunasProcessos),
            colunasCadastro: normalizarColunasCadastro(parsed.colunasCadastro),
            colunasNegociacoes: normalizarColunasNegociacoes(parsed.colunasNegociacoes),
        }
    } catch {
        return {
            ...DEFAULT_UI,
            colunasProcessos: { ...DEFAULT_COLUNAS_PROCESSOS },
            colunasCadastro: { ...DEFAULT_COLUNAS_CADASTRO },
            colunasNegociacoes: { ...DEFAULT_COLUNAS_NEGOCIACOES },
        }
    }
}

export function salvarDevToolsUi(partial) {
    if (typeof window === 'undefined') return lerDevToolsUi()
    const atual = lerDevToolsUi()
    const next = {
        ...atual,
        ...partial,
        colunasProcessos: partial.colunasProcessos
            ? { ...atual.colunasProcessos, ...partial.colunasProcessos }
            : atual.colunasProcessos,
        colunasCadastro: partial.colunasCadastro
            ? { ...atual.colunasCadastro, ...partial.colunasCadastro }
            : atual.colunasCadastro,
        colunasNegociacoes: partial.colunasNegociacoes
            ? { ...atual.colunasNegociacoes, ...partial.colunasNegociacoes }
            : atual.colunasNegociacoes,
    }
    window.localStorage.setItem(DEV_TOOLS_UI_STORAGE_KEY, JSON.stringify(next))
    window.dispatchEvent(new CustomEvent(DEV_TOOLS_UI_CHANGE_EVENT, { detail: next }))
    return next
}

export function alternarDevToolsUiFlag(chave) {
    const atual = lerDevToolsUi()
    return salvarDevToolsUi({ [chave]: !atual[chave] })
}

export function alternarColunaDevTools(tela, chaveColuna) {
    const atual = lerDevToolsUi()
    if (tela === 'processos') {
        const colunasProcessos = {
            ...atual.colunasProcessos,
            [chaveColuna]: !atual.colunasProcessos[chaveColuna],
        }
        return salvarDevToolsUi({ colunasProcessos })
    }
    if (tela === 'cadastro') {
        const atualCol = { ...DEFAULT_COLUNAS_CADASTRO, ...atual.colunasCadastro }
        const colunasCadastro = {
            ...atualCol,
            [chaveColuna]: !atualCol[chaveColuna],
        }
        return salvarDevToolsUi({ colunasCadastro })
    }
    if (tela === 'negociacoes') {
        const atualCol = { ...DEFAULT_COLUNAS_NEGOCIACOES, ...atual.colunasNegociacoes }
        const colunasNegociacoes = {
            ...atualCol,
            [chaveColuna]: !atualCol[chaveColuna],
        }
        return salvarDevToolsUi({ colunasNegociacoes })
    }
    return atual
}

export function useDevToolsUi() {
    const [ui, setUi] = useState(() => lerDevToolsUi())

    useEffect(() => {
        const sync = () => setUi(lerDevToolsUi())
        window.addEventListener(DEV_TOOLS_UI_CHANGE_EVENT, sync)
        window.addEventListener('storage', sync)
        return () => {
            window.removeEventListener(DEV_TOOLS_UI_CHANGE_EVENT, sync)
            window.removeEventListener('storage', sync)
        }
    }, [])

    const patch = useCallback((partial) => {
        salvarDevToolsUi(partial)
    }, [])

    const toggle = useCallback((chave) => {
        alternarDevToolsUiFlag(chave)
    }, [])

    const toggleColuna = useCallback((tela, chaveColuna) => {
        alternarColunaDevTools(tela, chaveColuna)
    }, [])

    return { ui, patch, toggle, toggleColuna }
}

export function useBuscaNotAtiva() {
    const { ui } = useDevToolsUi()
    return hasStoredDevTools() && ui.buscaNot
}

export function devToolsAlgumRecursoAtivo(ui) {
    const u = ui || lerDevToolsUi()
    if (u.buscaNot || u.exclusaoMassa) return true
    if (Object.values(u.colunasProcessos || {}).some(Boolean)) return true
    if (Object.values(u.colunasCadastro || {}).some(Boolean)) return true
    if (Object.values(u.colunasNegociacoes || {}).some(Boolean)) return true
    return false
}
