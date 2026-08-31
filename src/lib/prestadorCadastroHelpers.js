import { maskCNPJ, maskCPF } from './contratos/mascarasDocumento.js'
import { maskTelefoneBr } from './telefoneBrasil.js'

export const formatarTelefoneEntrada = maskTelefoneBr

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
]

export const TIPO_REPASSE_DICA =
    'Se o atendimento é feito pelo CPF, escolha RPA. Se o veterinário possui CNPJ, escolha Nota.'

/** Inclui valores antigos (ex.: boleto) só para exibir o que já está gravado. */
export function opcoesTipoRepasse(valorAtual) {
    const base = TIPOS_REPASSE
    const v = String(valorAtual || '').trim().toLowerCase()
    if (!v || base.some((t) => t.value === v)) return base
    const legado = { boleto: 'Boleto' }[v]
    return [...base, { value: v, label: legado || v }]
}

export const normalizarTextoBusca = (texto) =>
    String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

/** Palavras do termo já normalizado (sem acentos / pontuação). */
export function tokensTermoBusca(termoNormalizado) {
    return String(termoNormalizado || '')
        .split(' ')
        .map((t) => t.trim())
        .filter(Boolean)
}

/** Todas as palavras do termo devem aparecer no texto normalizado (ordem livre). */
export function blobContemTermoBusca(blobNormalizado, termoNormalizado) {
    if (!termoNormalizado) return true
    const tokens = tokensTermoBusca(termoNormalizado)
    if (!tokens.length) return true
    return tokens.every((t) => blobNormalizado.includes(t))
}

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

/** Deduz o tipo de chave PIX a partir do valor salvo (edição de cadastro sem tipo_pix na base). */
export const inferirTipoPixDaChave = (chave) => {
    const s = String(chave || '').trim()
    if (!s) return ''
    if (s.includes('@')) return 'email'
    const digits = s.replace(/\D/g, '')
    if (digits.length === 14) return 'cnpj'
    if (digits.length === 11) {
        if (/[().\s-]/.test(s) && !s.includes('/')) return 'telefone'
        return 'cpf'
    }
    if (digits.length >= 10 && digits.length <= 13) return 'telefone'
    return ''
}

export const formatarChavePixEntrada = (valor, tipoPix) => {
    const t = String(tipoPix || '').toLowerCase()
    if (t === 'email') return formatarEmailEntrada(valor)
    if (t === 'cpf') return maskCPF(String(valor || '').replace(/\D/g, '').slice(0, 11))
    if (t === 'cnpj') return maskCNPJ(String(valor || '').replace(/\D/g, '').slice(0, 14))
    if (t === 'telefone') return maskTelefoneBr(valor)
    return String(valor || '').toLowerCase()
}

export const normalizarChavePixParaSalvar = (valor, tipoPix) => {
    const t = String(tipoPix || '').toLowerCase()
    if (!String(valor || '').trim()) return null
    if (t === 'email') return normalizarEmailParaSalvar(valor)
    if (t === 'cpf') {
        const d = String(valor || '').replace(/\D/g, '').slice(0, 11)
        return d || null
    }
    if (t === 'cnpj') {
        const d = String(valor || '').replace(/\D/g, '').slice(0, 14)
        return d || null
    }
    if (t === 'telefone') {
        const d = String(valor || '').replace(/\D/g, '')
        return d || null
    }
    return String(valor || '').trim().toLowerCase()
}

const normalizarDescricaoSituacao = (descricao) =>
    String(descricao || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()

/** Descrição indica situação credenciado (ex.: CREDENCIADO). */
export const situacaoDescricaoEhCredenciado = (descricao) =>
    normalizarDescricaoSituacao(descricao).includes('CREDENCIAD')

/** ID da situação «Credenciado» para filtro/cadastro padrão. */
export const acharSituacaoCredenciadoId = (situacoes) => {
    const hit = (situacoes || []).find((s) => situacaoDescricaoEhCredenciado(s.descricao))
    return hit != null ? String(hit.id) : ''
}

export const descricaoSituacaoPrestador = (prestador, situacoes) => {
    const sid = Number(prestador?.situacao_id)
    if (!sid) return ''
    return (situacoes || []).find((s) => Number(s.id) === sid)?.descricao || ''
}

export const prestadorEhCredenciado = (prestador, situacoes) =>
    situacaoDescricaoEhCredenciado(descricaoSituacaoPrestador(prestador, situacoes))

/**
 * Se a situação está mudando para Credenciado (e antes não era),
 * devolve `{ credenciado_em: ISO }`. Caso contrário `{}`.
 * O trigger no banco também cobre isso; o app envia para refletir na UI imediatamente.
 */
export const patchCredenciadoEmSeTransicao = (situacaoIdAnterior, situacaoIdNova, situacoes) => {
    const era = situacaoDescricaoEhCredenciado(
        (situacoes || []).find((s) => Number(s.id) === Number(situacaoIdAnterior))?.descricao,
    )
    const sera = situacaoDescricaoEhCredenciado(
        (situacoes || []).find((s) => Number(s.id) === Number(situacaoIdNova))?.descricao,
    )
    if (sera && !era) {
        return { credenciado_em: new Date().toISOString() }
    }
    return {}
}

/** Situação «Preenchendo formulário(s)» ou equivalente. */
export const acharSituacaoPreenchendoFormularioId = (situacoes) => {
    const lista = situacoes || []
    const porCodigo = lista.find((s) => {
        const c = String(s.codigo || '')
            .trim()
            .toUpperCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^A-Z0-9]+/g, '_')
        return c === 'PREENCHENDO_FORMULARIO' || c === 'PREENCHENDO_FORMULARIOS' || c === 'PREENCH_FORM'
    })
    if (porCodigo != null) return String(porCodigo.id)
    const hit = lista.find((s) => {
        const t = normalizarDescricaoSituacao(s.descricao)
        return t.includes('PREENCH') && (t.includes('FORMUL') || t.includes('FORM'))
    })
    return hit != null ? String(hit.id) : ''
}

/**
 * Situação legada «Aguardando Formulário» (redundante com Preenchendo Formulários).
 * Mantida só para ocultar/migrar registros antigos no banco.
 */
export function situacaoEhAguardandoFormularioLegado(situacao) {
    if (!situacao) return false
    const c = String(situacao.codigo || '')
        .trim()
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9]+/g, '_')
    if (
        c === 'AGUARDANDO_FORMULARIO' ||
        c === 'AGUARDANDO_FORMULARIOS' ||
        c === 'AGUARD_FORM' ||
        c === 'AGUARDANDO_FORM'
    ) {
        return true
    }
    const t = normalizarDescricaoSituacao(situacao.descricao)
    if (t === 'AGUARDANDO FORMULARIO' || t === 'AGUARDANDO FORMULARIOS') return true
    return t.includes('AGUARD') && (t.includes('FORMUL') || t.includes('FORM')) && !t.includes('PREENCH')
}

/** Remove a situação legada das listas de seleção (relatório, filtros, cadastro). */
export function filtrarSituacoesSemAguardandoFormulario(situacoes = []) {
    return (situacoes || []).filter((s) => !situacaoEhAguardandoFormularioLegado(s))
}

/** Situações disponíveis no relatório PDF de cadastros. */
export function situacoesParaRelatorioCadastros(situacoes = []) {
    return filtrarSituacoesSemAguardandoFormulario(situacoes)
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
 * Sintaxe avançada de busca (sem tip na UI):
 * - texto normal: todas as palavras (AND)
 * - (a, b, c): OR entre itens
 * - !y ou NOT y: exclui quem contém y
 * - !(a, b) ou NOT (a, b): exclui quem contém qualquer item
 * Cláusulas separadas por espaço fora de parênteses combinam com AND.
 */
export function parseClausulasBuscaAvancada(termoBruto) {
    const s = String(termoBruto || '').trim()
    if (!s) return []
    const clausulas = []
    let i = 0
    while (i < s.length) {
        while (i < s.length && /\s/.test(s[i])) i += 1
        if (i >= s.length) break

        let neg = false
        const restoLower = s.slice(i).toLowerCase()
        if (restoLower.startsWith('not ') || restoLower === 'not') {
            neg = true
            i += 3
            while (i < s.length && /\s/.test(s[i])) i += 1
        } else if (s[i] === '!') {
            neg = true
            i += 1
            while (i < s.length && /\s/.test(s[i])) i += 1
        }

        if (i >= s.length) break

        if (s[i] === '(') {
            const end = s.indexOf(')', i)
            if (end === -1) {
                const norm = normalizarTextoBusca(s.slice(i))
                if (norm) clausulas.push({ neg, tipo: 'and', texto: norm })
                break
            }
            const alts = s
                .slice(i + 1, end)
                .split(',')
                .map((p) => normalizarTextoBusca(p))
                .filter(Boolean)
            if (alts.length) clausulas.push({ neg, tipo: 'or', textos: alts })
            i = end + 1
            continue
        }

        let j = i
        while (j < s.length) {
            if (s[j] === '(') break
            if (s[j] === '!' && (j === i || /\s/.test(s[j - 1]))) break
            if (/\s/.test(s[j])) {
                const after = s.slice(j)
                if (/^\s+not(?:\s+|\(|$)/i.test(after) || /^\s+!/.test(after) || /^\s+\(/.test(after)) {
                    break
                }
            }
            j += 1
        }
        const pedaco = s.slice(i, j).trim()
        const norm = normalizarTextoBusca(pedaco)
        if (norm) clausulas.push({ neg, tipo: 'and', texto: norm })
        i = j
    }
    return clausulas
}

function avaliaClausulaBusca(blobNormalizado, clausula) {
    let ok = false
    if (clausula.tipo === 'or') {
        ok = (clausula.textos || []).some((t) => blobContemTermoBusca(blobNormalizado, t))
    } else {
        ok = blobContemTermoBusca(blobNormalizado, clausula.texto || '')
    }
    return clausula.neg ? !ok : ok
}

/** Filtro de texto com sintaxe avançada (!, NOT, (a,b,c)). */
export const passaFiltroBuscaTexto = (blobNormalizado, termoBruto) => {
    const bruto = String(termoBruto || '').trim()
    if (!bruto) return true
    const clausulas = parseClausulasBuscaAvancada(bruto)
    if (!clausulas.length) return true
    return clausulas.every((c) => avaliaClausulaBusca(blobNormalizado, c))
}

/**
 * Filtro de lista com sintaxe avançada sempre ativa.
 * O 3º argumento é ignorado (compatibilidade com call sites antigos do Dev Tool).
 */
export const filtrarPorTermoBusca = (blobNormalizado, termoBruto, _usarNot = false) =>
    passaFiltroBuscaTexto(blobNormalizado, termoBruto)

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
