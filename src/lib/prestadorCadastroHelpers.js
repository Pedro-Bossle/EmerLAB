import { maskCNPJ, maskCPF } from './contratos/mascarasDocumento.js'

/** IDs de especialidade = estabelecimento (clínica, consultório, laboratório, hospital, 24h). */
export const ESPECIALIDADES_ESTABELECIMENTO_IDS = new Set([1, 2, 3, 5])

/** Especialidade «Laboratório» em prestadores (parceiro que recebe exames). Id 5 na base (3 = consultório). */
export const ESPECIALIDADE_LABORATORIO_ID = 5

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
    { value: 'boleto', label: 'Boleto' },
]

export const normalizarTextoBusca = (texto) =>
    String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()

export const prestadorEhEstabelecimento = (especialidadeId) =>
    ESPECIALIDADES_ESTABELECIMENTO_IDS.has(Number(especialidadeId))

/** Laboratório: id canônico ou nome da especialidade contendo «laborat». */
export const prestadorEhLaboratorio = (especialidadeId, especialidades = []) => {
    const id = Number(especialidadeId)
    if (!id) return false
    const esp = (especialidades || []).find((e) => Number(e.id) === id)
    const nome = normalizarTextoBusca(esp?.nome || '')
    if (nome.includes('laborat')) return true
    return id === ESPECIALIDADE_LABORATORIO_ID
}

export const idsEspecialidadeLaboratorio = (especialidades = []) => {
    const ids = new Set()
    ;(especialidades || []).forEach((e) => {
        if (prestadorEhLaboratorio(e.id, [e])) ids.add(Number(e.id))
    })
    if (!ids.size) ids.add(ESPECIALIDADE_LABORATORIO_ID)
    return [...ids]
}

/** Clínica / local vinculável a veterinário (mesmo critério do credenciamento principal). */
export const prestadorEstabelecimentoVinculavel = (especialidadeId) =>
    ESPECIALIDADES_ESTABELECIMENTO_IDS.has(Number(especialidadeId))

export const tipoEspecialidadePrestador = (tipoOuNome) => {
    const txt = normalizarTextoBusca(tipoOuNome).toUpperCase()
    if (txt.includes('LOCAL')) return 'LOCAL'
    if (txt.includes('ESPECIALIDADE')) return 'ESPECIALIDADE'
    return ''
}

/** Apenas dígitos, no máximo 14 (CNPJ). */
export const somenteDigitosCpfCnpj = (valor) => String(valor || '').replace(/\D/g, '').slice(0, 14)

/** Detecta máscara: até 11 dígitos = CPF; a partir do 12º = CNPJ. */
export const tipoDocumentoCpfCnpj = (valor) => {
    const n = somenteDigitosCpfCnpj(valor).length
    if (n === 0) return ''
    return n <= 11 ? 'CPF' : 'CNPJ'
}

/** Máscara de exibição/edição conforme quantidade de dígitos. */
export const formatarCpfCnpjEntrada = (valor) => {
    const d = somenteDigitosCpfCnpj(valor)
    if (d.length <= 11) return maskCPF(d)
    return maskCNPJ(d)
}

/** Persistência: só dígitos (11 ou 14); vazio → null. */
export const normalizarCpfCnpjParaSalvar = (valor) => {
    const d = somenteDigitosCpfCnpj(valor)
    return d || null
}

export { maskTelefoneBr as formatarTelefoneEntrada } from './telefoneBrasil.js'

export const formatarCrmvEntrada = (valor) => String(valor || '').toUpperCase()

export const formatarEmailEntrada = (valor) => String(valor || '').toLowerCase()

export const normalizarCrmvParaSalvar = (valor) => {
    const v = String(valor || '').trim().toUpperCase()
    return v || null
}

export const normalizarEmailParaSalvar = (valor) => {
    const v = String(valor || '').trim().toLowerCase()
    return v || null
}

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
