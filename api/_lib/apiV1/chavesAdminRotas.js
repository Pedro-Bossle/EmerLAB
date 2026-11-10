/**
 * Rotas internas de administração das chaves da API /api/v1 e do testador (docs/api/especificacao-design.md, seção 5).
 *
 * Todas usam o escopo 'jwt:access.manage': autenticam pelo JWT do usuário com a permissão access.manage,
 * não por chave de API. A tela chama estas rotas no mesmo domínio (sem CORS).
 * A chave completa só existe na resposta de criar/girar; no banco fica apenas o hash.
 */
import { getClientIp } from '../../../src/lib/api/serverAuth.js'
import { gerarChave } from '../../../src/lib/apiV1/chaves.js'
import {
    estadoDaChave,
    tipoDosEscopos,
    validarEdicaoChave,
    validarNovaChave,
} from '../../../src/lib/apiV1/chavesAdminRegras.js'
import { acharRota, ErroApi, ESCOPO_JWT_ACCESS_MANAGE, processarRequisicao, registrarRota } from './roteador.js'

const ESCOPO = ESCOPO_JWT_ACCESS_MANAGE
const SEM_CACHE = { 'Cache-Control': 'no-store' }
// Nunca inclui hash: só estas colunas saem do banco nas leituras.
const COLUNAS =
    'id, nome, prefixo, escopos, origens_permitidas, limite_por_minuto, ips_permitidos, criada_em, criada_por, expira_em, revogada_em, ultimo_uso_em'

function publica(linha, agora = new Date()) {
    return {
        id: linha.id,
        nome: linha.nome,
        prefixo: linha.prefixo,
        escopos: linha.escopos || [],
        origens_permitidas: linha.origens_permitidas || [],
        limite_por_minuto: linha.limite_por_minuto,
        ips_permitidos: linha.ips_permitidos || [],
        criada_em: linha.criada_em ?? null,
        criada_por: linha.criada_por ?? null,
        expira_em: linha.expira_em ?? null,
        revogada_em: linha.revogada_em ?? null,
        ultimo_uso_em: linha.ultimo_uso_em ?? null,
        estado: estadoDaChave(linha, agora),
    }
}

/** Campos não sensíveis que vão para a auditoria. Nunca a chave nem o hash. */
const paraAuditoria = (linha) => ({
    nome: linha.nome,
    prefixo: linha.prefixo,
    escopos: linha.escopos || [],
    origens_permitidas: linha.origens_permitidas || [],
    limite_por_minuto: linha.limite_por_minuto,
})

function exigir({ data, error }) {
    if (error) throw new Error(error.message || 'falha no banco')
    return data
}

const naoEncontrada = () => new ErroApi(404, 'chave_nao_encontrada', 'Chave não encontrada.')

function validar(resultado) {
    if (!resultado.ok) throw new ErroApi(400, resultado.erro.codigo, resultado.erro.mensagem)
    return resultado
}

async function auditar(admin, usuario, { acao, registroId, antigo = null, novo }) {
    try {
        const { error } = await admin.from('audit_logs').insert({
            data_hora: new Date().toISOString(),
            usuario_id: usuario.id,
            usuario_nome: usuario.email,
            acao,
            tabela: 'api_chaves',
            registro_id: String(registroId),
            valor_antigo: antigo,
            valor_novo: novo,
            severidade: 'warning',
        })
        if (error) console.error('[api-v1] auditoria das chaves falhou:', error.message)
    } catch (e) {
        console.error('[api-v1] auditoria das chaves falhou:', e?.message || 'desconhecido')
    }
}

async function buscarLinha(admin, id) {
    const { data, error } = await admin.from('api_chaves').select(COLUNAS).eq('id', String(id)).maybeSingle()
    // 22P02: id que não é uuid. Para o usuário é só "não existe".
    if (error && error.code === '22P02') throw naoEncontrada()
    if (error) throw new Error(error.message || 'falha no banco')
    if (!data) throw naoEncontrada()
    return data
}

async function inserirChave(admin, usuario, dados) {
    const { chave, prefixo, hash } = gerarChave(dados.tipo === 'pagamentos' ? 'pag' : 'rede')
    const linha = exigir(
        await admin
            .from('api_chaves')
            .insert({
                nome: dados.nome,
                prefixo,
                hash,
                escopos: dados.escopos,
                origens_permitidas: dados.origens_permitidas,
                limite_por_minuto: dados.limite_por_minuto,
                ips_permitidos: dados.ips_permitidos,
                expira_em: dados.expira_em,
                criada_por: usuario.id,
            })
            .select(COLUNAS)
            .single(),
    )
    return { chave, linha }
}

registrarRota('POST', '/admin/chaves', ESCOPO, async ({ admin, usuario, body }) => {
    const { dados } = validar(validarNovaChave(body))
    const { chave, linha } = await inserirChave(admin, usuario, dados)
    await auditar(admin, usuario, { acao: 'API_CHAVE_CRIADA', registroId: linha.id, novo: paraAuditoria(linha) })
    return { status: 201, corpo: { chave, registro: publica(linha) }, headers: SEM_CACHE }
})

registrarRota('GET', '/admin/chaves', ESCOPO, async ({ admin }) => {
    const agora = new Date()
    const linhas = exigir(await admin.from('api_chaves').select(COLUNAS).order('criada_em', { ascending: false })) || []
    return { corpo: linhas.map((l) => publica(l, agora)), headers: SEM_CACHE }
})

registrarRota('PATCH', '/admin/chaves/{id}', ESCOPO, async ({ admin, usuario, params, body }) => {
    const atual = await buscarLinha(admin, params.id)
    if (atual.revogada_em) throw new ErroApi(409, 'chave_revogada', 'Chave revogada não pode ser editada.')
    const { alteracoes } = validar(validarEdicaoChave(body, atual))
    const atualizadas =
        exigir(await admin.from('api_chaves').update(alteracoes).eq('id', atual.id).is('revogada_em', null).select(COLUNAS)) || []
    if (!atualizadas.length) throw new ErroApi(409, 'chave_revogada', 'Chave revogada não pode ser editada.')
    const nova = atualizadas[0]
    await auditar(admin, usuario, {
        acao: 'API_CHAVE_EDITADA',
        registroId: nova.id,
        antigo: paraAuditoria(atual),
        novo: paraAuditoria(nova),
    })
    return { corpo: publica(nova), headers: SEM_CACHE }
})

async function revogarLinha(admin, id) {
    const feitas =
        exigir(
            await admin
                .from('api_chaves')
                .update({ revogada_em: new Date().toISOString() })
                .eq('id', id)
                .is('revogada_em', null)
                .select(COLUNAS),
        ) || []
    return feitas[0] || null
}

registrarRota('POST', '/admin/chaves/{id}/revogar', ESCOPO, async ({ admin, usuario, params }) => {
    const atual = await buscarLinha(admin, params.id)
    const revogada = await revogarLinha(admin, atual.id)
    if (!revogada) throw new ErroApi(409, 'chave_revogada', 'A chave já está revogada.')
    await auditar(admin, usuario, { acao: 'API_CHAVE_REVOGADA', registroId: revogada.id, novo: paraAuditoria(revogada) })
    return { corpo: publica(revogada), headers: SEM_CACHE }
})

registrarRota('POST', '/admin/chaves/{id}/girar', ESCOPO, async ({ admin, usuario, params }) => {
    const atual = await buscarLinha(admin, params.id)
    if (atual.revogada_em) throw new ErroApi(409, 'chave_revogada', 'Chave revogada não pode ser girada.')
    const tipo = tipoDosEscopos(atual.escopos) || 'rede'
    const { chave, linha } = await inserirChave(admin, usuario, {
        tipo,
        nome: atual.nome,
        escopos: atual.escopos,
        origens_permitidas: atual.origens_permitidas || [],
        limite_por_minuto: atual.limite_por_minuto,
        ips_permitidos: atual.ips_permitidos || [],
        expira_em: atual.expira_em ?? null,
    })
    const revogada = await revogarLinha(admin, atual.id)
    if (!revogada) {
        // Revogada por outra chamada no meio: desfaz a nova para não sobrar chave ativa sem dono.
        await admin.from('api_chaves').delete().eq('id', linha.id)
        throw new ErroApi(409, 'chave_revogada', 'A chave já está revogada.')
    }
    await auditar(admin, usuario, {
        acao: 'API_CHAVE_GIRADA',
        registroId: linha.id,
        antigo: { id: atual.id, ...paraAuditoria(atual) },
        novo: { ...paraAuditoria(linha), chave_anterior_id: atual.id },
    })
    return { status: 201, corpo: { chave, registro: publica(linha), revogada: publica(revogada) }, headers: SEM_CACHE }
})

// ---------- testador ----------

const METODOS_TESTE = ['GET', 'POST', 'DELETE']
const CABECALHOS_PERMITIDOS = new Set([
    'cache-control',
    'x-total-count',
    'retry-after',
    'access-control-allow-origin',
    'content-type',
])
const caminhoInvalido = () => new ErroApi(400, 'caminho_invalido', 'Caminho inválido. Use uma rota de /rede ou /pagamentos.')

/** Normaliza e valida o caminho; devolve { caminho, query }. Nunca deixa chegar a /admin/*. */
function lerCaminhoDeTeste(bruto, metodo) {
    if (typeof bruto !== 'string' || !bruto.trim() || bruto.length > 500) throw caminhoInvalido()
    const texto = bruto.trim()
    const [parte, ...resto] = texto.split('?')
    // eslint-disable-next-line no-control-regex
    if (/[\\\u0000-\u001f]|%2e|%2f|%5c|%00|:\/\/|\.\.|\/\//i.test(parte)) throw caminhoInvalido()
    if (!parte.startsWith('/')) throw caminhoInvalido()
    const caminho = parte.replace(/^\/api\/v1(?=\/|$)/, '').replace(/^\/v1(?=\/|$)/, '')
    if (!/^\/(rede|pagamentos)\//.test(caminho)) throw caminhoInvalido()
    const achada = acharRota(metodo, caminho)
    if (!achada || achada.rota.escopo === ESCOPO) throw caminhoInvalido()
    const query = {}
    for (const [k, v] of new URLSearchParams(resto.join('?')).entries()) query[k] = v
    return { caminho, query }
}

function ocultarChave(valor, chave) {
    if (valor === undefined) return undefined
    const texto = JSON.stringify(valor)
    if (!texto || !texto.includes(chave)) return valor
    return JSON.parse(texto.split(chave).join('[chave omitida]'))
}

registrarRota('POST', '/admin/testar', ESCOPO, async ({ body, req }) => {
    const chave = typeof body?.chave === 'string' ? body.chave.trim() : ''
    if (!chave || chave.length > 200) throw new ErroApi(400, 'chave_ausente', 'Informe a chave a testar.')
    const metodo = String(body?.metodo || 'GET').toUpperCase()
    if (!METODOS_TESTE.includes(metodo)) throw new ErroApi(400, 'metodo_invalido', 'Método inválido. Use GET, POST ou DELETE.')
    const { caminho, query } = lerCaminhoDeTeste(body?.caminho, metodo)
    if (metodo !== 'GET' && body?.confirmar_escrita !== true) {
        throw new ErroApi(400, 'confirmacao_necessaria', 'Confirme que o teste grava dados reais (confirmar_escrita: true).')
    }
    const origem = typeof body?.origem === 'string' ? body.origem.trim() : ''
    if (origem.length > 200) throw new ErroApi(400, 'origem_invalida', 'Origem inválida.')
    const corpoSimulado = body?.corpo && typeof body.corpo === 'object' && !Array.isArray(body.corpo) ? body.corpo : {}

    const headers = { 'x-api-key': chave }
    if (origem) headers.origin = origem

    const inicio = Date.now()
    const r = await processarRequisicao({
        metodo,
        caminho,
        query,
        headers,
        body: corpoSimulado,
        ip: getClientIp(req),
    })
    const duracao = Date.now() - inicio

    const saida = {}
    for (const [k, v] of Object.entries(r.headers || {})) {
        const nome = k.toLowerCase()
        if (CABECALHOS_PERMITIDOS.has(nome) || nome.startsWith('x-ratelimit-')) saida[nome] = String(v).split(chave).join('[chave omitida]')
    }
    if (r.corpo !== undefined && !saida['content-type']) saida['content-type'] = 'application/json; charset=utf-8'

    return {
        corpo: {
            status: r.status,
            headers: saida,
            corpo: r.corpo === undefined ? null : ocultarChave(r.corpo, chave),
            duracao_ms: duracao,
        },
        headers: SEM_CACHE,
    }
})
