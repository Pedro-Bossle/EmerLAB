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

/** `simples` | `especiais` | null */
export const classificarCategoriaExameLaboratorial = (nomeCategoria) => {
    const n = normalizarTextoBusca(nomeCategoria)
    if (!n.includes('exame')) return null
    if (n.includes('simples')) return 'simples'
    if (n.includes('especial')) return 'especiais'
    return null
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

/** Tipo da chave PIX (formatação do campo «Chave PIX» no formulário público). */
export const TIPOS_CHAVE_PIX = [
    { value: '', label: '— Selecione —' },
    { value: 'telefone', label: 'Telefone' },
    { value: 'cpf', label: 'CPF' },
    { value: 'cnpj', label: 'CNPJ' },
    { value: 'email', label: 'E-mail' },
]

export const formatarChavePixEntrada = (valor, tipoPix) => {
    const t = String(tipoPix || '').toLowerCase()
    if (t === 'email') return formatarEmailEntrada(valor)
    if (t === 'cpf' || t === 'cnpj') return formatarCpfCnpjEntrada(valor)
    if (t === 'telefone') return formatarTelefoneEntrada(valor)
    return String(valor || '').toLowerCase()
}

export const normalizarChavePixParaSalvar = (valor, tipoPix) => {
    const t = String(tipoPix || '').toLowerCase()
    if (!String(valor || '').trim()) return null
    if (t === 'email') return normalizarEmailParaSalvar(valor)
    if (t === 'cpf' || t === 'cnpj') return normalizarCpfCnpjParaSalvar(valor)
    if (t === 'telefone') {
        const d = String(valor || '').replace(/\D/g, '')
        return d || null
    }
    return String(valor || '').trim().toLowerCase()
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

/** Situação «Preenchendo formulário(s)» ou equivalente. */
export const acharSituacaoPreenchendoFormularioId = (situacoes) => {
    const hit = (situacoes || []).find((s) => {
        const t = String(s.descricao || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase()
        return t.includes('PREENCH') && (t.includes('FORMUL') || t.includes('FORM'))
    })
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

const campoPreenchido = (valor) => {
    if (valor == null) return false
    if (typeof valor === 'string') return valor.trim().length > 0
    if (typeof valor === 'number') return !Number.isNaN(valor)
    return Boolean(valor)
}

/**
 * Percentual de completude da ficha (Perfil, Endereço, Financeiro).
 * Não considera modalidade, cidades de atuação nem procedimentos/serviços.
 */
export const calcularPercentualCompletudePerfil = (prestador, opcoes = {}) => {
    const { temVinculoClinica = false } = opcoes
    const ehEstabelecimento = prestadorEhEstabelecimento(prestador?.especialidade_id)

    const criterios = [
        campoPreenchido(prestador?.nome),
        campoPreenchido(prestador?.especialidade_id),
        campoPreenchido(prestador?.cpf_cnpj),
        !ehEstabelecimento ? campoPreenchido(prestador?.crmv) : true,
        campoPreenchido(prestador?.situacao_id),
        campoPreenchido(prestador?.telefone) ||
            campoPreenchido(prestador?.celular) ||
            temVinculoClinica,
        campoPreenchido(prestador?.email),
        campoPreenchido(prestador?.cep),
        campoPreenchido(prestador?.endereco_logradouro) || campoPreenchido(prestador?.endereco),
        campoPreenchido(prestador?.endereco_numero),
        campoPreenchido(prestador?.endereco_bairro),
        campoPreenchido(prestador?.endereco_cidade),
        campoPreenchido(prestador?.endereco_uf),
        campoPreenchido(prestador?.chave_pix),
        campoPreenchido(prestador?.tipo_repasse),
    ]

    const preenchidos = criterios.filter(Boolean).length
    return Math.round((preenchidos / criterios.length) * 100)
}

/** Rótulos dos critérios de completude (mesma ordem de `calcularPercentualCompletudePerfil`). */
export const listarPendenciasCompletudePerfil = (prestador, opcoes = {}) => {
    const { temVinculoClinica = false } = opcoes
    const ehEstabelecimento = prestadorEhEstabelecimento(prestador?.especialidade_id)

    const itens = [
        { ok: campoPreenchido(prestador?.nome), label: 'Nome' },
        { ok: campoPreenchido(prestador?.especialidade_id), label: 'Especialidade / tipo' },
        { ok: campoPreenchido(prestador?.cpf_cnpj), label: 'CPF ou CNPJ' },
        {
            ok: !ehEstabelecimento ? campoPreenchido(prestador?.crmv) : true,
            label: 'CRMV',
            skip: ehEstabelecimento,
        },
        { ok: campoPreenchido(prestador?.situacao_id), label: 'Situação' },
        {
            ok:
                campoPreenchido(prestador?.telefone) ||
                campoPreenchido(prestador?.celular) ||
                temVinculoClinica,
            label: temVinculoClinica
                ? 'Telefone ou celular (dispensado: vet vinculado a clínica)'
                : 'Telefone ou celular',
        },
        { ok: campoPreenchido(prestador?.email), label: 'E-mail' },
        { ok: campoPreenchido(prestador?.cep), label: 'CEP' },
        {
            ok: campoPreenchido(prestador?.endereco_logradouro) || campoPreenchido(prestador?.endereco),
            label: 'Logradouro',
        },
        { ok: campoPreenchido(prestador?.endereco_numero), label: 'Número do endereço' },
        { ok: campoPreenchido(prestador?.endereco_bairro), label: 'Bairro' },
        { ok: campoPreenchido(prestador?.endereco_cidade), label: 'Cidade (endereço)' },
        { ok: campoPreenchido(prestador?.endereco_uf), label: 'UF (endereço)' },
        { ok: campoPreenchido(prestador?.chave_pix), label: 'Chave PIX' },
        { ok: campoPreenchido(prestador?.tipo_repasse), label: 'Tipo de repasse' },
    ]

    return itens.filter((i) => !i.skip && !i.ok).map((i) => i.label)
}

/**
 * Filtro de texto com prefixo NOT (ex.: «NOT Caxias» exclui quem contém Caxias no blob).
 * Sem prefixo, comportamento de inclusão usual.
 */
export const passaFiltroBuscaTexto = (blobNormalizado, termoBruto) => {
    const bruto = String(termoBruto || '').trim()
    if (!bruto) return true
    const norm = normalizarTextoBusca(bruto)
    let negativo = false
    let consulta = norm
    if (norm.startsWith('not ')) {
        negativo = true
        consulta = norm.slice(4).trim()
    } else if (norm.startsWith('!')) {
        negativo = true
        consulta = norm.slice(1).trim()
    }
    if (!consulta) return true
    const achou = blobNormalizado.includes(consulta)
    return negativo ? !achou : achou
}

/** Filtro de lista: com `usarNot`, aceita NOT/!; senão, inclusão simples. */
export const filtrarPorTermoBusca = (blobNormalizado, termoBruto, usarNot = false) => {
    if (usarNot) return passaFiltroBuscaTexto(blobNormalizado, termoBruto)
    const n = normalizarTextoBusca(termoBruto)
    if (!n) return true
    return blobNormalizado.includes(n)
}

/** Endereço do cadastro preenchido de forma a definir a cidade principal pelo bloco Endereço. */
export const enderecoCadastroCompleto = (prestador) => {
    const p = prestador || {}
    return (
        campoPreenchido(p.cep) &&
        (campoPreenchido(p.endereco_logradouro) || campoPreenchido(p.endereco)) &&
        campoPreenchido(p.endereco_numero) &&
        campoPreenchido(p.endereco_bairro) &&
        campoPreenchido(p.endereco_cidade) &&
        campoPreenchido(p.endereco_uf)
    )
}

const nomeCidadeNoMapa = (mapa, cidadeId) => {
    if (!cidadeId) return ''
    const hit = mapa.get(Number(cidadeId))
    if (!hit) return ''
    if (typeof hit === 'string') return hit
    return String(hit.nome || '').trim()
}

/**
 * Cidade principal para listas, filtros e badges.
 * Com endereço completo, usa `endereco_cidade`; caso contrário, relação principal / `cidade_id`.
 */
export const resolverCidadePrincipalNome = (prestador, opcoes = {}) => {
    const { mapaCidadeNomePorId = new Map(), relacoesCidades = [] } = opcoes
    const p = prestador || {}

    if (enderecoCadastroCompleto(p)) {
        const end = String(p.endereco_cidade || '').trim()
        if (end) return end
    }

    const rels = relacoesCidades || []
    const principal = rels.find((r) => r.principal) || rels[0]
    const viaRel = principal ? nomeCidadeNoMapa(mapaCidadeNomePorId, principal.cidade_id) : ''
    if (viaRel) return viaRel

    const viaId = nomeCidadeNoMapa(mapaCidadeNomePorId, p.cidade_id)
    if (viaId) return viaId

    const endParcial = String(p.endereco_cidade || '').trim()
    return endParcial || '—'
}
