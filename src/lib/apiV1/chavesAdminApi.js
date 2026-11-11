/**
 * Cliente da administração das chaves da API /api/v1 (tela Administrativo > API).
 * As rotas /api/v1/admin/* são chamadas no MESMO domínio (caminho relativo, sem CORS) com o
 * token da sessão do Supabase. As funções puras (formulário, montagem do teste) ficam testadas
 * em chavesAdminApi.test.js; os componentes só chamam estas funções.
 */
import { ESCOPOS_POR_TIPO, validarNovaChave } from './chavesAdminRegras.js'

// ---------- funções puras ----------

/** Texto livre (uma origem ou IP por linha, ou separados por vírgula/espaço) em lista sem vazios nem repetidos. */
export function textoParaLista(texto) {
    return [...new Set(String(texto || '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))]
}

/** Estado do formulário "Nova chave" no corpo de POST /admin/chaves. */
export function montarPayloadChave(form = {}) {
    const tipo = form.tipo === 'pagamentos' ? 'pagamentos' : 'rede'
    const payload = {
        nome: String(form.nome || '').trim(),
        tipo,
        escopos: tipo === 'rede' ? [...ESCOPOS_POR_TIPO.rede] : form.escrita ? [...ESCOPOS_POR_TIPO.pagamentos] : ['pagamentos:ler'],
        origens_permitidas: tipo === 'rede' ? textoParaLista(form.origensTexto) : [],
    }
    const limite = String(form.limite ?? '').trim()
    if (limite !== '') payload.limite_por_minuto = Number(limite)
    const ips = textoParaLista(form.ipsTexto)
    if (ips.length) payload.ips_permitidos = ips
    if (form.expiraEm) {
        // Data escolhida vale até o fim do dia, no horário local de quem cadastra.
        const fim = new Date(`${form.expiraEm}T23:59:59`)
        payload.expira_em = Number.isNaN(fim.getTime()) ? String(form.expiraEm) : fim.toISOString()
    }
    return payload
}

/** Mesma validação do servidor, para avisar antes de enviar. */
export function validarFormChave(form, { agora = new Date() } = {}) {
    const payload = montarPayloadChave(form)
    const r = validarNovaChave(payload, { agora })
    if (!r.ok) return { ok: false, erro: r.erro.mensagem }
    return { ok: true, payload }
}

const doisDigitos = (n) => String(n).padStart(2, '0')
const dataLocal = (iso) => {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`
}

/** Linha da lista no estado do formulário de edição. */
export function formDeChave(linha) {
    const pagamentos = (linha.escopos || []).some((e) => e.startsWith('pagamentos:'))
    return {
        nome: linha.nome || '',
        tipo: pagamentos ? 'pagamentos' : 'rede',
        origensTexto: (linha.origens_permitidas || []).join('\n'),
        ipsTexto: (linha.ips_permitidos || []).join('\n'),
        limite: String(linha.limite_por_minuto ?? ''),
        expiraEm: dataLocal(linha.expira_em),
        escrita: (linha.escopos || []).includes('pagamentos:escrever'),
    }
}

/** Corpo do PATCH: só o que mudou em relação à linha (a expiração só se a data mudou). */
export function montarPayloadEdicao(form, linha) {
    const novo = montarPayloadChave(form)
    const atual = formDeChave(linha)
    const payload = {}
    if (novo.nome !== linha.nome) payload.nome = novo.nome
    if (JSON.stringify(novo.escopos) !== JSON.stringify(linha.escopos)) payload.escopos = novo.escopos
    if (novo.tipo === 'rede' && JSON.stringify(novo.origens_permitidas) !== JSON.stringify(linha.origens_permitidas || [])) {
        payload.origens_permitidas = novo.origens_permitidas
    }
    if (novo.limite_por_minuto !== undefined && novo.limite_por_minuto !== linha.limite_por_minuto) {
        payload.limite_por_minuto = novo.limite_por_minuto
    }
    if (JSON.stringify(textoParaLista(form.ipsTexto)) !== JSON.stringify(linha.ips_permitidos || [])) {
        payload.ips_permitidos = textoParaLista(form.ipsTexto)
    }
    if (String(form.expiraEm || '') !== atual.expiraEm) payload.expira_em = form.expiraEm ? novo.expira_em : null
    return payload
}

/** Texto de erro para exibir dentro de um modal (Error, string ou resultado de validarFormChave). */
export function mensagemDeErro(e, padrao = 'Não foi possível concluir. Tente novamente.') {
    const texto = typeof e === 'string' ? e : typeof e?.message === 'string' ? e.message : typeof e?.erro === 'string' ? e.erro : ''
    return texto.trim() || padrao
}

export function erroDaResposta(status, corpo) {
    return corpo?.erro?.mensagem || `Falha na requisição (HTTP ${status}).`
}

const P = {
    id: (rotulo) => ({ nome: 'id', onde: 'caminho', rotulo, obrigatorio: true }),
    q: (nome, rotulo, dica) => ({ nome, onde: 'query', rotulo, dica }),
    c: (nome, rotulo, extras = {}) => ({ nome, onde: 'corpo', rotulo, ...extras }),
}
const PAGINACAO = [P.q('pagina', 'Página', '1'), P.q('por_pagina', 'Itens por página', '18')]

/** Rotas públicas conhecidas, para o seletor do testador. `escrita` exige a confirmação explícita. */
export const ROTAS_TESTE = [
    {
        metodo: 'GET',
        caminho: '/rede/credenciados',
        rotulo: 'Rede: listar credenciados',
        escopo: 'rede:ler',
        escrita: false,
        params: [
            P.q('uf', 'UF', 'RS'),
            P.q('cidade', 'Cidade'),
            P.q('especialidade', 'Especialidade'),
            P.q('tipo', 'Tipo'),
            P.q('plano', 'Plano'),
            P.q('q', 'Busca livre'),
            ...PAGINACAO,
        ],
    },
    {
        metodo: 'GET',
        caminho: '/rede/credenciados/{id}',
        rotulo: 'Rede: detalhar credenciado',
        escopo: 'rede:ler',
        escrita: false,
        params: [P.id('ID do credenciado')],
    },
    { metodo: 'GET', caminho: '/rede/filtros', rotulo: 'Rede: filtros disponíveis', escopo: 'rede:ler', escrita: false, params: [] },
    {
        metodo: 'GET',
        caminho: '/pagamentos/registros',
        rotulo: 'Pagamentos: listar registros',
        escopo: 'pagamentos:ler',
        escrita: false,
        params: [P.q('mes', 'Mês', '1 a 12'), P.q('ano', 'Ano', 'AAAA'), P.q('pago', 'Pago', 'true ou false'), P.q('prestador_id', 'ID do prestador'), ...PAGINACAO],
    },
    {
        metodo: 'GET',
        caminho: '/pagamentos/registros/{id}',
        rotulo: 'Pagamentos: detalhar registro',
        escopo: 'pagamentos:ler',
        escrita: false,
        params: [P.id('ID do registro')],
    },
    {
        metodo: 'POST',
        caminho: '/pagamentos/registros/{id}/pago',
        rotulo: 'Pagamentos: marcar como pago (grava)',
        escopo: 'pagamentos:escrever',
        escrita: true,
        params: [P.id('ID do registro'), P.c('data_pagamento', 'Data do pagamento', { dica: 'AAAA-MM-DD' }), P.c('valor', 'Valor', { dica: 'ex.: 1234.56' })],
    },
    {
        metodo: 'POST',
        caminho: '/pagamentos/registros/{id}/comprovantes',
        rotulo: 'Pagamentos: anexar comprovante (grava)',
        escopo: 'pagamentos:escrever',
        escrita: true,
        params: [
            P.id('ID do registro'),
            P.c('nome', 'Nome do arquivo', { dica: 'comprovante.pdf' }),
            P.c('arquivo_base64', 'Arquivo em base64', { longo: true }),
            P.c('data_pagamento', 'Data do pagamento', { dica: 'AAAA-MM-DD' }),
            P.c('valor', 'Valor'),
            P.c('notificar_prestador', 'Notificar o prestador', { dica: 'true ou false', booleano: true }),
        ],
    },
    {
        metodo: 'DELETE',
        caminho: '/pagamentos/registros/{id}/pago',
        rotulo: 'Pagamentos: desfazer pagamento (grava)',
        escopo: 'pagamentos:escrever',
        escrita: true,
        params: [P.id('ID do registro'), P.c('motivo', 'Motivo', { obrigatorio: true })],
    },
]

/** Valores digitados + definição da rota em { metodo, caminho (com query), corpo } para POST /admin/testar. */
export function montarRequisicaoTeste(rota, valores = {}) {
    const texto = (nome) => String(valores[nome] ?? '').trim()
    let caminho = rota.caminho.replace(/\{(\w+)\}/g, (_, nome) => encodeURIComponent(texto(nome)))
    const busca = new URLSearchParams()
    const corpo = {}
    for (const p of rota.params) {
        if (p.onde === 'caminho' || !texto(p.nome)) continue
        if (p.onde === 'query') busca.set(p.nome, texto(p.nome))
        else corpo[p.nome] = p.booleano ? texto(p.nome) === 'true' : texto(p.nome)
    }
    const qs = busca.toString()
    if (qs) caminho += `?${qs}`
    return { metodo: rota.metodo, caminho, corpo: Object.keys(corpo).length ? corpo : undefined }
}

// ---------- chamadas HTTP ----------

async function tokenDaSessao() {
    const { supabase } = await import('../supabase')
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (!token) throw new Error('Sessão expirada. Faça login novamente.')
    return token
}

async function chamar(metodo, caminho, corpo) {
    const token = await tokenDaSessao()
    const resp = await fetch(`/api/v1/admin${caminho}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    })
    const bruto = await resp.text()
    let json = null
    try {
        json = bruto ? JSON.parse(bruto) : null
    } catch {
        json = null
    }
    if (!resp.ok) throw new Error(erroDaResposta(resp.status, json))
    return json
}

export const listarChaves = () => chamar('GET', '/chaves')
/** Devolve { chave, registro }: a chave completa só vem nesta resposta. */
export const criarChave = (dados) => chamar('POST', '/chaves', dados)
export const editarChave = (id, dados) => chamar('PATCH', `/chaves/${encodeURIComponent(id)}`, dados)
export const revogarChave = (id) => chamar('POST', `/chaves/${encodeURIComponent(id)}/revogar`, {})
/** Devolve { chave, registro, revogada }. */
export const girarChave = (id) => chamar('POST', `/chaves/${encodeURIComponent(id)}/girar`, {})
/** Devolve { status, headers, corpo, duracao_ms } (o HTTP é 200 mesmo quando o teste dá 401/403/404). */
export const testarRequisicao = (dados) => chamar('POST', '/testar', dados)
