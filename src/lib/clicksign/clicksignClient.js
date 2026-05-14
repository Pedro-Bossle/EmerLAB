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
        const role = roleDoAtributosRequisito(item?.attributes || {})
        if (!role) continue
        const sid = signerIdDoRequisito(item)
        const did = documentIdDoRequisito(item)
        if (sid && did) set.add(`${did}|${sid}`)
    }
    return set
}

function requisitoDuplicadoOuConflito(rq) {
    if (rq.ok) return false
    const s = JSON.stringify(rq.data || {}).toLowerCase()
    return (
        rq.status === 422 &&
        (s.includes('duplic') || s.includes('already') || s.includes('taken') || s.includes('exist') || s.includes('já existe'))
    )
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
        clickReq('GET', `/envelopes/${encodeURIComponent(eid)}/requirements`),
    ])
    if (!d1.ok || !d2.ok) return { criados: 0, falhas, erroListagem: true }

    const docs = extrairListaDocumentos(d1.data)
    const sigs = extrairListaSignatarios(d2.data)
    const covered = paresQualificacaoExistentes(d3.ok ? d3.data : null)
    const rolesBySigner = extrairRolesQualificacaoPorSignatario(d3.ok ? d3.data : null)

    const docElegivel = (d) => {
        const st = String(d.status || '').toLowerCase()
        if (st === 'canceled' || st === 'cancelled' || st === 'failed' || st === 'error') return false
        return true
    }

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

/** Pares documento×signatário com algum requisito que não seja só qualificação padrão (`agree` + `role`). */
export function paresAutenticacaoOuOutrosExistentes(requirementsJson) {
    /** @type {Set<string>} */
    const set = new Set()
    const arr = Array.isArray(requirementsJson?.data)
        ? requirementsJson.data
        : requirementsJson?.data
          ? [requirementsJson.data]
          : []
    for (const item of arr) {
        const a = item?.attributes || {}
        const role = roleDoAtributosRequisito(a)
        const actionNorm = String(a.action || 'agree').toLowerCase()
        const apenasQualificacaoPadrao = !!role && actionNorm === 'agree'
        if (apenasQualificacaoPadrao) continue
        const sid = signerIdDoRequisito(item)
        const did = documentIdDoRequisito(item)
        if (sid && did) set.add(`${did}|${sid}`)
    }
    return set
}

function payloadAuthEmailVariante(variante, documentId, signerId) {
    const docId = String(documentId || '').trim()
    const sigId = String(signerId || '').trim()
    const base = {
        type: 'requirements',
        relationships: {
            document: { data: { type: 'documents', id: docId } },
            signer: { data: { type: 'signers', id: sigId } },
        },
    }
    if (variante === 0) {
        return { data: { ...base, attributes: { action: 'authenticate', auth: 'email' } } }
    }
    if (variante === 1) {
        return { data: { ...base, attributes: { action: 'provide_evidence', evidence_provider: 'email' } } }
    }
    return { data: { ...base, attributes: { action: 'authenticate', schema: { type: 'email' } } } }
}

/**
 * Tenta criar requisitos de autenticação por e-mail em pares ainda sem outro requisito além da qualificação.
 */
export async function garantirRequisitosAutenticacaoEmailCobertos(clickReq, envelopeId) {
    const eid = String(envelopeId || '').trim()
    if (!eid) return { criados: 0, tentou: false }

    const [d1, d2, d3] = await Promise.all([
        clickReq('GET', `/envelopes/${encodeURIComponent(eid)}/documents`),
        clickReq('GET', `/envelopes/${encodeURIComponent(eid)}/signers`),
        clickReq('GET', `/envelopes/${encodeURIComponent(eid)}/requirements`),
    ])
    if (!d1.ok || !d2.ok || !d3.ok) return { criados: 0, tentou: false }

    const docs = extrairListaDocumentos(d1.data)
    const sigs = extrairListaSignatarios(d2.data)
    const covered = paresAutenticacaoOuOutrosExistentes(d3.data)

    const docElegivel = (d) => {
        const st = String(d.status || '').toLowerCase()
        if (st === 'canceled' || st === 'cancelled' || st === 'failed' || st === 'error') return false
        return true
    }

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

            let okPost = false
            for (let v = 0; v <= 2; v += 1) {
                const body = payloadAuthEmailVariante(v, docId, signerId)
                const rq = await clickReq('POST', `/envelopes/${encodeURIComponent(eid)}/requirements`, body)
                if (rq.ok || requisitoDuplicadoOuConflito(rq)) {
                    if (rq.ok) criados += 1
                    covered.add(key)
                    okPost = true
                    break
                }
            }
            if (!okPost) {
                continue
            }
        }
    }
    return { criados, tentou: criados > 0 }
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
        rows.push({
            id: item?.id ?? '',
            filename: a.filename ?? a.name ?? '—',
            status: a.status ?? '—',
        })
    }
    return rows
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
