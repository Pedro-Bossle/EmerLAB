/**
 * Remove o prefixo profissional Dr./Dra. (com ou sem ponto) no início do nome.
 * Ex.: «Dra. Ana Silva» → «Ana Silva»; «Dr João» → «João».
 */
export function removerTituloDrDra(nome) {
    return String(nome || '')
        .replace(/^\s*Dra?\.?\s+/i, '')
        .replace(/\s+/g, ' ')
        .trim()
}

/**
 * Nome/razão da contratada volante para PDF e arquivo:
 * CNPJ → razão social; CPF → nome completo sem Dr./Dra.
 */
export function nomeContratadaVolante(d) {
    if (d?.docTipo === 'cnpj') {
        return String(d?.razaoSocial || '').trim()
    }
    return removerTituloDrDra(d?.nomeCompleto)
}
