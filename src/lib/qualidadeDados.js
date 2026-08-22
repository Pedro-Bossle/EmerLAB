/**
 * Scan de qualidade de dados — apenas prestadores credenciados.
 * Geocode: só especialidade tipo LOCAL.
 * Duplicatas: CRMV, Nome, CPF/CNPJ, E-mail, Telefone.
 */

import { supabase } from './supabase.js'
import { apenasDigitos, validarCNPJ, validarCPF } from './contratos/validarDocumentos.js'
import {
    coordenadasValidasBrasil,
    especialidadePorIdMap,
    prestadorEhTipoLocal,
} from './credenciamento/prestadorEnderecoGeocode.js'
import {
    normalizarTextoBusca,
    prestadorEhCredenciado,
} from './prestadorCadastroHelpers.js'

const PRESTADOR_COLS =
    'id, nome, cpf_cnpj, crmv, email, telefone, celular, cep, latitude, longitude, especialidade_id, ativo, situacao_id, tipo'

const SITUACAO_CREDENCIADO_ID = 4

const LS_ARQUIVADOS = 'emerlab-qualidade-arquivados'

export const CATEGORIAS_QUALIDADE = [
    { id: 'documento_invalido', label: 'CNPJ/CPF inválido' },
    { id: 'geocode_faltando', label: 'Geocode faltando' },
    { id: 'especialidade_sem_rc', label: 'Especialidade sem RC' },
    { id: 'duplicatas', label: 'Duplicatas' },
    { id: 'arquivados', label: 'Arquivados' },
]

function linkCadastroPrestador(id) {
    if (id == null || id === '') return ''
    return `/credenciamento/cadastro/${id}`
}

function resumoPrestador(p) {
    return {
        id: p.id,
        nome: p.nome || `Prestador #${p.id}`,
        ativo: p.ativo !== false,
        href: linkCadastroPrestador(p.id),
    }
}

/** Chave estável para ignorar/arquivar. */
export function chaveAvisoQualidade(categoria, rowOuGrupo) {
    if (categoria === 'duplicatas') {
        return `duplicatas|${rowOuGrupo.motivo}|${rowOuGrupo.chave}`
    }
    return `${categoria}|${rowOuGrupo.id}`
}

async function carregarPrestadoresCredenciados() {
    const pageSize = 1000
    const out = []
    let from = 0
    for (;;) {
        const { data, error } = await supabase
            .from('prestadores')
            .select(PRESTADOR_COLS)
            .eq('situacao_id', SITUACAO_CREDENCIADO_ID)
            .order('id', { ascending: true })
            .range(from, from + pageSize - 1)
        if (error) throw new Error(error.message)
        const batch = data || []
        out.push(...batch)
        if (batch.length < pageSize) break
        from += pageSize
    }
    return out
}

async function carregarEspecialidades() {
    const { data, error } = await supabase.from('especialidades').select('id, nome, ordem_rc, tipo')
    if (error) throw new Error(error.message)
    return data || []
}

async function carregarSituacoes() {
    const { data, error } = await supabase.from('situacoes').select('id, descricao')
    if (error) return []
    return data || []
}

/** Classifica documento: valido | cpf_invalido | cnpj_invalido | incompleto | vazio */
export function classificarDocumentoCpfCnpj(raw) {
    const d = apenasDigitos(raw)
    if (!d) return { status: 'vazio', digitos: '' }
    if (d.length === 11) {
        return { status: validarCPF(d) ? 'valido' : 'cpf_invalido', digitos: d }
    }
    if (d.length === 14) {
        return { status: validarCNPJ(d) ? 'valido' : 'cnpj_invalido', digitos: d }
    }
    return { status: 'incompleto', digitos: d }
}

function crmvNormalizado(raw) {
    return String(raw || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '')
}

function emailNormalizado(raw) {
    return String(raw || '').trim().toLowerCase()
}

function telefoneNormalizado(raw) {
    const d = apenasDigitos(raw)
    return d.length >= 10 ? d : ''
}

function agruparDuplicatas(prestadores, chaveFn, motivo) {
    const mapa = new Map()
    for (const p of prestadores) {
        const chave = chaveFn(p)
        if (!chave) continue
        if (!mapa.has(chave)) mapa.set(chave, [])
        mapa.get(chave).push(p)
    }
    const grupos = []
    for (const [chave, lista] of mapa) {
        if (lista.length < 2) continue
        grupos.push({
            motivo,
            chave,
            itens: lista.map(resumoPrestador),
            detalhe: `${lista.length} credenciados com o mesmo ${motivo}`,
        })
    }
    return grupos.sort((a, b) => b.itens.length - a.itens.length || a.chave.localeCompare(b.chave))
}

function lerArquivadosLocal() {
    try {
        const raw = localStorage.getItem(LS_ARQUIVADOS)
        if (!raw) return {}
        const obj = JSON.parse(raw)
        return obj && typeof obj === 'object' ? obj : {}
    } catch {
        return {}
    }
}

function gravarArquivadosLocal(mapa) {
    localStorage.setItem(LS_ARQUIVADOS, JSON.stringify(mapa || {}))
}

/**
 * Lista chaves arquivadas (mapa chave → meta).
 * Tenta tabela Supabase; se indisponível, usa localStorage.
 */
export async function listarAvisosArquivados() {
    try {
        const { data, error } = await supabase
            .from('qualidade_dados_arquivados')
            .select('chave, categoria, detalhe, arquivado_em, arquivado_por_nome')
        if (!error && data) {
            const mapa = {}
            for (const row of data) {
                if (!row?.chave) continue
                mapa[row.chave] = {
                    chave: row.chave,
                    categoria: row.categoria,
                    detalhe: row.detalhe,
                    arquivadoEm: row.arquivado_em,
                    arquivadoPorNome: row.arquivado_por_nome || '',
                    fonte: 'supabase',
                }
            }
            return { mapa, fonte: 'supabase' }
        }
    } catch {
        /* fallback */
    }
    const local = lerArquivadosLocal()
    return { mapa: local, fonte: 'local' }
}

export async function arquivarAvisoQualidade({ chave, categoria, detalhe, usuarioNome }) {
    const meta = {
        chave,
        categoria,
        detalhe: detalhe || null,
        arquivadoEm: new Date().toISOString(),
        arquivadoPorNome: usuarioNome || '',
        fonte: 'local',
    }
    try {
        const { error } = await supabase.from('qualidade_dados_arquivados').upsert(
            {
                chave,
                categoria,
                detalhe: detalhe || null,
                arquivado_em: meta.arquivadoEm,
                arquivado_por_nome: usuarioNome || null,
            },
            { onConflict: 'chave' },
        )
        if (!error) {
            meta.fonte = 'supabase'
            return meta
        }
    } catch {
        /* fallback local */
    }
    const local = lerArquivadosLocal()
    local[chave] = meta
    gravarArquivadosLocal(local)
    return meta
}

export async function restaurarAvisoQualidade(chave) {
    try {
        await supabase.from('qualidade_dados_arquivados').delete().eq('chave', chave)
    } catch {
        /* ignore */
    }
    const local = lerArquivadosLocal()
    if (local[chave]) {
        delete local[chave]
        gravarArquivadosLocal(local)
    }
}

/**
 * Executa o scan completo (só credenciados).
 */
export async function scanQualidadeDados() {
    const [prestadoresRaw, especialidades, situacoes] = await Promise.all([
        carregarPrestadoresCredenciados(),
        carregarEspecialidades(),
        carregarSituacoes(),
    ])

    const prestadores = (prestadoresRaw || []).filter((p) => {
        if (situacoes?.length) return prestadorEhCredenciado(p, situacoes)
        return Number(p.situacao_id) === SITUACAO_CREDENCIADO_ID
    })

    const mapaEsp = especialidadePorIdMap(especialidades)
    const espPorId = new Map(especialidades.map((e) => [Number(e.id), e]))
    const espUsadas = new Set()
    for (const p of prestadores) {
        if (p.especialidade_id != null) espUsadas.add(Number(p.especialidade_id))
    }

    const documentoInvalido = []
    const geocodeFaltando = []
    const especialidadeSemRc = []

    for (const p of prestadores) {
        const doc = classificarDocumentoCpfCnpj(p.cpf_cnpj)
        if (doc.status === 'cpf_invalido' || doc.status === 'cnpj_invalido' || doc.status === 'incompleto') {
            const tipo =
                doc.status === 'cpf_invalido'
                    ? 'CPF inválido'
                    : doc.status === 'cnpj_invalido'
                      ? 'CNPJ inválido'
                      : 'Documento incompleto'
            documentoInvalido.push({
                ...resumoPrestador(p),
                detalhe: `${tipo}: ${doc.digitos || '(vazio)'}`,
                tipo,
            })
        }

        if (prestadorEhTipoLocal(p, mapaEsp) && !coordenadasValidasBrasil(p.latitude, p.longitude)) {
            geocodeFaltando.push({
                ...resumoPrestador(p),
                detalhe: 'LOCAL sem latitude/longitude válidas no Brasil',
            })
        }

        if (p.especialidade_id == null || p.especialidade_id === '') {
            especialidadeSemRc.push({
                ...resumoPrestador(p),
                tipo: 'prestador_sem_especialidade',
                detalhe: 'Credenciado sem especialidade_id (não agrupa na RC)',
            })
        }
    }

    for (const id of espUsadas) {
        const esp = espPorId.get(id)
        if (!esp) {
            especialidadeSemRc.push({
                id: `esp-missing-${id}`,
                nome: `Especialidade #${id}`,
                ativo: true,
                href: '/credenciamento/especialidades-rc',
                tipo: 'especialidade_inexistente',
                detalhe: `ID ${id} referenciado por credenciados, mas não existe em especialidades`,
            })
            continue
        }
        if (esp.ordem_rc == null || esp.ordem_rc === '') {
            especialidadeSemRc.push({
                id: `esp-${esp.id}`,
                nome: esp.nome || `Especialidade #${esp.id}`,
                ativo: true,
                href: '/credenciamento/especialidades-rc',
                tipo: 'ordem_rc_nulo',
                detalhe: `Especialidade «${esp.nome}» sem ordem_rc (fallback no PDF RC)`,
            })
        }
    }

    const dupCrmv = agruparDuplicatas(prestadores, (p) => crmvNormalizado(p.crmv), 'crmv')
    const dupNome = agruparDuplicatas(
        prestadores,
        (p) => {
            const n = normalizarTextoBusca(p.nome)
            return n.length >= 3 ? n : ''
        },
        'nome',
    )
    const dupDoc = agruparDuplicatas(
        prestadores,
        (p) => {
            const d = apenasDigitos(p.cpf_cnpj)
            return d.length === 11 || d.length === 14 ? d : ''
        },
        'cpf',
    )
    const dupEmail = agruparDuplicatas(
        prestadores,
        (p) => {
            const e = emailNormalizado(p.email)
            return e.includes('@') ? e : ''
        },
        'email',
    )
    const dupTel = (() => {
        const mapa = new Map()
        for (const p of prestadores) {
            for (const raw of [p.telefone, p.celular]) {
                const chave = telefoneNormalizado(raw)
                if (!chave) continue
                if (!mapa.has(chave)) mapa.set(chave, new Map())
                mapa.get(chave).set(p.id, p)
            }
        }
        const grupos = []
        for (const [chave, byId] of mapa) {
            if (byId.size < 2) continue
            const lista = [...byId.values()]
            grupos.push({
                motivo: 'telefone',
                chave,
                itens: lista.map(resumoPrestador),
                detalhe: `${lista.length} credenciados com o mesmo telefone`,
            })
        }
        return grupos.sort((a, b) => b.itens.length - a.itens.length || a.chave.localeCompare(b.chave))
    })()

    const duplicatas = [...dupCrmv, ...dupNome, ...dupDoc, ...dupEmail, ...dupTel]

    const totais = {
        documento_invalido: documentoInvalido.length,
        geocode_faltando: geocodeFaltando.length,
        especialidade_sem_rc: especialidadeSemRc.length,
        duplicatas: duplicatas.length,
        prestadores: prestadores.length,
    }

    return {
        geradoEm: new Date().toISOString(),
        totais,
        documentoInvalido,
        geocodeFaltando,
        especialidadeSemRc,
        duplicatas,
    }
}

/** Filtra itens ativos (não arquivados) e monta lista de arquivados a partir do scan. */
export function particionarScanPorArquivo(scan, mapaArquivados = {}) {
    const arquivadosSet = new Set(Object.keys(mapaArquivados || {}))
    const filtrarLista = (lista, categoria) =>
        (lista || []).filter((row) => !arquivadosSet.has(chaveAvisoQualidade(categoria, row)))

    const documentoInvalido = filtrarLista(scan?.documentoInvalido, 'documento_invalido')
    const geocodeFaltando = filtrarLista(scan?.geocodeFaltando, 'geocode_faltando')
    const especialidadeSemRc = filtrarLista(scan?.especialidadeSemRc, 'especialidade_sem_rc')
    const duplicatas = filtrarLista(scan?.duplicatas, 'duplicatas')

    const arquivados = []
    const pushSeArquivado = (lista, categoria) => {
        for (const row of lista || []) {
            const chave = chaveAvisoQualidade(categoria, row)
            if (!arquivadosSet.has(chave)) continue
            const meta = mapaArquivados[chave] || {}
            arquivados.push({
                ...row,
                categoria,
                chave,
                arquivadoEm: meta.arquivadoEm,
                arquivadoPorNome: meta.arquivadoPorNome,
                motivo: row.motivo,
                itens: row.itens,
            })
        }
    }
    pushSeArquivado(scan?.documentoInvalido, 'documento_invalido')
    pushSeArquivado(scan?.geocodeFaltando, 'geocode_faltando')
    pushSeArquivado(scan?.especialidadeSemRc, 'especialidade_sem_rc')
    pushSeArquivado(scan?.duplicatas, 'duplicatas')

    // Arquivados órfãos (ainda na base, mas sumiram do scan)
    for (const [chave, meta] of Object.entries(mapaArquivados || {})) {
        if (arquivados.some((a) => a.chave === chave)) continue
        arquivados.push({
            id: chave,
            nome: meta.detalhe?.nome || chave,
            detalhe: meta.detalhe?.detalhe || 'Aviso arquivado (não aparece mais no scan atual)',
            categoria: meta.categoria || 'arquivados',
            chave,
            arquivadoEm: meta.arquivadoEm,
            arquivadoPorNome: meta.arquivadoPorNome,
            href: meta.detalhe?.href || '',
            orfao: true,
        })
    }

    return {
        documentoInvalido,
        geocodeFaltando,
        especialidadeSemRc,
        duplicatas,
        arquivados,
        totais: {
            documento_invalido: documentoInvalido.length,
            geocode_faltando: geocodeFaltando.length,
            especialidade_sem_rc: especialidadeSemRc.length,
            duplicatas: duplicatas.length,
            arquivados: arquivados.length,
            prestadores: scan?.totais?.prestadores ?? 0,
        },
    }
}

export function montarCsvQualidadeCategoria(categoriaId, particao) {
    const lines = []
    const esc = (v) => {
        const s = v == null ? '' : String(v)
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }

    if (categoriaId === 'duplicatas') {
        lines.push(['motivo', 'chave', 'prestador_ids', 'nomes', 'detalhe'].join(','))
        for (const g of particao.duplicatas || []) {
            const ids = (g.itens || []).map((i) => i.id).join('|')
            const nomes = (g.itens || []).map((i) => i.nome).join('|')
            lines.push([g.motivo, g.chave, ids, nomes, g.detalhe].map(esc).join(','))
        }
        return lines.join('\n')
    }

    if (categoriaId === 'arquivados') {
        lines.push(['categoria', 'chave', 'nome', 'detalhe', 'arquivado_em'].join(','))
        for (const row of particao.arquivados || []) {
            lines.push(
                [row.categoria, row.chave, row.nome, row.detalhe, row.arquivadoEm].map(esc).join(','),
            )
        }
        return lines.join('\n')
    }

    const lista =
        categoriaId === 'documento_invalido'
            ? particao.documentoInvalido
            : categoriaId === 'geocode_faltando'
              ? particao.geocodeFaltando
              : categoriaId === 'especialidade_sem_rc'
                ? particao.especialidadeSemRc
                : []

    lines.push(['id', 'nome', 'ativo', 'detalhe', 'href'].join(','))
    for (const row of lista || []) {
        lines.push([row.id, row.nome, row.ativo, row.detalhe, row.href].map(esc).join(','))
    }
    return lines.join('\n')
}
