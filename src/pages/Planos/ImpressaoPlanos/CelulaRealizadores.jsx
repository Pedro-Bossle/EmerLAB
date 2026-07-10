import React from 'react'

function obterClasseProcedimento(texto) {
    const tamanho = String(texto || '').length
    if (tamanho > 42) return 'table_text_proc table_text_proc_xs'
    if (tamanho > 34) return 'table_text_proc table_text_proc_sm'
    if (tamanho > 26) return 'table_text_proc table_text_proc_md'
    return 'table_text_proc'
}

export { obterClasseProcedimento }

export default function CelulaRealizadores({ contagem, nomes }) {
    const lista = nomes || []
    const n = Number(contagem) || 0

    if (!n) {
        return (
            <td className="planos_impressao_td_realizadores planos_impressao_td_compact planos_impressao_td_extra">
                0
            </td>
        )
    }

    const hint = lista.length ? lista.join(', ') : undefined

    return (
        <td className="planos_impressao_td_realizadores planos_impressao_td_compact planos_impressao_td_extra">
            <span className="planos_impressao_realizadores" title={hint}>
                {n}
            </span>
        </td>
    )
}
