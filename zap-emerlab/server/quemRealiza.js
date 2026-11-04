// Regra services {…} das respostas rápidas: mesma busca do Credenciamento > Quem realiza do projeto principal
// (src/lib/buscarQuemRealizaPrestadores.js → pesquisarQuemRealizaNaRede), com as opções padrão da tela:
//   - prestadores ativos com situação "Credenciado", de qualquer especialidade (clínicas e laboratórios incluídos);
//   - veterinário vinculado a clínica/equipe (prestador_estabelecimentos) usa a cidade e a UF da clínica;
//   - cidade pelo endereço do cadastro (endereco_cidade/endereco_uf), aceitando "Porto Alegre e Região" ↔ "Porto Alegre";
//     a lista "Cidades que atende" fica de fora, como na tela com "cidades paralelas" desmarcado;
//   - procedimento no perfil do prestador (prestador_procedimentos, pelo código ou pelo id do procedimento).
// O app principal não entra no bundle deste painel, por isso a regra está copiada aqui. Mudou lá, mude aqui.
//
// Marcas {credenciados.clinicas|veterinarios|laboratorio|descontos}: a mesma base, com a lista "Cidades que
// atende" ligada (como Credenciamento > Especialidades por cidade / Quem realiza com "cidades paralelas"):
// atende a cidade quem tem o endereço nela OU a tem como cidade adicional no perfil (prestador_cidades).
// Vet vinculado a clínica usa as cidades adicionais da clínica (idsPrestadorCidadesParaFiltro).
import { db, ok } from './db.js'
import { memo } from './cache.js'
import { normCodigo } from '../src/regras.js'

const PAGINA = 1000
// A base são 8 tabelas lidas inteiras e quase não muda. `memo` junta as chamadas simultâneas: antes, quando o cache
// vencia, cada requisição em andamento refazia as 8 leituras (≈1.500 cargas/dia no Supabase).
const VALIDADE_MS = 60 * 60 * 1000
// ver ESPECIALIDADES_ESTABELECIMENTO_IDS no projeto principal (clínica, hospital, equipe, laboratório)
const ESPECIALIDADES_ESTABELECIMENTO = new Set([1, 2, 3, 5])
// classificação das marcas {credenciados.*}: 1 Clínica 24h, 2 Clínica, 3 Consultório (e Hospital, pelo nome) · 5 Laboratório.
// Veterinário = prestador do tipo "Especialidade" (tipoEspecialidadePrestador no projeto principal); os demais do tipo
// "Local" (hotel, banho e tosa, petshop, farmácia, comércio…) só entram em descontos.
const CLINICAS = new Set([1, 2, 3])
const ESPECIALIDADE_LABORATORIO = 5

const primeiroTelefone = (p) => (p ? [p.celular, p.telefone].map((t) => String(t || '').trim()).find(Boolean) || '' : '')

// linha de cada credenciado nas marcas {credenciados.*}: seta no início (no celular a quebra de linha confunde onde
// começa cada um), "Nome - Tel" e, para volantes, "Nome - Especialidade - Tel"
const linhaCredenciado = (p) => `➡️ ${[p.nome, ...(p.volante && p.especialidade ? [p.especialidade] : []), p.telefone].join(' - ')}`

const norm = (t) =>
    String(t || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .trim()
        .toLowerCase()

// "porto alegre e regiao" → "porto alegre"
function nucleoMunicipio(nomeNorm) {
    return String(nomeNorm || '')
        .replace(/\b(e\s+)?(regiao(\s+metropolitana)?|grande|rmpa|area\s+metropolitana|metro(politana)?)\b/g, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function cidadeCompativel(nomeCadastro, alvo) {
    const a = norm(alvo)
    const c = norm(nomeCadastro)
    if (!a || !c) return false
    if (a === c) return true
    const nA = nucleoMunicipio(a)
    const nC = nucleoMunicipio(c)
    return Boolean(nA && nC && nA === nC)
}

// endereço do prestador na cidade/UF alvo (sem UF no cadastro também vale, como no projeto principal)
function enderecoNaCidade(p, uf, cidade) {
    if (!cidadeCompativel(p.endereco_cidade, cidade)) return false
    const ufEnd = String(p.endereco_uf || '').trim().toUpperCase()
    return !uf || !ufEnd || ufEnd === uf
}

async function todas(montar) {
    const linhas = []
    for (let inicio = 0; ; inicio += PAGINA) {
        const lote = ok(await montar().range(inicio, inicio + PAGINA - 1)) || []
        linhas.push(...lote)
        if (lote.length < PAGINA) return linhas
    }
}

// prestadores credenciados com a localidade já resolvida e o catálogo de procedimentos, guardados por 60 min
function carregarBase() {
    return memo('quemrealiza:base', VALIDADE_MS, carregarBaseDoBanco)
}

async function carregarBaseDoBanco() {
    const [prestadores, situacoes, vinculos, procedimentos, adicionais, cidadesCred, especialidades, beneficios] = await Promise.all([
        todas(() =>
            db().from('prestadores').select('id, nome, especialidade_id, endereco_uf, endereco_cidade, situacao_id, telefone, celular, tipo').eq('ativo', true).order('id'),
        ),
        todas(() => db().from('situacoes').select('id, descricao').order('id')),
        todas(() =>
            db().from('prestador_estabelecimentos').select('veterinario_id, estabelecimento_id, principal').order('veterinario_id').order('estabelecimento_id'),
        ),
        todas(() => db().from('procedimentos').select('id, codigo, nome').order('id')),
        todas(() => db().from('prestador_cidades').select('prestador_id, cidade_id').order('prestador_id').order('cidade_id')),
        todas(() => db().from('cidades_credenciamento').select('id, nome').order('id')),
        todas(() => db().from('especialidades').select('id, nome').order('id')),
        todas(() => db().from('prestador_beneficios').select('prestador_id').eq('incluir', true).order('prestador_id')),
    ])
    const nomeCidadeCred = new Map(cidadesCred.map((c) => [Number(c.id), String(c.nome || '')]))
    const cidadesDe = new Map() // prestador_id → nomes das cidades adicionais
    for (const r of adicionais) {
        const nome = nomeCidadeCred.get(Number(r.cidade_id))
        if (!nome) continue
        const pid = Number(r.prestador_id)
        if (!cidadesDe.has(pid)) cidadesDe.set(pid, [])
        cidadesDe.get(pid).push(nome)
    }
    // laboratório: id canônico ou especialidade com "laborat" no nome (prestadorEhLaboratorio)
    const laboratorio = new Set(especialidades.filter((e) => Number(e.id) === ESPECIALIDADE_LABORATORIO || norm(e.nome).includes('laborat')).map((e) => Number(e.id)))
    const clinicas = new Set([...CLINICAS, ...especialidades.filter((e) => norm(e.nome).includes('hospital')).map((e) => Number(e.id))])
    const comDesconto = new Set(beneficios.map((b) => Number(b.prestador_id)))
    const nomeEspecialidade = new Map(especialidades.map((e) => [Number(e.id), String(e.nome || '').trim()]))

    const credenciado = new Set(situacoes.filter((s) => norm(s.descricao).toUpperCase().includes('CREDENCIAD')).map((s) => Number(s.id)))
    const porId = new Map(prestadores.map((p) => [Number(p.id), p]))
    // veterinário → clínica (o vínculo principal ganha); a clínica vem de todos os ativos, credenciada ou não
    const clinicaDoVet = new Map()
    for (const v of vinculos) {
        const est = porId.get(Number(v.estabelecimento_id))
        if (!est) continue
        const vet = Number(v.veterinario_id)
        if (v.principal || !clinicaDoVet.has(vet)) clinicaDoVet.set(vet, est)
    }
    const rede = prestadores
        .filter((p) => credenciado.has(Number(p.situacao_id)))
        .map((p) => {
            const est = ESPECIALIDADES_ESTABELECIMENTO.has(Number(p.especialidade_id)) ? null : clinicaDoVet.get(Number(p.id))
            const esp = Number(p.especialidade_id)
            return {
                id: Number(p.id),
                nome: String(p.nome || '').trim(),
                endereco_cidade: est ? (est.endereco_cidade ?? p.endereco_cidade) : p.endereco_cidade,
                endereco_uf: est ? (est.endereco_uf ?? p.endereco_uf) : p.endereco_uf,
                tipo: laboratorio.has(esp)
                    ? 'laboratorio'
                    : clinicas.has(esp)
                      ? 'clinica'
                      : norm(p.tipo).includes('local') || ESPECIALIDADES_ESTABELECIMENTO.has(esp)
                        ? 'outro'
                        : 'veterinario',
                cidadesAdicionais: cidadesDe.get(est ? Number(est.id) : Number(p.id)) || [],
                desconto: comDesconto.has(Number(p.id)),
                // telefone como em Especialidades por cidade: vet vinculado usa o da clínica; celular antes do fixo
                telefone: primeiroTelefone(est) || primeiroTelefone(p) || '—',
                // volante: veterinário sem vínculo com clínica (prestador_estabelecimentos); o vinculado sai com o telefone da clínica
                volante: !norm(p.tipo).includes('local') && !ESPECIALIDADES_ESTABELECIMENTO.has(esp) && !est,
                especialidade: nomeEspecialidade.get(esp) || '',
            }
        })

    const catalogo = new Map()
    const codigoPorId = new Map()
    for (const r of procedimentos) {
        const cod = normCodigo(r.codigo)
        if (!cod) continue
        catalogo.set(cod, String(r.nome || cod).trim())
        codigoPorId.set(Number(r.id), cod)
    }
    return { rede, catalogo, codigoPorId }
}

/** Catálogo de procedimentos (código → nome) para conferir as regras services {…}. */
export async function catalogoProcedimentos() {
    return (await carregarBase()).catalogo
}

/**
 * Quem da rede realiza os códigos na cidade do contato.
 * @returns {Promise<{ realizadores: Record<string, number>, prestadores: Array<{ nome: string, codigos: string[] }> }>}
 *   realizadores: quantos prestadores por código (só os códigos com alguém); prestadores: nome e códigos de cada um
 */
export async function servicosNaCidade({ uf, cidade, codigos }) {
    const vazio = { realizadores: {}, prestadores: [] }
    const sigla = String(uf || '').trim().toUpperCase()
    const { rede, catalogo, codigoPorId } = await carregarBase()
    const pedidos = [...new Set((codigos || []).map(normCodigo))].filter((c) => catalogo.has(c))
    if (!String(cidade || '').trim() || !pedidos.length) return vazio

    const naCidade = new Map(rede.filter((p) => enderecoNaCidade(p, sigla, cidade)).map((p) => [p.id, p]))
    if (!naCidade.size) return vazio

    // vínculo pelo código ou, em linhas antigas, só pelo id do procedimento
    const ids = [...codigoPorId].filter(([, c]) => pedidos.includes(c)).map(([id]) => id)
    const [porCodigo, porIdProc] = await Promise.all([
        todas(() => db().from('prestador_procedimentos').select('id, prestador_id, procedimento_cod, procedimento_id').in('procedimento_cod', pedidos).order('id')),
        todas(() => db().from('prestador_procedimentos').select('id, prestador_id, procedimento_cod, procedimento_id').in('procedimento_id', ids).order('id')),
    ])

    const quem = new Map() // código → Set(prestador_id)
    for (const v of [...porCodigo, ...porIdProc]) {
        const pid = Number(v.prestador_id)
        if (!naCidade.has(pid)) continue
        const cod = normCodigo(v.procedimento_cod) || codigoPorId.get(Number(v.procedimento_id))
        if (!pedidos.includes(cod)) continue
        if (!quem.has(cod)) quem.set(cod, new Set())
        quem.get(cod).add(pid)
    }
    const codigosPorPrestador = new Map()
    for (const [cod, ids] of quem) for (const pid of ids) codigosPorPrestador.set(pid, [...(codigosPorPrestador.get(pid) || []), cod])
    return {
        realizadores: Object.fromEntries([...quem].map(([cod, s]) => [cod, s.size])),
        prestadores: [...codigosPorPrestador].map(([pid, cods]) => ({ nome: naCidade.get(pid).nome, codigos: cods.sort() })),
    }
}

/**
 * Credenciados que atendem a cidade (endereço nela ou cidade adicional no perfil), por grupo, A–Z pelo nome.
 * Cada item já é a linha da mensagem: "Nome - Tel" ou, para volantes, "Nome - Tel - Especialidade".
 * @returns {Promise<{ clinicas: string[], veterinarios: string[], laboratorio: string[], descontos: string[] }>}
 */
export async function credenciadosNaCidade({ uf, cidade }) {
    const vazio = { clinicas: [], veterinarios: [], laboratorio: [], descontos: [] }
    if (!String(cidade || '').trim()) return vazio
    const sigla = String(uf || '').trim().toUpperCase()
    const { rede } = await carregarBase()
    const grupos = { clinicas: new Set(), veterinarios: new Set(), laboratorio: new Set(), descontos: new Set() }
    const grupoDoTipo = { clinica: 'clinicas', veterinario: 'veterinarios', laboratorio: 'laboratorio' }
    for (const p of rede) {
        if (!p.nome) continue
        const atende = enderecoNaCidade(p, sigla, cidade) || p.cidadesAdicionais.some((nome) => cidadeCompativel(nome, cidade))
        if (!atende) continue
        // veterinário vinculado a clínica não entra em {credenciados.veterinarios}: a clínica dele já está em clínicas
        const vinculado = p.tipo === 'veterinario' && !p.volante
        if (grupoDoTipo[p.tipo] && !vinculado) grupos[grupoDoTipo[p.tipo]].add(linhaCredenciado(p))
        if (p.desconto) grupos.descontos.add(linhaCredenciado(p))
    }
    const az = (set) => [...set].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))
    return { clinicas: az(grupos.clinicas), veterinarios: az(grupos.veterinarios), laboratorio: az(grupos.laboratorio), descontos: az(grupos.descontos) }
}
