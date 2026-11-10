/**
 * Testa a API do repasse mensal com banco, Storage e Resend FALSOS (nenhum e-mail real, nenhuma rede).
 * Foca nas regras do docs/repasse-mensal.md: legado, divergência, token, flags do registro, bloqueios de envio.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = { tabelas: {}, emails: [], storage: new Map(), removidos: [] }

function tabela(n) {
    return (db.tabelas[n] ||= [])
}

function builder(nome, modo, payload) {
    const filtros = []
    let ordem = null
    let limite = null
    const b = {
        select: () => b,
        eq: (k, v) => (filtros.push((r) => r[k] === v), b),
        in: (k, vs) => (filtros.push((r) => vs.includes(r[k])), b),
        lt: (k, v) => (filtros.push((r) => r[k] < v), b),
        gte: (k, v) => (filtros.push((r) => r[k] >= v), b),
        order: (k, o) => ((ordem = [k, o?.ascending !== false]), b),
        limit: (n) => ((limite = n), b),
        single: async () => ({ data: executar()[0] ?? null, error: null }),
        maybeSingle: async () => ({ data: executar()[0] ?? null, error: null }),
        then: (res, rej) => Promise.resolve({ data: executar(), error: null }).then(res, rej),
    }
    function executar() {
        const linhas = tabela(nome)
        if (modo === 'insert') {
            const novos = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ ...r }))
            linhas.push(...novos)
            return novos
        }
        let achadas = linhas.filter((r) => filtros.every((f) => f(r)))
        if (modo === 'delete') {
            db.tabelas[nome] = linhas.filter((r) => !achadas.includes(r))
            return achadas
        }
        if (modo === 'update') {
            achadas.forEach((r) => Object.assign(r, payload))
            return achadas
        }
        if (ordem) achadas = [...achadas].sort((a, c) => (a[ordem[0]] > c[ordem[0]] ? 1 : -1) * (ordem[1] ? 1 : -1))
        return limite ? achadas.slice(0, limite) : achadas
    }
    return b
}

const admin = {
    from: (n) => ({
        select: (...a) => builder(n, 'select').select(...a),
        insert: (p) => builder(n, 'insert', p),
        update: (p) => builder(n, 'update', p),
        delete: () => builder(n, 'delete'),
    }),
    storage: {
        from: () => ({
            remove: async (paths) => (db.removidos.push(...paths), { data: paths, error: null }),
            createSignedUploadUrl: async (p) => ({ data: { token: 'up-' + p }, error: null }),
            createSignedUrl: async (p) => ({ data: { signedUrl: 'https://x/' + p }, error: null }),
            download: async (p) => ({ data: { arrayBuffer: async () => new TextEncoder().encode(db.storage.get(p) || 'conteudo').buffer }, error: null }),
        }),
    },
}

vi.mock('../api/serverAuth.js', () => ({
    createSupabaseAdminClient: () => admin,
    getClientIp: () => '1.2.3.4',
    readJsonBodyLimited: async (req) => req.body,
    responderSePayloadGrande: () => false,
    validarJwtComPermissao: async () => ({ user: { id: 'u1', email: 'fin@emerdog.com.br' }, profile: {} }),
}))
vi.mock('../../../api/_lib/resendMail.js', () => ({
    enviarEmailResend: async (o) => {
        db.emails.push(o)
        return { id: 'em_' + db.emails.length }
    },
    cancelarEmailAgendadoResend: async () => {},
}))
vi.mock('../../../api/_lib/emailBrand.js', () => ({ emailAssetOrigin: () => 'https://www.emerlab.com.br', EMAIL_BRAND: {} }))
vi.mock('../../../api/_lib/repasseEmails.js', () => {
    const m = (subject) => ({ subject, html: '<p/>', text: 't' })
    return {
        montarEmailRepasseRelatorio: (o) => ({ ...m(o.assunto), link: o.link }),
        montarEmailRepasseReprovacao: () => m('reprovacao'),
        montarEmailRepasseDocumentoDevolvido: () => m('devolvido'),
        montarEmailRepasseComprovante: () => m('comprovante'),
    }
})

import handler from '../../../api/_lib/repasseMensalHandler.js'

globalThis.process.env.REPASSE_TOKEN_SECRET = 'segredo-de-teste'

async function chamar(rota, body) {
    const res = { headers: {}, setHeader() {}, status(c) { this.code = c; return this }, json(p) { this.corpo = p; return this } }
    await handler({ method: 'POST', url: `/api/repasse-mensal?_route=${rota}`, headers: {}, body }, res)
    return { status: res.code, ...res.corpo }
}

const aba = (extra = {}) => ({
    nomeA1: 'CLINICA X', abaNome: 'X', totalAba: 150, fluxo: 'automatico',
    grupos: [{ titulo: 'CLINICA X', atendimentos: [{ id: '1', tutor: 'Ana', pet: 'Rex', data: '02/10/2026', itens: [['Consulta', 100, 20], ['Vacina', 50, 0]] }] }],
    ...extra,
})

function semear({ tipo = 'rpa', valor = 150, mes = 10, ano = 2026 } = {}) {
    tabela('pagamentos_registros').push({ id: 'reg1', mes, ano, prestador_id: 7, prestador_nome: 'Clínica X', tipo_repasse: tipo, chave_pix: 'x@pix.com', valor, resposta: false, pago: false, obs: 'obs' })
    tabela('prestadores').push({ id: 7, email: 'clinica@x.com' })
}

beforeEach(() => {
    db.tabelas = {}
    db.emails = []
    db.removidos = []
})

describe('criar-relatorios', () => {
    it('competência anterior à inicial (2026-10) fica como legado', async () => {
        semear({ mes: 9 })
        const r = await chamar('criar-relatorios', { itens: [{ registro_id: 'reg1', aba: aba() }] })
        expect(r.itens[0].ok).toBe(false)
        expect(tabela('repasse_relatorios')).toHaveLength(0)
    })

    it('cria relatório sem tocar no registro e detecta divergência com o valor do registro', async () => {
        semear({ valor: 999 })
        const antes = { ...tabela('pagamentos_registros')[0] }
        const r = await chamar('criar-relatorios', { itens: [{ registro_id: 'reg1', aba: aba() }] })
        expect(r.itens[0]).toMatchObject({ ok: true, divergente: true })
        expect(tabela('pagamentos_registros')[0]).toEqual(antes)
        expect(tabela('repasse_relatorios')[0].token_hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('laboratório em fluxo manual nunca é divergente', async () => {
        semear({ valor: 999 })
        const r = await chamar('criar-relatorios', { itens: [{ registro_id: 'reg1', aba: aba({ fluxo: 'laboratorio_manual' }) }] })
        expect(r.itens[0].divergente).toBe(false)
    })
})

describe('página pública', () => {
    async function criarELink() {
        const c = await chamar('criar-relatorios', { itens: [{ registro_id: 'reg1', aba: aba() }] })
        const { link } = await chamar('link', { relatorio_id: c.itens[0].relatorio_id })
        return { relId: c.itens[0].relatorio_id, token: link.split('/').pop() }
    }

    it('token inválido devolve erro genérico', async () => {
        const r = await chamar('publico-ler', { token: 'x'.repeat(43) })
        expect(r.status).toBe(404)
        expect(r.error).toMatch(/inválido ou vencido/)
    })

    it('o token em claro não é gravado; ler marca visualizado e não expõe o id do registro', async () => {
        semear()
        const { token } = await criarELink()
        expect(JSON.stringify(tabela('repasse_relatorios'))).not.toContain(token)
        const r = await chamar('publico-ler', { token })
        expect(r.relatorio.status).toBe('visualizado')
        expect(r.relatorio.totalRepasse).toBe(150)
        expect(JSON.stringify(r)).not.toContain('reg1')
    })

    it('relatório divergente não abre', async () => {
        semear({ valor: 999 })
        const { token } = await criarELink()
        expect((await chamar('publico-ler', { token })).status).toBe(404)
    })

    it('link revogado e link vencido não abrem', async () => {
        semear()
        const { relId, token } = await criarELink()
        await chamar('revogar-link', { relatorio_id: relId })
        expect((await chamar('publico-ler', { token })).status).toBe(404)
        const novo = await chamar('novo-link', { relatorio_id: relId })
        const t2 = novo.link.split('/').pop()
        expect((await chamar('publico-ler', { token })).status).toBe(404) // o antigo segue inválido
        tabela('repasse_relatorios')[0].token_expira_em = new Date(Date.now() - 1000).toISOString()
        expect((await chamar('publico-ler', { token: t2 })).status).toBe(404)
    })

    it('RPA aprova: só liga resposta (nada mais muda no registro)', async () => {
        semear()
        const { token } = await criarELink()
        const antes = { ...tabela('pagamentos_registros')[0] }
        await chamar('publico-aprovar', { token })
        expect(tabela('pagamentos_registros')[0]).toEqual({ ...antes, resposta: true })
        expect(tabela('repasse_relatorios')[0].status).toBe('aprovado')
    })

    it('NF não aprova direto e bloqueia o valor pago pelo tutor (alerta vermelho)', async () => {
        semear({ tipo: 'nota' })
        const { relId, token } = await criarELink()
        expect((await chamar('publico-aprovar', { token })).status).toBe(400)
        const path = `2026-10/${relId}/documento/a.pdf`
        const tutor = await chamar('publico-documento', { token, path, numero: '123', valor: 20 })
        expect(tutor.status).toBe(422)
        const ok = await chamar('publico-documento', { token, path, numero: '123', valor: 140 })
        expect(ok).toMatchObject({ ok: true, status: 'documento_em_revisao', alerta: 'aviso_diferente' })
        expect(tabela('pagamentos_registros')[0].resposta).toBe(false) // só o financeiro aprova
    })

    it('envio repetido do mesmo documento (clique duplo) não cria um segundo documento', async () => {
        semear({ tipo: 'nota' })
        const { relId, token } = await criarELink()
        const corpo = { token, numero: '3', valor: 150 }
        const a = await chamar('publico-documento', { ...corpo, path: `2026-10/${relId}/documento/a.pdf` })
        const b = await chamar('publico-documento', { ...corpo, path: `2026-10/${relId}/documento/b.pdf` })
        expect(a).toMatchObject({ ok: true, status: 'documento_em_revisao' })
        expect(b).toMatchObject({ ok: true, status: 'documento_em_revisao', duplicado: true })
        expect(tabela('repasse_documentos')).toHaveLength(1)
        expect(tabela('repasse_eventos').filter((e) => e.tipo === 'documento_enviado')).toHaveLength(1)
        // número diferente é outro documento
        await chamar('publico-documento', { ...corpo, numero: '4', path: `2026-10/${relId}/documento/c.pdf` })
        expect(tabela('repasse_documentos')).toHaveLength(2)
    })

    it('rejeita caminho de documento de outro relatório', async () => {
        semear({ tipo: 'nota' })
        const { token } = await criarELink()
        const r = await chamar('publico-documento', { token, path: '2026-10/outro/documento/a.pdf', numero: '1', valor: 150 })
        expect(r.status).toBe(400)
    })

    it('reprovar por e-mail avisa pedro@emerdog.com.br e registra o evento', async () => {
        semear()
        const { token } = await criarELink()
        await chamar('publico-reprovar', { token, observacao: 'faltou um atendimento', canal: 'email' })
        expect(db.emails[0].to).toBe('pedro@emerdog.com.br')
        expect(tabela('repasse_relatorios')[0].status).toBe('reprovado')
        expect(tabela('repasse_eventos').find((e) => e.tipo === 'reprovado').dados.canal).toBe('email')
    })

    it('reprovar por WhatsApp não envia e-mail', async () => {
        semear()
        const { token } = await criarELink()
        await chamar('publico-reprovar', { token, observacao: 'valor errado aqui', canal: 'whatsapp' })
        expect(db.emails).toHaveLength(0)
    })
})

describe('retenção de documentos (60 dias)', () => {
    const dias = (n) => new Date(Date.now() - n * 86_400_000).toISOString()
    const cron = async (segredo) => {
        const res = { setHeader() {}, status(c) { this.code = c; return this }, json(p) { this.corpo = p; return this } }
        await handler({ method: 'GET', url: '/api/repasse-mensal?_route=limpar-documentos', headers: segredo ? { authorization: `Bearer ${segredo}` } : {} }, res)
        return { status: res.code, ...res.corpo }
    }

    it('exclui só nota/boleto APROVADO com mais de 60 dias (arquivo e registro) e guarda o evento', async () => {
        globalThis.process.env.CRON_SECRET = 'cron-teste'
        tabela('repasse_documentos').push(
            { id: 'velho', relatorio_id: 'r1', status: 'aprovado', criado_em: dias(61), storage_path: 'a/velho.pdf', tipo: 'nota', numero: '10', valor: 150 },
            { id: 'recente', relatorio_id: 'r1', status: 'aprovado', criado_em: dias(10), storage_path: 'a/recente.pdf', tipo: 'nota', numero: '11', valor: 150 },
            { id: 'pendente', relatorio_id: 'r1', status: 'em_revisao', criado_em: dias(90), storage_path: 'a/pendente.pdf', tipo: 'nota', numero: '12', valor: 150 },
        )
        const r = await cron('cron-teste')
        expect(r).toMatchObject({ ok: true, excluidos: 1 })
        expect(db.removidos).toEqual(['a/velho.pdf'])
        expect(tabela('repasse_documentos').map((d) => d.id).sort()).toEqual(['pendente', 'recente'])
        expect(tabela('repasse_eventos').find((e) => e.tipo === 'documento_excluido').dados.numero).toBe('10')
    })

    it('só roda com o segredo do cron', async () => {
        globalThis.process.env.CRON_SECRET = 'cron-teste'
        tabela('repasse_documentos').push({ id: 'velho', relatorio_id: 'r1', status: 'aprovado', criado_em: dias(100), storage_path: 'a/v.pdf' })
        expect((await cron('')).status).toBe(401)
        expect((await cron('errado')).status).toBe(401)
        expect(tabela('repasse_documentos')).toHaveLength(1)
        delete globalThis.process.env.CRON_SECRET
        expect((await cron('qualquer')).status).toBe(503)
    })
})

describe('envio e comprovante', () => {
    it('só envia relatórios aptos: bloqueia divergente e prestador sem e-mail; marca enviado', async () => {
        semear()
        const c = await chamar('criar-relatorios', { itens: [{ registro_id: 'reg1', aba: aba() }] })
        const relId = c.itens[0].relatorio_id
        const plano = await chamar('planejar-envio', { assunto: 'a {prestador}', corpo: 'b', modo: 'agora', relatorio_ids: [relId] })
        tabela('prestadores')[0].email = ''
        let r = await chamar('enviar-lote', { envio_id: plano.envio_id, itens: plano.plano })
        expect(r.resultados[0]).toMatchObject({ ok: false })
        expect(r.resultados[0].error).toMatch(/sem e-mail/)
        tabela('prestadores')[0].email = 'clinica@x.com'
        r = await chamar('enviar-lote', { envio_id: plano.envio_id, itens: plano.plano })
        expect(r.resultados[0].ok).toBe(true)
        expect(db.emails[0].to).toBe('clinica@x.com')
        expect(tabela('repasse_relatorios')[0].status).toBe('enviado')
        // reenviar o mesmo (já enviado) é recusado
        r = await chamar('enviar-lote', { envio_id: plano.envio_id, itens: plano.plano })
        expect(r.resultados[0].ok).toBe(false)
    })

    it('reenviar e-mail: primeiro envio vira «enviado»; reenvio mantém o status e registra o evento', async () => {
        semear()
        const c = await chamar('criar-relatorios', { itens: [{ registro_id: 'reg1', aba: aba() }] })
        const relId = c.itens[0].relatorio_id
        let r = await chamar('reenviar-email', { relatorio_id: relId })
        expect(r).toMatchObject({ ok: true, para: 'clinica@x.com', primeiroEnvio: true })
        expect(tabela('repasse_relatorios')[0].status).toBe('enviado')
        tabela('repasse_relatorios')[0].status = 'aprovado'
        r = await chamar('reenviar-email', { relatorio_id: relId })
        expect(r).toMatchObject({ ok: true, primeiroEnvio: false })
        expect(db.emails).toHaveLength(2)
        expect(tabela('repasse_relatorios')[0].status).toBe('aprovado')
        expect(tabela('repasse_eventos').filter((e) => e.tipo === 'reenviado')).toHaveLength(1)
    })

    it('reenviar e-mail é recusado para agendado, divergente e prestador sem e-mail', async () => {
        semear()
        const c = await chamar('criar-relatorios', { itens: [{ registro_id: 'reg1', aba: aba() }] })
        const relId = c.itens[0].relatorio_id
        tabela('repasse_relatorios')[0].status = 'agendado'
        expect((await chamar('reenviar-email', { relatorio_id: relId })).status).toBe(409)
        tabela('repasse_relatorios')[0].status = 'enviado'
        tabela('repasse_relatorios')[0].divergente = true
        expect((await chamar('reenviar-email', { relatorio_id: relId })).status).toBe(409)
        tabela('repasse_relatorios')[0].divergente = false
        tabela('prestadores')[0].email = ''
        expect((await chamar('reenviar-email', { relatorio_id: relId })).status).toBe(422)
        expect(db.emails).toHaveLength(0)
    })

    it('agendamento usa scheduledAt e fica «agendado»', async () => {
        semear()
        const c = await chamar('criar-relatorios', { itens: [{ registro_id: 'reg1', aba: aba() }] })
        const relId = c.itens[0].relatorio_id
        const ini = new Date(Date.now() + 3_600_000).toISOString()
        const fim = new Date(Date.now() + 7_200_000).toISOString()
        const plano = await chamar('planejar-envio', { assunto: 'a', corpo: 'b', modo: 'periodo', janela_inicio: ini, janela_fim: fim, ordem: 'aleatoria', relatorio_ids: [relId] })
        await chamar('enviar-lote', { envio_id: plano.envio_id, itens: plano.plano })
        expect(db.emails[0].scheduledAt).toBeTruthy()
        expect(tabela('repasse_relatorios')[0].status).toBe('agendado')
        await chamar('cancelar-agendamento', { relatorio_ids: [relId] })
        expect(tabela('repasse_relatorios')[0].status).toBe('nao_enviado')
    })

    it('comprovante anexa o arquivo, grava e liga só pago', async () => {
        semear()
        const c = await chamar('criar-relatorios', { itens: [{ registro_id: 'reg1', aba: aba() }] })
        const relId = c.itens[0].relatorio_id
        const antes = { ...tabela('pagamentos_registros')[0] }
        const r = await chamar('enviar-comprovante', { relatorio_id: relId, path: `2026-11/${relId}/comprovante/c.pdf`.replace('2026-11', '2026-10'), data_pagamento: '2026-11-10', valor: 150 })
        expect(r.ok).toBe(true)
        expect(db.emails[0].attachments[0].filename).toMatch(/comprovante-10-2026\.pdf/)
        expect(tabela('pagamentos_registros')[0]).toEqual({ ...antes, pago: true })
        expect(tabela('repasse_comprovantes')).toHaveLength(1)
    })

    it('comprovante: linha, e-mail e evento com os mesmos campos de antes', async () => {
        semear()
        const c = await chamar('criar-relatorios', { itens: [{ registro_id: 'reg1', aba: aba() }] })
        const relId = c.itens[0].relatorio_id
        const path = `2026-10/${relId}/comprovante/c.pdf`
        db.storage.set(path, 'PDFDATA')
        await chamar('enviar-comprovante', { relatorio_id: relId, path, data_pagamento: '2026-11-10', valor: 150.004 })
        expect(db.emails).toHaveLength(1)
        expect(db.emails[0]).toMatchObject({ to: 'clinica@x.com', subject: 'comprovante', from: 'Emerdog Financeiro <noreply@emerlab.com.br>' })
        expect(new TextDecoder().decode(db.emails[0].attachments[0].content)).toBe('PDFDATA')
        expect(tabela('repasse_comprovantes')[0]).toEqual({
            relatorio_id: relId, registro_id: 'reg1', forma: 'pix', storage_path: path, data_pagamento: '2026-11-10', valor: 150,
            enviado_por: 'u1', resend_email_id: 'em_1',
        })
        const ev = tabela('repasse_eventos').filter((e) => e.tipo === 'comprovante_enviado')
        expect(ev).toEqual([{ relatorio_id: relId, tipo: 'comprovante_enviado', dados: { valor: 150, data_pagamento: '2026-11-10', forma: 'pix' }, autor: 'fin@emerdog.com.br', ip_hash: null }])
    })

    it('comprovante: prestador sem e-mail é 422 e nada é gravado', async () => {
        semear()
        const c = await chamar('criar-relatorios', { itens: [{ registro_id: 'reg1', aba: aba() }] })
        const relId = c.itens[0].relatorio_id
        tabela('prestadores')[0].email = ''
        const r = await chamar('enviar-comprovante', { relatorio_id: relId, path: `2026-10/${relId}/comprovante/c.pdf`, data_pagamento: '2026-11-10', valor: 150 })
        expect(r.status).toBe(422)
        expect(tabela('repasse_comprovantes')).toHaveLength(0)
        expect(tabela('pagamentos_registros')[0].pago).toBe(false)
    })

    it('comprovante em lote: um e-mail, uma linha e um evento por mês', async () => {
        semear()
        tabela('pagamentos_registros').push({ ...tabela('pagamentos_registros')[0], id: 'reg2', mes: 11 })
        const c = await chamar('criar-relatorios', { itens: [{ registro_id: 'reg1', aba: aba() }, { registro_id: 'reg2', aba: aba() }] })
        const ids = c.itens.map((i) => i.relatorio_id)
        const r = await chamar('enviar-comprovante-lote', { relatorio_ids: ids, path: `2026-10/${ids[0]}/comprovante/c.pdf`, data_pagamento: '2026-11-10', valor: 300 })
        expect(r).toMatchObject({ ok: true, meses: 2 })
        expect(db.emails).toHaveLength(1)
        expect(db.emails[0].attachments[0].filename).toBe('comprovante-10-2026-11-2026.pdf')
        expect(tabela('repasse_comprovantes').map((x) => [x.registro_id, x.valor, x.resend_email_id])).toEqual([['reg1', 150, 'em_1'], ['reg2', 150, 'em_1']])
        expect(tabela('pagamentos_registros').map((x) => x.pago)).toEqual([true, true])
        const ev = tabela('repasse_eventos').filter((e) => e.tipo === 'comprovante_enviado')
        expect(ev.map((e) => e.dados)).toEqual([
            { valor: 150, valor_total_pago: 300, data_pagamento: '2026-11-10', forma: 'pix', lote: 2 },
            { valor: 150, valor_total_pago: 300, data_pagamento: '2026-11-10', forma: 'pix', lote: 2 },
        ])
    })

    it('desfazer pagamento exige motivo, remove o comprovante e desmarca pago', async () => {
        semear()
        const c = await chamar('criar-relatorios', { itens: [{ registro_id: 'reg1', aba: aba() }] })
        const relId = c.itens[0].relatorio_id
        await chamar('enviar-comprovante', { relatorio_id: relId, path: `2026-10/${relId}/comprovante/c.pdf`, data_pagamento: '2026-11-10', valor: 150 })
        expect((await chamar('desfazer-pagamento', { relatorio_id: relId, motivo: 'abc' })).status).toBe(400)
        const r = await chamar('desfazer-pagamento', { relatorio_id: relId, motivo: 'pago em duplicidade' })
        expect(r.ok).toBe(true)
        expect(tabela('repasse_comprovantes')).toHaveLength(0)
        expect(tabela('pagamentos_registros')[0].pago).toBe(false)
        expect(tabela('repasse_eventos').filter((e) => e.tipo === 'pagamento_desfeito')[0].dados).toEqual({ motivo: 'pago em duplicidade' })
    })
})
