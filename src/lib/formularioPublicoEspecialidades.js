/** IDs de especialidade permitidos no formulário público por tipo de perfil. */

const IDS_VOLANTE = (() => {
    const ids = []
    for (let i = 7; i <= 33; i++) ids.push(i)
    ids.push(35, 37)
    return ids
})()

const IDS_CLINICA = [1, 2, 3, 4, 5, 6, 34, 38]

const IDS_COMERCIO = [4, 6, 34, 38]

const SETS = {
    volante: new Set(IDS_VOLANTE),
    clinica: new Set(IDS_CLINICA),
    comercio: new Set(IDS_COMERCIO),
}

/** Especialidades de veterinário (vínculo em clínica). */
export const IDS_ESPECIALIDADE_VETERINARIO = IDS_VOLANTE

export function idsEspecialidadePermitidosPorPerfil(tipoPerfil) {
    const t = String(tipoPerfil || '').toLowerCase()
    const set = SETS[t]
    if (!set) return []
    return [...set].sort((a, b) => a - b)
}

export function especialidadePermitidaParaPerfil(tipoPerfil, especialidadeId) {
    const set = SETS[String(tipoPerfil || '').toLowerCase()]
    if (!set) return false
    return set.has(Number(especialidadeId))
}

export function filtrarEspecialidadesPorPerfil(especialidades, tipoPerfil) {
    const set = SETS[String(tipoPerfil || '').toLowerCase()]
    if (!set) return []
    return (especialidades || [])
        .filter((e) => set.has(Number(e.id)))
        .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { sensitivity: 'base' }))
}

export function montarEspecialidadesIdsFormulario(principalId, secundariasIds) {
    const p = Number(principalId)
    if (!p) return []
    const sec = (secundariasIds || []).map(Number).filter((id) => id && id !== p)
    return [p, ...sec]
}

export function filtrarEspecialidadesVeterinario(especialidades) {
    const set = new Set(IDS_ESPECIALIDADE_VETERINARIO)
    return (especialidades || [])
        .filter((e) => set.has(Number(e.id)))
        .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { sensitivity: 'base' }))
}
