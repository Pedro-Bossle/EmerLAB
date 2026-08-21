import { useCallback, useEffect, useState } from 'react'

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
    /** Padrão do produto (não é mais toggle Dev Tool). */
    coordenadasMapa: true,
}

export const DEFAULT_COLUNAS_NEGOCIACOES = {
    /** Padrão do produto (não é mais toggle Dev Tool). */
    vinculoPrestadorLista: true,
}

const DEFAULT_UI = {
    exclusaoMassa: false,
    /** Padrão do produto (não é mais toggle Dev Tool). */
    contagemRealizadoresPlanos: true,
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
        // Sempre ativo: recurso padrão do produto.
        base.coordenadasMapa = true
    }
    return base
}

function normalizarColunasNegociacoes(_raw) {
    return {
        ...DEFAULT_COLUNAS_NEGOCIACOES,
        // Sempre ativo: recurso padrão do produto.
        vinculoPrestadorLista: true,
    }
}

function estadoUiPadrao() {
    return {
        ...DEFAULT_UI,
        colunasProcessos: { ...DEFAULT_COLUNAS_PROCESSOS },
        colunasCadastro: { ...DEFAULT_COLUNAS_CADASTRO },
        colunasNegociacoes: { ...DEFAULT_COLUNAS_NEGOCIACOES },
    }
}

export function lerDevToolsUi() {
    if (typeof window === 'undefined') {
        return estadoUiPadrao()
    }
    try {
        const raw = window.localStorage.getItem(DEV_TOOLS_UI_STORAGE_KEY)
        if (!raw) {
            return estadoUiPadrao()
        }
        const parsed = JSON.parse(raw)
        if (parsed.colunasExtras === true) {
            return {
                exclusaoMassa: !!parsed.exclusaoMassa,
                contagemRealizadoresPlanos: true,
                colunasProcessos: { pdf: true, site: true, mapa: true },
                colunasCadastro: {
                    perfil: true,
                    crmv: true,
                    procs: true,
                    ocultarVetsClinica: false,
                    coordenadasMapa: true,
                },
                colunasNegociacoes: { vinculoPrestadorLista: true },
            }
        }
        return {
            exclusaoMassa: !!parsed.exclusaoMassa,
            contagemRealizadoresPlanos: true,
            colunasProcessos: normalizarColunasProcessos(parsed.colunasProcessos),
            colunasCadastro: normalizarColunasCadastro(parsed.colunasCadastro),
            colunasNegociacoes: normalizarColunasNegociacoes(parsed.colunasNegociacoes),
        }
    } catch {
        return estadoUiPadrao()
    }
}

export function salvarDevToolsUi(partial) {
    if (typeof window === 'undefined') return lerDevToolsUi()
    const atual = lerDevToolsUi()
    const next = {
        ...atual,
        ...partial,
        contagemRealizadoresPlanos: true,
        colunasProcessos: partial.colunasProcessos
            ? { ...atual.colunasProcessos, ...partial.colunasProcessos }
            : atual.colunasProcessos,
        colunasCadastro: partial.colunasCadastro
            ? {
                  ...atual.colunasCadastro,
                  ...partial.colunasCadastro,
                  coordenadasMapa: true,
              }
            : { ...atual.colunasCadastro, coordenadasMapa: true },
        colunasNegociacoes: {
            ...atual.colunasNegociacoes,
            ...(partial.colunasNegociacoes || {}),
            vinculoPrestadorLista: true,
        },
    }
    window.localStorage.setItem(DEV_TOOLS_UI_STORAGE_KEY, JSON.stringify(next))
    window.dispatchEvent(new CustomEvent(DEV_TOOLS_UI_CHANGE_EVENT, { detail: next }))
    return next
}

const FLAGS_PADRAO_PRODUTO = new Set([
    'contagemRealizadoresPlanos',
])

export function alternarDevToolsUiFlag(chave) {
    // Recursos promovidos a padrão do produto não podem ser desligados pela Dev Tool.
    if (FLAGS_PADRAO_PRODUTO.has(chave)) {
        return lerDevToolsUi()
    }
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
        if (chaveColuna === 'coordenadasMapa') return atual
        const atualCol = { ...DEFAULT_COLUNAS_CADASTRO, ...atual.colunasCadastro }
        const colunasCadastro = {
            ...atualCol,
            [chaveColuna]: !atualCol[chaveColuna],
        }
        return salvarDevToolsUi({ colunasCadastro })
    }
    if (tela === 'negociacoes') {
        if (chaveColuna === 'vinculoPrestadorLista') return atual
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

export function devToolsAlgumRecursoAtivo(ui) {
    const u = ui || lerDevToolsUi()
    if (u.exclusaoMassa) return true
    if (Object.values(u.colunasProcessos || {}).some(Boolean)) return true
    const cad = u.colunasCadastro || {}
    if (cad.perfil || cad.crmv || cad.procs || cad.ocultarVetsClinica) {
        return true
    }
    return false
}
