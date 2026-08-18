function pctDeScore(score0a1000) {
    if (!Number.isFinite(Number(score0a1000))) return 0
    return Math.max(0, Math.min(100, Math.round(Number(score0a1000) / 10)))
}

export function montarMatchScore({ tutor, pet, data, exame, valor }) {
    const score = {
        tutor: pctDeScore(tutor),
        pet: pctDeScore(pet),
        data: pctDeScore(data),
        exame: pctDeScore(exame),
        valor: pctDeScore(valor),
    }
    const final = Math.round(
        score.tutor * 0.22 +
            score.pet * 0.22 +
            score.data * 0.16 +
            score.exame * 0.22 +
            score.valor * 0.18,
    )
    let confianca = 'BAIXA'
    if (final >= 85 && score.tutor >= 70 && score.pet >= 70) confianca = 'ALTA'
    else if (final >= 60) confianca = 'MEDIA'
    return { ...score, final, confianca }
}
