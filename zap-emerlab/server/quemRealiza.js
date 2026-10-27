// Regra services {…} das respostas rápidas: mesma busca do Credenciamento > Quem realiza do projeto principal
// (src/lib/buscarQuemRealizaPrestadores.js → pesquisarQuemRealizaNaRede), com as opções padrão da tela:
//   - prestadores ativos com situação "Credenciado", de qualquer especialidade (clínicas e laboratórios incluídos);
//   - veterinário vinculado a clínica/equipe (prestador_estabelecimentos) usa a cidade e a UF da clínica;
//   - cidade pelo endereço do cadastro (endereco_cidade/endereco_uf), aceitando "Porto Alegre e Região" ↔ "Porto Alegre";
//     a lista "Cidades que atende" fica de fora, como na tela com "cidades paralelas" desmarcado;
//   - procedimento no perfil do prestador (prestador_procedimentos, pelo código ou pelo id do procedimento).
// O app principal não entra no bundle deste painel, por isso a regra está copiada aqui. Mudou lá, mude aqui.
import { db, ok } from './db.js'
import { normCodigo } from '../src/regras.js'

const PAGINA = 1000
const VALIDADE_MS = 10 * 60 * 1000
// ver ESPECIALIDADES_ESTABELECIMENTO_IDS no projeto principal (clínica, hospital, equipe, laboratório)
const ESPECIALIDADES_ESTABELECIMENTO = new Set([1, 2, 3, 5])

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

// prestadores credenciados com a localidade já resolvida e o catálogo de procedimentos, guardados por 10 min
let cache = null

async function carregarBase() {
    if (cache && Date.now() - cache.em < VALIDADE_MS) return cache.dados
    const [prestadores, situacoes, vinculos, procedimentos] = await Promise.all([
        todas(() =>
            db().from('prestadores').select('id, nome, especialidade_id, endereco_uf, endereco_cidade, situacao_id').eq('ativo', true).order('id'),
        ),
        todas(() => db().from('situacoes').select('id, descricao').order('id')),
        todas(() =>
            db().from('prestador_estabelecimentos').select('veterinario_id, estabelecimento_id, principal').order('veterinario_id').order('estabelecimento_id'),
        ),
        todas(() => db().from('procedimentos').select('id, codigo, nome').order('id')),
    ])

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
            return {
                id: Number(p.id),
                nome: String(p.nome || '').trim(),
                endereco_cidade: est ? (est.endereco_cidade ?? p.endereco_cidade) : p.endereco_cidade,
                endereco_uf: est ? (est.endereco_uf ?? p.endereco_uf) : p.endereco_uf,
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
    const dados = { rede, catalogo, codigoPorId }
    cache = { em: Date.now(), dados }
    return dados
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
