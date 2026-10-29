import { supabase } from '../supabase.js'

/**
 * Aplica o mapa salvo de seleção sobre categorias já carregadas.
 * Linhas presentes em `selecao` usam o valor gravado; linhas novas mantêm o checked atual
 * (regra ≥3 realizadores vinda de carregarLinhasImpressaoPlanos).
 */
export function aplicarSelecaoModo(categorias, selecao) {
    if (!selecao || typeof selecao !== 'object' || Array.isArray(selecao)) return categorias
    return (categorias || []).map((cat) => ({
        ...cat,
        linhas: (cat.linhas || []).map((l) => {
            if (l.apenasLoja || l.selecionavel === false) return { ...l, checked: false }
            if (Object.prototype.hasOwnProperty.call(selecao, l.linhaKey)) {
                return { ...l, checked: Boolean(selecao[l.linhaKey]) }
            }
            return l
        }),
    }))
}

/** Snapshot `{ [linhaKey]: boolean }` das linhas selecionáveis. */
export function montarSelecaoDeCategorias(categorias) {
    const selecao = {}
    for (const cat of categorias || []) {
        for (const l of cat.linhas || []) {
            if (l.apenasLoja || l.selecionavel === false) continue
            if (!l.linhaKey) continue
            selecao[l.linhaKey] = l.checked !== false
        }
    }
    return selecao
}

export async function buscarModoImpressaoPlanos(planoId, cidadeId) {
    if (!planoId || !cidadeId) return null
    const { data, error } = await supabase
        .from('impressao_planos_modos')
        .select('selecao, atualizado_em, atualizado_por')
        .eq('plano_id', Number(planoId))
        .eq('cidade_id', Number(cidadeId))
        .maybeSingle()
    if (error) throw error
    if (!data) return null

    let atualizadoPorNome = null
    if (data.atualizado_por) {
        const { data: perfil } = await supabase
            .from('profiles')
            .select('name')
            .eq('id', data.atualizado_por)
            .maybeSingle()
        atualizadoPorNome = perfil?.name || null
    }

    return {
        selecao: data.selecao && typeof data.selecao === 'object' ? data.selecao : {},
        atualizadoEm: data.atualizado_em || null,
        atualizadoPor: data.atualizado_por || null,
        atualizadoPorNome,
    }
}

export async function salvarModoImpressaoPlanos(planoId, cidadeId, categorias) {
    if (!planoId || !cidadeId) throw new Error('Plano e cidade são obrigatórios para salvar o modo.')
    const selecao = montarSelecaoDeCategorias(categorias)
    const {
        data: { user },
    } = await supabase.auth.getUser()
    const agora = new Date().toISOString()
    const row = {
        plano_id: Number(planoId),
        cidade_id: Number(cidadeId),
        selecao,
        atualizado_em: agora,
        atualizado_por: user?.id || null,
    }
    const { data, error } = await supabase
        .from('impressao_planos_modos')
        .upsert(row, { onConflict: 'plano_id,cidade_id' })
        .select('selecao, atualizado_em, atualizado_por')
        .maybeSingle()
    if (error) throw error

    let atualizadoPorNome = null
    if (data?.atualizado_por) {
        const { data: perfil } = await supabase
            .from('profiles')
            .select('name')
            .eq('id', data.atualizado_por)
            .maybeSingle()
        atualizadoPorNome = perfil?.name || null
    }

    return {
        selecao: data?.selecao || selecao,
        atualizadoEm: data?.atualizado_em || agora,
        atualizadoPor: data?.atualizado_por || user?.id || null,
        atualizadoPorNome,
    }
}

/** Texto curto para o indicador da UI. */
export function rotuloModoImpressao(modo) {
    if (!modo?.atualizadoEm) return 'Ainda sem modo salvo para este plano e cidade.'
    const quando = formatarQuandoRelativo(modo.atualizadoEm)
    const quem = modo.atualizadoPorNome ? ` · por ${modo.atualizadoPorNome}` : ''
    return `Modo da equipe: salvo ${quando}${quem}`
}

function formatarQuandoRelativo(iso) {
    const t = new Date(iso).getTime()
    if (!Number.isFinite(t)) return String(iso)
    const diff = Date.now() - t
    if (diff < 60_000) return 'agora'
    if (diff < 3600_000) {
        const m = Math.round(diff / 60_000)
        return `há ${m} min`
    }
    if (diff < 86400_000) {
        const h = Math.round(diff / 3600_000)
        return `há ${h} h`
    }
    try {
        return new Date(iso).toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        })
    } catch {
        return String(iso)
    }
}
