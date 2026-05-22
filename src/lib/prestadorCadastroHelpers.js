/** IDs de especialidade = estabelecimento (clínica, consultório, laboratório, hospital, 24h). */
export const ESPECIALIDADES_ESTABELECIMENTO_IDS = new Set([1, 2, 3, 5])

/** Especialidade «Laboratório» em prestadores (parceiro que recebe exames). */
export const ESPECIALIDADE_LABORATORIO_ID = 3

/** Categorias de procedimento em que o prestador escolhe laboratórios para solicitar exames. */
export const categoriaExigeLaboratoriosSolicitacao = (nomeCategoria) => {
    const n = normalizarTextoBusca(nomeCategoria)
    if (!n.includes('exame') || !n.includes('laborat')) return false
    return n.includes('simples') || n.includes('especial')
}

export const TIPOS_REPASSE = [
    { value: '', label: '— Selecione —' },
    { value: 'rpa', label: 'RPA' },
    { value: 'nota', label: 'Nota' },
]

export const normalizarTextoBusca = (texto) =>
    String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()

export const prestadorEhEstabelecimento = (especialidadeId) =>
    ESPECIALIDADES_ESTABELECIMENTO_IDS.has(Number(especialidadeId))

export const formatarCpfCnpjEntrada = (valor) => {
    const d = String(valor || '').replace(/\D/g, '').slice(0, 14)
    if (d.length <= 11) {
        if (d.length <= 3) return d
        if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`
        if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
        return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
    }
    if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

export { maskTelefoneBr as formatarTelefoneEntrada } from './telefoneBrasil.js'

/** ID da situação «Credenciado» para filtro/cadastro padrão. */
export const acharSituacaoCredenciadoId = (situacoes) => {
    const hit = (situacoes || []).find((s) =>
        String(s.descricao || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase()
            .includes('CREDENCIAD'),
    )
    return hit != null ? String(hit.id) : ''
}

export const montarEnderecoUmaLinha = (e) => {
    const partes = [
        [e.endereco_logradouro, e.endereco_numero].filter(Boolean).join(', '),
        e.endereco_complemento,
        e.endereco_bairro,
        [e.endereco_cidade, e.endereco_uf].filter(Boolean).join('/'),
        e.cep ? `CEP ${e.cep}` : '',
        e.endereco_pais && e.endereco_pais !== 'Brasil' ? e.endereco_pais : '',
    ].filter(Boolean)
    return partes.join(' — ')
}
