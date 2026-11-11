/**
 * API do repasse mensal (docs/repasse-mensal.md §8). Multiplexada por `?_route=` (limite de funções da Vercel).
 *
 * Públicas (POST, pelo token do link; sem JWT): publico-ler | publico-aprovar | publico-upload-url |
 *   publico-documento | publico-reprovar | publico-comprovante. Erros são genéricos para não revelar se o token existe.
 * Internas (JWT com pagamentos.edit): criar-relatorios | link | planejar-envio | enviar-lote | cancelar-agendamento |
 *   revisar-documento | marcar-tratado | upload-url | enviar-comprovante | enviar-comprovante-lote | desfazer-pagamento | revogar-link | novo-link | url-arquivo.
 *
 * O banco é acessado só com service role. O token em claro nunca é gravado: guardamos sha256 e o token é
 * recomputável por HMAC(id, versão) para o «Copiar link».
 */
import crypto from 'node:crypto'
import { PERMISSION_KEYS } from '../../src/lib/accessControl.js'
import {
    createSupabaseAdminClient,
    getClientIp,
    readJsonBodyLimited,
    responderSePayloadGrande,
    validarJwtComPermissao,
} from '../../src/lib/api/serverAuth.js'
import { aplicarRateLimit } from '../../src/lib/api/rateLimit.js'
import { emailAssetOrigin } from './emailBrand.js'
import {
    avaliarValorDocumento,
    aplicarVariaveis,
    distribuirHorarios,
    ehCompetenciaNovoModelo,
    instrucaoPorTipo,
    descontoRpaDoRepasse,
    ASSUNTO_PADRAO,
    CORPO_PADRAO,
    DIAS_RETENCAO_DOCUMENTOS,
    validarArquivoRepasse,
    periodoMesAnteriorLabel,
} from '../../src/lib/repasse/repasseCore.js'
import { cancelarEmailAgendadoResend, enviarEmailResend } from './resendMail.js'
import {
    montarEmailRepasseComprovante,
    montarEmailRepasseDocumentoDevolvido,
    montarEmailRepasseRelatorio,
    montarEmailRepasseReprovacao,
} from './repasseEmails.js'

const BUCKET = 'repasse-documentos'
const LIMITE_PUBLICO = { limit: 40, windowMs: 60_000 }
const LIMITE_INTERNO = { limit: 120, windowMs: 60_000 }
const MAX_BODY = 4 * 1024 * 1024
const TOLERANCIA = 0.01
const PODE_ENVIAR = ['nao_enviado', 'reprovado', 'documento_devolvido', 'tratado']

class ErroApi extends Error {
    constructor(status, mensagem) {
        super(mensagem)
        this.status = status
    }
}

// ---------- token ----------
const segredoToken = () => {
    const s = process.env.REPASSE_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!s) throw new ErroApi(503, 'Defina REPASSE_TOKEN_SECRET (ou SUPABASE_SERVICE_ROLE_KEY) no servidor.')
    return s
}
export const tokenDoRelatorio = (id, versao) =>
    crypto.createHmac('sha256', segredoToken()).update(`${id}:${versao}`).digest('base64url')
export const hashDoToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex')
const hashIp = (ip) => crypto.createHash('sha256').update(`${segredoToken()}|${ip}`).digest('hex').slice(0, 24)

// ---------- utilidades ----------
const arredondar = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const competenciaLabel = (mes, ano) => `${String(mes).padStart(2, '0')}/${ano}`
const dataBr = (iso) => {
    const [a, m, d] = String(iso || '').slice(0, 10).split('-')
    return d ? `${d}/${m}/${a}` : ''
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const somarDados = (dados) =>
    arredondar(
        (dados?.grupos || []).reduce(
            (s, g) => s + (g.atendimentos || []).reduce((s2, a) => s2 + (a.itens || []).reduce((s3, it) => s3 + Number(it[1] || 0), 0), 0),
            0,
        ),
    )
const somarTutor = (dados) =>
    arredondar(
        (dados?.grupos || []).reduce(
            (s, g) => s + (g.atendimentos || []).reduce((s2, a) => s2 + (a.itens || []).reduce((s3, it) => s3 + Number(it[2] || 0), 0), 0),
            0,
        ),
    )
const contarAtendimentos = (dados) => (dados?.grupos || []).reduce((s, g) => s + (g.atendimentos || []).length, 0)

const linkPublico = (token) => `${emailAssetOrigin()}/repasse_mensal/${token}`

async function carregarConfig(admin) {
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

const remetente = (config) => `${config.remetente_nome} <noreply@emerlab.com.br>`

async function evento(admin, relatorioId, tipo, dados = {}, autor = 'sistema', ipHash = null) {
    await admin.from('repasse_eventos').insert({ relatorio_id: relatorioId, tipo, dados, autor, ip_hash: ipHash })
}

async function carregarRelatorio(admin, id) {
    const { data, error } = await admin.from('repasse_relatorios').select('*').eq('id', id).maybeSingle()
    if (error) throw new ErroApi(500, 'Falha ao ler o relatório.')
    if (!data) throw new ErroApi(404, 'Relatório não encontrado.')
    return data
}

async function carregarRegistro(admin, id) {
    const { data, error } = await admin.from('pagamentos_registros').select('*').eq('id', id).maybeSingle()
    if (error || !data) throw new ErroApi(404, 'Registro não encontrado.')
    return data
}

/** E-mail financeiro alternativo do registro (se informado) tem prioridade sobre o e-mail do cadastro. */
async function emailDoPrestador(admin, prestadorId, emailFinanceiro) {
    const alt = String(emailFinanceiro || '').trim().toLowerCase()
    if (alt) return alt
    if (prestadorId == null) return ''
    const { data } = await admin.from('prestadores').select('email').eq('id', prestadorId).maybeSingle()
    return String(data?.email || '').trim().toLowerCase()
}

/** Resolve o token público. Qualquer falha devolve o mesmo erro genérico. */
async function resolverToken(admin, token) {
    const invalido = new ErroApi(404, 'Link inválido ou vencido. Fale com o financeiro.')
    const t = String(token || '')
    if (t.length < 20 || t.length > 100) throw invalido
    const { data } = await admin.from('repasse_relatorios').select('*').eq('token_hash', hashDoToken(t)).maybeSingle()
    if (!data || data.token_revogado_em || data.divergente) throw invalido
    if (data.token_expira_em && new Date(data.token_expira_em) < new Date()) throw invalido
    return data
}

const tipoDoRegistro = (registro) => {
    const t = String(registro?.tipo_repasse || '').toLowerCase()
    return t === 'nota' || t === 'boleto' ? t : 'rpa'
}

// ---------- rotas públicas ----------
async function publicoLer(admin, { token }, ctx) {
    const rel = await resolverToken(admin, token)
    const registro = await carregarRegistro(admin, rel.registro_id)
    const config = await carregarConfig(admin)
    // Acesso interno (equipe logada com permissão de Pagamentos) não conta como «visualizado» pelo prestador.
    let interno = false
    if (ctx.req?.headers?.authorization) {
        try {
            const aut = await validarJwtComPermissao(ctx.req, [PERMISSION_KEYS.PAGAMENTOS_VIEW], { supabaseAdmin: admin })
            interno = !aut.error
        } catch {
            interno = false
        }
    }
    if (!interno && ['nao_enviado', 'agendado', 'enviado'].includes(rel.status)) {
        await admin.from('repasse_relatorios').update({ status: 'visualizado', visualizado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() }).eq('id', rel.id)
        await evento(admin, rel.id, 'visualizado', {}, 'prestador', ctx.ipHash)
        rel.status = 'visualizado'
    }
    const { data: docs } = await admin.from('repasse_documentos').select('id, tipo, numero, vencimento, valor, status, motivo_devolucao, criado_em').eq('relatorio_id', rel.id).order('criado_em', { ascending: false }).limit(1)
    const { data: comps } = await admin.from('repasse_comprovantes').select('id, forma, valor, data_pagamento, storage_path').eq('relatorio_id', rel.id).order('enviado_em', { ascending: false }).limit(1)
    const comp = comps?.[0]
    return {
        relatorio: {
            competencia: competenciaLabel(rel.mes, rel.ano),
            periodoInicio: rel.periodo_inicio,
            periodoFim: rel.periodo_fim,
            prestador: registro.prestador_nome || rel.nome_a1,
            interno,
            tipo: tipoDoRegistro(registro),
            // Só o RPA comum sofre o desconto de 11% (INSS); «RPA s/desc.» não.
            descontoRpa: String(registro.tipo_repasse || '').toLowerCase() === 'rpa',
            status: rel.status,
            totalRepasse: Number(rel.total_repasse),
            totalTutor: Number(rel.total_tutor),
            atendimentos: contarAtendimentos(rel.dados),
            veterinarios: (rel.dados?.grupos || []).length,
            abaNome: rel.aba_nome,
            dados: rel.dados,
            documento: docs?.[0] || null,
            comprovante: comp ? { forma: comp.forma, valor: Number(comp.valor), data: comp.data_pagamento } : null,
        },
        config: { whatsapp: config.whatsapp_financeiro },
    }
}

async function publicoAprovar(admin, { token }, ctx) {
    const rel = await resolverToken(admin, token)
    const registro = await carregarRegistro(admin, rel.registro_id)
    if (tipoDoRegistro(registro) !== 'rpa') throw new ErroApi(400, 'Este repasse exige o envio de documento.')
    if (rel.status === 'aprovado') return { status: 'aprovado' }
    const agora = new Date().toISOString()
    await admin.from('repasse_relatorios').update({ status: 'aprovado', respondido_em: agora, atualizado_em: agora }).eq('id', rel.id)
    // Única alteração em pagamentos_registros: a flag de resposta (como o financeiro marca à mão).
    await admin.from('pagamentos_registros').update({ resposta: true }).eq('id', rel.registro_id)
    await evento(admin, rel.id, 'aprovado', {}, 'prestador', ctx.ipHash)
    return { status: 'aprovado' }
}

async function publicoUploadUrl(admin, { token, nome, tamanho }) {
    const rel = await resolverToken(admin, token)
    const registro = await carregarRegistro(admin, rel.registro_id)
    if (tipoDoRegistro(registro) === 'rpa') throw new ErroApi(400, 'Este repasse não exige documento.')
    const erro = validarArquivoRepasse({ nome, tamanho: Number(tamanho), tipos: ['pdf', 'xml'] })
    if (erro) throw new ErroApi(400, erro)
    const ext = String(nome).toLowerCase().split('.').pop()
    const path = `${rel.ano}-${String(rel.mes).padStart(2, '0')}/${rel.id}/documento/${crypto.randomUUID()}.${ext}`
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path)
    if (error) throw new ErroApi(500, 'Não foi possível preparar o envio do arquivo.')
    return { path, uploadToken: data.token }
}

async function publicoDocumento(admin, { token, path, numero, vencimento, valor }, ctx) {
    const rel = await resolverToken(admin, token)
    const registro = await carregarRegistro(admin, rel.registro_id)
    const tipo = tipoDoRegistro(registro)
    if (tipo === 'rpa') throw new ErroApi(400, 'Este repasse não exige documento.')
    const prefixo = `${rel.ano}-${String(rel.mes).padStart(2, '0')}/${rel.id}/documento/`
    if (!String(path || '').startsWith(prefixo)) throw new ErroApi(400, 'Arquivo inválido.')
    const v = Number(valor)
    const aval = avaliarValorDocumento(v, rel.total_repasse, rel.total_tutor)
    if (aval.nivel === 'erro_invalido') throw new ErroApi(400, 'Informe o valor do documento.')
    if (aval.nivel === 'erro_tutor') throw new ErroApi(422, 'Esse é o valor pago pelo tutor, não o repasse. Confira o valor.')
    if (!String(numero || '').trim()) throw new ErroApi(400, tipo === 'nota' ? 'Informe o número da nota.' : 'Informe a linha digitável.')
    if (tipo === 'boleto' && !vencimento) throw new ErroApi(400, 'Informe o vencimento do boleto.')
    // Envio repetido (clique duplo, reenvio por falha de rede): mesmo tipo, número e valor já em revisão ou aprovado
    // não vira um segundo documento. Responde como sucesso (o prestador não precisa fazer nada) e descarta o arquivo novo.
    const numeroLimpo = String(numero).trim().slice(0, 120)
    const { data: jaExiste } = await admin
        .from('repasse_documentos')
        .select('id, status')
        .eq('relatorio_id', rel.id)
        .eq('tipo', tipo)
        .eq('numero', numeroLimpo)
        .eq('valor', arredondar(v))
        .in('status', ['em_revisao', 'aprovado'])
        .limit(1)
    if (jaExiste?.length) {
        try {
            await admin.storage.from(BUCKET).remove([path])
        } catch {
            // arquivo órfão é inofensivo; a limpeza diária só olha documentos registrados
        }
        return { status: jaExiste[0].status === 'aprovado' ? 'aprovado' : 'documento_em_revisao', alerta: aval.nivel, duplicado: true }
    }
    const { error } = await admin.from('repasse_documentos').insert({
        relatorio_id: rel.id, tipo, storage_path: path, numero: numeroLimpo,
        vencimento: tipo === 'boleto' ? vencimento : null, valor: arredondar(v), status: 'em_revisao',
    })
    if (error) throw new ErroApi(500, 'Não foi possível registrar o documento.')
    const agora = new Date().toISOString()
    await admin.from('repasse_relatorios').update({ status: 'documento_em_revisao', respondido_em: agora, atualizado_em: agora }).eq('id', rel.id)
    await evento(admin, rel.id, 'documento_enviado', { tipo, valor: arredondar(v), alerta: aval.nivel }, 'prestador', ctx.ipHash)
    return { status: 'documento_em_revisao', alerta: aval.nivel }
}

async function publicoReprovar(admin, { token, observacao, canal }, ctx) {
    const rel = await resolverToken(admin, token)
    const obs = String(observacao || '').trim()
    if (obs.length < 5) throw new ErroApi(400, 'Descreva o que precisa ser ajustado.')
    const via = canal === 'whatsapp' ? 'whatsapp' : 'email'
    const registro = await carregarRegistro(admin, rel.registro_id)
    const config = await carregarConfig(admin)
    const agora = new Date().toISOString()
    await admin.from('repasse_relatorios').update({ status: 'reprovado', respondido_em: agora, atualizado_em: agora }).eq('id', rel.id)
    await evento(admin, rel.id, 'reprovado', { obs: obs.slice(0, 2000), canal: via }, 'prestador', ctx.ipHash)
    if (via === 'email') {
        const m = montarEmailRepasseReprovacao({
            prestador: registro.prestador_nome || rel.nome_a1, competencia: competenciaLabel(rel.mes, rel.ano),
            valor: rel.total_repasse, observacao: obs, canal: via, linkInterno: `${emailAssetOrigin()}/pagamentos/caixa`,
        })
        try {
            await enviarEmailResend({ to: config.email_reprovacoes, subject: m.subject, html: m.html, text: m.text, from: remetente(config) })
        } catch {
            // A reprovação já está registrada (aparece na Caixa de entrada); falha de e-mail não desfaz.
        }
    }
    return { status: 'reprovado' }
}

async function publicoComprovante(admin, { token }) {
    const rel = await resolverToken(admin, token)
    const { data } = await admin.from('repasse_comprovantes').select('storage_path').eq('relatorio_id', rel.id).order('enviado_em', { ascending: false }).limit(1)
    if (!data?.[0]) throw new ErroApi(404, 'Comprovante indisponível.')
    const { data: url } = await admin.storage.from(BUCKET).createSignedUrl(data[0].storage_path, 120)
    return { url: url?.signedUrl || null }
}

// ---------- rotas internas ----------
async function criarRelatorios(admin, { itens }, ctx) {
    if (!Array.isArray(itens) || !itens.length || itens.length > 25) throw new ErroApi(400, 'Envie de 1 a 25 itens por chamada.')
    const config = await carregarConfig(admin)
    const validade = new Date(Date.now() + config.validade_link_dias * 86_400_000).toISOString()
    const saida = []
    for (const item of itens) {
        try {
            const registro = await carregarRegistro(admin, item.registro_id)
            if (!ehCompetenciaNovoModelo(registro.mes, registro.ano, config.competencia_inicial)) {
                saida.push({ registro_id: item.registro_id, ok: false, error: 'Competência anterior ao novo modelo (legado).' })
                continue
            }
            const { data: existente } = await admin.from('repasse_relatorios').select('id, status').eq('registro_id', registro.id).maybeSingle()
            // Relatório ainda não enviado pode ser refeito com o arquivo novo (corrige leitura antiga); enviado, nunca.
            if (existente && existente.status !== 'nao_enviado') {
                saida.push({ registro_id: registro.id, ok: true, relatorio_id: existente.id, ja_existia: true })
                continue
            }
            const aba = item.aba || {}
            const dados = { grupos: Array.isArray(aba.grupos) ? aba.grupos : [] }
            const soma = somarDados(dados)
            const tutor = somarTutor(dados)
            const totalAba = arredondar(aba.totalAba ?? soma)
            const lab = aba.fluxo === 'laboratorio_manual'
            // Recalcula no servidor (nunca confia no navegador): total da aba x soma e valor do registro x total da aba.
            const divergente = lab
                ? false
                : Math.abs(totalAba - soma) > TOLERANCIA || (registro.valor != null && Math.abs(Number(registro.valor) - totalAba) > TOLERANCIA)
            if (existente) {
                const { error: eUp } = await admin.from('repasse_relatorios').update({
                    periodo_inicio: item.periodo?.inicio || null, periodo_fim: item.periodo?.fim || null,
                    arquivo_origem: String(item.arquivo || '').slice(0, 200), aba_nome: String(aba.abaNome || '').slice(0, 60),
                    nome_a1: String(aba.nomeA1 || '').slice(0, 200), dados,
                    total_repasse: lab ? arredondar(soma) : totalAba, total_tutor: tutor, soma_linhas_repasse: soma,
                    divergente, fluxo: lab ? 'laboratorio_manual' : 'automatico', atualizado_em: new Date().toISOString(),
                }).eq('id', existente.id)
                if (eUp) throw new Error(eUp.message)
                await evento(admin, existente.id, 'atualizado', { divergente }, ctx.user.email || ctx.user.id)
                saida.push({ registro_id: registro.id, ok: true, relatorio_id: existente.id, divergente, atualizado: true })
                continue
            }
            const id = crypto.randomUUID()
            const token = tokenDoRelatorio(id, 1)
            const { error } = await admin.from('repasse_relatorios').insert({
                id, registro_id: registro.id, prestador_id: registro.prestador_id, mes: registro.mes, ano: registro.ano,
                periodo_inicio: item.periodo?.inicio || null, periodo_fim: item.periodo?.fim || null,
                arquivo_origem: String(item.arquivo || '').slice(0, 200), aba_nome: String(aba.abaNome || '').slice(0, 60),
                nome_a1: String(aba.nomeA1 || '').slice(0, 200), dados,
                total_repasse: lab ? arredondar(soma) : totalAba, total_tutor: tutor, soma_linhas_repasse: soma,
                divergente, fluxo: lab ? 'laboratorio_manual' : 'automatico', status: 'nao_enviado',
                token_versao: 1, token_hash: hashDoToken(token), token_expira_em: validade, criado_por: ctx.user.id,
            })
            if (error) throw new Error(error.message)
            await evento(admin, id, 'criado', { divergente }, ctx.user.email || ctx.user.id)
            saida.push({ registro_id: registro.id, ok: true, relatorio_id: id, divergente })
        } catch (e) {
            saida.push({ registro_id: item.registro_id, ok: false, error: e.message })
        }
    }
    return { itens: saida }
}

async function linkInterno(admin, { relatorio_id }) {
    const rel = await carregarRelatorio(admin, relatorio_id)
    if (rel.token_revogado_em) throw new ErroApi(409, 'Link revogado. Gere um novo link.')
    return { link: linkPublico(tokenDoRelatorio(rel.id, rel.token_versao)) }
}

async function planejarEnvio(admin, body, ctx) {
    const { assunto, corpo, modo, janela_inicio, janela_fim, ordem, relatorio_ids } = body
    if (!String(assunto || '').trim() || !String(corpo || '').trim()) throw new ErroApi(400, 'Informe assunto e mensagem.')
    if (!Array.isArray(relatorio_ids) || !relatorio_ids.length || relatorio_ids.length > 500) throw new ErroApi(400, 'Selecione os destinatários.')
    let horarios
    if (modo === 'periodo') {
        try {
            horarios = distribuirHorarios({ n: relatorio_ids.length, inicio: janela_inicio, fim: janela_fim, ordem: ordem === 'iguais' ? 'iguais' : 'aleatoria' })
        } catch (e) {
            throw new ErroApi(400, e.message)
        }
        if (horarios[0] < new Date(Date.now() - 60_000)) throw new ErroApi(400, 'A janela começa no passado.')
    } else {
        horarios = relatorio_ids.map(() => null)
    }
    const { data: envio, error } = await admin.from('repasse_envios').insert({
        criado_por: ctx.user.id, assunto: String(assunto).slice(0, 300), corpo: String(corpo).slice(0, 8000),
        modo: modo === 'periodo' ? 'periodo' : 'agora', janela_inicio: modo === 'periodo' ? janela_inicio : null,
        janela_fim: modo === 'periodo' ? janela_fim : null, ordem: modo === 'periodo' ? (ordem === 'iguais' ? 'iguais' : 'aleatoria') : null,
        total: relatorio_ids.length,
    }).select('id').single()
    if (error) throw new ErroApi(500, 'Não foi possível criar o envio.')
    // Embaralha quem recebe em cada horário (a ordem da lista não vira ordem de envio).
    const ordenados = [...relatorio_ids]
    if (modo === 'periodo') for (let i = ordenados.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [ordenados[i], ordenados[j]] = [ordenados[j], ordenados[i]] }
    return { envio_id: envio.id, plano: ordenados.map((id, i) => ({ relatorio_id: id, horario: horarios[i] ? horarios[i].toISOString() : null })) }
}

/**
 * Reenvia agora o e-mail do relatório ao prestador (menu ⋯ do Registro). Não muda o status do relatório
 * (aprovado continua aprovado); se ainda era «não enviado», vira «enviado». Link revogado ou vencido é renovado.
 */
async function reenviarEmail(admin, { relatorio_id }, ctx) {
    const rel = await carregarRelatorio(admin, relatorio_id)
    const registro = await carregarRegistro(admin, rel.registro_id)
    const config = await carregarConfig(admin)
    if (rel.divergente) throw new ErroApi(409, 'Total não confere: o relatório está fora do envio.')
    if (rel.fluxo === 'laboratorio_manual') throw new ErroApi(409, 'Laboratório em fluxo manual.')
    if (rel.status === 'agendado') throw new ErroApi(409, 'O e-mail está agendado. Cancele o agendamento antes de reenviar.')
    if (!ehCompetenciaNovoModelo(rel.mes, rel.ano, config.competencia_inicial)) throw new ErroApi(409, 'Competência legado.')
    const para = await emailDoPrestador(admin, registro.prestador_id, registro.email_financeiro)
    if (!para) throw new ErroApi(422, 'Prestador sem e-mail no cadastro.')

    // Mesmo texto do envio original, se existir; senão o padrão.
    let assunto = ASSUNTO_PADRAO
    let corpo = CORPO_PADRAO
    if (rel.envio_id) {
        const { data: envio } = await admin.from('repasse_envios').select('assunto, corpo').eq('id', rel.envio_id).maybeSingle()
        if (envio) { assunto = envio.assunto; corpo = envio.corpo }
    }

    const agora = new Date()
    const vencido = rel.token_expira_em && new Date(rel.token_expira_em) < agora
    const atualiza = { atualizado_em: agora.toISOString(), token_expira_em: new Date(agora.getTime() + config.validade_link_dias * 86_400_000).toISOString() }
    let versao = rel.token_versao
    if (rel.token_revogado_em || vencido) {
        versao = rel.token_versao + 1
        atualiza.token_versao = versao
        atualiza.token_hash = hashDoToken(tokenDoRelatorio(rel.id, versao))
        atualiza.token_revogado_em = null
    }
    const tipo = tipoDoRegistro(registro)
    const valorFmt = Number(rel.total_repasse).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    const prestador = registro.prestador_nome || rel.nome_a1
    const comDesconto = tipo === 'rpa' && String(registro.tipo_repasse || '').toLowerCase() === 'rpa'
    const vars = {
        prestador, competencia: periodoMesAnteriorLabel(), valor: valorFmt, atendimentos: contarAtendimentos(rel.dados),
        instrucao_tipo: instrucaoPorTipo(tipo, valorFmt, { descontoRpa: comDesconto, valorBruto: rel.total_repasse }),
    }
    const m = montarEmailRepasseRelatorio({
        assunto: aplicarVariaveis(assunto, vars), corpo: aplicarVariaveis(corpo, vars), prestador, competencia: vars.competencia,
        valor: rel.total_repasse, atendimentos: vars.atendimentos,
        formaPagamento: tipo === 'rpa' ? 'RPA' : tipo === 'nota' ? 'Nota fiscal' : 'Boleto',
        link: linkPublico(tokenDoRelatorio(rel.id, versao)), whatsapp: config.whatsapp_financeiro,
        descontoRpa: comDesconto ? descontoRpaDoRepasse(rel.total_repasse) : null,
    })
    const data = await enviarEmailResend({ to: para, subject: m.subject, html: m.html, text: m.text, from: remetente(config) })
    const primeiroEnvio = rel.status === 'nao_enviado'
    if (primeiroEnvio) {
        atualiza.status = 'enviado'
        atualiza.enviado_em = agora.toISOString()
    }
    atualiza.resend_email_id = data?.id || null
    await admin.from('repasse_relatorios').update(atualiza).eq('id', rel.id)
    await evento(admin, rel.id, primeiroEnvio ? 'enviado' : 'reenviado', { para, link_renovado: versao !== rel.token_versao }, ctx.user.email || ctx.user.id)
    return { ok: true, para, primeiroEnvio }
}

async function enviarLote(admin, { envio_id, itens }, ctx) {
    if (!Array.isArray(itens) || !itens.length || itens.length > 10) throw new ErroApi(400, 'Envie até 10 e-mails por chamada.')
    const { data: envio } = await admin.from('repasse_envios').select('*').eq('id', envio_id).maybeSingle()
    if (!envio) throw new ErroApi(404, 'Envio não encontrado.')
    const config = await carregarConfig(admin)
    const resultados = []
    for (const item of itens) {
        try {
            const rel = await carregarRelatorio(admin, item.relatorio_id)
            const registro = await carregarRegistro(admin, rel.registro_id)
            if (rel.divergente) throw new Error('Total não confere — fora do envio.')
            if (rel.fluxo === 'laboratorio_manual') throw new Error('Laboratório em fluxo manual.')
            if (rel.token_revogado_em) throw new Error('Link revogado.')
            if (!PODE_ENVIAR.includes(rel.status)) throw new Error('Este relatório já foi enviado.')
            if (!ehCompetenciaNovoModelo(rel.mes, rel.ano, config.competencia_inicial)) throw new Error('Competência legado.')
            const para = await emailDoPrestador(admin, registro.prestador_id, registro.email_financeiro)
            if (!para) throw new Error('Prestador sem e-mail no cadastro.')
            const tipo = tipoDoRegistro(registro)
            const valorFmt = Number(rel.total_repasse).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
            const comp = periodoMesAnteriorLabel() // o e-mail sempre fala do mês anterior ao do envio
            const prestador = registro.prestador_nome || rel.nome_a1
            // Só o RPA comum sofre o desconto de 11% (INSS); «RPA s/desc.» não.
            const comDesconto = tipo === 'rpa' && String(registro.tipo_repasse || '').toLowerCase() === 'rpa'
            const vars = { prestador, competencia: comp, valor: valorFmt, atendimentos: contarAtendimentos(rel.dados), instrucao_tipo: instrucaoPorTipo(tipo, valorFmt, { descontoRpa: comDesconto, valorBruto: rel.total_repasse }) }
            const token = tokenDoRelatorio(rel.id, rel.token_versao)
            const m = montarEmailRepasseRelatorio({
                assunto: aplicarVariaveis(envio.assunto, vars), corpo: aplicarVariaveis(envio.corpo, vars), prestador, competencia: comp,
                valor: rel.total_repasse, atendimentos: vars.atendimentos,
                formaPagamento: tipo === 'rpa' ? 'RPA' : tipo === 'nota' ? 'Nota fiscal' : 'Boleto',
                link: linkPublico(token), whatsapp: config.whatsapp_financeiro,
                descontoRpa: comDesconto ? descontoRpaDoRepasse(rel.total_repasse) : null,
            })
            const horario = item.horario && new Date(item.horario) > new Date(Date.now() + 60_000) ? new Date(item.horario) : null
            const data = await enviarEmailResend({ to: para, subject: m.subject, html: m.html, text: m.text, from: remetente(config), scheduledAt: horario || undefined })
            const agora = new Date().toISOString()
            const expira = new Date((horario ? horario.getTime() : Date.now()) + config.validade_link_dias * 86_400_000).toISOString()
            await admin.from('repasse_relatorios').update({
                status: horario ? 'agendado' : 'enviado', envio_id, resend_email_id: data?.id || null,
                agendado_para: horario ? horario.toISOString() : null, enviado_em: horario ? null : agora,
                token_expira_em: expira, atualizado_em: agora,
            }).eq('id', rel.id)
            await evento(admin, rel.id, horario ? 'agendado' : 'enviado', { para, horario: horario?.toISOString() || null }, ctx.user.email || ctx.user.id)
            resultados.push({ relatorio_id: rel.id, ok: true, agendado: Boolean(horario) })
        } catch (e) {
            resultados.push({ relatorio_id: item.relatorio_id, ok: false, error: e.message })
        }
        await dormir(600) // limite de requisições da Resend (padrão 2/s)
    }
    return { resultados }
}

async function cancelarAgendamento(admin, { relatorio_ids }, ctx) {
    const saida = []
    for (const id of relatorio_ids || []) {
        try {
            const rel = await carregarRelatorio(admin, id)
            if (rel.status !== 'agendado' || !rel.resend_email_id) throw new Error('Não está agendado.')
            await cancelarEmailAgendadoResend(rel.resend_email_id)
            await admin.from('repasse_relatorios').update({ status: 'nao_enviado', resend_email_id: null, agendado_para: null, atualizado_em: new Date().toISOString() }).eq('id', id)
            await evento(admin, id, 'agendamento_cancelado', {}, ctx.user.email || ctx.user.id)
            saida.push({ relatorio_id: id, ok: true })
        } catch (e) {
            saida.push({ relatorio_id: id, ok: false, error: e.message })
        }
        await dormir(300)
    }
    return { resultados: saida }
}

async function revisarDocumento(admin, { documento_id, acao, motivo }, ctx) {
    const { data: doc } = await admin.from('repasse_documentos').select('*').eq('id', documento_id).maybeSingle()
    if (!doc) throw new ErroApi(404, 'Documento não encontrado.')
    const rel = await carregarRelatorio(admin, doc.relatorio_id)
    const agora = new Date().toISOString()
    const autor = ctx.user.email || ctx.user.id
    if (acao === 'aprovar') {
        await admin.from('repasse_documentos').update({ status: 'aprovado', revisado_por: ctx.user.id, revisado_em: agora }).eq('id', doc.id)
        await admin.from('repasse_relatorios').update({ status: 'aprovado', respondido_em: agora, atualizado_em: agora }).eq('id', rel.id)
        await admin.from('pagamentos_registros').update({ resposta: true }).eq('id', rel.registro_id)
        await evento(admin, rel.id, 'documento_aprovado', {}, autor)
        return { status: 'aprovado' }
    }
    if (acao === 'devolver') {
        const m = String(motivo || '').trim()
        if (m.length < 5) throw new ErroApi(400, 'Informe o motivo da devolução.')
        await admin.from('repasse_documentos').update({ status: 'devolvido', motivo_devolucao: m.slice(0, 1000), revisado_por: ctx.user.id, revisado_em: agora }).eq('id', doc.id)
        await admin.from('repasse_relatorios').update({ status: 'documento_devolvido', atualizado_em: agora }).eq('id', rel.id)
        await evento(admin, rel.id, 'documento_devolvido', { motivo: m }, autor)
        try {
            const registro = await carregarRegistro(admin, rel.registro_id)
            const config = await carregarConfig(admin)
            const para = await emailDoPrestador(admin, registro.prestador_id, registro.email_financeiro)
            if (para) {
                const mail = montarEmailRepasseDocumentoDevolvido({
                    prestador: registro.prestador_nome || rel.nome_a1, competencia: competenciaLabel(rel.mes, rel.ano), motivo: m,
                    link: linkPublico(tokenDoRelatorio(rel.id, rel.token_versao)), tipo: doc.tipo,
                })
                await enviarEmailResend({ to: para, subject: mail.subject, html: mail.html, text: mail.text, from: remetente(config) })
            }
        } catch {
            // devolução registrada; o prestador também vê o motivo ao reabrir o link.
        }
        return { status: 'documento_devolvido' }
    }
    throw new ErroApi(400, 'Ação inválida.')
}

async function marcarTratado(admin, { relatorio_id }, ctx) {
    const rel = await carregarRelatorio(admin, relatorio_id)
    if (rel.status !== 'reprovado') throw new ErroApi(409, 'Só relatórios reprovados podem ser marcados como tratados.')
    await admin.from('repasse_relatorios').update({ status: 'tratado', atualizado_em: new Date().toISOString() }).eq('id', rel.id)
    await evento(admin, rel.id, 'tratado', {}, ctx.user.email || ctx.user.id)
    return { status: 'tratado' }
}

async function uploadUrlInterno(admin, { relatorio_id, nome, tamanho }) {
    const rel = await carregarRelatorio(admin, relatorio_id)
    const erro = validarArquivoRepasse({ nome, tamanho: Number(tamanho) })
    if (erro) throw new ErroApi(400, erro)
    const ext = String(nome).toLowerCase().split('.').pop()
    const path = `${rel.ano}-${String(rel.mes).padStart(2, '0')}/${rel.id}/comprovante/${crypto.randomUUID()}.${ext}`
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path)
    if (error) throw new ErroApi(500, 'Não foi possível preparar o envio do arquivo.')
    return { path, uploadToken: data.token }
}

async function enviarComprovante(admin, { relatorio_id, path, data_pagamento, valor }, ctx) {
    const rel = await carregarRelatorio(admin, relatorio_id)
    const registro = await carregarRegistro(admin, rel.registro_id)
    const prefixo = `${rel.ano}-${String(rel.mes).padStart(2, '0')}/${rel.id}/comprovante/`
    if (!String(path || '').startsWith(prefixo)) throw new ErroApi(400, 'Arquivo inválido.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data_pagamento || ''))) throw new ErroApi(400, 'Informe a data do pagamento.')
    const v = Number(valor)
    if (!Number.isFinite(v) || v <= 0) throw new ErroApi(400, 'Informe o valor pago.')
    const para = await emailDoPrestador(admin, registro.prestador_id, registro.email_financeiro)
    if (!para) throw new ErroApi(422, 'Prestador sem e-mail no cadastro.')
    const { data: arquivo, error } = await admin.storage.from(BUCKET).download(path)
    if (error || !arquivo) throw new ErroApi(400, 'Arquivo do comprovante não encontrado.')
    const buf = Buffer.from(await arquivo.arrayBuffer())
    const config = await carregarConfig(admin)
    const tipo = tipoDoRegistro(registro)
    const forma = tipo === 'boleto' ? 'boleto' : 'pix'
    let vencimento = ''
    if (forma === 'boleto') {
        const { data: d } = await admin.from('repasse_documentos').select('vencimento').eq('relatorio_id', rel.id).order('criado_em', { ascending: false }).limit(1)
        vencimento = dataBr(d?.[0]?.vencimento)
    }
    const m = montarEmailRepasseComprovante({
        prestador: registro.prestador_nome || rel.nome_a1, competencia: competenciaLabel(rel.mes, rel.ano), valor: v,
        dataPagamento: dataBr(data_pagamento), forma, chavePix: registro.chave_pix || '', vencimentoBoleto: vencimento,
        link: linkPublico(tokenDoRelatorio(rel.id, rel.token_versao)), whatsapp: config.whatsapp_financeiro,
    })
    const ext = path.split('.').pop()
    const enviado = await enviarEmailResend({
        to: para, subject: m.subject, html: m.html, text: m.text, from: remetente(config),
        attachments: [{ filename: `comprovante-${competenciaLabel(rel.mes, rel.ano).replace('/', '-')}.${ext}`, content: buf }],
    })
    await admin.from('repasse_comprovantes').insert({
        relatorio_id: rel.id, registro_id: rel.registro_id, forma, storage_path: path, data_pagamento, valor: arredondar(v),
        enviado_por: ctx.user.id, resend_email_id: enviado?.id || null,
    })
    // Única alteração em pagamentos_registros: a flag «pago» (nunca desmarca).
    await admin.from('pagamentos_registros').update({ pago: true }).eq('id', rel.registro_id)
    await evento(admin, rel.id, 'comprovante_enviado', { valor: arredondar(v), data_pagamento, forma }, ctx.user.email || ctx.user.id)
    return { ok: true, avisoNaoAprovado: !['aprovado'].includes(rel.status) }
}

/**
 * Um comprovante para vários meses do MESMO prestador: um arquivo, um e-mail, uma linha de comprovante por relatório
 * (mesmo storage_path). O arquivo foi subido por `upload-url` do primeiro relatório.
 */
async function enviarComprovanteLote(admin, { relatorio_ids, path, data_pagamento, valor }, ctx) {
    const ids = [...new Set(Array.isArray(relatorio_ids) ? relatorio_ids : [])].filter(Boolean)
    if (ids.length < 2 || ids.length > 24) throw new ErroApi(400, 'Selecione de 2 a 24 meses.')
    const rels = []
    for (const id of ids) rels.push(await carregarRelatorio(admin, id))
    const registros = []
    for (const r of rels) registros.push(await carregarRegistro(admin, r.registro_id))
    const prestadorId = registros[0].prestador_id
    if (prestadorId == null || registros.some((r) => String(r.prestador_id) !== String(prestadorId))) {
        throw new ErroApi(400, 'Os meses precisam ser do mesmo prestador.')
    }
    if (rels.some((r) => r.divergente)) throw new ErroApi(409, 'Há relatório com total que não confere.')
    const primeiro = rels[0]
    const prefixo = `${primeiro.ano}-${String(primeiro.mes).padStart(2, '0')}/${primeiro.id}/comprovante/`
    if (!String(path || '').startsWith(prefixo)) throw new ErroApi(400, 'Arquivo inválido.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data_pagamento || ''))) throw new ErroApi(400, 'Informe a data do pagamento.')
    const v = Number(valor)
    if (!Number.isFinite(v) || v <= 0) throw new ErroApi(400, 'Informe o valor pago.')
    const para = await emailDoPrestador(admin, prestadorId, registros.map((r) => r.email_financeiro).find((e) => String(e || '').trim()))
    if (!para) throw new ErroApi(422, 'Prestador sem e-mail no cadastro.')
    const { data: arquivo, error } = await admin.storage.from(BUCKET).download(path)
    if (error || !arquivo) throw new ErroApi(400, 'Arquivo do comprovante não encontrado.')
    const buf = Buffer.from(await arquivo.arrayBuffer())
    const config = await carregarConfig(admin)
    const forma = tipoDoRegistro(registros[0]) === 'boleto' ? 'boleto' : 'pix'
    const ordenados = [...rels].sort((a, b) => a.ano - b.ano || a.mes - b.mes)
    const competencia = ordenados.map((r) => competenciaLabel(r.mes, r.ano)).join(', ')
    const m = montarEmailRepasseComprovante({
        prestador: registros[0].prestador_nome || primeiro.nome_a1, competencia, valor: v,
        dataPagamento: dataBr(data_pagamento), forma, chavePix: registros[0].chave_pix || '', vencimentoBoleto: '',
        link: linkPublico(tokenDoRelatorio(primeiro.id, primeiro.token_versao)), whatsapp: config.whatsapp_financeiro,
    })
    const ext = path.split('.').pop()
    const enviado = await enviarEmailResend({
        to: para, subject: m.subject, html: m.html, text: m.text, from: remetente(config),
        attachments: [{ filename: `comprovante-${competencia.replace(/[/, ]+/g, '-')}.${ext}`, content: buf }],
    })
    for (const rel of rels) {
        await admin.from('repasse_comprovantes').insert({
            relatorio_id: rel.id, registro_id: rel.registro_id, forma, storage_path: path, data_pagamento,
            valor: arredondar(Number(rel.total_repasse)), enviado_por: ctx.user.id, resend_email_id: enviado?.id || null,
        })
        await admin.from('pagamentos_registros').update({ pago: true }).eq('id', rel.registro_id)
        await evento(admin, rel.id, 'comprovante_enviado', {
            valor: arredondar(Number(rel.total_repasse)), valor_total_pago: arredondar(v), data_pagamento, forma, lote: ids.length,
        }, ctx.user.email || ctx.user.id)
    }
    return { ok: true, meses: ids.length }
}

/** Desfaz um pagamento enviado por engano: remove o comprovante do relatório e desmarca «pago». Exige motivo. */
async function desfazerPagamento(admin, { relatorio_id, motivo }, ctx) {
    const texto = String(motivo || '').trim()
    if (texto.length < 5) throw new ErroApi(400, 'Informe o motivo (mínimo 5 caracteres).')
    const rel = await carregarRelatorio(admin, relatorio_id)
    const { data: comps } = await admin.from('repasse_comprovantes').select('id').eq('relatorio_id', rel.id)
    if (!comps?.length) throw new ErroApi(409, 'Este relatório não tem comprovante.')
    await admin.from('repasse_comprovantes').delete().eq('relatorio_id', rel.id)
    await admin.from('pagamentos_registros').update({ pago: false }).eq('id', rel.registro_id)
    await evento(admin, rel.id, 'pagamento_desfeito', { motivo: texto.slice(0, 500) }, ctx.user.email || ctx.user.id)
    return { ok: true }
}

async function revogarLink(admin, { relatorio_id }, ctx) {
    const rel = await carregarRelatorio(admin, relatorio_id)
    await admin.from('repasse_relatorios').update({ token_revogado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() }).eq('id', rel.id)
    await evento(admin, rel.id, 'link_revogado', {}, ctx.user.email || ctx.user.id)
    return { ok: true }
}

async function novoLink(admin, { relatorio_id }, ctx) {
    const rel = await carregarRelatorio(admin, relatorio_id)
    const config = await carregarConfig(admin)
    const versao = rel.token_versao + 1
    const token = tokenDoRelatorio(rel.id, versao)
    await admin.from('repasse_relatorios').update({
        token_versao: versao, token_hash: hashDoToken(token), token_revogado_em: null,
        token_expira_em: new Date(Date.now() + config.validade_link_dias * 86_400_000).toISOString(), atualizado_em: new Date().toISOString(),
    }).eq('id', rel.id)
    await evento(admin, rel.id, 'link_renovado', {}, ctx.user.email || ctx.user.id)
    return { link: linkPublico(token) }
}

async function urlArquivo(admin, { documento_id, comprovante_id }) {
    let path = null
    if (documento_id) path = (await admin.from('repasse_documentos').select('storage_path').eq('id', documento_id).maybeSingle()).data?.storage_path
    else if (comprovante_id) path = (await admin.from('repasse_comprovantes').select('storage_path').eq('id', comprovante_id).maybeSingle()).data?.storage_path
    if (!path) throw new ErroApi(404, 'Arquivo não encontrado.')
    const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, 300)
    return { url: data?.signedUrl || null }
}

const PUBLICAS = {
    'publico-ler': publicoLer,
    'publico-aprovar': publicoAprovar,
    'publico-upload-url': publicoUploadUrl,
    'publico-documento': publicoDocumento,
    'publico-reprovar': publicoReprovar,
    'publico-comprovante': publicoComprovante,
}
const INTERNAS = {
    'criar-relatorios': criarRelatorios,
    'vincular-relatorio': criarRelatorios,
    link: linkInterno,
    'planejar-envio': planejarEnvio,
    'enviar-lote': enviarLote,
    'reenviar-email': reenviarEmail,
    'cancelar-agendamento': cancelarAgendamento,
    'revisar-documento': revisarDocumento,
    'marcar-tratado': marcarTratado,
    'upload-url': uploadUrlInterno,
    'enviar-comprovante': enviarComprovante,
    'enviar-comprovante-lote': enviarComprovanteLote,
    'desfazer-pagamento': desfazerPagamento,
    'revogar-link': revogarLink,
    'novo-link': novoLink,
    'url-arquivo': urlArquivo,
}

/**
 * Exclui do EmerLAB (arquivo no Storage + registro) as notas/boletos APROVADOS com mais de
 * DIAS_RETENCAO_DOCUMENTOS dias de recebidos. Pendentes (em revisão/devolvidos) nunca são apagados.
 * O histórico do relatório guarda um evento «documento_excluido» (sem o arquivo).
 */
export async function limparDocumentosVencidos(admin, agora = new Date()) {
    const limite = new Date(agora.getTime() - DIAS_RETENCAO_DOCUMENTOS * 86_400_000).toISOString()
    const { data: docs, error } = await admin
        .from('repasse_documentos')
        .select('id, relatorio_id, storage_path, tipo, numero, valor')
        .eq('status', 'aprovado')
        .lt('criado_em', limite)
        .limit(200)
    if (error) throw new Error(error.message)
    const lista = docs || []
    if (!lista.length) return { excluidos: 0 }
    const paths = lista.map((d) => d.storage_path).filter(Boolean)
    if (paths.length) {
        const { error: eSt } = await admin.storage.from(BUCKET).remove(paths)
        if (eSt) throw new Error(`Storage: ${eSt.message}`)
    }
    const { error: eDel } = await admin.from('repasse_documentos').delete().in('id', lista.map((d) => d.id))
    if (eDel) throw new Error(eDel.message)
    for (const d of lista) await evento(admin, d.relatorio_id, 'documento_excluido', { tipo: d.tipo, numero: d.numero, valor: d.valor, motivo: `retenção de ${DIAS_RETENCAO_DOCUMENTOS} dias` }, 'sistema')
    return { excluidos: lista.length }
}

/** Rota da limpeza: só com o segredo do cron (Vercel envia `Authorization: Bearer $CRON_SECRET`). */
async function responderLimpeza(req, res) {
    const segredo = process.env.CRON_SECRET
    if (!segredo) return res.status(503).json({ ok: false, error: 'Defina CRON_SECRET no servidor.' })
    const recebido = String(req.headers?.authorization || '')
    const esperado = `Bearer ${segredo}`
    const a = Buffer.from(recebido)
    const b = Buffer.from(esperado)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ ok: false, error: 'Não autorizado.' })
    try {
        const r = await limparDocumentosVencidos(createSupabaseAdminClient())
        return res.status(200).json({ ok: true, ...r })
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message })
    }
}

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    try {
        if (new URL(req.url || '/', 'http://localhost').searchParams.get('_route') === 'limpar-documentos') return await responderLimpeza(req, res)
    } catch {
        /* URL inválida: segue o fluxo normal */
    }
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método não permitido.' })
    try {
        const url = new URL(req.url || '/', 'http://localhost')
        const rota = String(url.searchParams.get('_route') || '')
        const publica = PUBLICAS[rota]
        const interna = INTERNAS[rota]
        if (!publica && !interna) return res.status(404).json({ ok: false, error: 'Rota não encontrada.' })

        const ip = getClientIp(req)
        if (!aplicarRateLimit(res, `repasse:${publica ? 'pub' : 'int'}:${ip}`, publica ? LIMITE_PUBLICO : LIMITE_INTERNO)) return

        let body
        try {
            body = await readJsonBodyLimited(req, { maxBytes: MAX_BODY })
        } catch (e) {
            if (responderSePayloadGrande(res, e)) return
            throw e
        }
        const admin = createSupabaseAdminClient()

        if (publica) {
            const dados = await publica(admin, body || {}, { ipHash: hashIp(ip), req })
            return res.status(200).json({ ok: true, ...dados })
        }
        const auth = await validarJwtComPermissao(req, [PERMISSION_KEYS.PAGAMENTOS_EDIT], { supabaseAdmin: admin })
        if (auth.error) return res.status(auth.status || 401).json({ ok: false, error: auth.error })
        const dados = await interna(admin, body || {}, { user: auth.user, profile: auth.profile })
        return res.status(200).json({ ok: true, ...dados })
    } catch (e) {
        if (e instanceof ErroApi) return res.status(e.status).json({ ok: false, error: e.message })
        return res.status(500).json({ ok: false, error: 'Falha ao processar a solicitação.' })
    }
}
