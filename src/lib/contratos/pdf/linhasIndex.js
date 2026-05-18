import { getLinhasClinicas } from './linhasClinicas.js'
import { getLinhasVolantes } from './linhasVolantes.js'
import { getLinhasParceria } from './linhasParceria.js'

/** @param {'clinicas'|'volantes'|'parceria'} tipo */
export function getLinhas(tipo, dados) {
    if (tipo === 'clinicas') return getLinhasClinicas(dados)
    if (tipo === 'volantes') return getLinhasVolantes(dados)
    if (tipo === 'parceria') return getLinhasParceria(dados)
    return []
}

import { textoLinha } from './linhasUtil.js'

export function linhasParaTextoPreview(linhas) {
    return linhas.map((l) => textoLinha(l)).join('\n\n')
}
