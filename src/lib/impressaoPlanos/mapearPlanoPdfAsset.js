import { ORDEM_PLANOS, obterChavePlanoPorId } from '../planosHierarquia.js'

import urlBasico from '../../assets/planos/basico.pdf?url'
import urlClassico from '../../assets/planos/classico.pdf?url'
import urlAvancado from '../../assets/planos/avancado.pdf?url'
import urlUltra from '../../assets/planos/ultra.pdf?url'

export const URL_PDF_PLANO_POR_CHAVE = {
    basico: urlBasico,
    classico: urlClassico,
    avancado: urlAvancado,
    ultra: urlUltra,
}

export function resolverChavePdfPlano(planoId, mapaPlanos) {
    const chave = obterChavePlanoPorId(planoId, mapaPlanos)
    if (!chave || !URL_PDF_PLANO_POR_CHAVE[chave]) return null
    return chave
}

export function resolverUrlPdfPlano(planoId, mapaPlanos) {
    const chave = resolverChavePdfPlano(planoId, mapaPlanos)
    return chave ? URL_PDF_PLANO_POR_CHAVE[chave] : null
}

export function listarPlanosImpressaoOrdenados(planosLista, mapaPlanos) {
    return ORDEM_PLANOS.map((chave) => {
        const meta = mapaPlanos[chave]
        if (!meta?.id) return null
        if (!URL_PDF_PLANO_POR_CHAVE[chave]) return null
        const nome =
            (planosLista || []).find((p) => Number(p.id) === Number(meta.id))?.nome || meta.nome || chave
        return { chave, id: Number(meta.id), nome }
    }).filter(Boolean)
}
