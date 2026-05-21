/** Municípios por UF — API pública IBGE (CORS liberado). */

export const UFS_BRASIL = [
    'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
    'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]

export async function buscarMunicipiosPorUf(uf) {
    const sigla = String(uf || '').trim().toUpperCase()
    if (!UFS_BRASIL.includes(sigla)) throw new Error('UF inválida.')
    const res = await fetch(
        `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${sigla}/municipios?orderBy=nome`,
        { headers: { Accept: 'application/json' } },
    )
    if (!res.ok) throw new Error('Não foi possível carregar cidades desta UF.')
    const data = await res.json()
    return (data || []).map((m) => ({ id: m.id, nome: String(m.nome || '').trim() }))
}
