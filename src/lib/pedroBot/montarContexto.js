/**
 * Monta o system prompt do Pedro Bot (servidor).
 * Seed estático + docs/ia-usuario.md + blocos activos na tabela.
 */
/* global process */
import fs from 'node:fs'
import path from 'node:path'

const MAX_BLOCO_CHARS = 4000
const MAX_EXTRAS_CHARS = 24_000
const MAX_MENSAGENS = 12
const MAX_MSG_CHARS = 4000

function lerDoc(nome) {
    const candidatos = [
        path.join(process.cwd(), 'docs', nome),
        path.join(process.cwd(), '..', 'docs', nome),
    ]
    for (const p of candidatos) {
        try {
            return fs.readFileSync(p, 'utf8')
        } catch {
            /* tenta o próximo */
        }
    }
    return ''
}

function personaPedroBot() {
    return `Você é o Pedro Bot, assistente interno do EmerLAB (Emerdog) para novos contratados.
Ajude a usar o sistema: menus, rotas, ordem correcta dos processos de credenciamento.
Responda em português, curto e prático. Cite o nome do menu e a rota quando ajudar.
Não invente ecrãs, botões ou colunas. Não aceda a dados vivos (fichas, valores, envelopes).
Não peça nem revele chaves ou dados pessoais. Se não souber, diga e indique a tela certa.
Não confunda este chat com o Bate-papo / Emerzap (conversa entre pessoas).`
}

function formatarExtras(linhas) {
    if (!Array.isArray(linhas) || !linhas.length) return ''
    const partes = []
    let total = 0
    for (const row of linhas) {
        const titulo = String(row?.titulo || '').trim() || 'Sem título'
        const cat = String(row?.categoria || 'geral').trim()
        const corpo = String(row?.corpo || '').trim().slice(0, MAX_BLOCO_CHARS)
        if (!corpo) continue
        const bloco = `### [${cat}] ${titulo}\n${corpo}`
        if (total + bloco.length > MAX_EXTRAS_CHARS) break
        partes.push(bloco)
        total += bloco.length
    }
    if (!partes.length) return ''
    return `\n\n## Notas da equipa (editor na app)\n\n${partes.join('\n\n')}`
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient | null} supabaseAdmin
 */
export async function montarContextoPedroBot(supabaseAdmin) {
    const seed = lerDoc('pedro-bot-conhecimento.md')
    const iaUsuario = lerDoc('ia-usuario.md')
    let extras = []
    if (supabaseAdmin) {
        const { data, error } = await supabaseAdmin
            .from('pedro_bot_conhecimento')
            .select('categoria, titulo, corpo')
            .eq('activo', true)
            .order('titulo', { ascending: true })
        if (!error && Array.isArray(data)) extras = data
    }

    const partes = [personaPedroBot()]
    if (seed) partes.push('\n---\n', seed)
    if (iaUsuario) partes.push('\n---\n## Guia curto de IA (prospectos)\n\n', iaUsuario)
    partes.push(formatarExtras(extras))
    return partes.join('')
}

function rotuloPapel(role) {
    const r = String(role || '').toLowerCase()
    if (r === 'assistant' || r === 'bot' || r === 'model') return 'Pedro Bot'
    return 'Utilizador'
}

/**
 * @param {string} contexto
 * @param {Array<{ role?: string, content?: string }>} mensagens
 */
export function montarPromptChat(contexto, mensagens) {
    const lista = Array.isArray(mensagens) ? mensagens : []
    const recentes = lista.slice(-MAX_MENSAGENS).map((m) => ({
        role: rotuloPapel(m?.role),
        content: String(m?.content || '').trim().slice(0, MAX_MSG_CHARS),
    })).filter((m) => m.content)

    const historico = recentes
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n\n')

    return `${contexto}

---

Conversação (responda só à última mensagem do Utilizador, com o contexto acima):

${historico || 'Utilizador: (vazio)'}

Pedro Bot:`
}
