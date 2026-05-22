/**
 * Cliente browser → proxy local `/api/clicksign/*` (token só no servidor).
 * API Clicksign 3.0 — JSON:API (`application/vnd.api+json`).
 */

async function parseJson(res) {
    const text = await res.text()
    let data = {}
    if (text.trim()) {
        try {
            data = JSON.parse(text)
        } catch {
            data = { error: 'Resposta não JSON', raw: text.slice(0, 400) }
        }
    }
    return { ok: res.ok, status: res.status, data }
}

/**
 * @param {string} method
 * @param {string} path - ex. "/envelopes" ou "/envelopes/abc123"
 * @param {object|string|null} body - objeto serializado ou string JSON
 */
export async function clicksignRequest(method, path, body = null) {
    const p = path.startsWith('/') ? path : `/${path}`
    const opts = {
        method,
        headers: { Accept: 'application/vnd.api+json' },
    }
    if (body != null && method !== 'GET' && method !== 'HEAD') {
        opts.headers['Content-Type'] = 'application/vnd.api+json'
        opts.body = typeof body === 'string' ? body : JSON.stringify(body)
    }
    const res = await fetch(`/api/clicksign${p}`, opts)
    return parseJson(res)
}

/** Nome do envelope a partir do ficheiro PDF (sem extensão .pdf). */
export function nomeEnvelopeDoArquivoPdf(fileName) {
    let n = String(fileName || 'documento.pdf').trim()
    if (/\.pdf$/i.test(n)) n = n.slice(0, -4)
    n = n.trim()
    return n || 'Documento'
}

/** Payload mínimo JSON:API para envelope em rascunho. */
export function payloadEnvelopeRascunho(nome, extras = {}) {
    const attrs = {
        name: String(nome || '').trim() || 'Novo envelope',
        locale: 'pt-BR',
        ...extras,
    }
    return {
        data: {
            type: 'envelopes',
            attributes: attrs,
        },
    }
}

/** Ativa envelope (draft → running). Requer requisitos configurados na conta. */
export function payloadAtivarEnvelope(envelopeId) {
    const id = String(envelopeId || '').trim()
    return {
        data: {
            id,
            type: 'envelopes',
            attributes: {
                status: 'running',
            },
        },
    }
}

/**
 * Cancela um documento em progresso (PATCH documento).
 * @see https://developers.clicksign.com/reference/editar-documento
 */
export function payloadCancelarDocumento(documentId) {
    const id = String(documentId || '').trim()
    return {
        data: {
            id,
            type: 'documents',
            attributes: {
                status: 'canceled',
            },
        },
    }
}

/**
 * Cancela envelope em processo: na API 3.0 o PATCH do envelope só aceita status draft|running.
 * O cancelamento invalida cada documento com status running → canceled.
 */
export async function cancelarEnvelopeClicksign(envelopeId, clickReq = clicksignRequest) {
    const eid = String(envelopeId || '').trim()
    if (!eid) {
        return { ok: false, status: 0, data: { error: 'ID do envelope inválido.' }, canceledCount: 0 }
    }

    const list = await clickReq('GET', `/envelopes/${encodeURIComponent(eid)}/documents`)
    if (!list.ok) {
        return { ...list, canceledCount: 0 }
    }

    const docs = extrairListaDocumentos(list.data)
    if (docs.length === 0) {
        return { ok: false, status: 404, data: { error: 'Envelope sem documentos.' }, canceledCount: 0 }
    }

    const paraCancelar = docs.filter((d) => envelopeStatusNormalizado(d.status) === 'running')
    if (paraCancelar.length === 0) {
        const todosTerminais = docs.every((d) => {
            const st = envelopeStatusNormalizado(d.status)
            return st === 'canceled' || st === 'cancelled' || st === 'closed'
        })
        if (todosTerminais) {
            return { ok: true, status: 200, data: {}, canceledCount: 0, alreadyCanceled: true }
        }
        return {
            ok: false,
            status: 422,
            data: { error: 'Nenhum documento em progresso para cancelar (status running).' },
            canceledCount: 0,
        }
    }

    let canceledCount = 0
    for (const doc of paraCancelar) {
        const docId = String(doc.id || '').trim()
        if (!docId) continue
        const patch = await clickReq(
            'PATCH',
            `/envelopes/${encodeURIComponent(eid)}/documents/${encodeURIComponent(docId)}`,
            payloadCancelarDocumento(docId),
        )
        if (!patch.ok) {
            return { ...patch, canceledCount, failedDocumentId: docId, failedFilename: doc.filename }
        }
        canceledCount += 1
    }

    return { ok: true, status: 200, data: {}, canceledCount }
}

export function envelopeStatusNormalizado(status) {
    return String(status ?? '')
        .trim()
        .toLowerCase()
}

/** Nome de ficheiro seguro para JSON (ASCII) — evita falhas em proxies / API. */
export function nomeArquivoPdfSeguro(name) {
    const n = String(name || 'documento.pdf').trim() || 'documento.pdf'
    const ascii = n
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._\-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
    const out = (ascii || 'documento').slice(0, 180)
    return out.toLowerCase().endsWith('.pdf') ? out : `${out || 'documento'}.pdf`
}

/**
 * Upload de PDF em Base64.
 * A API Clicksign v3 exige `content_base64` como **Data URI completo** (ex.: `data:application/pdf;base64,...`).
 * Aceita Data URI (FileReader), `data:application/octet-stream;base64,...` ou base64 cru — normaliza para `application/pdf`.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.includeEnvelopeRelationship] — Se `true`, inclui `relationships.envelope`.
 *   Por defeito **não** inclui (POST já é `/envelopes/:id/documents`); incluir pode provocar 500 em alguns ambientes.
 */
export function payloadDocumentoPdf(envelopeId, filename, base64SemPrefixoOuDataUri, opts = {}) {
    const id = String(envelopeId || '').trim()
    const includeEnvelopeRelationship = opts.includeEnvelopeRelationship === true
    let s = String(base64SemPrefixoOuDataUri || '').trim().replace(/\s/g, '')
    const m = /^data:[^;]+;base64,(.+)$/is.exec(s)
    if (m) {
        s = `data:application/pdf;base64,${m[1]}`
    } else if (s && !/^data:/i.test(s)) {
        s = `data:application/pdf;base64,${s}`
    }
    const data = {
        type: 'documents',
        attributes: {
            filename: nomeArquivoPdfSeguro(filename),
            content_base64: s,
        },
    }
    if (includeEnvelopeRelationship && id) {
        data.relationships = {
            envelope: {
                data: { type: 'envelopes', id },
            },
        }
    }
    return { data }
}

/** @deprecated mesmo que {@link payloadDocumentoPdf} (sempre Data URI). */
export const payloadDocumentoPdfDataUri = payloadDocumentoPdf

/**
 * Papéis para requisito de qualificação (atributo `role` em POST …/requirements).
 * Lista fixa Emerdog — valores oficiais Clicksign: https://developers.clicksign.com/v3.0/docs/adicionar-requisito-de-qualificacao
 */
export const PAPEIS_SIGNATARIO_CLICKSIGN = [
    { value: 'contractee', label: 'Contratada' },
    { value: 'contractor', label: 'Contratante' },
    { value: 'detracted', label: 'Distratada' },
    { value: 'distracting', label: 'Distratante' },
    { value: 'employee', label: 'Empregado(a)' },
    { value: 'employer', label: 'Empregador(a)' },
    { value: 'witness', label: 'Testemunha' },
    { value: 'sign', label: 'Assinar' },
]

/** Garante `role` permitido na lista Emerdog (contactos antigos da agenda podem ter outro valor). */
export function normalizarPapelQualificacao(p) {
    const v = String(p || '').trim()
    return PAPEIS_SIGNATARIO_CLICKSIGN.some((x) => x.value === v) ? v : 'sign'
}

/** Rótulo em português para o valor `role` da API (ou «—» se vazio). */
export function rotuloPapelQualificacao(role) {
    const v = String(role || '').trim()
    if (!v) return '—'
    const p = PAPEIS_SIGNATARIO_CLICKSIGN.find((x) => x.value === v)
    return p ? p.label : v
}

function signerIdDoRequisito(item) {
    const rel = item?.relationships?.signer
    const d = rel?.data
    if (Array.isArray(d) && d[0] && d[0].id) return String(d[0].id).trim()
    if (d && typeof d === 'object' && d.id) return String(d.id).trim()
    const related = rel?.links?.related
    if (typeof related === 'string') {
        const m = /signers\/([a-f0-9-]{36})/i.exec(related)
        if (m) return m[1]
    }
    const self = rel?.links?.self
    if (typeof self === 'string') {
        const m = /signers\/([a-f0-9-]{36})/i.exec(self)
        if (m) return m[1]
    }
    return ''
}

function roleDoAtributosRequisito(a) {
    if (!a || typeof a !== 'object') return ''
    return String(
        a.role || a.qualification_role || a?.schema?.role || a?.qualification?.role || a?.data?.role || '',
    ).trim()
}

function isRequisitoQualificacaoItem(item) {
    const a = item?.attributes || {}
    const action = String(a.action || '').toLowerCase()
    return action === 'agree' || Boolean(roleDoAtributosRequisito(a))
}

function isRequisitoAutenticacaoItem(item) {
    const a = item?.attributes || {}
    const action = String(a.action || '').toLowerCase()
    const auth = String(a.auth || a.authentication || a.evidence_provider || '').trim()
    return action === 'provide_evidence' || action === 'authenticate' || auth.length > 0
}

/** GET …/requirements com paginação e `include` (signatário + documento) quando suportado. */
export function pathListagemRequisitosEnvelope(envelopeId, opts = {}) {
    const eid = String(envelopeId || '').trim()
    const base = `/envelopes/${encodeURIComponent(eid)}/requirements`
    const qs = new URLSearchParams()
    qs.set('page[number]', String(opts.pageNumber ?? 1))
    qs.set('page[size]', String(opts.pageSize ?? 50))
    if (opts.include !== false) {
        qs.set('include', 'signer,document')
    }
    return `${base}?${qs.toString()}`
}

/**
 * A listagem da Clicksign muitas vezes não traz `relationships` nos itens; usa `included` ou `links.related`.
 */
export function normalizarRespostaRequisitos(json) {
    if (!json || typeof json !== 'object') return json

    let dataArr = Array.isArray(json.data) ? [...json.data] : json.data ? [json.data] : []

    const included = Array.isArray(json.included) ? json.included : []
    if (included.length > 0) {
        const index = new Map()
        for (const res of included) {
            if (res?.type && res?.id) index.set(`${res.type}:${res.id}`, res)
        }
        const hydrateRef = (ref) => {
            if (!ref || typeof ref !== 'object' || !ref.type || !ref.id) return ref
            const full = index.get(`${ref.type}:${ref.id}`)
            return full ? { type: ref.type, id: ref.id } : ref
        }
        dataArr = dataArr.map((item) => {
            if (!item?.relationships) return item
            const rel = { ...item.relationships }
            for (const key of Object.keys(rel)) {
                const block = rel[key]
                if (!block?.data) continue
                if (Array.isArray(block.data)) {
                    rel[key] = { ...block, data: block.data.map(hydrateRef) }
                } else {
                    rel[key] = { ...block, data: hydrateRef(block.data) }
                }
            }
            return { ...item, relationships: rel }
        })
    }

    dataArr = dataArr.map((item) => {
        if (!item) return item
        const relIn = item.relationships || {}
        const rel = { ...relIn }
        let changed = false
        for (const [key, typeName, pattern] of [
            ['signer', 'signers', /signers\/([a-f0-9-]{36})/i],
            ['document', 'documents', /documents\/([a-f0-9-]{36})/i],
        ]) {
            const block = rel[key]
            if (!block) continue
            if (block.data?.id) continue
            const related = block.links?.related
            if (typeof related !== 'string') continue
            const m = pattern.exec(related)
            if (!m) continue
            rel[key] = { ...block, data: { type: typeName, id: m[1] } }
            changed = true
        }
        return changed ? { ...item, relationships: rel } : item
    })

    return { ...json, data: Array.isArray(json.data) ? dataArr : dataArr[0] ?? json.data }
}

export async function obterRequisitosEnvelope(clickReq, envelopeId) {
    const eid = String(envelopeId || '').trim()
    let res = await clickReq('GET', pathListagemRequisitosEnvelope(eid))
    if (!res.ok && (res.status === 400 || res.status === 404)) {
        res = await clickReq('GET', pathListagemRequisitosEnvelope(eid, { include: false }))
    }
    if (!res.ok) return res
    return { ...res, data: normalizarRespostaRequisitos(res.data) }
}

export function contagemRequisitosPorTipo(requirementsJson) {
    const arr = Array.isArray(requirementsJson?.data)
        ? requirementsJson.data
        : requirementsJson?.data
          ? [requirementsJson.data]
          : []
    let qual = 0
    let auth = 0
    for (const item of arr) {
        if (isRequisitoQualificacaoItem(item)) qual += 1
        else if (isRequisitoAutenticacaoItem(item)) auth += 1
    }
    return { qual, auth }
}

/** Um requisito de qualificação + um de autenticação por par documento×signatário. */
export function matrizRequisitosPareceCompleta(requirementsJson, docCount, signerCount) {
    const need = Math.max(0, docCount) * Math.max(0, signerCount)
    if (need === 0) return false
    const { qual, auth } = contagemRequisitosPorTipo(requirementsJson)
    return qual >= need && auth >= need
}

/**
 * A partir de GET `/envelopes/:id/requirements`: mapa signerId → valor `role` do requisito de qualificação.
 * Aceita vínculos `relationships.signer` em vários formatos JSON:API e `attributes.role` (ou variantes).
 */
export function extrairRolesQualificacaoPorSignatario(json) {
    /** @type {Record<string, string>} */
    const bySigner = {}
    const arr = Array.isArray(json?.data) ? json.data : json?.data ? [json.data] : []
    for (const item of arr) {
        const a = item?.attributes || {}
        const role = roleDoAtributosRequisito(a)
        if (!role) continue
        const sid = signerIdDoRequisito(item)
        if (!sid) continue
        bySigner[sid] = role
    }
    return bySigner
}

/** Junta signatários com o rótulo de qualificação lido dos requisitos (vazio se não existir na API). */
export function mergeSignersWithQualificationLabels(signersJson, requirementsJson) {
    const rows = extrairListaSignatarios(signersJson)
    const roles = requirementsJson ? extrairRolesQualificacaoPorSignatario(requirementsJson) : {}
    return rows.map((s) => ({
        ...s,
        qualificationLabel: roles[s.id] ? rotuloPapelQualificacao(roles[s.id]) : '',
    }))
}

function documentIdDoRequisito(item) {
    const rel = item?.relationships?.document
    const d = rel?.data
    if (Array.isArray(d) && d[0] && d[0].id) return String(d[0].id).trim()
    if (d && typeof d === 'object' && d.id) return String(d.id).trim()
    const related = rel?.links?.related
    if (typeof related === 'string') {
        const m = /documents\/([a-f0-9-]{36})/i.exec(related)
        if (m) return m[1]
    }
    const self = rel?.links?.self
    if (typeof self === 'string') {
        const m = /documents\/([a-f0-9-]{36})/i.exec(self)
        if (m) return m[1]
    }
    return ''
}

/** Conjunto `documentId|signerId` já coberto por requisito de qualificação (com `role`). */
export function paresQualificacaoExistentes(requirementsJson) {
    /** @type {Set<string>} */
    const set = new Set()
    const arr = Array.isArray(requirementsJson?.data)
        ? requirementsJson.data
        : requirementsJson?.data
          ? [requirementsJson.data]
          : []
    for (const item of arr) {
        if (!isRequisitoQualificacaoItem(item)) continue
        const sid = signerIdDoRequisito(item)
        const did = documentIdDoRequisito(item)
        if (sid && did) set.add(`${did}|${sid}`)
    }
    return set
}

export function requisitoDuplicadoOuConflito(rq) {
    if (rq.ok) return false
    if (rq.status !== 422) return false
    const s = JSON.stringify(rq.data || {}).toLowerCase()
    return (
        s.includes('duplic') ||
        s.includes('already') ||
        s.includes('taken') ||
        s.includes('exist') ||
        s.includes('já existe') ||
        s.includes('já foi') ||
        s.includes('unique') ||
        s.includes('único') ||
        s.includes('registrad') ||
        s.includes('conflit') ||
        s.includes('permitid') ||
        s.includes('não pode') ||
        s.includes('nao pode') ||
        s.includes('inválid') ||
        s.includes('invalid') ||
        s.includes('já possui')
    )
}

export function erroApiTexto(data) {
    if (!data) return '—'
    if (data.error) return String(data.error)
    if (Array.isArray(data.errors) && data.errors.length > 0) {
        return data.errors
            .map((e) => String(e?.detail || e?.title || '').trim())
            .filter(Boolean)
            .join(' ')
    }
    return JSON.stringify(data).slice(0, 500)
}

export function inferirAuthDoSignatario(sig) {
    const em = String(sig?.email || '').trim().toLowerCase()
    const ph = String(sig?.phone || '').replace(/\D/g, '')
    if (em && em !== '—') return 'email'
    if (ph.length >= 10) return 'whatsapp'
    return 'email'
}

/**
 * Cria requisitos de qualificação em falta (cada par documento×signatário).
 * @param {(m: string, p: string, b?: object) => Promise<{ ok: boolean, status: number, data: object }>} clickReq
 */
export async function garantirRequisitosQualificacaoCobertos(clickReq, envelopeId) {
    const eid = String(envelopeId || '').trim()
    /** @type {Array<{ status: number, data: object }>} */
    const falhas = []
    if (!eid) return { criados: 0, falhas, erroListagem: true }

    const [d1, d2, d3] = await Promise.all([
        clickReq('GET', `/envelopes/${encodeURIComponent(eid)}/documents`),
        clickReq('GET', `/envelopes/${encodeURIComponent(eid)}/signers`),
        obterRequisitosEnvelope(clickReq, eid),
    ])
    if (!d1.ok || !d2.ok) return { criados: 0, falhas, erroListagem: true }

    const docs = extrairListaDocumentos(d1.data)
    const sigs = extrairListaSignatarios(d2.data)
    const reqJson = d3.ok ? d3.data : null

    const docElegivel = (d) => {
        const st = String(d.status || '').toLowerCase()
        if (st === 'canceled' || st === 'cancelled' || st === 'failed' || st === 'error') return false
        return true
    }

    const docsAtivos = docs.filter(docElegivel)
    if (reqJson && matrizRequisitosPareceCompleta(reqJson, docsAtivos.length, sigs.length)) {
        return { criados: 0, falhas: [], erroListagem: false }
    }

    const covered = paresQualificacaoExistentes(reqJson)
    const rolesBySigner = extrairRolesQualificacaoPorSignatario(reqJson)

    let criados = 0
    for (const doc of docs) {
        if (!docElegivel(doc)) continue
        const docId = String(doc.id || '').trim()
        if (!docId) continue
        for (const sig of sigs) {
            const signerId = String(sig.id || '').trim()
            if (!signerId) continue
            const key = `${docId}|${signerId}`
            if (covered.has(key)) continue
            const role = normalizarPapelQualificacao(rolesBySigner[signerId] || 'sign')
            const body = payloadRequisitoQualificacao(eid, { documentId: docId, signerId, role })
            const rq = await clickReq('POST', `/envelopes/${encodeURIComponent(eid)}/requirements`, body)
            if (rq.ok || requisitoDuplicadoOuConflito(rq)) {
                covered.add(key)
                if (rq.ok) criados += 1
                continue
            }
            falhas.push({ status: rq.status, data: rq.data })
            return { criados, falhas, erroListagem: false }
        }
    }
    return { criados, falhas, erroListagem: false }
}

/** Pares documento×signatário que já têm requisito de autenticação. */
export function paresAutenticacaoExistentes(requirementsJson) {
    /** @type {Set<string>} */
    const set = new Set()
    const arr = Array.isArray(requirementsJson?.data)
        ? requirementsJson.data
        : requirementsJson?.data
          ? [requirementsJson.data]
          : []
    for (const item of arr) {
        const a = item?.attributes || {}
        const action = String(a.action || '').toLowerCase()
        const auth = String(a.auth || a.authentication || a.evidence_provider || '').trim()
        const isAuth =
            action === 'provide_evidence' || action === 'authenticate' || auth.length > 0
        if (!isAuth) continue
        const sid = signerIdDoRequisito(item)
        const did = documentIdDoRequisito(item)
        if (sid && did) set.add(`${did}|${sid}`)
    }
    return set
}

/** POST …/requirements — autenticação (e-mail ou WhatsApp), conforme guia API 3.0. */
export function payloadRequisitoAutenticacao(_envelopeId, { documentId, signerId, auth = 'email' }) {
    const docId = String(documentId || '').trim()
    const sigId = String(signerId || '').trim()
    const metodo = auth === 'whatsapp' ? 'whatsapp' : 'email'
    return {
        data: {
            type: 'requirements',
            attributes: {
                action: 'provide_evidence',
                auth: metodo,
            },
            relationships: {
                document: { data: { type: 'documents', id: docId } },
                signer: { data: { type: 'signers', id: sigId } },
            },
        },
    }
}

/**
 * Cria requisitos de autenticação em falta (um por par documento×signatário).
 * @param {(m: string, p: string, b?: object) => Promise<{ ok: boolean, status: number, data: object }>} clickReq
 */
export async function garantirRequisitosAutenticacaoCobertos(clickReq, envelopeId) {
    const eid = String(envelopeId || '').trim()
    /** @type {Array<{ status: number, data: object }>} */
    const falhas = []
    if (!eid) return { criados: 0, falhas, erroListagem: true }

    const [d1, d2, d3] = await Promise.all([
        clickReq('GET', `/envelopes/${encodeURIComponent(eid)}/documents`),
        clickReq('GET', `/envelopes/${encodeURIComponent(eid)}/signers`),
        obterRequisitosEnvelope(clickReq, eid),
    ])
    if (!d1.ok || !d2.ok) return { criados: 0, falhas, erroListagem: true }

    const docs = extrairListaDocumentos(d1.data)
    const sigs = extrairListaSignatarios(d2.data)
    const reqJson = d3.ok ? d3.data : null

    const docElegivel = (d) => {
        const st = String(d.status || '').toLowerCase()
        if (st === 'canceled' || st === 'cancelled' || st === 'failed' || st === 'error') return false
        return true
    }

    const docsAtivos = docs.filter(docElegivel)
    if (reqJson && matrizRequisitosPareceCompleta(reqJson, docsAtivos.length, sigs.length)) {
        return { criados: 0, falhas: [], erroListagem: false }
    }

    const covered = paresAutenticacaoExistentes(reqJson)

    let criados = 0
    for (const doc of docs) {
        if (!docElegivel(doc)) continue
        const docId = String(doc.id || '').trim()
        if (!docId) continue
        for (const sig of sigs) {
            const signerId = String(sig.id || '').trim()
            if (!signerId) continue
            const key = `${docId}|${signerId}`
            if (covered.has(key)) continue
            const auth = inferirAuthDoSignatario(sig)
            const body = payloadRequisitoAutenticacao(eid, { documentId: docId, signerId, auth })
            const rq = await clickReq('POST', `/envelopes/${encodeURIComponent(eid)}/requirements`, body)
            if (rq.ok || requisitoDuplicadoOuConflito(rq)) {
                covered.add(key)
                if (rq.ok) criados += 1
                continue
            }
            falhas.push({ status: rq.status, data: rq.data })
            return { criados, falhas, erroListagem: false }
        }
    }
    return { criados, falhas, erroListagem: false }
}

/** Qualificação + autenticação antes de ativar o envelope. */
export async function garantirRequisitosCompletosAntesAtivar(clickReq, envelopeId) {
    const qual = await garantirRequisitosQualificacaoCobertos(clickReq, envelopeId)
    if (qual.erroListagem || qual.falhas.length > 0) {
        return {
            criadosQual: qual.criados,
            criadosAuth: 0,
            falhas: qual.falhas,
            erroListagem: qual.erroListagem,
            etapa: 'qualificacao',
        }
    }
    const auth = await garantirRequisitosAutenticacaoCobertos(clickReq, envelopeId)
    if (auth.erroListagem || auth.falhas.length > 0) {
        return {
            criadosQual: qual.criados,
            criadosAuth: auth.criados,
            falhas: auth.falhas,
            erroListagem: auth.erroListagem,
            etapa: 'autenticacao',
        }
    }
    return {
        criadosQual: qual.criados,
        criadosAuth: auth.criados,
        falhas: [],
        erroListagem: false,
        etapa: null,
    }
}

/** POST /envelopes/:id/requirements — qualificação (quem assina em que papel, em que documento). */
export function payloadRequisitoQualificacao(_envelopeId, { documentId, signerId, role }) {
    const docId = String(documentId || '').trim()
    const sigId = String(signerId || '').trim()
    const r = String(role || 'sign').trim() || 'sign'
    return {
        data: {
            type: 'requirements',
            attributes: {
                action: 'agree',
                role: r,
            },
            relationships: {
                document: {
                    data: { type: 'documents', id: docId },
                },
                signer: {
                    data: { type: 'signers', id: sigId },
                },
            },
        },
    }
}

/** Normaliza telefone BR para 10 ou 11 dígitos (só números), conforme API. */
export function normalizarTelefoneBr(valor) {
    let d = String(valor || '').replace(/\D/g, '')
    if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
    return d
}

/**
 * Signatário: canal e-mail ou WhatsApp.
 * Payload mínimo para POST `/envelopes/:envelope_id/signers`.
 * O envelope já está no path — **não** enviar `relationships.envelope` (a Clicksign pode responder 400
 * com mensagem do tipo «type não está disponível» ao validar o vínculo em duplicado).
 * O papel jurídico (Contratante, etc.) define-se no requisito de qualificação (POST …/requirements).
 * @param {'email'|'whatsapp'} channel
 */
export function payloadSignatario(_envelopeId, { name, email, phone, channel = 'email' }) {
    const nome = String(name || '').trim()
    const attrs = {
        name: nome,
    }
    if (channel === 'whatsapp') {
        const tel = normalizarTelefoneBr(phone)
        attrs.phone_number = tel
        const em = String(email || '').trim().toLowerCase()
        if (em) attrs.email = em
    } else {
        attrs.email = String(email || '').trim().toLowerCase()
    }
    return {
        data: {
            type: 'signers',
            attributes: attrs,
        },
    }
}

/** @deprecated use payloadSignatario com channel email */
export function payloadSignatarioEmail(envelopeId, nome, email) {
    return payloadSignatario(envelopeId, { name: nome, email, channel: 'email' })
}

/** Remove prefixo data:application/pdf;base64, se existir. */
export function stripBase64Prefix(dataUrlOuBase64) {
    const s = String(dataUrlOuBase64 || '').trim()
    if (!s) return ''
    const m = /^data:application\/pdf[^,]*base64,(.+)$/is.exec(s)
    return (m ? m[1] : s).replace(/\s/g, '')
}

/** Intervalo ISO (início,fim) do mês civil corrente em UTC — query filter[created]. */
export function intervaloCriacaoMesAtualUtc() {
    const now = new Date()
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0))
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999))
    return `${start.toISOString()},${end.toISOString()}`
}

/** Intervalo ISO dos últimos 30 dias (UTC) — query filter[created]. */
export function intervaloCriacaoUltimos30DiasUtc() {
    const end = new Date()
    const start = new Date(end.getTime())
    start.setUTCDate(start.getUTCDate() - 30)
    start.setUTCHours(0, 0, 0, 0)
    end.setUTCHours(23, 59, 59, 999)
    return `${start.toISOString()},${end.toISOString()}`
}

/** Monta query string de listagem de envelopes. */
export function montarPathListagemEnvelopes({ pageNumber = 1, pageSize = 20, filterStatus = '', filterCreated = '', filterName = '' } = {}) {
    const q = new URLSearchParams()
    q.set('page[number]', String(pageNumber))
    q.set('page[size]', String(pageSize))
    if (filterStatus) q.set('filter[status]', filterStatus)
    if (filterCreated) q.set('filter[created]', filterCreated)
    if (filterName) q.set('filter[name]', filterName)
    return `/envelopes?${q.toString()}`
}

/** Nome com pelo menos duas palavras (requisito comum da API Clicksign). */
export function nomeSignatarioValido(nome) {
    const parts = String(nome || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
    return parts.length >= 2
}

/** Extrai linhas de lista a partir da resposta JSON:API. */
export function extrairListaEnvelopes(json) {
    const rows = []
    const arr = Array.isArray(json?.data) ? json.data : json?.data ? [json.data] : []
    for (const item of arr) {
        const id = item?.id ?? ''
        const a = item?.attributes || {}
        rows.push({
            id,
            name: a.name ?? a.title ?? '—',
            status: a.status ?? a.state ?? '—',
            created: a.created ?? a.created_at ?? '',
            updated: a.modified ?? a.updated_at ?? a.modified_at ?? a.created ?? '',
        })
    }
    return { rows, meta: json?.meta || {}, links: json?.links || {} }
}

/** Lista simples de documentos (GET …/documents). */
export function extrairListaDocumentos(json) {
    const rows = []
    const arr = Array.isArray(json?.data) ? json.data : json?.data ? [json.data] : []
    for (const item of arr) {
        const a = item?.attributes || {}
        const files = urlsArquivosDocumento(item)
        rows.push({
            id: item?.id ?? '',
            filename: a.filename ?? a.name ?? '—',
            status: a.status ?? '—',
            fileOriginal: files.original,
            fileSigned: files.signed,
        })
    }
    return rows
}

function hrefDeLinkArquivo(link) {
    if (!link) return ''
    if (typeof link === 'string') return link.trim()
    return String(link.href || link.url || link.download || '').trim()
}

export function urlsArquivosDocumento(item) {
    const a = item?.attributes || {}
    const l = item?.links || {}
    const f = l.files || a.files || {}
    const original =
        hrefDeLinkArquivo(f.original) ||
        hrefDeLinkArquivo(f.url) ||
        hrefDeLinkArquivo(a.download_url) ||
        hrefDeLinkArquivo(a.original_file_url) ||
        hrefDeLinkArquivo(l.download)
    const signed =
        hrefDeLinkArquivo(f.signed) ||
        hrefDeLinkArquivo(f.signed_url) ||
        hrefDeLinkArquivo(f.signed_file) ||
        hrefDeLinkArquivo(a.signed_file_url) ||
        hrefDeLinkArquivo(a.signed_url)
    return { original, signed }
}

/** URL preferida para abrir/visualizar PDF no browser (assinado se existir, senão original). */
export function urlVisualizarDocumento(doc) {
    if (!doc || typeof doc !== 'object') return ''
    const signed = String(doc.fileSigned || '').trim()
    const original = String(doc.fileOriginal || '').trim()
    const st = envelopeStatusNormalizado(doc.status)
    if (signed && (st === 'closed' || st === 'running')) return signed
    return original || signed
}

/** URL local (proxy com token) para visualizar PDF no browser. */
export function urlVisualizarDocumentoProxy(envelopeId, documentId, variant = 'auto') {
    const eid = String(envelopeId || '').trim()
    const did = String(documentId || '').trim()
    if (!eid || !did) return ''
    const q = new URLSearchParams({ envelopeId: eid, documentId: did, variant })
    return `/api/clicksign-download?${q.toString()}`
}

export function abrirVisualizacaoDocumento(envelopeId, doc, opts = {}) {
    const eid = String(envelopeId || opts.envelopeId || '').trim()
    const did = String(doc?.id || '').trim()
    if (!eid || !did) return { ok: false, reason: 'missing_id' }
    const direct = urlVisualizarDocumento(doc)
    if (direct && /^https?:\/\//i.test(direct) && !direct.includes('/api/v3')) {
        window.open(direct, '_blank', 'noopener,noreferrer')
        return { ok: true, mode: 'direct' }
    }
    const proxied = urlVisualizarDocumentoProxy(eid, did, opts.variant || 'auto')
    window.open(proxied, '_blank', 'noopener,noreferrer')
    return { ok: true, mode: 'proxy' }
}

export function rotuloEstadoDocumento(status) {
    const st = String(status ?? '')
        .trim()
        .toLowerCase()
    const map = {
        draft: 'Rascunho',
        running: 'Em processo',
        closed: 'Finalizado',
        canceled: 'Cancelado',
        cancelled: 'Cancelado',
    }
    return map[st] || (st ? st : '—')
}

/** Origem do app Clicksign (sandbox vs produção) — opcional VITE_CLICKSIGN_API_BASE no build. */
export function clicksignAppOrigin() {
    const apiBase = String(
        typeof import.meta !== 'undefined' ? import.meta.env.VITE_CLICKSIGN_API_BASE || '' : '',
    )
        .trim()
        .replace(/\/$/, '')
    if (apiBase) {
        try {
            const u = new URL(apiBase.includes('://') ? apiBase : `https://${apiBase}`)
            return u.origin
        } catch {
            /* ignore */
        }
    }
    return 'https://sandbox.clicksign.com'
}

/** URL para abrir o envelope no site Clicksign (origem inferida do link da API). */
export function urlAbrirEnvelopeClicksign(envelopeId, selfLink) {
    const id = String(envelopeId || '').trim()
    const link = String(selfLink || '').trim()
    if (link) {
        try {
            const u = new URL(link)
            return `${u.origin}/envelopes/${id}`
        } catch {
            /* ignore */
        }
    }
    return `${clicksignAppOrigin()}/envelopes/${id}`
}

export function dataEncerramentoEnvelope(attrs) {
    const a = attrs || {}
    const st = envelopeStatusNormalizado(a.status ?? a.state)
    if (st === 'closed') {
        return a.closed_at ?? a.finished_at ?? a.completed_at ?? a.modified ?? a.updated_at ?? ''
    }
    if (st === 'canceled' || st === 'cancelled') {
        return a.canceled_at ?? a.cancelled_at ?? a.modified ?? a.updated_at ?? ''
    }
    return ''
}

export function rotuloDataEncerramentoEnvelope(status) {
    const st = envelopeStatusNormalizado(status)
    if (st === 'closed') return 'Finalizado em'
    if (st === 'canceled' || st === 'cancelled') return 'Cancelado em'
    return ''
}

/** Signatário já tem papel de qualificação neste envelope (qualquer documento). */
export function signatarioPossuiQualificacao(rolesBySigner, signerId) {
    const sid = String(signerId || '').trim()
    if (!sid) return false
    return Boolean(String(rolesBySigner[sid] || '').trim())
}

export function rotuloMeioContatoSignatario(sig, authInferido) {
    const em = String(sig?.email || '').trim()
    const ph = String(sig?.phone || '').replace(/\D/g, '')
    if (authInferido === 'whatsapp' || (ph.length >= 10 && (!em || em === '—'))) {
        return ph.length >= 10 ? `WhatsApp · ${sig.phone}` : 'WhatsApp'
    }
    if (em && em !== '—') return `E-mail · ${em}`
    return '—'
}

export function rotuloAssinaturaSignatario(attrs) {
    const a = attrs || {}
    const st = String(a.status ?? '').toLowerCase()
    const signed = a.signed_at ?? a.signed ?? a.signature_finished_at ?? a.completed_at
    if (signed) return formatarDataIsoPtBr(signed)
    if (st === 'signed' || st === 'completed' || st === 'closed') return 'Assinado'
    if (st === 'refused' || st === 'rejected') return 'Recusado'
    return 'Pendente'
}

function formatarDataIsoPtBr(iso) {
    if (!iso) return '—'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return String(iso)
    const pad = (n) => String(n).padStart(2, '0')
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Preenche URLs de download quando a listagem não traz `links.files`. */
export async function enriquecerDocumentosComArquivos(clickReq, envelopeId, docs) {
    const eid = String(envelopeId || '').trim()
    const lista = Array.isArray(docs) ? docs : []
    if (!eid || lista.length === 0) return lista

    const out = []
    for (const d of lista) {
        if (d.fileOriginal || d.fileSigned) {
            out.push(d)
            continue
        }
        const docId = String(d.id || '').trim()
        if (!docId) {
            out.push(d)
            continue
        }
        const one = await clickReq('GET', `/envelopes/${encodeURIComponent(eid)}/documents/${encodeURIComponent(docId)}`)
        if (one.ok) {
            const extra = extrairListaDocumentos({ data: one.data?.data })
            out.push(extra[0] ? { ...d, ...extra[0] } : d)
        } else {
            out.push(d)
        }
    }
    return out
}

/**
 * Signatários com qualificação (requirements) e rótulo de assinatura.
 * @param {object|null} signersJson
 * @param {object|null} requirementsJson — normalizado
 * @param {Record<string, object>} [signerItemsById] — item JSON:API bruto por id
 */
export function montarLinhasSignatariosDetalhe(signersJson, requirementsJson, signerItemsById = {}) {
    const rows = extrairListaSignatarios(signersJson)
    const roles = requirementsJson ? extrairRolesQualificacaoPorSignatario(requirementsJson) : {}
    const authBySigner = {}
    const arrReq = Array.isArray(requirementsJson?.data)
        ? requirementsJson.data
        : requirementsJson?.data
          ? [requirementsJson.data]
          : []
    for (const item of arrReq) {
        if (!isRequisitoAutenticacaoItem(item)) continue
        const sid = signerIdDoRequisito(item)
        if (!sid) continue
        const a = item?.attributes || {}
        authBySigner[sid] = String(a.auth || 'email').toLowerCase() === 'whatsapp' ? 'whatsapp' : 'email'
    }
    return rows.map((s) => {
        const raw = signerItemsById[s.id]
        const attrs = raw?.attributes || {}
        const auth = authBySigner[s.id] || inferirAuthDoSignatario(s)
        return {
            ...s,
            qualificationLabel: roles[s.id] ? rotuloPapelQualificacao(roles[s.id]) : '—',
            contactLabel: rotuloMeioContatoSignatario(s, auth),
            signatureLabel: rotuloAssinaturaSignatario(attrs),
        }
    })
}

/** Lista simples de signatários (GET …/signers). */
export function extrairListaSignatarios(json) {
    const rows = []
    const arr = Array.isArray(json?.data) ? json.data : json?.data ? [json.data] : []
    for (const item of arr) {
        const a = item?.attributes || {}
        rows.push({
            id: item?.id ?? '',
            name: a.name ?? a.full_name ?? '—',
            email: a.email ?? '—',
            phone: a.phone_number ?? a.phone ?? '—',
            status: a.status ?? '—',
            rawAttributes: a,
        })
    }
    return rows
}

/** Tenta extrair números úteis do meta (cota, uso) quando a API os enviar. */
export function extrairIndicadoresMeta(meta) {
    const m = meta && typeof meta === 'object' ? meta : {}
    const keys = [
        'envelope_quota',
        'envelopes_quota',
        'remaining_envelopes',
        'available_envelopes',
        'used_envelopes',
        'envelopes_used',
        'plan_limit',
        'limit',
    ]
    const out = {}
    for (const k of keys) {
        if (m[k] != null && m[k] !== '') out[k] = m[k]
    }
    return out
}

/** Converte URL absoluta da Clicksign (links.*) em path relativo ao proxy (/envelopes?...). */
export function pathFromClicksignLink(fullUrl) {
    if (!fullUrl || typeof fullUrl !== 'string') return null
    try {
        const u = new URL(fullUrl)
        const marker = '/api/v3'
        const idx = u.pathname.indexOf(marker)
        if (idx === -1) return null
        return `${u.pathname.slice(idx + marker.length)}${u.search || ''}`
    } catch {
        return null
    }
}

/** Estados de envelope (API) → rótulos em português na interface. */
const ROTULOS_ESTADO_ENVELOPE = {
    draft: 'Rascunho',
    running: 'Em processo',
    closed: 'Finalizado',
    canceled: 'Cancelado',
    cancelled: 'Cancelado',
}

export function rotuloEstadoEnvelope(status) {
    const bruto = String(status ?? '').trim()
    if (!bruto || bruto === '—') return '—'
    const k = bruto.toLowerCase()
    return ROTULOS_ESTADO_ENVELOPE[k] || bruto
}
