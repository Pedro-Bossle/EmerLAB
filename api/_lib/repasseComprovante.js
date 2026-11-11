/**
 * Núcleo compartilhado do comprovante de repasse: usado pelo painel (repasseMensalHandler.js, rotas
 * `enviar-comprovante` e `enviar-comprovante-lote`) e pela API pública (/api/v1/pagamentos, apiV1/pagamentosRotas.js).
 *
 * Única alteração em `pagamentos_registros`: a flag `pago`. O e-mail ao prestador é o mesmo do painel.
 * Sem relatório de repasse (`relatorio` nulo) o comprovante fica ligado só ao registro e não há `repasse_eventos`
 * (a tabela exige relatorio_id); quem chama grava a auditoria.
 */
import crypto from 'node:crypto'
import { emailAssetOrigin } from './emailBrand.js'
import { enviarEmailResend } from './resendMail.js'
import { montarEmailRepasseComprovante } from './repasseEmails.js'

export const BUCKET = 'repasse-documentos'

/** Erro com status HTTP (e código opcional, usado pela API pública). */
export class ErroRepasse extends Error {
    constructor(status, mensagem, codigo = null) {
        super(mensagem)
        this.status = status
        this.codigo = codigo
    }
}

// ---------- token do link público ----------
export const segredoToken = () => {
    const s = process.env.REPASSE_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!s) throw new ErroRepasse(503, 'Defina REPASSE_TOKEN_SECRET (ou SUPABASE_SERVICE_ROLE_KEY) no servidor.')
    return s
}
export const tokenDoRelatorio = (id, versao) =>
    crypto.createHmac('sha256', segredoToken()).update(`${id}:${versao}`).digest('base64url')
export const hashDoToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex')

// ---------- utilidades ----------
export const arredondar = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
export const competenciaLabel = (mes, ano) => `${String(mes).padStart(2, '0')}/${ano}`
export const dataBr = (iso) => {
    const [a, m, d] = String(iso || '').slice(0, 10).split('-')
    return d ? `${d}/${m}/${a}` : ''
}
export const linkPublico = (token) => `${emailAssetOrigin()}/repasse_mensal/${token}`

export async function carregarConfig(admin) {
    const { data } = await admin.from('repasse_config').select('*').eq('id', 1).maybeSingle()
    return {
        email_reprovacoes: 'pedro@emerdog.com.br',
        whatsapp_financeiro: '555499041695',
        validade_link_dias: 60,
        remetente_nome: 'Emerdog Financeiro',
        competencia_inicial: '2026-10',
        ...(data || {}),
    }
}

export const remetente = (config) => `${config.remetente_nome} <noreply@emerlab.com.br>`

export async function evento(admin, relatorioId, tipo, dados = {}, autor = 'sistema', ipHash = null) {
    await admin.from('repasse_eventos').insert({ relatorio_id: relatorioId, tipo, dados, autor, ip_hash: ipHash })
}

/**
 * Destino dos e-mails ao prestador (regra única do painel e da API): o e-mail financeiro alternativo do registro
 * (`pagamentos_registros.email_financeiro`), se informado, tem prioridade sobre o e-mail do cadastro do prestador.
 */
export async function emailDoPrestador(admin, prestadorId, emailFinanceiro) {
    const alt = String(emailFinanceiro || '').trim().toLowerCase()
    if (alt) return alt
    if (prestadorId == null) return ''
    const { data } = await admin.from('prestadores').select('email').eq('id', prestadorId).maybeSingle()
    return String(data?.email || '').trim().toLowerCase()
}

export const tipoDoRegistro = (registro) => {
    const t = String(registro?.tipo_repasse || '').toLowerCase()
    return t === 'nota' || t === 'boleto' ? t : 'rpa'
}

export const formaDoRegistro = (registro) => (tipoDoRegistro(registro) === 'boleto' ? 'boleto' : 'pix')

/**
 * E-mail «Pagamento realizado» ao prestador com o comprovante anexado (o mesmo do painel).
 * `arquivo` (Buffer) evita baixar de novo do Storage quando quem chama já tem os bytes.
 * Lança 422 se o prestador não tem e-mail e 400 se o arquivo não está no Storage. Devolve o retorno do Resend.
 */
export async function notificarComprovante(admin, { registro, relatorio, path, data_pagamento, valor, forma, arquivo = null }) {
    const v = Number(valor)
    const para = await emailDoPrestador(admin, registro.prestador_id, registro.email_financeiro)
    if (!para) throw new ErroRepasse(422, 'Prestador sem e-mail no cadastro.', 'prestador_sem_email')
    let buf = arquivo
    if (!buf) {
        const { data: baixado, error } = await admin.storage.from(BUCKET).download(path)
        if (error || !baixado) throw new ErroRepasse(400, 'Arquivo do comprovante não encontrado.', 'arquivo_nao_encontrado')
        buf = Buffer.from(await baixado.arrayBuffer())
    }
    const config = await carregarConfig(admin)
    const mes = relatorio ? relatorio.mes : registro.mes
    const ano = relatorio ? relatorio.ano : registro.ano
    let vencimento = ''
    if (forma === 'boleto' && relatorio) {
        const { data: d } = await admin.from('repasse_documentos').select('vencimento').eq('relatorio_id', relatorio.id).order('criado_em', { ascending: false }).limit(1)
        vencimento = dataBr(d?.[0]?.vencimento)
    }
    const m = montarEmailRepasseComprovante({
        prestador: registro.prestador_nome || relatorio?.nome_a1, competencia: competenciaLabel(mes, ano), valor: v,
        dataPagamento: dataBr(data_pagamento), forma, chavePix: registro.chave_pix || '', vencimentoBoleto: vencimento,
        link: relatorio ? linkPublico(tokenDoRelatorio(relatorio.id, relatorio.token_versao)) : '', whatsapp: config.whatsapp_financeiro,
    })
    const ext = path.split('.').pop()
    return enviarEmailResend({
        to: para, subject: m.subject, html: m.html, text: m.text, from: remetente(config),
        attachments: [{ filename: `comprovante-${competenciaLabel(mes, ano).replace('/', '-')}.${ext}`, content: buf }],
    })
}

/**
 * Fluxo do painel: grava a linha em `repasse_comprovantes` (sem conferir erro, como sempre foi), liga `pago` no
 * registro (nunca desmarca) e, havendo relatório, o evento `comprovante_enviado`.
 */
export async function registrarComprovante(admin, {
    registro, relatorio, path, data_pagamento, valor, forma, autor, enviadoPor = null, resendEmailId = null, dadosEvento = null,
}) {
    await admin.from('repasse_comprovantes').insert({
        relatorio_id: relatorio ? relatorio.id : null, registro_id: registro.id, forma, storage_path: path, data_pagamento,
        valor: arredondar(valor), enviado_por: enviadoPor, resend_email_id: resendEmailId,
    })
    // Única alteração em pagamentos_registros: a flag «pago» (nunca desmarca).
    await admin.from('pagamentos_registros').update({ pago: true }).eq('id', registro.id)
    if (relatorio) {
        await evento(admin, relatorio.id, 'comprovante_enviado', dadosEvento || { valor: arredondar(valor), data_pagamento, forma }, autor)
    }
    return null
}

/**
 * Comprovante de um registro: e-mail ao prestador (se `notificar`), linha do comprovante, `pago` e evento.
 *
 * Painel (`transacional` falso): e-mail primeiro e depois a gravação, como sempre foi.
 * API (`transacional` verdadeiro): grava a linha primeiro (erro na inserção para tudo, sem e-mail nem `pago`), depois
 * envia o e-mail e guarda o id do Resend na linha; se o e-mail falhar a linha é apagada e o erro sobe, então nada fica
 * gravado e a chamada pode ser repetida.
 * @returns {Promise<{ comprovante: object|null, resendEmailId: string|null }>}
 */
export async function gravarComprovante(admin, {
    registro, relatorio = null, path, data_pagamento, valor, forma, autor, notificar, enviadoPor = null, arquivo = null,
    transacional = false,
}) {
    if (transacional) return gravarComprovanteTransacional(admin, { registro, relatorio, path, data_pagamento, valor, forma, autor, notificar, enviadoPor, arquivo })
    let resendEmailId = null
    if (notificar) {
        const enviado = await notificarComprovante(admin, { registro, relatorio, path, data_pagamento, valor, forma, arquivo })
        resendEmailId = enviado?.id || null
    }
    const comprovante = await registrarComprovante(admin, {
        registro, relatorio, path, data_pagamento, valor, forma, autor, enviadoPor, resendEmailId,
    })
    return { comprovante, resendEmailId }
}

/** Erro do fluxo transacional que diz se é seguro apagar o arquivo: só quando nenhuma linha ficou salva. */
function erroSemLinha(e) {
    e.removerArquivo = true
    return e
}

/**
 * Liga `pago` só se ainda estiver falso. Devolve true quando esta chamada mudou o registro.
 * Erro aqui lança `comprovante_inconsistente` (a linha do comprovante fica; uma nova chamada repara).
 */
export async function marcarPagoCondicional(admin, registroId) {
    const { data, error } = await admin.from('pagamentos_registros').update({ pago: true }).eq('id', registroId).eq('pago', false).select('id')
    if (error) throw new ErroRepasse(500, 'Comprovante gravado, mas o registro não foi marcado como pago. Repita a chamada.', 'comprovante_inconsistente')
    return (data || []).length > 0
}

/**
 * Fluxo da API. Erros lançados carregam `removerArquivo: true` apenas quando nenhuma linha ficou salva (falha na
 * inserção ou e-mail que falhou e cuja linha foi apagada); em qualquer outro caso o arquivo precisa ficar, porque há
 * linha apontando para ele. Inserção recusada por duplicidade (23505, índice único registro_id + storage_path) lança
 * `comprovante_duplicado` sem e-mail e sem remover o arquivo, que pertence à outra linha.
 */
async function gravarComprovanteTransacional(admin, { registro, relatorio, path, data_pagamento, valor, forma, autor, notificar, enviadoPor, arquivo }) {
    const linha = {
        relatorio_id: relatorio ? relatorio.id : null, registro_id: registro.id, forma, storage_path: path, data_pagamento,
        valor: arredondar(valor), enviado_por: enviadoPor, resend_email_id: null,
    }
    const { data: comprovante, error } = await admin.from('repasse_comprovantes').insert(linha).select('id, data_pagamento, valor, forma, enviado_em').maybeSingle()
    if (error) {
        if (error.code === '23505') throw new ErroRepasse(409, 'Este comprovante já foi anexado.', 'comprovante_duplicado')
        const codigo = error.code === '23502' ? 'relatorio_obrigatorio' : 'erro_interno'
        throw erroSemLinha(new ErroRepasse(500, 'Falha ao gravar o comprovante.', codigo))
    }
    // Sem erro e sem linha devolvida: não dá para saber se a linha existe; mantém o arquivo.
    if (!comprovante) throw new ErroRepasse(500, 'Falha ao gravar o comprovante.', 'erro_interno')
    let resendEmailId = null
    if (notificar) {
        try {
            const enviado = await notificarComprovante(admin, { registro, relatorio, path, data_pagamento, valor, forma, arquivo })
            resendEmailId = enviado?.id || null
        } catch (e) {
            const { error: eDel } = await admin.from('repasse_comprovantes').delete().eq('id', comprovante.id)
            throw eDel ? e : erroSemLinha(e)
        }
        if (resendEmailId) await admin.from('repasse_comprovantes').update({ resend_email_id: resendEmailId }).eq('id', comprovante.id)
    }
    // Única alteração em pagamentos_registros: a flag «pago» (nunca desmarca). Condicional para que duas chamadas
    // concorrentes não gravem dois eventos.
    const marcou = await marcarPagoCondicional(admin, registro.id)
    if (relatorio && (marcou || registro.pago)) {
        await evento(admin, relatorio.id, 'comprovante_enviado', { valor: arredondar(valor), data_pagamento, forma }, autor)
    }
    return { comprovante, resendEmailId, marcouPago: marcou }
}
