/** Municípios por UF — API pública IBGE (CORS liberado), com cache e dedupe. */

export const UFS_BRASIL = [
    'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
    'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]

const normalizarNomeMunicipio = (nome) =>
    String(nome || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()

/** Nome de município (normalizado) → sigla UF. Preenchido sob demanda via IBGE. */
const mapaNomeMunicipioParaUf = new Map()
/** @type {Map<string, Array<{ id: string|number, nome: string }>>} */
const cacheMunicipiosPorUf = new Map()
/** @type {Map<string, Promise<Array<{ id: string|number, nome: string }>>>} */
const inflightMunicipiosPorUf = new Map()
let promessaIndiceUf = null

async function garantirIndiceNomeUf() {
    if (mapaNomeMunicipioParaUf.size > 0) return
    if (promessaIndiceUf) {
        await promessaIndiceUf
        return
    }
    promessaIndiceUf = (async () => {
        for (const uf of UFS_BRASIL) {
            try {
                const municipios = await buscarMunicipiosPorUf(uf)
                municipios.forEach((m) => {
                    const chave = normalizarNomeMunicipio(m.nome)
                    if (chave && !mapaNomeMunicipioParaUf.has(chave)) {
                        mapaNomeMunicipioParaUf.set(chave, uf)
                    }
                })
            } catch {
                /* ignora UF com falha pontual */
            }
        }
    })()
    await promessaIndiceUf
}

/** Resolve UF a partir do nome do município (ex.: ao reabrir cadastro sem UF na lista). */
export async function resolverUfPorNomeMunicipio(nome) {
    const chave = normalizarNomeMunicipio(nome)
    if (!chave) return ''
    if (mapaNomeMunicipioParaUf.has(chave)) return mapaNomeMunicipioParaUf.get(chave)
    await garantirIndiceNomeUf()
    return mapaNomeMunicipioParaUf.get(chave) || ''
}

/**
 * @param {string} uf
 * @returns {Promise<Array<{ id: string|number, nome: string }>>}
 */
export async function buscarMunicipiosPorUf(uf) {
    const sigla = String(uf || '').trim().toUpperCase()
    if (!UFS_BRASIL.includes(sigla)) throw new Error('UF inválida.')

    if (cacheMunicipiosPorUf.has(sigla)) {
        return cacheMunicipiosPorUf.get(sigla)
    }
    if (inflightMunicipiosPorUf.has(sigla)) {
        return inflightMunicipiosPorUf.get(sigla)
    }

    const pedido = (async () => {
        const urls = []
        // Em browser: proxy local/Vercel evita bloqueio de CORS/rede à API do IBGE.
        if (typeof window !== 'undefined') {
            urls.push(`/api/ibge-municipios?uf=${encodeURIComponent(sigla)}`)
        }
        urls.push(
            `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${sigla}/municipios?orderBy=nome`,
        )

        let data = null
        let lastErr = null
        for (const url of urls) {
            try {
                const res = await fetch(url, { headers: { Accept: 'application/json' } })
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                const parsed = await res.json()
                if (!Array.isArray(parsed)) throw new Error('Resposta IBGE inválida.')
                data = parsed
                break
            } catch (e) {
                lastErr = e
            }
        }
        if (!data) {
            throw lastErr || new Error('Não foi possível carregar cidades desta UF.')
        }

        const lista = (data || [])
            .map((m) => ({ id: m.id, nome: String(m.nome || '').trim() }))
            .filter((m) => m.nome)
        lista.forEach((m) => {
            const chave = normalizarNomeMunicipio(m.nome)
            if (chave) mapaNomeMunicipioParaUf.set(chave, sigla)
        })
        cacheMunicipiosPorUf.set(sigla, lista)
        return lista
    })()

    inflightMunicipiosPorUf.set(sigla, pedido)
    try {
        return await pedido
    } finally {
        inflightMunicipiosPorUf.delete(sigla)
    }
}

/**
 * Une lista IBGE com nomes extra (tabela `cidades`, vínculos, catálogo).
 * @param {Array<{ id?: string|number, nome: string }>} ibge
 * @param {string[]} nomesExtras
 */
export function mesclarMunicipiosComExtras(ibge, nomesExtras = []) {
    const porChave = new Map()
    for (const m of ibge || []) {
        const nome = String(m?.nome || '').trim()
        const chave = normalizarNomeMunicipio(nome)
        if (!chave) continue
        porChave.set(chave, { id: m.id ?? nome, nome })
    }
    for (const raw of nomesExtras || []) {
        const nome = String(raw || '').trim()
        const chave = normalizarNomeMunicipio(nome)
        if (!chave || porChave.has(chave)) continue
        porChave.set(chave, { id: nome, nome })
    }
    return [...porChave.values()].sort((a, b) =>
        a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }),
    )
}

/**
 * IBGE (com cache) + nomes da malha Supabase se a API falhar ou vier vazia.
 * @param {string} uf
 * @param {{ supabase?: { from: Function } }} [opts]
 */
export async function buscarMunicipiosPorUfRobusto(uf, opts = {}) {
    const sigla = String(uf || '').trim().toUpperCase()
    if (!sigla) return []

    let ibge = []
    try {
        ibge = await buscarMunicipiosPorUf(sigla)
    } catch {
        ibge = []
    }

    const extras = []
    const client = opts.supabase
    if (client) {
        try {
            const [{ data: cidades }, { data: vinculos }] = await Promise.all([
                client.from('cidades').select('nome, uf').eq('uf', sigla),
                client
                    .from('cidades_municipios_vinculo')
                    .select('municipio_nome, uf')
                    .eq('uf', sigla),
            ])
            for (const c of cidades || []) {
                const n = String(c.nome || '').trim()
                if (n) extras.push(n)
            }
            for (const v of vinculos || []) {
                const n = String(v.municipio_nome || '').trim()
                if (n) extras.push(n)
            }
        } catch {
            /* fallback opcional */
        }
    }

    return mesclarMunicipiosComExtras(ibge, extras)
}
