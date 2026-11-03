/**
 * Cria um relatório de repasse de TESTE e envia o e-mail «aprovar ou reprovar» para o destinatário informado.
 * Uso: node scripts/enviar-repasse-teste.mjs destinatario@exemplo.com [https://origem-do-site]
 * Cria 1 registro em pagamentos_registros (prestador «TESTE») e 1 relatório ligado a ele.
 * Para remover: delete o registro (o relatório sai junto, ON DELETE CASCADE).
 */
import crypto from 'node:crypto'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
const para = String(process.argv[2] || '').trim().toLowerCase()
if (!para.includes('@')) {
    console.error('Informe o e-mail do destinatário.')
    process.exit(1)
}
process.env.EMAIL_PUBLIC_URL = process.argv[3] || 'http://localhost:5174'

const { createSupabaseAdminClient } = await import('../src/lib/api/serverAuth.js')
const { tokenDoRelatorio, hashDoToken } = await import('../api/_lib/repasseMensalHandler.js')
const { montarEmailRepasseRelatorio } = await import('../api/_lib/repasseEmails.js')
const { enviarEmailResend } = await import('../api/_lib/resendMail.js')
const { emailAssetOrigin } = await import('../api/_lib/emailBrand.js')
const { periodoMesAnteriorLabel } = await import('../src/lib/repasse/repasseCore.js')

const admin = createSupabaseAdminClient()
const NOME = 'TESTE — Prestador de Teste'

const { data: reg, error: eReg } = await admin
    .from('pagamentos_registros')
    .insert({
        mes: 10,
        ano: 2026,
        prestador_id: null,
        prestador_nome: NOME,
        tipo_repasse: 'rpa',
        chave_pix: 'teste@emerdog.com.br',
        valor: 150,
        resposta: false,
        pago: false,
        obs: 'REGISTRO DE TESTE — pode excluir',
    })
    .select('id')
    .single()
if (eReg) throw new Error(`Registro de teste: ${eReg.message}`)

const dados = {
    grupos: [
        {
            titulo: 'Dr. Veterinário de Teste',
            atendimentos: [
                { id: 'T-001', data: '05/10/2026', tutor: 'Tutor Teste', pet: 'Rex', itens: [['Consulta clínica (teste)', 100, 150]] },
                { id: 'T-002', data: '12/10/2026', tutor: 'Tutora Teste', pet: 'Mel', itens: [['Retorno (teste)', 50, 80]] },
            ],
        },
    ],
}
const id = crypto.randomUUID()
const token = tokenDoRelatorio(id, 1)
const { error: eRel } = await admin.from('repasse_relatorios').insert({
    id,
    registro_id: reg.id,
    prestador_id: null,
    mes: 10,
    ano: 2026,
    periodo_inicio: '2026-10-01',
    periodo_fim: '2026-10-31',
    arquivo_origem: 'relatorio-teste.xlsx',
    aba_nome: 'TESTE',
    nome_a1: NOME,
    dados,
    total_repasse: 150,
    total_tutor: 230,
    soma_linhas_repasse: 150,
    divergente: false,
    fluxo: 'automatico',
    status: 'nao_enviado',
    token_versao: 1,
    token_hash: hashDoToken(token),
    token_expira_em: new Date(Date.now() + 7 * 86_400_000).toISOString(),
})
if (eRel) {
    await admin.from('pagamentos_registros').delete().eq('id', reg.id)
    throw new Error(`Relatório de teste: ${eRel.message}`)
}

const link = `${emailAssetOrigin()}/repasse_mensal/${token}`
const competencia = periodoMesAnteriorLabel()
const corpo = `Olá, ${NOME}!

Este é um e-mail de TESTE do novo fluxo de repasse. Segue o relatório de repasse de ${competencia}, com 2 atendimento(s) e valor de repasse de R$ 150,00.

Para concluir, aprove ou reprove o relatório. Acesse o botão abaixo para conferir.`
const m = montarEmailRepasseRelatorio({
    assunto: `[TESTE] Relatório de repasse ${competencia} — ${NOME}`,
    corpo,
    prestador: NOME,
    competencia,
    valor: 150,
    atendimentos: 2,
    formaPagamento: 'RPA',
    link,
    whatsapp: '555499041695',
})
const enviado = await enviarEmailResend({ to: para, subject: `[TESTE] Relatório de repasse ${competencia} — ${NOME}`, html: m.html, text: m.text })
await admin.from('repasse_relatorios').update({ status: 'enviado', enviado_em: new Date().toISOString(), resend_email_id: enviado?.id || null }).eq('id', id)

console.log(JSON.stringify({ registro_id: reg.id, relatorio_id: id, email_id: enviado?.id || null, para, link }, null, 2))
