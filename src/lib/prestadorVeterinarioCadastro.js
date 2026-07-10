import { supabase } from './supabase'
import { normalizarEmailParaSalvar } from './prestadorCadastroHelpers'

export function responsaveisParaPayload(lista) {
    return (lista || [])
        .map((r) => ({
            nome: String(r.nome || '').trim(),
            email: normalizarEmailParaSalvar(r.email) || '',
            telefone: String(r.telefone || '').trim(),
        }))
        .filter((r) => r.nome)
}

export function responsaveisFromDbRows(rows) {
    return (rows || []).map((r) => ({
        key: `db-${r.id}`,
        id: r.id,
        nome: r.nome || '',
        email: r.email || '',
        telefone: r.telefone || '',
    }))
}

export function responsaveisFromPayload(payloadList) {
    return (payloadList || []).map((r, i) => ({
        key: `payload-${i}-${r.nome}`,
        nome: r.nome || '',
        email: r.email || '',
        telefone: r.telefone || '',
    }))
}

export const BUCKET_CREDENCIAMENTO_DOCUMENTOS = 'credenciamento-documentos'
export const MAX_CERTIFICADOS_CONCLUSAO = 5

const MIME_PERMITIDOS = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
])

export function certificadoConclusaoMimePermitido(mime) {
    const m = String(mime || '').toLowerCase()
    return MIME_PERMITIDOS.has(m)
}

export function certificadoConclusaoArquivoValido(file) {
    if (!file) return { ok: false, erro: 'Arquivo inválido.' }
    if (!certificadoConclusaoMimePermitido(file.type)) {
        return { ok: false, erro: 'Use foto (JPEG, PNG, WebP, GIF) ou PDF.' }
    }
    if (file.size > 15 * 1024 * 1024) {
        return { ok: false, erro: 'Arquivo acima de 15 MB.' }
    }
    return { ok: true }
}

function extensaoSegura(nomeArquivo, mimeType) {
    const nome = String(nomeArquivo || '').toLowerCase()
    const m = String(mimeType || '').toLowerCase()
    if (nome.endsWith('.pdf') || m === 'application/pdf') return 'pdf'
    if (nome.endsWith('.png') || m === 'image/png') return 'png'
    if (nome.endsWith('.webp') || m === 'image/webp') return 'webp'
    if (nome.endsWith('.gif') || m === 'image/gif') return 'gif'
    return 'jpg'
}

function randomSuffix() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function montarStoragePathCertificadoPrestador(prestadorId, nomeArquivo, mimeType) {
    const ext = extensaoSegura(nomeArquivo, mimeType)
    return `prestadores/${Number(prestadorId)}/certificados-conclusao/${randomSuffix()}.${ext}`
}

export function montarStoragePathCertificadoFormulario(loteId, nomeArquivo, mimeType) {
    const ext = extensaoSegura(nomeArquivo, mimeType)
    return `formulario-entradas/${String(loteId)}/certificados-conclusao/${randomSuffix()}.${ext}`
}

export async function uploadArquivoCredenciamentoDocumentos(storagePath, file) {
    const { error } = await supabase.storage.from(BUCKET_CREDENCIAMENTO_DOCUMENTOS).upload(storagePath, file, {
        upsert: false,
        contentType: file.type || undefined,
    })
    if (error) throw new Error(error.message)
}

export async function removerArquivosCredenciamentoDocumentos(storagePaths) {
    const paths = (storagePaths || []).map(String).filter(Boolean)
    if (!paths.length) return
    const { error } = await supabase.storage.from(BUCKET_CREDENCIAMENTO_DOCUMENTOS).remove(paths)
    if (error) throw new Error(error.message)
}

export async function urlAssinadaCertificadoConclusao(storagePath, expiresIn = 3600) {
    const { data, error } = await supabase.storage
        .from(BUCKET_CREDENCIAMENTO_DOCUMENTOS)
        .createSignedUrl(String(storagePath), expiresIn)
    if (error) throw new Error(error.message)
    return data?.signedUrl || ''
}

export async function carregarCertificadosConclusaoPrestador(prestadorId) {
    const pid = Number(prestadorId)
    if (!pid) return []
    const { data, error } = await supabase
        .from('prestador_certificados_conclusao')
        .select('id, storage_path, nome_arquivo, mime_type, ordem')
        .eq('prestador_id', pid)
        .order('ordem', { ascending: true })
        .order('id', { ascending: true })
    if (error) throw new Error(error.message)
    return data || []
}

export async function carregarResponsaveisPrestador(prestadorId) {
    const pid = Number(prestadorId)
    if (!pid) return []
    const { data, error } = await supabase
        .from('prestador_responsaveis')
        .select('id, nome, email, telefone, ordem')
        .eq('prestador_id', pid)
        .order('ordem', { ascending: true })
        .order('id', { ascending: true })
    if (error) throw new Error(error.message)
    return data || []
}

export function normalizarListaResponsaveis(lista) {
    return (lista || [])
        .map((r, idx) => ({
            id: r.id != null ? Number(r.id) : null,
            nome: String(r.nome || '').trim(),
            email: normalizarEmailParaSalvar(r.email) || '',
            telefone: String(r.telefone || '').trim(),
            ordem: idx,
        }))
        .filter((r) => r.nome)
}

export async function sincronizarResponsaveisPrestador(prestadorId, lista) {
    const pid = Number(prestadorId)
    if (!pid) return
    const rows = normalizarListaResponsaveis(lista)
    const { error: errDel } = await supabase.from('prestador_responsaveis').delete().eq('prestador_id', pid)
    if (errDel) throw new Error(errDel.message)
    if (!rows.length) return
    const insertRows = rows.map((r) => ({
        prestador_id: pid,
        nome: r.nome,
        email: r.email || null,
        telefone: r.telefone || null,
        ordem: r.ordem,
    }))
    const { error: errIns } = await supabase.from('prestador_responsaveis').insert(insertRows)
    if (errIns) {
        const msg = String(errIns.message || '')
        if (msg.toLowerCase().includes('row-level security')) {
            throw new Error(
                'Sem permissão RLS em prestador_responsaveis. Execute scripts/sql/prestador_veterinario_certificados_responsaveis.sql.',
            )
        }
        throw new Error(msg)
    }
}

export async function sincronizarCertificadosConclusaoPrestador(
    prestadorId,
    { novos = [], removerIds = [] } = {},
) {
    const pid = Number(prestadorId)
    if (!pid) return

    const idsRemover = new Set((removerIds || []).map(Number).filter(Boolean))
    const existentes = await carregarCertificadosConclusaoPrestador(pid)
    const restantes = existentes.filter((r) => !idsRemover.has(Number(r.id)))
    const totalFinal = restantes.length + (novos || []).length
    if (totalFinal > MAX_CERTIFICADOS_CONCLUSAO) {
        throw new Error(`Máximo de ${MAX_CERTIFICADOS_CONCLUSAO} certificados.`)
    }

    const pathsRemover = existentes.filter((r) => idsRemover.has(Number(r.id))).map((r) => r.storage_path)
    if (idsRemover.size) {
        const { error: errDel } = await supabase
            .from('prestador_certificados_conclusao')
            .delete()
            .eq('prestador_id', pid)
            .in('id', [...idsRemover])
        if (errDel) throw new Error(errDel.message)
    }
    if (pathsRemover.length) {
        try {
            await removerArquivosCredenciamentoDocumentos(pathsRemover)
        } catch {
            /* ignore */
        }
    }

    let ordem = 0
    for (const row of restantes) {
        await supabase.from('prestador_certificados_conclusao').update({ ordem }).eq('id', row.id)
        ordem += 1
    }

    for (const file of novos || []) {
        const check = certificadoConclusaoArquivoValido(file)
        if (!check.ok) throw new Error(check.erro)
        const storagePath = montarStoragePathCertificadoPrestador(pid, file.name, file.type)
        await uploadArquivoCredenciamentoDocumentos(storagePath, file)
        const { error: errIns } = await supabase.from('prestador_certificados_conclusao').insert({
            prestador_id: pid,
            storage_path: storagePath,
            nome_arquivo: file.name || 'certificado',
            mime_type: file.type || null,
            ordem,
        })
        if (errIns) {
            const msg = String(errIns.message || '')
            if (msg.toLowerCase().includes('row-level security')) {
                throw new Error(
                    'Sem permissão RLS em prestador_certificados_conclusao. Execute scripts/sql/prestador_veterinario_certificados_responsaveis.sql.',
                )
            }
            throw new Error(msg)
        }
        ordem += 1
    }
}

export async function uploadCertificadosConclusaoFormulario(loteId, files) {
    const lista = files || []
    if (lista.length > MAX_CERTIFICADOS_CONCLUSAO) {
        throw new Error(`Máximo de ${MAX_CERTIFICADOS_CONCLUSAO} certificados.`)
    }
    const out = []
    for (const file of lista) {
        const check = certificadoConclusaoArquivoValido(file)
        if (!check.ok) throw new Error(check.erro)
        const storagePath = montarStoragePathCertificadoFormulario(loteId, file.name, file.type)
        await uploadArquivoCredenciamentoDocumentos(storagePath, file)
        out.push({
            storage_path: storagePath,
            nome_arquivo: file.name || 'certificado',
            mime_type: file.type || null,
        })
    }
    return out
}

export async function promoverCertificadosFormularioParaPrestador(prestadorId, certificadosPayload) {
    const pid = Number(prestadorId)
    const lista = Array.isArray(certificadosPayload) ? certificadosPayload : []
    if (!pid || !lista.length) return

    const existentes = await carregarCertificadosConclusaoPrestador(pid)
    if (existentes.length + lista.length > MAX_CERTIFICADOS_CONCLUSAO) {
        throw new Error(`Certificados excedem o limite de ${MAX_CERTIFICADOS_CONCLUSAO} após conversão.`)
    }

    let ordem = existentes.length
    for (const item of lista) {
        const path = String(item.storage_path || '').trim()
        if (!path) continue
        const { error } = await supabase.from('prestador_certificados_conclusao').insert({
            prestador_id: pid,
            storage_path: path,
            nome_arquivo: String(item.nome_arquivo || 'certificado'),
            mime_type: item.mime_type || null,
            ordem,
        })
        if (error) throw new Error(error.message)
        ordem += 1
    }
}

export async function promoverResponsaveisFormularioParaPrestador(prestadorId, responsaveisPayload) {
    const pid = Number(prestadorId)
    const lista = normalizarListaResponsaveis(responsaveisPayload)
    if (!pid || !lista.length) return
    await sincronizarResponsaveisPrestador(pid, lista)
}
