/**
 * Regras puras da rede credenciada para a API pública (/api/v1/rede/*). Sem I/O: recebe as linhas cruas do
 * Supabase (BaseRede, lidas em lote pela rota) e devolve os credenciados já montados, filtrados e no formato público
 * (docs/api/especificacao-design.md, seções 6.2 e 6.3).
 *
 * Procedimentos por plano (decisão): mesma regra de elegibilidade de Planos > Impressão
 * (src/lib/impressaoPlanos/carregarLinhasImpressaoPlanos.js, filtro `procedimentosElegiveis`): um procedimento entra no
 * plano P quando `procedimentoPertenceAoPlanoSelecionado(plano_base_id, P)` — hierarquia Básico ⊂ Clássico ⊂ Avançado ⊂
 * Ultra pelo `plano_base_id` do procedimento. Lá o procedimento de plano base «Apenas loja» aparece só como linha
 * informativa (não selecionável, fora do PDF); aqui ele sai quando há plano, porque não é cobertura do plano. A
 * impressão ainda cruza com os códigos de `planos_cidade` de UMA cidade da tabela; na API o credenciado pode atender
 * várias cidades, então, como diz a especificação (6.2), o plano filtra o credenciado pela cidade (alguma cidade dele
 * tem tabela do plano em `planos_cidade`) e os procedimentos só pela hierarquia. Sem plano, saem todos.
 *
 * Cidades e vínculo com clínica copiados de zap-emerlab/server/quemRealiza.js (normalização de município, "Porto
 * Alegre e Região" ↔ "Porto Alegre", vet vinculado herda cidade/UF e "cidades que atende" da clínica, vínculo principal
 * ganha). O Zap não entra no bundle do app, por isso a lógica está copiada. Mudou lá, confira aqui.
 *
 * @typedef {{
 *   prestadores: object[], situacoes: object[], estabelecimentos: object[], procedimentos: object[],
 *   prestadorProcedimentos: object[], prestadorCidades: object[], cidadesCredenciamento: object[],
 *   especialidades: object[], prestadorEspecialidades?: object[], beneficios: object[], prestadorBeneficios: object[],
 *   beneficiosObs: object[], planos: object[], planosCidade: object[],
 *   cidades?: object[], municipiosVinculo?: object[], categorias?: object[],
 * }} BaseRede
 *   - prestadores: id, nome, ativo, situacao_id, especialidade_id, tipo, telefone, celular, endereco_logradouro,
 *     endereco_numero, endereco_complemento, endereco_bairro, endereco_cidade, endereco_uf, cep e, opcional, endereco
 *     (texto livre antigo, usado só quando os campos separados estão vazios)
 *   - situacoes: id, descricao · estabelecimentos (prestador_estabelecimentos): veterinario_id, estabelecimento_id, principal
 *   - procedimentos: id, codigo, nome, categoria_id, plano_base_id · categorias: id, nome
 *   - prestadorProcedimentos: prestador_id, procedimento_cod, procedimento_id, nome_alternativo
 *   - prestadorCidades: prestador_id, cidade_id · cidadesCredenciamento: id, nome, uf
 *   - especialidades: id, nome, tipo ('Local' | 'Especialidade') · prestadorEspecialidades: prestador_id, especialidade_id, principal
 *   - beneficios (beneficios_catalogo): id, nome, grupo_nome, ordem, ativo
 *   - prestadorBeneficios: prestador_id, beneficio_id, percentual, percentual_max, incluir, ordem
 *   - beneficiosObs (prestador_beneficios_obs): prestador_id, observacoes
 *   - planos: id, nome · planosCidade: plano_id, cidade_id (basta um por par; procedimento_cod é ignorado)
 *   - cidades (tabela de valores): id, nome, uf · municipiosVinculo (cidades_municipios_vinculo): cidade_id, uf, municipio_nome
 */
import { normalizarTextoBusca, situacaoDescricaoEhCredenciado } from '../prestadorCadastroHelpers.js'
import {
    CHAVE_PLANO_APENAS_LOJA,
    mapearPlanos,
    obterChavePlanoPorId,
    ORDEM_PLANOS,
    procedimentoPertenceAoPlanoSelecionado,
} from '../planosHierarquia.js'

/** Erro de parâmetro do cliente; a rota devolve HTTP 400 com `codigo`. */
export class ErroValidacao extends Error {
    constructor(codigo, mensagem) {
        super(mensagem || codigo)
        this.name = 'ErroValidacao'
        this.codigo = codigo
    }
}

// especialidades de estabelecimento (clínica 24h, clínica, consultório, laboratório): não herdam cidade de clínica
// (ESPECIALIDADES_ESTABELECIMENTO_IDS em prestadorCadastroHelpers.js e no quemRealiza.js do Zap)
const ESPECIALIDADES_ESTABELECIMENTO = new Set([1, 2, 3, 5])

const texto = (v) => {
    const t = String(v ?? '').trim()
    return t || null
}
const siglaUf = (v) => String(v ?? '').trim().toUpperCase()
const numeroOuNulo = (v) => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
}
const normCodigo = (c) => String(c || '').trim().toUpperCase()
const compararNome = (a, b) => String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base' })

/**
 * Situação "Credenciado" (situacaoDescricaoEhCredenciado: descrição contém CREDENCIAD), sem aceitar negações como
 * "Descredenciado", "Não credenciado" ou "Ex-credenciado", que também contêm CREDENCIAD.
 */
export function situacaoEhCredenciado(descricao) {
    if (!situacaoDescricaoEhCredenciado(descricao)) return false
    const n = normalizarTextoBusca(descricao)
    return !/descredenciad|\b(nao|ex)\s+credenciad/.test(n)
}

// cópia de nucleoMunicipio/cidadeCompativel (zap-emerlab/server/quemRealiza.js)
const normBasico = (t) =>
    String(t || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .trim()
        .toLowerCase()

/** "Porto Alegre e Região" → "porto alegre": sem acento, minúsculo, sem sufixo de região metropolitana. */
export function normalizarMunicipio(nome) {
    return normBasico(nome)
        .replace(/\b(e\s+)?(regiao(\s+metropolitana)?|grande|rmpa|area\s+metropolitana|metro(politana)?)\b/g, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function municipioCompativel(nomeA, nomeB) {
    const a = normBasico(nomeA)
    const b = normBasico(nomeB)
    if (!a || !b) return false
    if (a === b) return true
    const nA = normalizarMunicipio(a)
    const nB = normalizarMunicipio(b)
    return Boolean(nA && nB && nA === nB)
}

// UF ausente de um dos lados não impede o casamento (mesma tolerância do Zap)
const ufCompativel = (a, b) => !a || !b || a === b

const cidadeCasa = (cidade, nome, uf) => municipioCompativel(cidade.nome, nome) && ufCompativel(cidade.uf, uf)

function agruparPor(linhas, chave) {
    const mapa = new Map()
    for (const r of linhas || []) {
        const k = Number(r[chave])
        if (!mapa.has(k)) mapa.set(k, [])
        mapa.get(k).push(r)
    }
    return mapa
}

function montarEndereco(p, cidade) {
    const logradouro = texto(p.endereco_logradouro)
    const numero = texto(p.endereco_numero)
    const bairro = texto(p.endereco_bairro)
    const nomeCidade = cidade?.nome || null
    const uf = cidade?.uf || null
    const rua = [logradouro, numero].filter(Boolean).join(', ')
    const local = [nomeCidade, uf].filter(Boolean).join('/')
    return {
        logradouro,
        numero,
        complemento: texto(p.endereco_complemento),
        bairro,
        cidade: nomeCidade,
        uf,
        cep: texto(p.cep),
        texto: [rua, bairro, local].filter(Boolean).join(' — ') || texto(p.endereco) || null,
    }
}

function urlWhatsapp(...numeros) {
    for (const n of numeros) {
        let d = String(n || '').replace(/\D/g, '')
        if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
        if (d.length === 10 || d.length === 11) return `https://wa.me/55${d}`
    }
    return null
}

/**
 * Credenciados ativos (situação Credenciado), em ordem de nome. Cada item guarda o necessário para filtrar e para
 * `paraPublico`; os campos com "_" são internos e nunca saem na resposta.
 * @param {BaseRede} base
 */
export function montarCredenciados(base) {
    const mapaPlanos = mapearPlanos(base.planos || [])
    const situacoesOk = new Set((base.situacoes || []).filter((s) => situacaoEhCredenciado(s.descricao)).map((s) => Number(s.id)))
    const especialidadePorId = new Map((base.especialidades || []).map((e) => [Number(e.id), e]))
    const ehLocal = (id) => normBasico(especialidadePorId.get(Number(id))?.tipo) === 'local'
    const categoriaPorId = new Map((base.categorias || []).map((c) => [Number(c.id), texto(c.nome)]))

    const ativos = (base.prestadores || []).filter((p) => p.ativo === true)
    const porId = new Map(ativos.map((p) => [Number(p.id), p]))

    // veterinário → clínica (o vínculo principal ganha); a clínica vem de todos os ativos, credenciada ou não
    const clinicaDoVet = new Map()
    for (const v of base.estabelecimentos || []) {
        const est = porId.get(Number(v.estabelecimento_id))
        if (!est) continue
        const vet = Number(v.veterinario_id)
        if (v.principal || !clinicaDoVet.has(vet)) clinicaDoVet.set(vet, est)
    }

    const cidadeCredPorId = new Map((base.cidadesCredenciamento || []).map((c) => [Number(c.id), c]))
    const cidadesDe = agruparPor(base.prestadorCidades, 'prestador_id')
    const especialidadesDe = agruparPor(base.prestadorEspecialidades, 'prestador_id')

    // procedimentos: pelo código ou, em linhas antigas, só pelo id
    const procPorCodigo = new Map()
    const codigoPorId = new Map()
    for (const r of base.procedimentos || []) {
        const cod = normCodigo(r.codigo)
        if (!cod) continue
        procPorCodigo.set(cod, r)
        codigoPorId.set(Number(r.id), cod)
    }
    const procedimentosDe = agruparPor(base.prestadorProcedimentos, 'prestador_id')

    const beneficioPorId = new Map((base.beneficios || []).filter((b) => b.ativo !== false).map((b) => [Number(b.id), b]))
    const beneficiosDe = agruparPor((base.prestadorBeneficios || []).filter((b) => b.incluir === true), 'prestador_id')
    const obsDe = new Map((base.beneficiosObs || []).map((o) => [Number(o.prestador_id), texto(o.observacoes)]))

    // municípios de cada plano: cidades da tabela de valores com linha em planos_cidade + municípios vinculados
    const cidadeTabelaPorId = new Map((base.cidades || []).map((c) => [Number(c.id), c]))
    const municipiosDaCidade = new Map()
    const addMunicipio = (cidadeId, nome, uf) => {
        if (!texto(nome)) return
        if (!municipiosDaCidade.has(cidadeId)) municipiosDaCidade.set(cidadeId, [])
        municipiosDaCidade.get(cidadeId).push({ nome: String(nome).trim(), uf: siglaUf(uf) })
    }
    for (const c of base.cidades || []) addMunicipio(Number(c.id), c.nome, c.uf)
    for (const v of base.municipiosVinculo || []) {
        const cid = Number(v.cidade_id)
        addMunicipio(cid, v.municipio_nome, v.uf || cidadeTabelaPorId.get(cid)?.uf)
    }
    const cidadesDoPlano = new Map()
    for (const r of base.planosCidade || []) {
        if (r.cidade_id === null || r.cidade_id === undefined) continue
        const pid = Number(r.plano_id)
        if (!cidadesDoPlano.has(pid)) cidadesDoPlano.set(pid, new Set())
        cidadesDoPlano.get(pid).add(Number(r.cidade_id))
    }
    const municipiosDoPlano = [...cidadesDoPlano].map(([pid, cids]) => [pid, [...cids].flatMap((c) => municipiosDaCidade.get(c) || [])])

    const rede = []
    for (const p of ativos) {
        if (!situacoesOk.has(Number(p.situacao_id))) continue
        const id = Number(p.id)
        const espLinhas = especialidadesDe.get(id) || []
        const principalId = Number(p.especialidade_id) || Number(espLinhas.find((e) => e.principal)?.especialidade_id) || null
        const secundariasIds = [...new Set(espLinhas.filter((e) => !e.principal).map((e) => Number(e.especialidade_id)))].filter(
            (e) => e && e !== principalId && especialidadePorId.has(e),
        )
        const est = principalId && ESPECIALIDADES_ESTABELECIMENTO.has(principalId) ? null : clinicaDoVet.get(id) || null
        const nomeCidade = texto(est ? (est.endereco_cidade ?? p.endereco_cidade) : p.endereco_cidade)
        const uf = siglaUf(est ? (est.endereco_uf ?? p.endereco_uf) : p.endereco_uf) || null
        const cidadePrincipal = nomeCidade ? { nome: nomeCidade, uf } : null

        const cidadesAtende = []
        const vistas = new Set()
        for (const r of cidadesDe.get(est ? Number(est.id) : id) || []) {
            const c = cidadeCredPorId.get(Number(r.cidade_id))
            const nome = texto(c?.nome)
            if (!nome) continue
            const item = { nome, uf: siglaUf(c.uf) || uf }
            const chave = `${normalizarMunicipio(nome)}|${item.uf || ''}`
            if (vistas.has(chave)) continue
            vistas.add(chave)
            cidadesAtende.push(item)
        }
        const todasCidades = [...(cidadePrincipal ? [cidadePrincipal] : []), ...cidadesAtende]

        const procedimentos = []
        const codigosVistos = new Map()
        for (const r of procedimentosDe.get(id) || []) {
            const cod = normCodigo(r.procedimento_cod) || codigoPorId.get(Number(r.procedimento_id))
            const proc = cod && procPorCodigo.get(cod)
            if (!proc) continue
            const alternativo = texto(r.nome_alternativo)
            if (codigosVistos.has(cod)) {
                const item = codigosVistos.get(cod)
                if (!item.nome_alternativo && alternativo) item.nome_alternativo = alternativo
                continue
            }
            const item = {
                codigo: cod,
                nome: texto(proc.nome) || cod,
                nome_alternativo: alternativo,
                categoria: categoriaPorId.get(Number(proc.categoria_id)) || null,
                planoBaseId: proc.plano_base_id,
            }
            codigosVistos.set(cod, item)
            procedimentos.push(item)
        }

        const descontos = (beneficiosDe.get(id) || [])
            .map((b) => ({ linha: b, cat: beneficioPorId.get(Number(b.beneficio_id)) }))
            .filter((x) => x.cat)
            .sort((a, b) => (Number(a.linha.ordem) || 0) - (Number(b.linha.ordem) || 0) || (Number(a.cat.ordem) || 0) - (Number(b.cat.ordem) || 0))
            .map(({ linha, cat }) => ({
                nome: texto(cat.nome),
                grupo: texto(cat.grupo_nome),
                percentual: numeroOuNulo(linha.percentual),
                percentual_max: numeroOuNulo(linha.percentual_max),
            }))

        const fonteContato = !texto(p.telefone) && !texto(p.celular) && est ? est : p
        const nomeEsp = (e) => texto(especialidadePorId.get(e)?.nome)

        rede.push({
            id,
            nome: texto(p.nome) || '',
            tipo: principalId ? (ehLocal(principalId) ? 'local' : 'especialidade') : normBasico(p.tipo) === 'local' ? 'local' : 'especialidade',
            especialidadePrincipalId: principalId,
            especialidadePrincipal: principalId ? nomeEsp(principalId) : null,
            especialidadesSecundariasIds: secundariasIds,
            especialidadesSecundarias: secundariasIds.map(nomeEsp).filter(Boolean).sort(compararNome),
            temLocal: [principalId, ...secundariasIds].some((e) => e && ehLocal(e)),
            contatos: {
                telefone: texto(fonteContato.telefone),
                celular: texto(fonteContato.celular),
                whatsapp_url: urlWhatsapp(fonteContato.celular, fonteContato.telefone),
            },
            cidadePrincipal,
            cidadesAtende,
            endereco: montarEndereco(p, cidadePrincipal),
            procedimentos,
            descontos: { itens: descontos, observacoes: obsDe.get(id) || null },
            planosAtendidos: municipiosDoPlano
                .filter(([, municipios]) => todasCidades.some((c) => municipios.some((m) => cidadeCasa(c, m.nome, m.uf))))
                .map(([pid]) => pid),
            _nomeBusca: normalizarTextoBusca(p.nome),
            _mapaPlanos: mapaPlanos,
            _especialidades: especialidadePorId,
        })
    }
    return rede.sort((a, b) => compararNome(a.nome, b.nome) || a.id - b.id)
}

/**
 * Id do plano a partir de id, chave (`basico`, `classico`, `avancado`, `ultra`) ou nome. «Apenas loja» e planos
 * desconhecidos lançam ErroValidacao('plano_invalido').
 * @param {object[]|object} planos linhas de `planos` ou o resultado de `mapearPlanos`
 */
export function resolverPlanoId(planos, valor) {
    const mapa = Array.isArray(planos) ? mapearPlanos(planos) : planos || {}
    const invalido = () => new ErroValidacao('plano_invalido', 'Plano inválido. Use o id ou basico, classico, avancado ou ultra.')
    const bruto = String(valor ?? '').trim()
    if (!bruto) throw invalido()
    let id
    if (/^\d+$/.test(bruto)) {
        id = Number(bruto)
    } else {
        const chave = normalizarTextoBusca(bruto).replace(/\s+/g, '_')
        const porChave = ORDEM_PLANOS.includes(chave) ? chave : ORDEM_PLANOS.find((k) => mapa[k] && normalizarTextoBusca(mapa[k].nome) === normalizarTextoBusca(bruto))
        if (!porChave) throw invalido()
        id = Number(mapa[porChave]?.id)
    }
    const chave = obterChavePlanoPorId(id, mapa)
    if (!chave || chave === CHAVE_PLANO_APENAS_LOJA) throw invalido()
    return id
}

// valida a chave sem a tabela de planos (lista vazia): só as chaves conhecidas passam
function validarPlanoSemCatalogo(valor) {
    const bruto = String(valor ?? '').trim()
    if (/^\d+$/.test(bruto)) return
    if (!ORDEM_PLANOS.includes(normalizarTextoBusca(bruto).replace(/\s+/g, '_'))) {
        throw new ErroValidacao('plano_invalido', 'Plano inválido. Use o id ou basico, classico, avancado ou ultra.')
    }
}

function casaEspecialidade(c, valor) {
    const bruto = String(valor ?? '').trim()
    const ids = [c.especialidadePrincipalId, ...c.especialidadesSecundariasIds].filter(Boolean)
    if (/^\d+$/.test(bruto)) return ids.includes(Number(bruto))
    const alvo = normalizarTextoBusca(bruto)
    return ids.some((e) => normalizarTextoBusca(c._especialidades.get(e)?.nome) === alvo)
}

/**
 * Filtros de GET /rede/credenciados. Parâmetros vazios são ignorados.
 * @param {ReturnType<typeof montarCredenciados>} lista
 * @param {{ uf?: string, cidade?: string, especialidade?: string|number, tipo?: string, plano?: string|number, q?: string }} f
 */
export function filtrarCredenciados(lista, f = {}) {
    const vazio = (v) => v === undefined || v === null || String(v).trim() === ''
    let saida = lista || []

    if (!vazio(f.tipo)) {
        const tipo = normBasico(f.tipo)
        if (tipo !== 'local' && tipo !== 'especialidade') throw new ErroValidacao('tipo_invalido', 'tipo deve ser local ou especialidade.')
        saida = saida.filter((c) => c.temLocal === (tipo === 'local'))
    }
    if (!vazio(f.plano)) {
        if (!(lista || []).length) {
            validarPlanoSemCatalogo(f.plano)
            return []
        }
        const planoId = resolverPlanoId(lista[0]._mapaPlanos, f.plano)
        saida = saida.filter((c) => c.planosAtendidos.includes(planoId))
    }
    const uf = vazio(f.uf) ? '' : siglaUf(f.uf)
    const cidade = vazio(f.cidade) ? '' : String(f.cidade).trim()
    if (uf || cidade) {
        saida = saida.filter((c) =>
            [...(c.cidadePrincipal ? [c.cidadePrincipal] : []), ...c.cidadesAtende].some((cid) =>
                cidade ? cidadeCasa(cid, cidade, uf) : cid.uf === uf,
            ),
        )
    }
    if (!vazio(f.especialidade)) saida = saida.filter((c) => casaEspecialidade(c, f.especialidade))
    if (!vazio(f.q)) {
        const termos = normalizarTextoBusca(f.q).split(' ').filter(Boolean)
        saida = saida.filter((c) => termos.every((t) => c._nomeBusca.includes(t)))
    }
    return saida
}

/**
 * Objeto público da seção 6.3, montado campo a campo (lista fechada): nada do cadastro interno sai daqui.
 * @param {{ planoId?: number|string }} [opcoes] com plano, os procedimentos são cortados pela hierarquia
 */
export function paraPublico(c, opcoes = {}) {
    let procs = c.procedimentos
    if (opcoes.planoId !== undefined && opcoes.planoId !== null && opcoes.planoId !== '') {
        const planoId = resolverPlanoId(c._mapaPlanos, opcoes.planoId)
        procs = procs.filter((p) => procedimentoPertenceAoPlanoSelecionado(p.planoBaseId, planoId, c._mapaPlanos))
    }
    const grupos = new Map()
    for (const p of procs) {
        if (!grupos.has(p.categoria)) grupos.set(p.categoria, [])
        grupos.get(p.categoria).push({ codigo: p.codigo, nome: p.nome, nome_alternativo: p.nome_alternativo })
    }
    const procedimentos = [...grupos]
        .sort(([a], [b]) => (a === null) - (b === null) || compararNome(a || '', b || ''))
        .map(([categoria, itens]) => ({ categoria, itens: itens.sort((a, b) => compararNome(a.codigo, b.codigo)) }))

    return {
        id: c.id,
        nome: c.nome,
        tipo: c.tipo,
        especialidade_principal: c.especialidadePrincipal,
        especialidades_secundarias: [...c.especialidadesSecundarias],
        contatos: { telefone: c.contatos.telefone, celular: c.contatos.celular, whatsapp_url: c.contatos.whatsapp_url },
        cidade_principal: c.cidadePrincipal ? { nome: c.cidadePrincipal.nome, uf: c.cidadePrincipal.uf } : null,
        cidades_atende: c.cidadesAtende.map((x) => ({ nome: x.nome, uf: x.uf })),
        endereco: c.temLocal ? { ...c.endereco } : null,
        procedimentos,
        descontos: {
            itens: c.descontos.itens.map((d) => ({ nome: d.nome, grupo: d.grupo, percentual: d.percentual, percentual_max: d.percentual_max })),
            observacoes: c.descontos.observacoes,
        },
    }
}
