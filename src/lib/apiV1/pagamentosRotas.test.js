/**
 * Rotas /api/v1/pagamentos com banco, Storage e Resend FALSOS (padrão de src/lib/repasse/apiRepasseMensal.test.js):
 * nenhum e-mail real, nenhuma rede.
 */
import { Buffer } from 'node:buffer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hashChave } from './chaves.js'

const CHAVE = 'emer_pag_abc123'
const REG = '11111111-1111-4111-8111-111111111111'
const REG_SEM_REL = '22222222-2222-4222-8222-222222222222'
const REL = '33333333-3333-4333-8333-333333333333'

const db = { tabelas: {}, emails: [], storage: new Map(), uploads: [], seq: 0, falharEmail: false }
const tabela = (n) => (db.tabelas[n] ||= [])

function builder(nome, modo, payload) {
    const filtros = []
    const ordens = []
    let faixa = null
    let limite = null
    let contar = false
    const b = {
        select: (_c, o) => ((contar = !!o?.count), b),
        eq: (k, v) => (filtros.push((r) => r[k] === v), b),
        in: (k, vs) => (filtros.push((r) => vs.includes(r[k])), b),
        is: (k, v) => (filtros.push((r) => (r[k] ?? null) === v), b),
        order: (k, o) => (ordens.push([k, o?.ascending !== false]), b),
        range: (a, z) => ((faixa = [a, z]), b),
        limit: (n) => ((limite = n), b),
        single: async () => ({ data: executar().linhas[0] ?? null, error: null }),
        maybeSingle: async () => ({ data: executar().linhas[0] ?? null, error: null }),
        then: (res, rej) => Promise.resolve(executar()).then(({ linhas, total }) => ({ data: linhas, error: null, count: contar ? total : null })).then(res, rej),
    }
    function executar() {
        const linhas = tabela(nome)
        if (modo === 'insert') {
            const novos = (Array.isArray(payload) ? payload : [payload]).map((r) => ({
                id: `id-${++db.seq}`, ...(nome === 'repasse_comprovantes' ? { enviado_em: '2026-11-10T12:00:00.000Z' } : {}), ...r,
            }))
            linhas.push(...novos)
            return { linhas: novos.map((r) => ({ ...r })) }
        }
        let achadas = linhas.filter((r) => filtros.every((f) => f(r)))
        if (modo === 'delete') {
            db.tabelas[nome] = linhas.filter((r) => !achadas.includes(r))
            return { linhas: achadas }
        }
        if (modo === 'update') {
            achadas.forEach((r) => Object.assign(r, payload))
            return { linhas: achadas.map((r) => ({ ...r })) }
        }
        const total = achadas.length
        if (ordens.length) {
            achadas = [...achadas].sort((a, c) => {
                for (const [k, asc] of ordens) {
                    if (a[k] === c[k]) continue
                    return (a[k] > c[k] ? 1 : -1) * (asc ? 1 : -1)
                }
                return 0
            })
        }
        if (faixa) achadas = achadas.slice(faixa[0], faixa[1] + 1)
        if (limite) achadas = achadas.slice(0, limite)
        return { linhas: achadas.map((r) => ({ ...r })), total }
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
            upload: async (p, buf, o) => (db.uploads.push({ path: p, ...o }), db.storage.set(p, Buffer.from(buf)), { data: { path: p }, error: null }),
            remove: async (paths) => (paths.forEach((p) => db.storage.delete(p)), { data: paths, error: null }),
            list: async (pasta, o) => ({
                data: [...db.storage.keys()].filter((k) => k.startsWith(pasta + '/') && k.slice(pasta.length + 1).includes(o?.search || '')).map((k) => ({ name: k.slice(pasta.length + 1) })),
                error: null,
            }),
            download: async (p) => ({ data: db.storage.has(p) ? { arrayBuffer: async () => db.storage.get(p) } : null, error: db.storage.has(p) ? null : { message: 'x' } }),
        }),
    },
}

vi.mock('../api/serverAuth.js', () => ({
    createSupabaseAdminClient: () => admin,
    getClientIp: () => '1.2.3.4',
    validarJwtComPermissao: async () => ({ error: 'x', status: 401 }),
}))
vi.mock('../../../api/_lib/resendMail.js', () => ({
    enviarEmailResend: async (o) => {
        if (db.falharEmail) throw new Error('resend fora do ar')
        db.emails.push(o)
        return { id: 'em_' + db.emails.length }
    },
    cancelarEmailAgendadoResend: async () => {},
}))
vi.mock('../../../api/_lib/emailBrand.js', () => ({ emailAssetOrigin: () => 'https://www.emerlab.com.br', EMAIL_BRAND: {} }))
vi.mock('../../../api/_lib/repasseEmails.js', () => ({
    montarEmailRepasseComprovante: (o) => ({ subject: 'comprovante', html: '<p/>', text: 't', link: o.link }),
    montarEmailRepasseRelatorio: () => ({}),
    montarEmailRepasseReprovacao: () => ({}),
    montarEmailRepasseDocumentoDevolvido: () => ({}),
}))

globalThis.process.env.REPASSE_TOKEN_SECRET = 'segredo-de-teste'

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('conteudo do comprovante')])
const b64 = (buf) => buf.toString('base64')

function semear() {
    db.tabelas = {
        api_chaves: [{
            id: 'k1', nome: 'Financeiro', prefixo: 'emer_pag', hash: hashChave(CHAVE), escopos: ['pagamentos:ler', 'pagamentos:escrever'],
            origens_permitidas: [], limite_por_minuto: 1000, ips_permitidos: [], expira_em: null, revogada_em: null,
        }],
        pagamentos_registros: [
            { id: REG, mes: 10, ano: 2026, prestador_id: 7, prestador_nome: 'Clínica X', tipo_repasse: 'rpa', chave_pix: 'segredo@pix.com', valor: 150, resposta: true, pago: false, obs: 'obs interna', criado_em: 'c', atualizado_em: 'a' },
            { id: REG_SEM_REL, mes: 11, ano: 2026, prestador_id: 8, prestador_nome: 'Lab Y', tipo_repasse: 'boleto', chave_pix: null, valor: 80, resposta: false, pago: false, obs: null, criado_em: 'c', atualizado_em: 'a' },
        ],
        repasse_relatorios: [{ id: REL, registro_id: REG, mes: 10, ano: 2026, status: 'aprovado', nome_a1: 'CLINICA X', token_versao: 1, total_repasse: 150 }],
        prestadores: [{ id: 7, email: 'clinica@x.com' }, { id: 8, email: 'lab@y.com' }],
        repasse_comprovantes: [],
        repasse_eventos: [],
        audit_logs: [],
    }
    db.emails = []
    db.storage = new Map()
    db.uploads = []
    db.falharEmail = false
}

let roteador
beforeEach(async () => {
    vi.resetModules()
    semear()
    roteador = await import('../../../api/_lib/apiV1/roteador.js')
})

const chamar = (metodo, caminho, { body = {}, query = {}, headers = {} } = {}) =>
    roteador.processarRequisicao({ metodo, caminho, query, body, ip: '1.2.3.4', headers: { authorization: `Bearer ${CHAVE}`, ...headers } })

const registro = (id) => tabela('pagamentos_registros').find((r) => r.id === id)
const eventos = (tipo) => tabela('repasse_eventos').filter((e) => e.tipo === tipo)
const auditoria = (acao) => tabela('audit_logs').filter((a) => a.acao === acao)

describe('POST /pagamentos/registros/{id}/pago', () => {
    it('marca pago, grava evento api:<nome> e auditoria, sem mexer em outra coluna', async () => {
        const antes = { ...registro(REG) }
        const r = await chamar('POST', `/pagamentos/registros/${REG}/pago`, { body: { data_pagamento: '2026-11-05', valor: 150 } })
        expect(r.status).toBe(200)
        expect(r.headers['Cache-Control']).toBe('no-store')
        expect(r.corpo).toMatchObject({ ja_estava_pago: false, registro: { id: REG, pago: true } })
        expect(registro(REG)).toEqual({ ...antes, pago: true })
        expect(eventos('pagamento_marcado')).toEqual([
            expect.objectContaining({ relatorio_id: REL, autor: 'api:Financeiro', dados: { data_pagamento: '2026-11-05', valor: 150, origem: 'api' } }),
        ])
        const [a] = auditoria('PAGAMENTO_MARCADO')
        expect(a).toMatchObject({ usuario_id: null, usuario_nome: 'api:Financeiro (emer_pag)', tabela: 'pagamentos_registros', registro_id: REG, severidade: 'warning' })
        expect(a.valor_novo).toMatchObject({ pago: true, data_pagamento: '2026-11-05', valor: 150 })
        expect(JSON.stringify(r.corpo)).not.toContain('segredo@pix.com')
    })

    it('repetido: 200 ja_estava_pago e nenhum evento novo', async () => {
        await chamar('POST', `/pagamentos/registros/${REG}/pago`)
        const r = await chamar('POST', `/pagamentos/registros/${REG}/pago`, { headers: { 'idempotency-key': 'abc' } })
        expect(r.status).toBe(200)
        expect(r.corpo.ja_estava_pago).toBe(true)
        expect(eventos('pagamento_marcado')).toHaveLength(1)
        expect(auditoria('PAGAMENTO_MARCADO')).toHaveLength(1)
    })

    it('corpo inválido: 400 com código', async () => {
        const a = await chamar('POST', `/pagamentos/registros/${REG}/pago`, { body: { data_pagamento: '05/11/2026' } })
        expect(a.status).toBe(400)
        expect(a.corpo.erro.codigo).toBe('data_pagamento_invalida')
        const b = await chamar('POST', `/pagamentos/registros/${REG}/pago`, { body: { valor: -3 } })
        expect(b.corpo.erro.codigo).toBe('valor_invalido')
        expect(registro(REG).pago).toBe(false)
    })

    it('registro sem relatório: marca pago, só auditoria (sem repasse_eventos)', async () => {
        const r = await chamar('POST', `/pagamentos/registros/${REG_SEM_REL}/pago`)
        expect(r.status).toBe(200)
        expect(registro(REG_SEM_REL).pago).toBe(true)
        expect(tabela('repasse_eventos')).toHaveLength(0)
        expect(auditoria('PAGAMENTO_MARCADO')).toHaveLength(1)
    })

    it('registro inexistente ou id inválido: 404', async () => {
        for (const id of ['44444444-4444-4444-8444-444444444444', 'abc']) {
            const r = await chamar('POST', `/pagamentos/registros/${id}/pago`)
            expect(r.status).toBe(404)
            expect(r.corpo.erro.codigo).toBe('registro_nao_encontrado')
        }
    })
})

describe('POST /pagamentos/registros/{id}/comprovantes', () => {
    const corpo = (extra = {}) => ({ arquivo_base64: b64(PDF), nome: 'comprovante.pdf', data_pagamento: '2026-11-05', valor: 150, ...extra })

    it('grava no Storage e em repasse_comprovantes, marca pago e não envia e-mail por padrão', async () => {
        const antes = { ...registro(REG) }
        const r = await chamar('POST', `/pagamentos/registros/${REG}/comprovantes`, { body: corpo() })
        expect(r.status).toBe(201)
        expect(r.headers['Cache-Control']).toBe('no-store')
        expect(db.uploads).toHaveLength(1)
        expect(db.uploads[0].path).toMatch(new RegExp(`^2026-10/${REL}/comprovante/[0-9a-f]{64}\\.pdf$`))
        expect(db.uploads[0].contentType).toBe('application/pdf')
        expect(tabela('repasse_comprovantes')).toEqual([expect.objectContaining({
            relatorio_id: REL, registro_id: REG, forma: 'pix', storage_path: db.uploads[0].path, data_pagamento: '2026-11-05', valor: 150,
            enviado_por: null, resend_email_id: null,
        })])
        expect(registro(REG)).toEqual({ ...antes, pago: true })
        expect(db.emails).toHaveLength(0)
        expect(eventos('comprovante_enviado')).toEqual([expect.objectContaining({ autor: 'api:Financeiro', dados: { valor: 150, data_pagamento: '2026-11-05', forma: 'pix' } })])
        expect(auditoria('COMPROVANTE_ANEXADO')).toHaveLength(1)
        expect(r.corpo).toEqual({
            ja_existia: false, notificado: false,
            comprovante: { id: tabela('repasse_comprovantes')[0].id, data_pagamento: '2026-11-05', valor: 150, forma: 'pix', enviado_em: '2026-11-10T12:00:00.000Z' },
        })
        expect(JSON.stringify(r.corpo)).not.toContain('comprovante/')
    })

    it('notificar_prestador true envia o e-mail do painel com o arquivo', async () => {
        const r = await chamar('POST', `/pagamentos/registros/${REG}/comprovantes`, { body: corpo({ notificar_prestador: true }) })
        expect(r.status).toBe(201)
        expect(r.corpo.notificado).toBe(true)
        expect(db.emails).toHaveLength(1)
        expect(db.emails[0]).toMatchObject({ to: 'clinica@x.com', subject: 'comprovante' })
        expect(db.emails[0].attachments[0].filename).toBe('comprovante-10-2026.pdf')
        expect(Buffer.compare(Buffer.from(db.emails[0].attachments[0].content), PDF)).toBe(0)
        expect(tabela('repasse_comprovantes')[0].resend_email_id).toBe('em_1')
    })

    it('e-mail falhou: nada fica gravado (linha, arquivo e pago) e a chamada pode ser repetida', async () => {
        db.falharEmail = true
        const r = await chamar('POST', `/pagamentos/registros/${REG}/comprovantes`, { body: corpo({ notificar_prestador: true }) })
        expect(r.status).toBe(500)
        expect(tabela('repasse_comprovantes')).toHaveLength(0)
        expect(db.storage.size).toBe(0)
        expect(registro(REG).pago).toBe(false)
        expect(eventos('comprovante_enviado')).toHaveLength(0)
        db.falharEmail = false
        const de_novo = await chamar('POST', `/pagamentos/registros/${REG}/comprovantes`, { body: corpo({ notificar_prestador: true }) })
        expect(de_novo.status).toBe(201)
        expect(db.emails).toHaveLength(1)
    })

    it('notificar sem e-mail do prestador: 422 prestador_sem_email e nada gravado', async () => {
        tabela('prestadores')[0].email = ''
        const r = await chamar('POST', `/pagamentos/registros/${REG}/comprovantes`, { body: corpo({ notificar_prestador: true }) })
        expect(r.status).toBe(422)
        expect(r.corpo.erro.codigo).toBe('prestador_sem_email')
        expect(db.uploads).toHaveLength(0)
        expect(tabela('repasse_comprovantes')).toHaveLength(0)
        expect(registro(REG).pago).toBe(false)
    })

    it('mesmo arquivo no mesmo registro devolve o existente, sem nova linha, upload ou e-mail', async () => {
        const a = await chamar('POST', `/pagamentos/registros/${REG}/comprovantes`, { body: corpo() })
        const b = await chamar('POST', `/pagamentos/registros/${REG}/comprovantes`, { body: corpo({ notificar_prestador: true }) })
        expect(b.status).toBe(200)
        expect(b.corpo.ja_existia).toBe(true)
        expect(b.corpo.comprovante.id).toBe(a.corpo.comprovante.id)
        expect(tabela('repasse_comprovantes')).toHaveLength(1)
        expect(db.uploads).toHaveLength(1)
        expect(db.emails).toHaveLength(0)
        expect(eventos('comprovante_enviado')).toHaveLength(1)
    })

    it('.exe renomeado para .pdf: 422 arquivo_invalido', async () => {
        const exe = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(64)])
        const r = await chamar('POST', `/pagamentos/registros/${REG}/comprovantes`, { body: corpo({ arquivo_base64: b64(exe), nome: 'boleto.pdf' }) })
        expect(r.status).toBe(422)
        expect(r.corpo.erro.codigo).toBe('arquivo_invalido')
        expect(db.uploads).toHaveLength(0)
    })

    it('3 MB + 1 byte: 413 arquivo_grande (o corpo de ~4,2 MB passa pelo teto da rota)', async () => {
        const grande = Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(3 * 1024 * 1024 + 1 - 4)])
        const texto = JSON.stringify(corpo({ arquivo_base64: b64(grande) }))
        const res = { headers: {}, setHeader(k, v) { this.headers[k] = v }, status(c) { this.codigo = c; return this }, json(p) { this.corpo = p; return this }, end() { return this } }
        await roteador.default({
            method: 'POST', url: `/api/email?_fn=api-v1&_path=${encodeURIComponent(`pagamentos/registros/${REG}/comprovantes`)}`,
            headers: { authorization: `Bearer ${CHAVE}`, 'content-length': String(Buffer.byteLength(texto)) }, body: texto,
        }, res)
        expect(res.codigo).toBe(413)
        expect(res.corpo.erro.codigo).toBe('arquivo_grande')
        expect(db.uploads).toHaveLength(0)
    })

    it('campos obrigatórios: arquivo, data e valor', async () => {
        expect((await chamar('POST', `/pagamentos/registros/${REG}/comprovantes`, { body: corpo({ arquivo_base64: undefined }) })).corpo.erro.codigo).toBe('arquivo_obrigatorio')
        expect((await chamar('POST', `/pagamentos/registros/${REG}/comprovantes`, { body: corpo({ data_pagamento: undefined }) })).corpo.erro.codigo).toBe('data_pagamento_invalida')
        expect((await chamar('POST', `/pagamentos/registros/${REG}/comprovantes`, { body: corpo({ valor: 0 }) })).corpo.erro.codigo).toBe('valor_invalido')
        expect((await chamar('POST', `/pagamentos/registros/${REG}/comprovantes`, { body: corpo({ notificar_prestador: 'talvez' }) })).corpo.erro.codigo).toBe('parametro_invalido')
        expect(db.uploads).toHaveLength(0)
    })

    it('registro sem relatório: grava com relatorio_id nulo no caminho do registro', async () => {
        const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)])
        const r = await chamar('POST', `/pagamentos/registros/${REG_SEM_REL}/comprovantes`, { body: corpo({ arquivo_base64: b64(png), nome: 'x.pdf', valor: 80 }) })
        expect(r.status).toBe(201)
        expect(db.uploads[0].path).toMatch(new RegExp(`^2026-11/registro-${REG_SEM_REL}/comprovante/[0-9a-f]{64}\\.png$`))
        expect(tabela('repasse_comprovantes')[0]).toMatchObject({ relatorio_id: null, registro_id: REG_SEM_REL, forma: 'boleto' })
        expect(registro(REG_SEM_REL).pago).toBe(true)
        expect(tabela('repasse_eventos')).toHaveLength(0)
        expect(auditoria('COMPROVANTE_ANEXADO')).toHaveLength(1)
    })

    it('falha ao gravar a linha (relatorio_id ainda obrigatório no banco): apaga o arquivo e não marca pago', async () => {
        const original = admin.from
        admin.from = (n) => {
            const t = original(n)
            if (n !== 'repasse_comprovantes') return t
            return { ...t, insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: { code: '23502', message: 'null value' } }) }) }) }
        }
        try {
            const r = await chamar('POST', `/pagamentos/registros/${REG_SEM_REL}/comprovantes`, { body: corpo({ valor: 80 }) })
            expect(r.status).toBe(409)
            expect(r.corpo.erro.codigo).toBe('registro_sem_relatorio')
            expect(db.storage.size).toBe(0)
            expect(registro(REG_SEM_REL).pago).toBe(false)
        } finally {
            admin.from = original
        }
    })
})

describe('comprovante: falhas no meio e duplicidade concorrente', () => {
    const corpo = (extra = {}) => ({ arquivo_base64: b64(PDF), data_pagamento: '2026-11-05', valor: 150, notificar_prestador: true, ...extra })
    const caminho = `/pagamentos/registros/${REG}/comprovantes`

    /** Faz o próximo update condicional de pagamentos_registros falhar uma vez. */
    function falharProximoPago() {
        const original = admin.from
        admin.from = (n) => {
            const t = original(n)
            if (n !== 'pagamentos_registros') return t
            return {
                ...t,
                update: () => {
                    admin.from = original
                    return { eq: () => ({ eq: () => ({ select: async () => ({ data: null, error: { message: 'timeout' } }) }) }) }
                },
            }
        }
        return () => (admin.from = original)
    }

    it('pago falha depois da linha salva: arquivo e linha ficam; nova chamada liga pago sem 2º e-mail nem 2º evento', async () => {
        const restaurar = falharProximoPago()
        let r
        try {
            r = await chamar('POST', caminho, { body: corpo() })
        } finally {
            restaurar()
        }
        expect(r.status).toBe(500)
        expect(r.corpo.erro.codigo).toBe('comprovante_inconsistente')
        expect(tabela('repasse_comprovantes')).toHaveLength(1)
        const path = tabela('repasse_comprovantes')[0].storage_path
        expect(db.storage.has(path)).toBe(true)
        expect(registro(REG).pago).toBe(false)
        expect(db.emails).toHaveLength(1)

        const de_novo = await chamar('POST', caminho, { body: corpo() })
        expect(de_novo.status).toBe(200)
        expect(de_novo.corpo).toMatchObject({ ja_existia: true, notificado: false, comprovante: { id: tabela('repasse_comprovantes')[0].id } })
        expect(registro(REG).pago).toBe(true)
        expect(tabela('repasse_comprovantes')).toHaveLength(1)
        expect(eventos('comprovante_enviado')).toHaveLength(1)
        expect(auditoria('COMPROVANTE_ANEXADO')).toHaveLength(1)
        expect(db.emails).toHaveLength(1)
        expect(db.uploads).toHaveLength(1)

        // terceira chamada: nada muda
        await chamar('POST', caminho, { body: corpo() })
        expect(eventos('comprovante_enviado')).toHaveLength(1)
    })

    it('arquivo sumiu do Storage: a nova chamada sobe de novo e liga pago', async () => {
        const restaurar = falharProximoPago()
        try {
            await chamar('POST', caminho, { body: corpo({ notificar_prestador: false }) })
        } finally {
            restaurar()
        }
        const path = tabela('repasse_comprovantes')[0].storage_path
        db.storage.delete(path)
        const r = await chamar('POST', caminho, { body: corpo({ notificar_prestador: false }) })
        expect(r.status).toBe(200)
        expect(r.corpo.ja_existia).toBe(true)
        expect(db.storage.has(path)).toBe(true)
        expect(Buffer.compare(db.storage.get(path), PDF)).toBe(0)
        expect(db.uploads).toHaveLength(2)
        expect(registro(REG).pago).toBe(true)
    })

    it('não consegue restaurar o arquivo: 5xx claro em vez de ja_existia', async () => {
        const restaurar = falharProximoPago()
        try {
            await chamar('POST', caminho, { body: corpo({ notificar_prestador: false }) })
        } finally {
            restaurar()
        }
        db.storage.clear()
        const original = admin.storage.from
        admin.storage.from = () => ({ ...original(), upload: async () => ({ data: null, error: { message: 'storage fora' } }) })
        try {
            const r = await chamar('POST', caminho, { body: corpo({ notificar_prestador: false }) })
            expect(r.status).toBe(500)
            expect(r.corpo.erro.codigo).toBe('comprovante_inconsistente')
        } finally {
            admin.storage.from = original
        }
    })

    it('insert recusado por duplicidade (23505): devolve a linha da outra chamada, sem e-mail e sem apagar o arquivo', async () => {
        const original = admin.from
        admin.from = (n) => {
            const t = original(n)
            if (n !== 'repasse_comprovantes') return t
            return {
                ...t,
                insert: (linha) => ({
                    select: () => ({
                        maybeSingle: async () => {
                            // a outra chamada, em paralelo, gravou primeiro
                            tabela('repasse_comprovantes').push({ ...linha, id: 'outra', enviado_em: '2026-11-10T11:59:00.000Z' })
                            return { data: null, error: { code: '23505', message: 'duplicate key' } }
                        },
                    }),
                }),
            }
        }
        let r
        try {
            r = await chamar('POST', caminho, { body: corpo() })
        } finally {
            admin.from = original
        }
        expect(r.status).toBe(200)
        expect(r.corpo).toMatchObject({ ja_existia: true, notificado: false, comprovante: { id: 'outra' } })
        expect(db.emails).toHaveLength(0)
        expect(tabela('repasse_comprovantes')).toHaveLength(1)
        expect(db.storage.has(tabela('repasse_comprovantes')[0].storage_path)).toBe(true)
        expect(registro(REG).pago).toBe(true)
        expect(eventos('comprovante_enviado')).toHaveLength(1)
    })
})

describe('DELETE /pagamentos/registros/{id}/pago', () => {
    it('sem motivo (menos de 5 caracteres): 400', async () => {
        await chamar('POST', `/pagamentos/registros/${REG}/pago`)
        const r = await chamar('DELETE', `/pagamentos/registros/${REG}/pago`, { body: { motivo: 'abc' } })
        expect(r.status).toBe(400)
        expect(r.corpo.erro.codigo).toBe('motivo_obrigatorio')
        expect(registro(REG).pago).toBe(true)
    })

    it('com motivo remove o comprovante e desmarca pago, com evento e auditoria', async () => {
        await chamar('POST', `/pagamentos/registros/${REG}/comprovantes`, { body: { arquivo_base64: b64(PDF), data_pagamento: '2026-11-05', valor: 150 } })
        const antes = { ...registro(REG) }
        const r = await chamar('DELETE', `/pagamentos/registros/${REG}/pago`, { body: { motivo: 'pago em duplicidade' } })
        expect(r.status).toBe(200)
        expect(r.corpo).toMatchObject({ comprovantes_removidos: 1, registro: { pago: false } })
        expect(tabela('repasse_comprovantes')).toHaveLength(0)
        expect(registro(REG)).toEqual({ ...antes, pago: false })
        expect(eventos('pagamento_desfeito')).toEqual([expect.objectContaining({ autor: 'api:Financeiro', dados: { motivo: 'pago em duplicidade', origem: 'api' } })])
        expect(auditoria('PAGAMENTO_DESFEITO')[0]).toMatchObject({ valor_antigo: { pago: true }, valor_novo: expect.objectContaining({ pago: false, motivo: 'pago em duplicidade' }) })
    })

    it('registro sem relatório e motivo na query também funciona', async () => {
        await chamar('POST', `/pagamentos/registros/${REG_SEM_REL}/pago`)
        const r = await chamar('DELETE', `/pagamentos/registros/${REG_SEM_REL}/pago`, { query: { motivo: 'lançado errado' } })
        expect(r.status).toBe(200)
        expect(registro(REG_SEM_REL).pago).toBe(false)
    })

    it('registro que não está pago: 409', async () => {
        const r = await chamar('DELETE', `/pagamentos/registros/${REG}/pago`, { body: { motivo: 'qualquer motivo' } })
        expect(r.status).toBe(409)
        expect(r.corpo.erro.codigo).toBe('nao_esta_pago')
    })
})

describe('escopos', () => {
    it('chave só com pagamentos:ler: 403 nas escritas e 200 nas leituras', async () => {
        tabela('api_chaves')[0].escopos = ['pagamentos:ler']
        for (const [m, c] of [['POST', `/pagamentos/registros/${REG}/pago`], ['DELETE', `/pagamentos/registros/${REG}/pago`], ['POST', `/pagamentos/registros/${REG}/comprovantes`]]) {
            const r = await chamar(m, c, { body: { motivo: 'motivo longo' } })
            expect(r.status).toBe(403)
            expect(r.corpo.erro.codigo).toBe('escopo_insuficiente')
        }
        expect(registro(REG).pago).toBe(false)
        expect((await chamar('GET', '/pagamentos/registros')).status).toBe(200)
        expect((await chamar('GET', `/pagamentos/registros/${REG}`)).status).toBe(200)
    })

    it('chave da rede não lê pagamentos', async () => {
        tabela('api_chaves')[0].escopos = ['rede:ler']
        expect((await chamar('GET', '/pagamentos/registros')).status).toBe(403)
    })
})

describe('GET /pagamentos/registros', () => {
    it('lista com filtros, paginação, X-Total-Count e sem campos sensíveis', async () => {
        await chamar('POST', `/pagamentos/registros/${REG}/comprovantes`, { body: { arquivo_base64: b64(PDF), data_pagamento: '2026-11-05', valor: 150 } })
        const r = await chamar('GET', '/pagamentos/registros', { query: { ano: '2026' } })
        expect(r.status).toBe(200)
        expect(r.headers['X-Total-Count']).toBe('2')
        expect(r.headers['Cache-Control']).toBe('no-store')
        expect(r.corpo.map((x) => x.id)).toEqual([REG_SEM_REL, REG])
        expect(r.corpo[1]).toEqual({
            id: REG, competencia: { mes: 10, ano: 2026 }, prestador_id: 7, prestador_nome: 'Clínica X', tipo_repasse: 'rpa', valor: 150,
            pago: true, tem_relatorio: true, tem_comprovante: true,
        })
        expect(r.corpo[0]).toMatchObject({ tem_relatorio: false, tem_comprovante: false })
        const json = JSON.stringify(r.corpo)
        for (const s of ['segredo@pix.com', 'clinica@x.com', 'obs interna', 'comprovante/']) expect(json).not.toContain(s)

        const f = await chamar('GET', '/pagamentos/registros', { query: { mes: '10', pago: 'true', prestador_id: '7' } })
        expect(f.corpo.map((x) => x.id)).toEqual([REG])
        const p = await chamar('GET', '/pagamentos/registros', { query: { por_pagina: '1', pagina: '2' } })
        expect(p.corpo.map((x) => x.id)).toEqual([REG])
        expect(p.headers['X-Total-Count']).toBe('2')
    })

    it('filtro inválido: 400 parametro_invalido', async () => {
        const r = await chamar('GET', '/pagamentos/registros', { query: { mes: '13' } })
        expect(r.status).toBe(400)
        expect(r.corpo.erro.codigo).toBe('parametro_invalido')
    })
})

describe('GET /pagamentos/registros/{id}', () => {
    it('detalhe com comprovantes e eventos, sem PIX, e-mail, caminho nem autor do painel', async () => {
        tabela('repasse_eventos').push({ id: 'e0', relatorio_id: REL, tipo: 'enviado', dados: { para: 'clinica@x.com' }, autor: 'fin@emerdog.com.br', criado_em: '2026-11-01T10:00:00Z' })
        await chamar('POST', `/pagamentos/registros/${REG}/comprovantes`, { body: { arquivo_base64: b64(PDF), data_pagamento: '2026-11-05', valor: 150 } })
        tabela('repasse_eventos')[1].criado_em = '2026-11-05T10:00:00Z'
        const r = await chamar('GET', `/pagamentos/registros/${REG}`)
        expect(r.status).toBe(200)
        expect(r.headers['Cache-Control']).toBe('no-store')
        expect(r.corpo).toMatchObject({ id: REG, pago: true, tem_relatorio: true, tem_comprovante: true })
        expect(r.corpo.comprovantes).toEqual([{ id: tabela('repasse_comprovantes')[0].id, data_pagamento: '2026-11-05', valor: 150, forma: 'pix', enviado_em: '2026-11-10T12:00:00.000Z' }])
        expect(r.corpo.eventos).toEqual([
            { tipo: 'enviado', criado_em: '2026-11-01T10:00:00Z', origem: 'painel' },
            { tipo: 'comprovante_enviado', criado_em: '2026-11-05T10:00:00Z', origem: 'api' },
        ])
        const json = JSON.stringify(r.corpo)
        for (const s of ['segredo@pix.com', 'clinica@x.com', 'fin@emerdog.com.br', 'comprovante/', 'obs interna']) expect(json).not.toContain(s)
    })

    it('registro sem relatório: eventos vêm da auditoria da API', async () => {
        await chamar('POST', `/pagamentos/registros/${REG_SEM_REL}/pago`)
        const r = await chamar('GET', `/pagamentos/registros/${REG_SEM_REL}`)
        expect(r.corpo.tem_relatorio).toBe(false)
        expect(r.corpo.eventos).toEqual([{ tipo: 'pagamento_marcado', criado_em: expect.any(String), origem: 'api' }])
        expect(JSON.stringify(r.corpo)).not.toContain('emer_pag')
    })

    it('inexistente: 404', async () => {
        const r = await chamar('GET', '/pagamentos/registros/44444444-4444-4444-8444-444444444444')
        expect(r.status).toBe(404)
        expect(r.corpo.erro.codigo).toBe('registro_nao_encontrado')
    })
})
