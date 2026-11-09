/**
 * Central de Notificações: junta as três fontes de avisos num formato único.
 *
 * Fontes
 * - contratos:  eventos do webhook da Clicksign (Supabase). O «X» dispensa no servidor, por usuário.
 * - formulario: entradas do formulário público pendentes / em análise.
 * - pagamentos: respostas dos prestadores ao e-mail de repasse.
 *
 * O «X» remove o aviso de vez (como o Central de Ações do Windows). Para Formulário e Pagamentos, que são
 * derivados de estado, os ids dispensados ficam neste navegador (por usuário). «Limpar» usa o horário de
 * limpeza que cada fonte já tinha.
 */
import { supabase } from './supabase.js'
import {
    dispensarNotificacaoWebhookParaMim,
    ehNotificacaoEnvelopeUtil,
    limparTodasNotificacoesContratos,
    listarNotificacoesWebhookRecentes,
} from './clicksign/clicksignNotificacoes.js'
import {
    limparNotificacoesFormularioBell,
    listarEntradasFormularioNotificacao,
    rotuloTipoPerfil,
} from './formularioCredenciamento.js'
import { formatarCpfCnpjEntrada } from './prestadorCadastroHelpers.js'
import { limparNotificacoesPagamentos, listarNotificacoesPagamentos } from './repasse/notificacoesPagamentos.js'

export const LIMITE_POR_FONTE = 30
const MAX_DISPENSADOS = 300
const CHAVE_DISPENSADOS = 'emerdog_notif_central_dispensados_v1:'

/** Metadados dos grupos, na ordem em que aparecem no painel. */
export const GRUPOS_NOTIFICACAO = [
    { id: 'contratos', nome: 'Contratos', rotaPadrao: '/contratos/clicksign' },
    { id: 'formulario', nome: 'Formulário', rotaPadrao: '/credenciamento/formulario/entradas' },
    { id: 'pagamentos', nome: 'Pagamentos', rotaPadrao: '/pagamentos/caixa' },
]

/** Ícone e cor de cada tipo de aviso (o desenho do ícone fica no componente). */
export const TIPOS_NOTIFICACAO = {
    assinou: { icone: 'check', tom: 'ok' },
    recusou: { icone: 'xcircle', tom: 'erro' },
    concluido: { icone: 'checkcircle', tom: 'ok' },
    cancelado: { icone: 'xcircle', tom: 'erro' },
    prazo: { icone: 'clock', tom: 'warn' },
    signatario: { icone: 'userplus', tom: 'info' },
    entrada: { icone: 'userplus', tom: 'info' },
    nota: { icone: 'filetext', tom: 'info' },
    aprovou: { icone: 'check', tom: 'ok' },
    reprovou: { icone: 'xcircle', tom: 'erro' },
    generico: { icone: 'info', tom: 'info' },
}

/** Evento do webhook da Clicksign → tipo do aviso. */
export function tipoDeEventoContrato(evento) {
    const e = String(evento || '').toLowerCase()
    if (e === 'sign') return 'assinou'
    if (e === 'refusal') return 'recusou'
    if (e === 'close' || e === 'auto_close') return 'concluido'
    if (e === 'cancel') return 'cancelado'
    if (e === 'deadline') return 'prazo'
    if (e === 'add_signer' || e === 'remove_signer') return 'signatario'
    return 'generico'
}

/** Tipo do evento de repasse → tipo do aviso. */
export function tipoDeEventoPagamento(tipo) {
    const t = String(tipo || '').toLowerCase()
    if (t === 'aprovado') return 'aprovou'
    if (t === 'reprovado') return 'reprovou'
    if (t === 'documento_enviado') return 'nota'
    return 'generico'
}

/** «agora», «há 5 min», «há 2 h», «ontem», «há 3 dias». Puro (testável). */
export function rotuloTempoRelativo(at, agora = Date.now()) {
    const t = typeof at === 'number' ? at : new Date(at || 0).getTime()
    if (!Number.isFinite(t) || t <= 0) return ''
    const d = Math.max(0, agora - t)
    if (d < 60_000) return 'agora'
    if (d < 3_600_000) return `há ${Math.floor(d / 60_000)} min`
    if (d < 86_400_000) return `há ${Math.floor(d / 3_600_000)} h`
    const dias = Math.floor(d / 86_400_000)
    return dias === 1 ? 'ontem' : `há ${dias} dias`
}

/** Agrupa e ordena: grupos na ordem fixa, avisos do mais novo para o mais antigo. Puro (testável). */
export function agruparNotificacoes(itens) {
    return GRUPOS_NOTIFICACAO.map((g) => ({
        ...g,
        itens: (itens || []).filter((i) => i.fonte === g.id).sort((a, b) => b.at - a.at),
    })).filter((g) => g.itens.length > 0)
}

/** Resumo para o rótulo acessível do sino. Puro (testável). */
export function rotuloAcessivelSino(total) {
    if (!total) return 'Notificações, nenhum aviso'
    return `Notificações, ${total} ${total === 1 ? 'aviso' : 'avisos'}`
}

// ---- ids dispensados (Formulário e Pagamentos), por usuário, neste navegador ----

function chaveDispensados(uid) {
    return `${CHAVE_DISPENSADOS}${uid || 'anon'}`
}

export function lerDispensados(uid) {
    try {
        const raw = localStorage.getItem(chaveDispensados(uid))
        const obj = raw ? JSON.parse(raw) : {}
        return {
            formulario: new Set(Array.isArray(obj.formulario) ? obj.formulario.map(String) : []),
            pagamentos: new Set(Array.isArray(obj.pagamentos) ? obj.pagamentos.map(String) : []),
        }
    } catch {
        return { formulario: new Set(), pagamentos: new Set() }
    }
}

function gravarDispensados(uid, dispensados) {
    try {
        const corta = (s) => [...s].slice(-MAX_DISPENSADOS)
        localStorage.setItem(
            chaveDispensados(uid),
            JSON.stringify({ formulario: corta(dispensados.formulario), pagamentos: corta(dispensados.pagamentos) }),
        )
    } catch {
        /* sem armazenamento: o aviso volta ao recarregar */
    }
}

async function uidAtual() {
    try {
        const { data } = await supabase.auth.getSession()
        return data?.session?.user?.id || null
    } catch {
        return null
    }
}

// ---- carga ----

function itemDeContrato(n) {
    return {
        id: `contratos:${n.webhookRowId}`,
        fonte: 'contratos',
        refId: String(n.webhookRowId),
        tipo: tipoDeEventoContrato(n.tipo),
        texto: String(n.texto || '').trim(),
        at: new Date(n.at || 0).getTime(),
        href: n.envelopeId
            ? `/contratos/clicksign?envelope=${encodeURIComponent(n.envelopeId)}`
            : '/contratos/clicksign',
    }
}

function itemDeFormulario(e) {
    const p = e.payload || {}
    const nome = String(p.nome || '').trim() || 'Sem nome'
    const doc = formatarCpfCnpjEntrada(e.cpf_cnpj)
    return {
        id: `formulario:${e.id}`,
        fonte: 'formulario',
        refId: String(e.id),
        tipo: 'entrada',
        texto: `Nova entrada: ${nome} · ${rotuloTipoPerfil(e.tipo_perfil)}${doc ? ` · ${doc}` : ''}`,
        at: new Date(e.criado_em || 0).getTime(),
        href: `/credenciamento/formulario/entradas?id=${encodeURIComponent(e.id)}`,
    }
}

function itemDePagamento(n) {
    return {
        id: `pagamentos:${n.id}`,
        fonte: 'pagamentos',
        refId: String(n.id),
        tipo: tipoDeEventoPagamento(n.tipo),
        texto: String(n.texto || '').trim(),
        at: new Date(n.criadoEm || 0).getTime(),
        href: '/pagamentos/caixa',
    }
}

/**
 * Carrega as fontes permitidas. Uma fonte que falhar não derruba as outras.
 * @param {{ contratos?: boolean, formulario?: boolean, pagamentos?: boolean }} pode
 * @returns {Promise<Array<object>>}
 */
export async function carregarNotificacoesCentral(pode) {
    const uid = await uidAtual()
    const dispensados = lerDispensados(uid)
    const [contratos, formulario, pagamentos] = await Promise.all([
        pode.contratos
            ? listarNotificacoesWebhookRecentes(LIMITE_POR_FONTE).catch(() => [])
            : Promise.resolve([]),
        pode.formulario
            ? listarEntradasFormularioNotificacao({ status: ['pendente', 'em_analise'], limite: LIMITE_POR_FONTE }).catch(() => [])
            : Promise.resolve([]),
        pode.pagamentos
            ? listarNotificacoesPagamentos(LIMITE_POR_FONTE).catch(() => [])
            : Promise.resolve([]),
    ])
    return [
        ...contratos.filter((n) => ehNotificacaoEnvelopeUtil(n)).map(itemDeContrato),
        ...formulario.map(itemDeFormulario).filter((i) => !dispensados.formulario.has(i.refId)),
        ...pagamentos.map(itemDePagamento).filter((i) => !dispensados.pagamentos.has(i.refId)),
    ]
}

// ---- ações ----

/** Remove um aviso de vez (o «X»). */
export async function dispensarNotificacao(item) {
    if (item.fonte === 'contratos') {
        await dispensarNotificacaoWebhookParaMim(item.refId)
        return
    }
    const uid = await uidAtual()
    const d = lerDispensados(uid)
    d[item.fonte]?.add(item.refId)
    gravarDispensados(uid, d)
}

/** «Limpar» de um grupo. */
export async function limparGrupoNotificacoes(fonte) {
    if (fonte === 'contratos') await limparTodasNotificacoesContratos()
    else if (fonte === 'formulario') limparNotificacoesFormularioBell()
    else if (fonte === 'pagamentos') limparNotificacoesPagamentos()
}

/** «Limpar tudo». */
export async function limparTudoNotificacoes(pode) {
    if (pode.contratos) await limparGrupoNotificacoes('contratos')
    if (pode.formulario) await limparGrupoNotificacoes('formulario')
    if (pode.pagamentos) await limparGrupoNotificacoes('pagamentos')
}
