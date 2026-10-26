// Municípios por UF da API pública do IBGE (o navegador não chama direto: a CSP do painel só libera o próprio domínio).
// Mesmo serviço do /api/ibge-municipios do projeto principal; cache em memória, a lista praticamente não muda.

export const UFS_BRASIL = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']

const cache = new Map()

export async function municipiosPorUf(uf) {
    const sigla = String(uf || '').trim().toUpperCase()
    if (!UFS_BRASIL.includes(sigla)) return null
    if (cache.has(sigla)) return cache.get(sigla)
    const resp = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${sigla}/municipios?orderBy=nome`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
    })
    if (!resp.ok) throw new Error(`IBGE respondeu ${resp.status}`)
    const dados = await resp.json()
    const lista = (Array.isArray(dados) ? dados : []).map((m) => ({ id: m.id, nome: String(m.nome || '').trim() })).filter((m) => m.nome)
    cache.set(sigla, lista)
    return lista
}
