/** Municípios por UF — API pública IBGE (CORS liberado). */

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
                    if (chave && !mapaNomeMunicipioParaUf.has(chave)) mapaNomeMunicipioParaUf.set(chave, uf)
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

export async function buscarMunicipiosPorUf(uf) {
    const sigla = String(uf || '').trim().toUpperCase()
    if (!UFS_BRASIL.includes(sigla)) throw new Error('UF inválida.')
    const res = await fetch(
        `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${sigla}/municipios?orderBy=nome`,
        { headers: { Accept: 'application/json' } },
    )
    if (!res.ok) throw new Error('Não foi possível carregar cidades desta UF.')
    const data = await res.json()
    const lista = (data || []).map((m) => ({ id: m.id, nome: String(m.nome || '').trim() }))
    lista.forEach((m) => {
        const chave = normalizarNomeMunicipio(m.nome)
        if (chave) mapaNomeMunicipioParaUf.set(chave, sigla)
    })
    return lista
}
