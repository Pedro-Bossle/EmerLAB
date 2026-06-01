/** IDs de especialidade permitidos no formulário público por tipo de perfil (fallback se nomes/tipos mudarem). */

import { normalizarTextoBusca, prestadorEhEstabelecimento } from './prestadorCadastroHelpers.js'

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

function normNome(e) {
    return normalizarTextoBusca(e?.nome)
}

function normTipo(e) {
    return String(e?.tipo || '').trim().toUpperCase()
}

function ehComercioEsp(e) {
    const n = normNome(e)
    const t = normTipo(e)
    return (
        n.includes('pet') ||
        n.includes('comerc') ||
        n.includes('shop') ||
        n.includes('banho') ||
        n.includes('tosa') ||
        t.includes('COMERC')
    )
}

function ehEstabelecimentoEsp(e) {
    if (prestadorEhEstabelecimento(e.id)) return true
    const n = normNome(e)
    const t = normTipo(e)
    if (t === 'LOCAL' || t.includes('LOCAL')) return true
    return (
        n.includes('clinic') ||
        n.includes('consult') ||
        n.includes('laborat') ||
        n.includes('hospital') ||
        n.includes('24 hor') ||
        n.includes('24h')
    )
}

function ehVeterinarioEsp(e) {
    if (ehEstabelecimentoEsp(e) || ehComercioEsp(e)) return false
    const t = normTipo(e)
    if (t === 'ESPECIALIDADE' || t.includes('ESPECIALIDADE')) return true
    if (t && t !== 'LOCAL' && !t.includes('LOCAL')) return true
    return Number(e.id) > 6
}

function combinaPerfil(e, tipoPerfil) {
    const t = String(tipoPerfil || '').toLowerCase()
    const id = Number(e.id)
    if (!t) return false
    if (t === 'clinica') return SETS.clinica.has(id) || ehEstabelecimentoEsp(e)
    if (t === 'comercio') return SETS.comercio.has(id) || ehComercioEsp(e)
    if (t === 'volante') return SETS.volante.has(id) || ehVeterinarioEsp(e)
    return false
}

const ordenarPorNome = (a, b) =>
    String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { sensitivity: 'base' })

export function idsEspecialidadePermitidosPorPerfil(tipoPerfil) {
    const t = String(tipoPerfil || '').toLowerCase()
    const set = SETS[t]
    if (!set) return []
    return [...set].sort((a, b) => a - b)
}

export function especialidadePermitidaParaPerfil(tipoPerfil, especialidadeId, especialidades = []) {
    const id = Number(especialidadeId)
    const esp = (especialidades || []).find((e) => Number(e.id) === id)
    if (esp) return combinaPerfil(esp, tipoPerfil)
    const set = SETS[String(tipoPerfil || '').toLowerCase()]
    return set ? set.has(id) : false
}

export function filtrarEspecialidadesPorPerfil(especialidades, tipoPerfil) {
    const t = String(tipoPerfil || '').toLowerCase()
    const lista = especialidades || []
    if (!t) return []
    let out = lista.filter((e) => combinaPerfil(e, t))
    if (!out.length && lista.length) {
        if (t === 'clinica') {
            out = lista.filter((e) => ehEstabelecimentoEsp(e) || !ehVeterinarioEsp(e))
        } else if (t === 'comercio') {
            out = lista.filter((e) => ehComercioEsp(e) || ehEstabelecimentoEsp(e))
        } else if (t === 'volante') {
            out = lista.filter((e) => ehVeterinarioEsp(e))
        }
    }
    return out.sort(ordenarPorNome)
}

export function montarEspecialidadesIdsFormulario(principalId, secundariasIds) {
    const p = Number(principalId)
    if (!p) return []
    const sec = (secundariasIds || []).map(Number).filter((id) => id && id !== p)
    return [p, ...sec]
}

export function filtrarEspecialidadesVeterinario(especialidades) {
    const lista = especialidades || []
    let out = lista.filter((e) => ehVeterinarioEsp(e))
    if (!out.length) {
        const set = new Set(IDS_ESPECIALIDADE_VETERINARIO)
        out = lista.filter((e) => set.has(Number(e.id)))
    }
    return out.sort(ordenarPorNome)
}

/** Placeholder do campo «Outras especialidades» no formulário público. */
export function placeholderOutrasEspecialidadesPublico(tipoPerfil) {
    const t = String(tipoPerfil || '').toLowerCase()
    if (t === 'clinica' || t === 'comercio') {
        return 'Petshop, banho e tosa, etc (insira separado por vírgula)'
    }
    return 'Ex.: Cardiologia, Dermatologia (insira as especialidades separadas por vírgula)'
}
