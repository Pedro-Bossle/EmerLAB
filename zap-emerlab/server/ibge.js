// Municípios por UF do IBGE. A lista fica em src/municipios.js (a mesma que a ficha do contato usa no navegador),
// então a rota responde na hora, sem esperar a API do IBGE.
import { MUNICIPIOS_POR_UF } from '../src/municipios.js'

export const UFS_BRASIL = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']

export async function municipiosPorUf(uf) {
    const sigla = String(uf || '').trim().toUpperCase()
    if (!UFS_BRASIL.includes(sigla)) return null
    return (MUNICIPIOS_POR_UF[sigla] || []).map(([id, nome]) => ({ id, nome }))
}
