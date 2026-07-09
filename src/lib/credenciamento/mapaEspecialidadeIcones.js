import { normalizarTextoBusca } from '../prestadorCadastroHelpers.js'

export const EMOJI_PADRAO_MAPA = '📍'

/** Ordem: chaves mais longas primeiro no match parcial (ex.: «clinica 24h» antes de «clinica»). */
const EMOJI_POR_ESPECIALIDADE = [
    { chave: 'clinica 24h', emoji: '🏪' },
    { chave: 'banho e tosa', emoji: '🧽' },
    { chave: 'consultorio', emoji: '🏠' },
    { chave: 'laboratorio', emoji: '🔬' },
    { chave: 'crematorio', emoji: '⚱️' },
    { chave: 'farmacia', emoji: '💊' },
    { chave: 'hospital', emoji: '🏥' },
    { chave: 'petshop', emoji: '🛒' },
    { chave: 'clinica', emoji: '🩺' },
    { chave: 'hotel', emoji: '🏨' },
]

const ENTRADAS_ORDENADAS_PARCIAL = [...EMOJI_POR_ESPECIALIDADE].sort(
    (a, b) => b.chave.length - a.chave.length,
)

export function resolverEmojiMapaEspecialidade(nomeEspecialidade) {
    const n = normalizarTextoBusca(nomeEspecialidade)
    if (!n) return EMOJI_PADRAO_MAPA

    for (const { chave, emoji } of EMOJI_POR_ESPECIALIDADE) {
        if (n === chave) return emoji
    }
    for (const { chave, emoji } of ENTRADAS_ORDENADAS_PARCIAL) {
        if (n.includes(chave)) return emoji
    }
    return EMOJI_PADRAO_MAPA
}
