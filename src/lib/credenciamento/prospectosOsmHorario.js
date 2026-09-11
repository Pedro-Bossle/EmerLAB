/**
 * Indica atendimento 24h (opening_hours OSM, campo horario_atendimento ou nota da coleta).
 * Também aceita campos do Emer-Radar Maps (`horario` / `horario_detalhado`).
 */
export function prospectoIndicaAtendimento24h(prospecto) {
    const h = String(
        prospecto?.horario_atendimento ||
            prospecto?.horario ||
            prospecto?.horario_detalhado ||
            '',
    )
        .trim()
        .toLowerCase()
    const nota = String(prospecto?.tags?.nota || '').trim().toLowerCase()
    const nome = String(prospecto?.nome || '').trim().toLowerCase()
    const blob = `${h} ${nota} ${nome}`
    if (!blob.trim()) return false
    if (/\b24\s*\/\s*7\b/.test(blob)) return true
    if (/\b24\s*h\b/.test(blob)) return true
    if (/\b24\s*hor(as)?\b/.test(blob)) return true
    if (/\b00:00\s*-\s*24:00\b/.test(h)) return true
    if (/\b24\s*horas\b/.test(blob)) return true
    if (/\baberto\s*24/.test(blob)) return true
    return false
}
