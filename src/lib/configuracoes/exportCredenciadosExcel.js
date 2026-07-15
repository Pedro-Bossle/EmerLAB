import { formatarFaixaPercentual, nomeGrupoBeneficioVisivel } from '../credenciamento/prestadorBeneficios.js'
import {
    montarEnderecoUmaLinha,
    prestadorEhCredenciado,
    prestadorEhEstabelecimento,
    resolverCidadePrincipalNome,
} from '../prestadorCadastroHelpers.js'
import {
    montarEstabelecimentoPorVeterinarioDeListas,
    resolverLocalidadeEfetivaPrestador,
} from '../prestadorLocalidadeVinculo.js'
import { buscarTodosPaginado, supabase } from '../supabase.js'

const CABECALHOS = [
    'ID',
    'NOME',
    'Telefone',
    'Celular',
    'Especialidade Primária',
    'Especialidades Secundárias',
    'Modalidade',
    'Endereço',
    'Cidade Principal',
    'Codigo de Procedimentos',
    'Procedimentos',
    'Categoria do Procedimento',
    'Descontos Grupo',
    'Desconto Tipo',
    'Desconto porcentagem',
    'Cidades que Atendem',
    'Veterinários Vinculados',
]

function sanitizarNomeArquivo(nome) {
    return String(nome || 'credenciados')
        .replace(/[<>:"/\\|?*]/g, '-')
        .replace(/\s+/g, '-')
        .slice(0, 80)
}

async function carregarTudo(queryBuilder) {
    const { data, error } = await buscarTodosPaginado(queryBuilder)
    if (error) throw new Error(error.message)
    return data || []
}

/**
 * Monta linhas (1 por procedimento do credenciado) para exportação.
 */
export async function carregarLinhasExportCredenciados() {
    const [
        prestadores,
        situacoes,
        especialidades,
        categorias,
        procedimentos,
        prestadorProcedimentos,
        prestadorEsp,
        prestadorCidades,
        cidades,
        estabelecimentos,
        beneficios,
        catalogoBeneficios,
    ] = await Promise.all([
        carregarTudo(() =>
            supabase
                .from('prestadores')
                .select(
                    'id, nome, tipo, telefone, celular, especialidade_id, modalidade, endereco, endereco_logradouro, endereco_numero, endereco_bairro, endereco_cidade, endereco_uf, cidade_id, situacao_id, ativo',
                )
                .eq('ativo', true)
                .order('nome', { ascending: true }),
        ),
        carregarTudo(() => supabase.from('situacoes').select('id, descricao, ativo')),
        carregarTudo(() => supabase.from('especialidades').select('id, nome')),
        carregarTudo(() => supabase.from('categorias').select('id, nome')),
        carregarTudo(() =>
            supabase.from('procedimentos').select('codigo, nome, categoria_id').order('codigo'),
        ),
        carregarTudo(() =>
            supabase.from('prestador_procedimentos').select('prestador_id, procedimento_cod, procedimento_id'),
        ),
        carregarTudo(() =>
            supabase.from('prestador_especialidades').select('prestador_id, especialidade_id, principal'),
        ),
        carregarTudo(() =>
            supabase.from('prestador_cidades').select('prestador_id, cidade_id, principal'),
        ),
        carregarTudo(() => supabase.from('cidades_credenciamento').select('id, nome').order('nome')),
        carregarTudo(() =>
            supabase.from('prestador_estabelecimentos').select('veterinario_id, estabelecimento_id, principal'),
        ),
        carregarTudo(() =>
            supabase
                .from('prestador_beneficios')
                .select('prestador_id, beneficio_id, percentual, percentual_max, incluir'),
        ),
        carregarTudo(() =>
            supabase
                .from('beneficios_catalogo')
                .select('id, codigo, nome, grupo_codigo, grupo_nome')
                .eq('ativo', true),
        ),
    ])

    const mapaEsp = new Map((especialidades || []).map((e) => [Number(e.id), e.nome]))
    const mapaCat = new Map((categorias || []).map((c) => [Number(c.id), c.nome]))
    const mapaCidade = new Map((cidades || []).map((c) => [Number(c.id), String(c.nome || '').trim()]))
    const mapaProcPorCod = new Map()
    for (const p of procedimentos || []) {
        const cod = String(p.codigo || '')
            .trim()
            .toUpperCase()
        if (cod) mapaProcPorCod.set(cod, p)
    }
    const mapaPrestador = new Map((prestadores || []).map((p) => [Number(p.id), p]))
    const catalogoPorId = new Map((catalogoBeneficios || []).map((b) => [Number(b.id), b]))
    const estabelecimentoPorVeterinario = montarEstabelecimentoPorVeterinarioDeListas(
        prestadores,
        estabelecimentos,
    )

    const credenciados = (prestadores || []).filter((p) => prestadorEhCredenciado(p, situacoes))
    const idsCred = new Set(credenciados.map((p) => Number(p.id)))

    const secundariasPorPrestador = new Map()
    for (const row of prestadorEsp || []) {
        const pid = Number(row.prestador_id)
        if (!idsCred.has(pid)) continue
        if (row.principal) continue
        const nome = mapaEsp.get(Number(row.especialidade_id))
        if (!nome) continue
        if (!secundariasPorPrestador.has(pid)) secundariasPorPrestador.set(pid, [])
        secundariasPorPrestador.get(pid).push(nome)
    }

    /** prestador_id → linhas de prestador_cidades */
    const relacoesCidadesPorPrestador = new Map()
    for (const row of prestadorCidades || []) {
        const pid = Number(row.prestador_id)
        if (!pid) continue
        if (!relacoesCidadesPorPrestador.has(pid)) relacoesCidadesPorPrestador.set(pid, [])
        relacoesCidadesPorPrestador.get(pid).push(row)
    }

    const procsPorPrestador = new Map()
    for (const row of prestadorProcedimentos || []) {
        const pid = Number(row.prestador_id)
        if (!idsCred.has(pid)) continue
        const cod =
            String(row.procedimento_cod || '')
                .trim()
                .toUpperCase() ||
            String(row.procedimento_id ?? '')
                .trim()
                .toUpperCase()
        if (!cod) continue
        if (!procsPorPrestador.has(pid)) procsPorPrestador.set(pid, [])
        procsPorPrestador.get(pid).push(cod)
    }

    const beneficiosPorPrestador = new Map()
    for (const row of beneficios || []) {
        if (row.incluir === false) continue
        const pid = Number(row.prestador_id)
        if (!idsCred.has(pid)) continue
        const cat = catalogoPorId.get(Number(row.beneficio_id))
        if (!cat) continue
        if (!beneficiosPorPrestador.has(pid)) beneficiosPorPrestador.set(pid, [])
        beneficiosPorPrestador.get(pid).push({
            grupo: nomeGrupoBeneficioVisivel(cat.grupo_nome || cat.grupo_codigo || ''),
            tipo: cat.nome || cat.codigo || '',
            pct: formatarFaixaPercentual(row.percentual, row.percentual_max),
        })
    }

    const vetsPorEstabelecimento = new Map()
    const estabelecimentosPorVet = new Map()
    for (const row of estabelecimentos || []) {
        const vid = Number(row.veterinario_id)
        const eid = Number(row.estabelecimento_id)
        if (!vid || !eid) continue
        if (!vetsPorEstabelecimento.has(eid)) vetsPorEstabelecimento.set(eid, [])
        vetsPorEstabelecimento.get(eid).push(vid)
        if (!estabelecimentosPorVet.has(vid)) estabelecimentosPorVet.set(vid, [])
        estabelecimentosPorVet.get(vid).push(eid)
    }

    const rotuloVinculos = (prestador) => {
        const pid = Number(prestador.id)
        let ids = []
        if (prestadorEhEstabelecimento(prestador.especialidade_id)) {
            ids = vetsPorEstabelecimento.get(pid) || []
        } else {
            ids = estabelecimentosPorVet.get(pid) || []
        }
        const nomes = ids
            .map((id) => mapaPrestador.get(Number(id))?.nome)
            .filter(Boolean)
        return [...new Set(nomes)].sort((a, b) => a.localeCompare(b, 'pt-BR')).join('; ')
    }

    const relacoesCidadesEfetivas = (prestador) => {
        const pid = Number(prestador.id)
        const { prestadorIdCidades } = resolverLocalidadeEfetivaPrestador(
            prestador,
            estabelecimentoPorVeterinario,
        )
        return (
            relacoesCidadesPorPrestador.get(Number(prestadorIdCidades)) ||
            relacoesCidadesPorPrestador.get(pid) ||
            []
        )
    }

    const nomesCidadesQueAtende = (rels) => {
        const nomes = []
        const vistos = new Set()
        for (const rel of rels || []) {
            const nome = mapaCidade.get(Number(rel.cidade_id))
            if (!nome) continue
            const chave = nome.toLocaleLowerCase('pt-BR')
            if (vistos.has(chave)) continue
            vistos.add(chave)
            nomes.push(nome)
        }
        return nomes.sort((a, b) => a.localeCompare(b, 'pt-BR')).join('; ')
    }

    const linhas = []
    for (const p of credenciados) {
        const pid = Number(p.id)
        const { prestador: pLoc } = resolverLocalidadeEfetivaPrestador(
            p,
            estabelecimentoPorVeterinario,
        )
        const relsCidades = relacoesCidadesEfetivas(p)
        const espPrim = mapaEsp.get(Number(p.especialidade_id)) || ''
        const espSec = (secundariasPorPrestador.get(pid) || [])
            .filter((n) => n !== espPrim)
            .sort((a, b) => a.localeCompare(b, 'pt-BR'))
            .join('; ')
        const cidadePrincipalRaw = resolverCidadePrincipalNome(pLoc, {
            mapaCidadeNomePorId: mapaCidade,
            relacoesCidades: relsCidades,
        })
        const cidadePrincipal =
            cidadePrincipalRaw && cidadePrincipalRaw !== '—' ? cidadePrincipalRaw : ''
        const cidadesAtendem = nomesCidadesQueAtende(relsCidades)
        const bens = beneficiosPorPrestador.get(pid) || []
        const descontosGrupo = bens.map((b) => b.grupo).join('; ')
        const descontosTipo = bens.map((b) => b.tipo).join('; ')
        const descontosPct = bens.map((b) => b.pct).join('; ')
        const endereco = montarEnderecoUmaLinha(pLoc) || String(p.endereco || '').trim()
        const vinculos = rotuloVinculos(p)

        const codigos = [...new Set(procsPorPrestador.get(pid) || [])].sort((a, b) =>
            a.localeCompare(b, 'pt-BR'),
        )

        const base = {
            id: pid,
            nome: p.nome || '',
            telefone: p.telefone || '',
            celular: p.celular || '',
            especialidadePrimaria: espPrim,
            especialidadesSecundarias: espSec,
            modalidade: p.modalidade || '',
            endereco,
            cidadePrincipal,
            descontosGrupo,
            descontoTipo: descontosTipo,
            descontoPorcentagem: descontosPct,
            cidadesQueAtendem: cidadesAtendem,
            veterinariosVinculados: vinculos,
        }

        if (!codigos.length) {
            linhas.push({
                ...base,
                codigoProcedimento: '',
                procedimento: '',
                categoriaProcedimento: '',
            })
            continue
        }

        for (const cod of codigos) {
            const meta = mapaProcPorCod.get(cod)
            linhas.push({
                ...base,
                codigoProcedimento: cod,
                procedimento: meta?.nome || '',
                categoriaProcedimento: mapaCat.get(Number(meta?.categoria_id)) || '',
            })
        }
    }

    return { linhas, totalCredenciados: credenciados.length }
}

export async function exportarCredenciadosParaExcel(opcoes = {}) {
    const { linhas, totalCredenciados } = await carregarLinhasExportCredenciados()
    if (!linhas.length) {
        return { ok: false, erro: 'Nenhum credenciado encontrado para exportar.' }
    }

    const { default: ExcelJS } = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    const ws = workbook.addWorksheet('Credenciados', {
        views: [{ state: 'frozen', ySplit: 1 }],
    })

    ws.addRow(CABECALHOS)
    const header = ws.getRow(1)
    header.font = { bold: true }
    header.alignment = { vertical: 'middle', wrapText: true }

    for (const row of linhas) {
        ws.addRow([
            row.id,
            row.nome,
            row.telefone,
            row.celular,
            row.especialidadePrimaria,
            row.especialidadesSecundarias,
            row.modalidade,
            row.endereco,
            row.cidadePrincipal,
            row.codigoProcedimento,
            row.procedimento,
            row.categoriaProcedimento,
            row.descontosGrupo,
            row.descontoTipo,
            row.descontoPorcentagem,
            row.cidadesQueAtendem,
            row.veterinariosVinculados,
        ])
    }

    const widths = [8, 32, 14, 14, 22, 28, 14, 40, 18, 16, 36, 22, 22, 24, 16, 28, 28]
    widths.forEach((w, i) => {
        ws.getColumn(i + 1).width = w
    })

    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const base = sanitizarNomeArquivo(opcoes.nomeArquivoBase || 'credenciados')
    a.href = url
    a.download = `${base}.xlsx`
    a.click()
    URL.revokeObjectURL(url)

    return { ok: true, totalLinhas: linhas.length, totalCredenciados }
}
