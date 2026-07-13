/** Fuso usado nos carimbos de emissão (PDF RC, planos, etc.). */
export const FUSO_CARIMBO_EMISSAO = 'America/Sao_Paulo'

/**
 * Data/hora de emissão para rodapé de PDF: `dd/mm/aaaa hh:mm` no horário de Brasília.
 * Evita UTC do servidor (ex.: Vercel) ao usar `Date#getHours()` local.
 * @param {Date} [data]
 */
export function formatarCarimboDataHora(data = new Date()) {
    const instante = data instanceof Date ? data : new Date(data)
    if (Number.isNaN(instante.getTime())) return '—'

    const partes = new Intl.DateTimeFormat('pt-BR', {
        timeZone: FUSO_CARIMBO_EMISSAO,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(instante)

    const p = (tipo) => partes.find((x) => x.type === tipo)?.value ?? '00'
    const hora = p('hour').padStart(2, '0')
    const minuto = p('minute').padStart(2, '0')
    return `${p('day')}/${p('month')}/${p('year')} ${hora}:${minuto}`
}
