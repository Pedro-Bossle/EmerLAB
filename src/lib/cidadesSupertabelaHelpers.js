/** Rótulo: UF | Nome da tabela */
export const rotuloCidadeSupertabela = (item) => {
    const uf = String(item?.uf || '').trim().toUpperCase() || '—'
    const nome = String(item?.nome || '').trim() || '—'
    return `${uf} | ${nome}`
}

export const mapCidadeParaGerenciador = (cidade) => ({
    id: cidade.id,
    nome: cidade.nome,
    uf: cidade.uf ? String(cidade.uf).trim().toUpperCase() : '',
})

export const payloadCidadeComUf = ({ nome, uf }) => ({
    nome: String(nome || '').trim(),
    uf: uf ? String(uf).trim().toUpperCase() : null,
})
