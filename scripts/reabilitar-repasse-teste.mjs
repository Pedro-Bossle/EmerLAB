/**
 * Reabilita o relatório de repasse de TESTE para aprovar/reprovar de novo.
 * Uso: node scripts/reabilitar-repasse-teste.mjs <relatorio_id>
 * Só aceita relatórios cujo registro é «TESTE — …» (nunca mexe em dados reais).
 */
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
const id = String(process.argv[2] || '').trim()
if (!id) {
    console.error('Informe o id do relatório de teste.')
    process.exit(1)
}

const { createSupabaseAdminClient } = await import('../src/lib/api/serverAuth.js')
const admin = createSupabaseAdminClient()

const { data: rel, error } = await admin.from('repasse_relatorios').select('id, registro_id, status').eq('id', id).maybeSingle()
if (error || !rel) throw new Error(error?.message || 'Relatório não encontrado.')
const { data: reg } = await admin.from('pagamentos_registros').select('id, prestador_nome').eq('id', rel.registro_id).maybeSingle()
if (!String(reg?.prestador_nome || '').startsWith('TESTE')) throw new Error('Este não é um relatório de teste. Nada foi alterado.')

await admin.from('repasse_documentos').delete().eq('relatorio_id', id)
await admin.from('repasse_comprovantes').delete().eq('relatorio_id', id)
const { error: e1 } = await admin
    .from('repasse_relatorios')
    .update({
        status: 'enviado',
        respondido_em: null,
        visualizado_em: null,
        token_revogado_em: null,
        token_expira_em: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        atualizado_em: new Date().toISOString(),
    })
    .eq('id', id)
if (e1) throw new Error(e1.message)
const { error: e2 } = await admin.from('pagamentos_registros').update({ resposta: false, pago: false }).eq('id', rel.registro_id)
if (e2) throw new Error(e2.message)
await admin.from('repasse_eventos').insert({ relatorio_id: id, tipo: 'reabilitado_teste', dados: {}, autor: 'script' })

console.log(`Relatório ${id} reabilitado (status anterior: ${rel.status} → enviado). Link válido por 7 dias.`)
