/**
 * Rotas de pagamentos da API pública (docs/api/especificacao-design.md, seção 7). Escopos `pagamentos:ler` (GET) e
 * `pagamentos:escrever` (POST/DELETE). Regras puras em src/lib/apiV1/pagamentosRegras.js; o comprovante usa o mesmo
 * núcleo do painel (api/_lib/repasseComprovante.js).
 *
 * - A única coluna de `pagamentos_registros` que a API altera é `pago`.
 * - Idempotência natural: `pago` repetido devolve `ja_estava_pago`; o mesmo arquivo (SHA-256, que vai no nome do
 *   arquivo no Storage) no mesmo registro devolve o comprovante existente. `Idempotency-Key` é aceito e ignorado.
 * - Comprovante só em JSON (`arquivo_base64`); o projeto não tem leitor de multipart.
 * - Respostas sem cache (`Cache-Control: no-store`) e sem PIX, e-mail ou caminho de arquivo.
 * - Toda escrita grava `audit_logs` (usuário `api:<nome> (<prefixo>)`) e, havendo relatório, `repasse_eventos`.
 */
import {
    booleanoOpcional,
    caminhoComprovante,
    comprovantePublico,
    decodificarBase64,
    ErroValidacao,
    hashArquivo,
    lerFiltrosRegistros,
    origemDoAutor,
    registroPublico,
    validarComprovante,
    validarDataPagamento,
    validarMotivo,
    validarValor,
} from '../../../src/lib/apiV1/pagamentosRegras.js'
import {
    BUCKET,
    emailDoPrestador,
    ErroRepasse,
    evento,
    formaDoRegistro,
    gravarComprovante,
    marcarPagoCondicional,
} from '../repasseComprovante.js'
import { ErroApi, registrarRota } from './roteador.js'

const LER = 'pagamentos:ler'
const ESCREVER = 'pagamentos:escrever'
const SEM_CACHE = { 'Cache-Control': 'no-store' }
/** Comprovante de 3 MB vira ~4 MB em base64; a Vercel aceita até 4,5 MB de corpo. */
const MAX_BYTES_COMPROVANTE = Math.floor(4.4 * 1024 * 1024)
const STATUS_DA_VALIDACAO = { arquivo_grande: 413, arquivo_invalido: 422 }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLUNAS_PUBLICAS = 'id, mes, ano, prestador_id, prestador_nome, tipo_repasse, valor, pago'
const COLUNAS_COMPROVANTE = 'id, data_pagamento, valor, forma, enviado_em, storage_path'
const ACAO_PARA_TIPO = {
    PAGAMENTO_MARCADO: 'pagamento_marcado',
    COMPROVANTE_ANEXADO: 'comprovante_enviado',
    PAGAMENTO_DESFEITO: 'pagamento_desfeito',
}

const autorApi = (chave) => `api:${chave?.nome || 'chave'}`
const usuarioAuditoria = (chave) => `api:${chave?.nome || 'chave'} (${chave?.prefixo || '?'})`
const semNulos = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined))

const naoEncontrado = () => new ErroApi(404, 'registro_nao_encontrado', 'Registro não encontrado.')

/** Converte erros de regra (400/413/422) e do núcleo do repasse em ErroApi com código. */
async function protegido(fn) {
    try {
        return await fn()
    } catch (e) {
        if (e instanceof ErroValidacao) throw new ErroApi(STATUS_DA_VALIDACAO[e.codigo] || 400, e.codigo, e.message)
        if (e instanceof ErroRepasse) {
            if (e.codigo === 'comprovante_inconsistente') throw new ErroApi(500, e.codigo, e.message)
            if (e.status >= 500) throw e
            throw new ErroApi(e.status, e.codigo || 'requisicao_invalida', e.message)
        }
        throw e
    }
}

function exigir({ data, error }) {
    if (error) throw new Error(error.message || 'falha no banco')
    return data
}

async function carregarRegistro(admin, id, colunas = '*') {
    if (!UUID.test(String(id || ''))) throw naoEncontrado()
    const registro = exigir(await admin.from('pagamentos_registros').select(colunas).eq('id', id).maybeSingle())
    if (!registro) throw naoEncontrado()
    return registro
}

const carregarRelatorio = async (admin, registroId) =>
    exigir(await admin.from('repasse_relatorios').select('*').eq('registro_id', registroId).maybeSingle())

const comprovantesDoRegistro = async (admin, registroId) =>
    exigir(await admin.from('repasse_comprovantes').select(COLUNAS_COMPROVANTE).eq('registro_id', registroId).order('enviado_em', { ascending: true })) || []

/** Linha de auditoria de toda escrita. Falha aqui não desfaz a operação (já feita); fica no log do servidor. */
async function auditar(admin, chave, { acao, registroId, antigo, novo }) {
    try {
        const { error } = await admin.from('audit_logs').insert({
            data_hora: new Date().toISOString(),
            usuario_id: null,
            usuario_nome: usuarioAuditoria(chave),
            acao,
            tabela: 'pagamentos_registros',
            registro_id: String(registroId),
            valor_antigo: antigo,
            valor_novo: novo,
            severidade: 'warning',
        })
        if (error) console.error('[api-v1] auditoria de pagamentos falhou:', error.message)
    } catch (e) {
        console.error('[api-v1] auditoria de pagamentos falhou:', e?.message || 'desconhecido')
    }
}

// ---------- leitura ----------

registrarRota('GET', '/pagamentos/registros', LER, async ({ admin, query }) =>
    protegido(async () => {
        const f = lerFiltrosRegistros(query || {})
        let q = admin.from('pagamentos_registros').select(COLUNAS_PUBLICAS, { count: 'exact' })
        if (f.mes !== null) q = q.eq('mes', f.mes)
        if (f.ano !== null) q = q.eq('ano', f.ano)
        if (f.pago !== null) q = q.eq('pago', f.pago)
        if (f.prestadorId !== null) q = q.eq('prestador_id', f.prestadorId)
        const inicio = (f.pagina - 1) * f.porPagina
        const { data, error, count } = await q
            .order('ano', { ascending: false })
            .order('mes', { ascending: false })
            .order('prestador_nome', { ascending: true })
            .order('id', { ascending: true })
            .range(inicio, inicio + f.porPagina - 1)
        if (error) throw new Error(error.message || 'falha no banco')
        const linhas = data || []
        const ids = linhas.map((r) => r.id)
        let comRelatorio = new Set()
        let comComprovante = new Set()
        if (ids.length) {
            const rels = exigir(await admin.from('repasse_relatorios').select('registro_id').in('registro_id', ids)) || []
            const comps = exigir(await admin.from('repasse_comprovantes').select('registro_id').in('registro_id', ids)) || []
            comRelatorio = new Set(rels.map((r) => r.registro_id))
            comComprovante = new Set(comps.map((c) => c.registro_id))
        }
        return {
            corpo: linhas.map((r) => registroPublico(r, { temRelatorio: comRelatorio.has(r.id), temComprovante: comComprovante.has(r.id) })),
            headers: { ...SEM_CACHE, 'X-Total-Count': String(count ?? linhas.length) },
        }
    }),
)

registrarRota('GET', '/pagamentos/registros/{id}', LER, async ({ admin, params }) =>
    protegido(async () => {
        const registro = await carregarRegistro(admin, params.id, COLUNAS_PUBLICAS)
        const relatorio = exigir(await admin.from('repasse_relatorios').select('id').eq('registro_id', registro.id).maybeSingle())
        const comprovantes = await comprovantesDoRegistro(admin, registro.id)
        let eventos
        if (relatorio) {
            const linhas = exigir(await admin.from('repasse_eventos').select('tipo, autor, criado_em').eq('relatorio_id', relatorio.id).order('criado_em', { ascending: true })) || []
            eventos = linhas.map((e) => ({ tipo: e.tipo, criado_em: e.criado_em, origem: origemDoAutor(e.autor) }))
        } else {
            const linhas = exigir(await admin.from('audit_logs').select('acao, data_hora')
                .eq('tabela', 'pagamentos_registros').eq('registro_id', String(registro.id)).in('acao', Object.keys(ACAO_PARA_TIPO))
                .order('data_hora', { ascending: true })) || []
            eventos = linhas.map((a) => ({ tipo: ACAO_PARA_TIPO[a.acao], criado_em: a.data_hora, origem: 'api' }))
        }
        return {
            corpo: {
                ...registroPublico(registro, { temRelatorio: !!relatorio, temComprovante: comprovantes.length > 0 }),
                comprovantes: comprovantes.map(comprovantePublico),
                eventos,
            },
            headers: SEM_CACHE,
        }
    }),
)

// ---------- escrita ----------

registrarRota('POST', '/pagamentos/registros/{id}/pago', ESCREVER, async ({ admin, chave, params, body }) =>
    protegido(async () => {
        const registro = await carregarRegistro(admin, params.id)
        const dataPagamento = validarDataPagamento(body?.data_pagamento, { obrigatoria: false })
        const valor = validarValor(body?.valor, { obrigatorio: false })
        const relatorio = await carregarRelatorio(admin, registro.id)
        const temComprovante = async () => (await comprovantesDoRegistro(admin, registro.id)).length > 0
        const jaPago = async () => ({
            corpo: { ja_estava_pago: true, registro: registroPublico({ ...registro, pago: true }, { temRelatorio: !!relatorio, temComprovante: await temComprovante() }) },
            headers: SEM_CACHE,
        })
        if (registro.pago) return jaPago()

        // Condicional em pago = false: duas chamadas simultâneas marcam (e auditam) uma vez só.
        const alterados = exigir(await admin.from('pagamentos_registros').update({ pago: true }).eq('id', registro.id).eq('pago', false).select('id'))
        if (!alterados?.length) return jaPago()

        const detalhes = semNulos({ data_pagamento: dataPagamento, valor })
        if (relatorio) await evento(admin, relatorio.id, 'pagamento_marcado', { ...detalhes, origem: 'api' }, autorApi(chave))
        await auditar(admin, chave, { acao: 'PAGAMENTO_MARCADO', registroId: registro.id, antigo: { pago: false }, novo: { pago: true, ...detalhes } })
        return {
            corpo: { ja_estava_pago: false, registro: registroPublico({ ...registro, pago: true }, { temRelatorio: !!relatorio, temComprovante: await temComprovante() }) },
            headers: SEM_CACHE,
        }
    }),
)

const INCONSISTENTE = 'comprovante_inconsistente'
/** A função da Vercel que hospeda o roteador tem 30 s de limite; depois disso a chamada original já terminou. */
export const COMPROVANTE_JANELA_EM_PROCESSAMENTO_MS = 45_000

/** Garante que o arquivo do comprovante existe no Storage; se sumiu, sobe de novo os bytes desta chamada (mesmo hash). */
async function garantirArquivo(admin, path, bytes, contentType) {
    const i = path.lastIndexOf('/')
    const nome = path.slice(i + 1)
    const { data, error } = await admin.storage.from(BUCKET).list(path.slice(0, i), { search: nome, limit: 100 })
    if (!error && (data || []).some((o) => o.name === nome)) return
    const { error: erroUpload } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true })
    if (erroUpload) throw new ErroApi(500, INCONSISTENTE, 'Não foi possível restaurar o arquivo do comprovante. Repita a chamada.')
}

/**
 * Comprovante que já existe (mesmo hash no mesmo registro): repara o que uma chamada anterior pode ter deixado pela
 * metade — arquivo ausente e `pago` ainda falso — e devolve 200 ja_existia. Nunca envia e-mail. Quando é esta chamada
 * que liga `pago`, grava o evento e a auditoria que a anterior não chegou a gravar.
 *
 * Linha mais nova que COMPROVANTE_JANELA_EM_PROCESSAMENTO_MS: a chamada que a criou pode ainda estar rodando (por
 * exemplo esperando o Resend, e pode apagar a linha se o e-mail falhar). Nada é tocado; responde 409
 * comprovante_em_processamento com Retry-After. Vale para a leitura antes da escrita e para o ramo 23505.
 */
async function responderExistente(admin, chave, { registro, relatorio, existente, bytes, contentType }) {
    const idadeMs = Date.now() - Date.parse(existente.enviado_em)
    if (Number.isFinite(idadeMs) && idadeMs < COMPROVANTE_JANELA_EM_PROCESSAMENTO_MS) {
        const segundos = Math.min(
            Math.ceil(COMPROVANTE_JANELA_EM_PROCESSAMENTO_MS / 1000),
            Math.max(1, Math.ceil((COMPROVANTE_JANELA_EM_PROCESSAMENTO_MS - idadeMs) / 1000)),
        )
        return {
            status: 409,
            corpo: { erro: { codigo: 'comprovante_em_processamento', mensagem: 'Este comprovante ainda está sendo processado. Tente de novo em instantes.' } },
            headers: { ...SEM_CACHE, 'Retry-After': String(segundos) },
        }
    }
    await garantirArquivo(admin, existente.storage_path, bytes, contentType)
    let marcou
    try {
        marcou = await marcarPagoCondicional(admin, registro.id)
    } catch (e) {
        if (e instanceof ErroRepasse) throw new ErroApi(500, INCONSISTENTE, e.message)
        throw e
    }
    if (marcou) {
        const dados = { valor: Number(existente.valor), data_pagamento: String(existente.data_pagamento).slice(0, 10), forma: existente.forma }
        if (relatorio) await evento(admin, relatorio.id, 'comprovante_enviado', dados, autorApi(chave))
        await auditar(admin, chave, {
            acao: 'COMPROVANTE_ANEXADO',
            registroId: registro.id,
            antigo: { pago: false },
            novo: { pago: true, comprovante_id: existente.id, ...dados, reparo: true, notificado: false },
        })
    }
    return { status: 200, corpo: { ja_existia: true, notificado: false, comprovante: comprovantePublico(existente) }, headers: SEM_CACHE }
}

registrarRota(
    'POST',
    '/pagamentos/registros/{id}/comprovantes',
    ESCREVER,
    async ({ admin, chave, params, body }) =>
        protegido(async () => {
            const registro = await carregarRegistro(admin, params.id)
            const notificar = booleanoOpcional(body?.notificar_prestador, 'notificar_prestador', false)
            const dataPagamento = validarDataPagamento(body?.data_pagamento)
            const valor = validarValor(body?.valor)
            const bytes = decodificarBase64(body?.arquivo_base64)
            const { ext, contentType } = validarComprovante({ nome: body?.nome, bytes })

            const relatorio = await carregarRelatorio(admin, registro.id)
            const hash = hashArquivo(bytes)
            const path = caminhoComprovante({ registro, relatorio, hash, ext })

            // Leitura antes da escrita: barra o reenvio comum. Duas chamadas idênticas simultâneas só são barradas pelo
            // índice único (registro_id, storage_path) da migração pendente 20261110131000; até ela ser aplicada, essa
            // corrida pode gravar duas linhas (limite conhecido).
            const existente = (await comprovantesDoRegistro(admin, registro.id)).find((c) => String(c.storage_path || '').endsWith(`/${hash}.${ext}`))
            if (existente) return responderExistente(admin, chave, { registro, relatorio, existente, bytes, contentType })
            // Confere o e-mail antes de subir o arquivo, para não deixar arquivo órfão.
            if (notificar && !(await emailDoPrestador(admin, registro.prestador_id, registro.email_financeiro))) {
                throw new ErroApi(422, 'prestador_sem_email', 'Prestador sem e-mail no cadastro.')
            }

            // Mesmo conteúdo, mesmo caminho: sobrescrever é inofensivo e permite repetir após uma falha no meio.
            const { error: erroUpload } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true })
            if (erroUpload) throw new Error(erroUpload.message || 'falha no upload')

            const forma = formaDoRegistro(registro)
            let gravado
            try {
                gravado = await gravarComprovante(admin, {
                    registro, relatorio, path, data_pagamento: dataPagamento, valor, forma, autor: autorApi(chave), notificar,
                    arquivo: bytes, transacional: true,
                })
            } catch (e) {
                // Só apaga o arquivo se nenhuma linha ficou salva; se há linha, ela aponta para ele.
                if (e?.removerArquivo === true) await Promise.resolve(admin.storage.from(BUCKET).remove([path])).catch(() => undefined)
                if (e instanceof ErroRepasse && e.codigo === 'comprovante_duplicado') {
                    // Outra chamada gravou a mesma linha (índice único): devolve a dela, sem e-mail e sem mexer no arquivo.
                    const dela = (await comprovantesDoRegistro(admin, registro.id)).find((c) => c.storage_path === path)
                    if (!dela) throw new ErroApi(500, 'comprovante_inconsistente', 'Comprovante duplicado não encontrado. Repita a chamada.')
                    return responderExistente(admin, chave, { registro, relatorio, existente: dela, bytes, contentType })
                }
                if (e instanceof ErroRepasse && e.codigo === 'relatorio_obrigatorio') {
                    throw new ErroApi(409, 'registro_sem_relatorio', 'Este registro ainda não aceita comprovante pela API por não ter relatório de repasse.')
                }
                throw e
            }
            await auditar(admin, chave, {
                acao: 'COMPROVANTE_ANEXADO',
                registroId: registro.id,
                antigo: { pago: !!registro.pago },
                novo: { pago: true, comprovante_id: gravado.comprovante.id, data_pagamento: dataPagamento, valor, forma, tipo_arquivo: ext, notificado: notificar },
            })
            return {
                status: 201,
                corpo: { ja_existia: false, notificado: notificar, comprovante: comprovantePublico(gravado.comprovante) },
                headers: SEM_CACHE,
            }
        }),
    { maxBytes: MAX_BYTES_COMPROVANTE },
)

registrarRota('DELETE', '/pagamentos/registros/{id}/pago', ESCREVER, async ({ admin, chave, params, body, query }) =>
    protegido(async () => {
        const registro = await carregarRegistro(admin, params.id)
        const motivo = validarMotivo(body?.motivo ?? (Array.isArray(query?.motivo) ? query.motivo[0] : query?.motivo))
        const relatorio = await carregarRelatorio(admin, registro.id)
        const comprovantes = await comprovantesDoRegistro(admin, registro.id)
        if (!registro.pago && !comprovantes.length) throw new ErroApi(409, 'nao_esta_pago', 'Este registro não está pago.')

        // Como no painel: remove as linhas de comprovante (o arquivo fica no Storage) e desmarca pago.
        if (comprovantes.length) exigir(await admin.from('repasse_comprovantes').delete().eq('registro_id', registro.id))
        exigir(await admin.from('pagamentos_registros').update({ pago: false }).eq('id', registro.id))
        if (relatorio) await evento(admin, relatorio.id, 'pagamento_desfeito', { motivo, origem: 'api' }, autorApi(chave))
        await auditar(admin, chave, {
            acao: 'PAGAMENTO_DESFEITO',
            registroId: registro.id,
            antigo: { pago: !!registro.pago },
            novo: { pago: false, motivo, comprovantes_removidos: comprovantes.length },
        })
        return {
            corpo: {
                comprovantes_removidos: comprovantes.length,
                registro: registroPublico({ ...registro, pago: false }, { temRelatorio: !!relatorio, temComprovante: false }),
            },
            headers: SEM_CACHE,
        }
    }),
)
