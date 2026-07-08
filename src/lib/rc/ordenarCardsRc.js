/** Heurística legada (nome da especialidade) — usada só se `ordem_rc` não estiver definida. */
export function ordemGrupoEspecialidadeLegado(especialidadeNome) {
    const nome = String(especialidadeNome || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase()
    if (nome.includes('HOSPITAL')) return 0
    if (nome.includes('24H')) return 1
    if (nome.includes('CLINICA')) return 2
    if (nome.includes('CONSULT')) return 3
    if (nome.includes('LABORAT')) return 4
    if (
        nome.includes('PETSHOP') ||
        nome.includes('PET SHOP') ||
        nome.includes('FARMAC') ||
        nome.includes('COMERC') ||
        nome.includes('BANHO') ||
        nome.includes('TOSA') ||
        nome.includes('CREMATOR') ||
        nome.includes('HOTEL') ||
        nome.includes('RECREAC') ||
        nome.includes('ADESTRAM')
    ) {
        return 6
    }
    return 5
}

/** @param {Array<{ id: number, ordem_rc?: number | null }>} especialidades */
export function buildMapaOrdemRc(especialidades = []) {
    const mapa = new Map()
    for (const item of especialidades) {
        const id = Number(item.id)
        const ordem = item.ordem_rc
        if (id && ordem != null && ordem !== '' && Number.isFinite(Number(ordem))) {
            mapa.set(id, Number(ordem))
        }
    }
    return mapa
}

function ordemEfetivaEspecialidade(especialidadeId, especialidadeNome, mapaOrdem) {
    const id = Number(especialidadeId)
    if (mapaOrdem.has(id)) return mapaOrdem.get(id)
    return 900_000 + ordemGrupoEspecialidadeLegado(especialidadeNome) * 1_000
}

/**
 * Ordena prestadores para o PDF da RC (mesma regra em API e script).
 * @param {Array<{ especialidadePrincipalId?: number, especialidadePrincipalNome: string, nome: string }>} linhas
 */
export function ordenarLinhasRc(linhas, mapaOrdem = new Map()) {
    return [...linhas].sort((a, b) => {
        const oa = ordemEfetivaEspecialidade(
            a.especialidadePrincipalId,
            a.especialidadePrincipalNome,
            mapaOrdem
        )
        const ob = ordemEfetivaEspecialidade(
            b.especialidadePrincipalId,
            b.especialidadePrincipalNome,
            mapaOrdem
        )
        if (oa !== ob) return oa - ob
        const e = String(a.especialidadePrincipalNome || '').localeCompare(
            String(b.especialidadePrincipalNome || ''),
            'pt-BR',
            { sensitivity: 'base' }
        )
        if (e !== 0) return e
        return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { sensitivity: 'base' })
    })
}

/** Gera valores iniciais de `ordem_rc` a partir da heurística legada. */
export function calcularOrdemRcPadrao(especialidades = []) {
    const ordenadas = [...especialidades].sort((a, b) => {
        const ga = ordemGrupoEspecialidadeLegado(a.nome)
        const gb = ordemGrupoEspecialidadeLegado(b.nome)
        if (ga !== gb) return ga - gb
        return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { sensitivity: 'base' })
    })
    return ordenadas.map((item, index) => ({
        id: Number(item.id),
        ordem_rc: (index + 1) * 10,
    }))
}

export function isMissingOrdemRcColumnError(error) {
    const msg = String(error?.message || error || '').toLowerCase()
    return msg.includes('ordem_rc') && (msg.includes('column') || msg.includes('coluna') || msg.includes('schema'))
}
