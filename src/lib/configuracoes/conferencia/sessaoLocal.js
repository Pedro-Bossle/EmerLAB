const DB_NOME = 'emerdog-conf-lab'
const STORE = 'sessoes'
const TTL_MS = 30 * 24 * 60 * 60 * 1000

function abrirDb() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB indisponível.'))
            return
        }
        const req = indexedDB.open(DB_NOME, 1)
        req.onupgradeneeded = () => {
            const db = req.result
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: 'id' })
            }
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error || new Error('Falha ao abrir sessões.'))
    })
}

function comTransacao(mode, work) {
    return abrirDb().then(
        (db) =>
            new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, mode)
                const store = tx.objectStore(STORE)
                let resultado
                work(store, (val) => {
                    resultado = val
                })
                tx.oncomplete = () => {
                    db.close()
                    resolve(resultado)
                }
                tx.onerror = () => {
                    db.close()
                    reject(tx.error)
                }
                tx.onabort = () => {
                    db.close()
                    reject(tx.error || new Error('Transação abortada.'))
                }
            }),
    )
}

function semBruto(obj) {
    if (Array.isArray(obj)) return obj.map(semBruto)
    if (obj && typeof obj === 'object') {
        const out = {}
        for (const [k, v] of Object.entries(obj)) {
            if (k === 'bruto') continue
            out[k] = semBruto(v)
        }
        return out
    }
    return obj
}

function novoId() {
    return `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function sessaoExpirada(reg, agora = Date.now()) {
    const t = Date.parse(reg?.expiraEm || '')
    if (Number.isFinite(t)) return t <= agora
    const u = Date.parse(reg?.atualizadoEm || reg?.criadoEm || '')
    if (!Number.isFinite(u)) return true
    return agora - u > TTL_MS
}

export function montarEstadoSessao({
    passo,
    nomesArquivos,
    headersHonorarios,
    headersMellis,
    headersBase,
    mapColsHonorarios,
    mapColsMellis,
    mapColsBase,
    linhasHonorarios,
    linhasMellis,
    linhasBase,
    vinculosBase,
    faltHonorarios,
    faltMellis,
    faltBase,
    resultados,
    resumo,
    revisoes,
    equivalencias,
    aliasesPessoa,
    perfis,
} = {}) {
    return semBruto({
        versao: 3,
        passo: passo || 'setup',
        nomesArquivos: nomesArquivos || { base: '', plano: '', lab: '' },
        headersHonorarios: headersHonorarios || [],
        headersMellis: headersMellis || [],
        headersBase: headersBase || [],
        mapColsHonorarios: mapColsHonorarios || {},
        mapColsMellis: mapColsMellis || {},
        mapColsBase: mapColsBase || {},
        linhasHonorarios: linhasHonorarios || [],
        linhasMellis: linhasMellis || [],
        linhasBase: linhasBase || [],
        vinculosBase: vinculosBase || {},
        faltHonorarios: faltHonorarios || [],
        faltMellis: faltMellis || [],
        faltBase: faltBase || [],
        resultados: resultados || [],
        resumo: resumo || null,
        revisoes: revisoes || [],
        equivalencias: equivalencias || [],
        aliasesPessoa: aliasesPessoa || [],
        perfis: perfis || [],
    })
}

function metaDeRegistro(reg) {
    const e = reg?.estado || {}
    const resumo = e.resumo || {}
    return {
        id: reg.id,
        criadoEm: reg.criadoEm,
        atualizadoEm: reg.atualizadoEm,
        expiraEm: reg.expiraEm,
        passo: e.passo || 'setup',
        nomesArquivos: e.nomesArquivos || { base: '', plano: '', lab: '' },
        totais: {
            plano: (e.linhasHonorarios || []).length,
            lab: (e.linhasMellis || []).length,
            pares: resumo.itensConferidos ?? (e.resultados || []).length,
            orfaos: (resumo.orfaosMellis || 0) + (resumo.orfaosHonorarios || 0),
        },
    }
}

export async function expurgarSessoesExpiradas() {
    const agora = Date.now()
    return comTransacao('readwrite', (store, done) => {
        const req = store.getAll()
        req.onsuccess = () => {
            for (const reg of req.result || []) {
                if (sessaoExpirada(reg, agora)) store.delete(reg.id)
            }
            done()
        }
    })
}

export async function listarSessoesConferencia() {
    await expurgarSessoesExpiradas()
    return comTransacao('readonly', (store, done) => {
        const req = store.getAll()
        req.onsuccess = () => {
            const lista = req.result || []
            done(
                lista
                    .filter((r) => !sessaoExpirada(r))
                    .sort((a, b) =>
                        String(b.atualizadoEm || '').localeCompare(a.atualizadoEm || ''),
                    )
                    .map(metaDeRegistro),
            )
        }
    })
}

export async function carregarSessaoLocal(id) {
    if (!id) return null
    await expurgarSessoesExpiradas()
    return comTransacao('readonly', (store, done) => {
        const req = store.get(id)
        req.onsuccess = () => {
            const reg = req.result
            done(!reg || sessaoExpirada(reg) ? null : reg)
        }
    })
}

export async function salvarSessaoLocal(id, estado) {
    const agora = new Date()
    const atualizadoEm = agora.toISOString()
    const existente = id ? await carregarSessaoLocal(id) : null
    const sid = existente?.id || novoId()
    const criadoEm = existente?.criadoEm || atualizadoEm
    const expiraEm = new Date(agora.getTime() + TTL_MS).toISOString()
    const registro = {
        id: sid,
        criadoEm,
        atualizadoEm,
        expiraEm,
        estado: montarEstadoSessao(estado),
    }
    await comTransacao('readwrite', (store, done) => {
        const req = store.put(registro)
        req.onsuccess = () => done(metaDeRegistro(registro))
    })
    return metaDeRegistro(registro)
}

export async function excluirSessaoLocal(id) {
    if (!id) return
    await comTransacao('readwrite', (store, done) => {
        const req = store.delete(id)
        req.onsuccess = () => done()
    })
}

export function sessaoTemConteudo(estado) {
    return Boolean(
        (estado?.linhasHonorarios || []).length ||
            (estado?.linhasMellis || []).length ||
            (estado?.linhasBase || []).length ||
            (estado?.resultados || []).length,
    )
}

export function formatarQuandoSessao(iso) {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}
