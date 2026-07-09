import { montarEnderecoUmaLinha, tipoEspecialidadePrestador, prestadorEhCredenciado } from '../prestadorCadastroHelpers.js'

export const CSV_COLUNAS_ENDERECO_PRESTADOR = [
    'prestador_id',
    'nome',
    'especialidade',
    'tipo_especialidade',
    'cep',
    'logradouro',
    'numero',
    'bairro',
    'cidade',
    'uf',
    'endereco_legado',
    'endereco_completo',
    'latitude',
    'longitude',
]

function escaparCsv(valor) {
    const s = String(valor ?? '')
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
}

export function hashEnderecoGeocode(enderecoCompleto) {
    return String(enderecoCompleto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
}

/** Normaliza texto legado para consulta Nominatim (vírgulas, sem CEP redundante). */
export function limparEnderecoLegadoParaBusca(enderecoLegado) {
    const base = String(enderecoLegado || '').trim()
    if (!base) return ''
    const expandido = base
        .replace(/\bAv\.(?=\s|,|$)|\bAv(?=\s|,|$)/gi, 'Avenida')
        .replace(/\bPres\.(?=\s|,|$)|\bPres(?=\s|,|$)/gi, 'Presidente')
        .replace(/\bR\.(?=\s|,|$)|\bR(?=\s|,|$)/gi, 'Rua')
        .replace(/\bDr\.(?=\s|,|$)|\bDr(?=\s|,|$)/gi, 'Doutor')
        .replace(/\bProf\.(?=\s|,|$)|\bProf(?=\s|,|$)/gi, 'Professor')
        .replace(/\bSta\.(?=\s|,|$)|\bSta(?=\s|,|$)/gi, 'Santa')
        .replace(/\bSto\.(?=\s|,|$)|\bSto(?=\s|,|$)/gi, 'Santo')
    return expandido
        .replace(/\s+[—–-]\s+/g, ', ')
        .replace(/\bCEP\s*\d{5}-?\d{3}\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+,/g, ',')
        .replace(/,+/g, ',')
        .replace(/,\s*,/g, ', ')
        .replace(/,\s*$/, '')
        .trim()
}

/** Variantes de busca (com Brasil quando faltar). */
export function montarConsultasNominatimBrasil(enderecoTexto) {
    const limpo = String(enderecoTexto || '').trim()
    if (!limpo) return []
    const semCep = limpo.replace(/\b\d{5}-?\d{3}\b/g, '').replace(/,\s*,/g, ', ').replace(/,\s*$/, '').trim()
    const cidadeUfComVirgula = semCep.replace(/\/([A-Z]{2})\b/g, ', $1')
    const semBairro = (() => {
        const partes = cidadeUfComVirgula
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean)
        const idxUf = partes.findIndex((p) => /^[A-Z]{2}$/i.test(p))
        // Remove apenas o bairro (token anterior à cidade) quando há estrutura suficiente.
        if (idxUf >= 3) {
            const idxBairro = idxUf - 2
            const candidato = partes[idxBairro] || ''
            if (!/\d/.test(candidato)) {
                const arr = [...partes]
                arr.splice(idxBairro, 1)
                return arr.join(', ')
            }
        }
        return cidadeUfComVirgula
    })()
    const semNumero = semBairro
        .replace(/,\s*\d+[A-Za-z]?\b/, '')
        .replace(/,\s*,/g, ', ')
        .trim()

    const bases = [limpo, semCep, cidadeUfComVirgula, semBairro, semNumero].filter(Boolean)
    const unicas = []
    const seen = new Set()
    for (const b of bases) {
        const x = b.replace(/\s{2,}/g, ' ').replace(/,\s*$/, '').trim()
        if (!x) continue
        const k = hashEnderecoGeocode(x)
        if (seen.has(k)) continue
        seen.add(k)
        unicas.push(x)
    }

    const consultas = []
    for (const q of unicas) {
        consultas.push(q)
        if (!/brasil/i.test(q)) consultas.push(`${q}, Brasil`)
    }
    return consultas
}

/**
 * Ordem: endereço legado (limpo) → endereço estruturado (campos novos).
 * @returns {{ query: string, tentativa: 'legado' | 'estruturado' }[]}
 */
export function listarConsultasGeocodePrestador(prestador) {
    const vistos = new Set()
    const out = []
    const pushGrupo = (tentativa, texto) => {
        const base = limparEnderecoLegadoParaBusca(texto)
        for (const query of montarConsultasNominatimBrasil(base)) {
            const chave = hashEnderecoGeocode(query)
            if (vistos.has(chave)) continue
            vistos.add(chave)
            out.push({ query, tentativa })
        }
    }
    const legado = String(prestador?.endereco || '').trim()
    if (legado) pushGrupo('legado', legado)
    const estruturado = montarEnderecoUmaLinha(prestador || {}).trim()
    if (estruturado) pushGrupo('estruturado', estruturado)
    return out
}

/** UF para validar resultado Nominatim (campo novo ou extraído do texto). */
export function ufPrestadorParaValidacaoGeocode(prestador) {
    const direto = String(prestador?.endereco_uf || '').trim().toUpperCase()
    if (/^[A-Z]{2}$/.test(direto)) return direto
    const blob = `${prestador?.endereco || ''} ${montarEnderecoUmaLinha(prestador || {})}`
    const m = blob.match(/\/([A-Z]{2})\b/) || blob.match(/,\s*([A-Z]{2})\s*-\s*\d/) || blob.match(/-\s*([A-Z]{2})\s*,/)
    return m ? String(m[1]).toUpperCase() : ''
}

/** Dicas de cadastro/formatação antes de chamar o Nominatim. */
export function diagnosticoCadastroEnderecoGeocode(prestador) {
    const p = prestador || {}
    const dicas = []
    const legado = String(p.endereco || '').trim()
    const log = String(p.endereco_logradouro || '').trim()
    const num = String(p.endereco_numero || '').trim()
    const bairro = String(p.endereco_bairro || '').trim()
    const cidade = String(p.endereco_cidade || '').trim()
    const uf = String(p.endereco_uf || '').trim().toUpperCase()
    const cep = String(p.cep || '').replace(/\D/g, '')

    if (!legado && !log) dicas.push('Sem endereço legado e sem logradouro nos campos novos.')
    if (!legado && log) dicas.push('Sem endereço legado; só campos estruturados serão usados após falha do legado.')
    if (legado && !log) dicas.push('Sem logradouro nos campos novos (fallback estruturado pode ser fraco).')
    if (legado && /[—–]/.test(legado)) dicas.push('Legado usa travessão (—); na busca isso vira vírgula — confira se não quebrou o sentido.')
    if (legado && /\b(CASA|APTO|APARTAMENTO|SALA|LOJA)\b/i.test(legado)) {
        dicas.push('Legado contém complemento (CASA/SALA/LOJA); o Nominatim às vezes ignora o número.')
    }
    if (!cidade && legado && !/\/[A-Z]{2}\b/.test(legado)) dicas.push('Cidade (campo novo) vazia e legado sem padrão Cidade/UF.')
    if (!uf && !ufPrestadorParaValidacaoGeocode(p)) {
        dicas.push('UF ausente; validação por estado fica desligada (aceita qualquer resultado no Brasil).')
    }
    if (!num && log) dicas.push('Número do endereço vazio nos campos novos.')
    if (!bairro && log) dicas.push('Bairro vazio nos campos novos.')
    if (cep.length !== 8) dicas.push('CEP ausente ou incompleto (8 dígitos ajudam na precisão).')
    const nome = String(p.nome || '').trim()
    if (nome && legado && normalizarTextoDiagnostico(legado).includes(normalizarTextoDiagnostico(nome))) {
        dicas.push('Nome da clínica aparece no endereço legado; prefira só logradouro + número + cidade.')
    }
    return dicas
}

function normalizarTextoDiagnostico(t) {
    return String(t || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
}

export function montarEnderecoGeocodeFromPrestador(prestador) {
    const estruturado = montarEnderecoUmaLinha(prestador || {})
    if (estruturado.trim()) return estruturado.trim()
    const legado = String(prestador?.endereco || '').trim()
    if (legado) return legado
    const partes = [
        prestador?.endereco_cidade,
        prestador?.endereco_uf,
        prestador?.cep,
        'Brasil',
    ].filter(Boolean)
    return partes.join(', ')
}

export function especialidadePorIdMap(especialidades = []) {
    return new Map((especialidades || []).map((e) => [Number(e.id), e]))
}

export function prestadorEhTipoLocal(prestador, mapaEsp) {
    const esp = mapaEsp?.get(Number(prestador?.especialidade_id))
    const tipo = tipoEspecialidadePrestador(esp?.tipo || prestador?.tipo || '')
    return tipo === 'LOCAL'
}

export function linhaExportEnderecoPrestador(prestador, mapaEsp) {
    const esp = mapaEsp?.get(Number(prestador?.especialidade_id))
    const tipo = tipoEspecialidadePrestador(esp?.tipo || prestador?.tipo || '')
    return {
        prestador_id: prestador.id,
        nome: prestador.nome || '',
        especialidade: esp?.nome || '',
        tipo_especialidade: tipo,
        cep: prestador.cep || '',
        logradouro: prestador.endereco_logradouro || '',
        numero: prestador.endereco_numero || '',
        bairro: prestador.endereco_bairro || '',
        cidade: prestador.endereco_cidade || '',
        uf: prestador.endereco_uf || '',
        endereco_legado: prestador.endereco || '',
        endereco_completo: montarEnderecoGeocodeFromPrestador(prestador),
        latitude: prestador.latitude ?? '',
        longitude: prestador.longitude ?? '',
    }
}

/** @param {object[]} linhas — saída de linhaExportEnderecoPrestador */
export function gerarCsvPrestadoresEnderecos(linhas) {
    const header = CSV_COLUNAS_ENDERECO_PRESTADOR.join(',')
    const corpo = (linhas || []).map((row) =>
        CSV_COLUNAS_ENDERECO_PRESTADOR.map((col) => escaparCsv(row[col])).join(','),
    )
    return `\uFEFF${[header, ...corpo].join('\r\n')}`
}

export function filtrarPrestadoresParaMapaEndereco(
    prestadores,
    especialidades,
    { apenasLocal = true, apenasCredenciados = true, situacoes = [] } = {},
) {
    const mapa = especialidadePorIdMap(especialidades)
    return (prestadores || []).filter((p) => {
        if (!p.ativo && p.ativo !== undefined) return false
        if (apenasCredenciados && !prestadorEhCredenciado(p, situacoes)) return false
        if (apenasLocal && !prestadorEhTipoLocal(p, mapa)) return false
        const end = montarEnderecoGeocodeFromPrestador(p)
        return Boolean(String(end || '').trim())
    })
}

/** Credenciados LOCAL ativos — base para vínculo por nome no import KMZ (não exige endereço). */
export function filtrarPrestadoresParaImportCoordenadas(
    prestadores,
    especialidades,
    { apenasLocal = true, apenasCredenciados = true, situacoes = [] } = {},
) {
    const mapa = especialidadePorIdMap(especialidades)
    return (prestadores || []).filter((p) => {
        if (p.ativo === false) return false
        if (apenasCredenciados && !prestadorEhCredenciado(p, situacoes)) return false
        if (apenasLocal && !prestadorEhTipoLocal(p, mapa)) return false
        return Boolean(String(p.nome || '').trim())
    })
}

export function parseCoordenadaEntrada(valor) {
    const s = String(valor ?? '')
        .trim()
        .replace(',', '.')
    if (!s) return null
    const n = Number(s)
    return Number.isFinite(n) ? n : null
}

/** Persiste coordenadas definidas manualmente (cadastro ou tela do mapa). */
export async function atualizarCoordenadasPrestadorManual(supabase, prestadorId, lat, lng, prestadorParaHash = {}) {
    const la = parseCoordenadaEntrada(lat)
    const lo = parseCoordenadaEntrada(lng)
    if (!coordenadasValidasBrasil(la, lo)) {
        throw new Error('Informe latitude e longitude válidas dentro do Brasil.')
    }
    const agora = new Date().toISOString()
    const hash = hashEnderecoGeocode(montarEnderecoGeocodeFromPrestador(prestadorParaHash))
    const { error } = await supabase
        .from('prestadores')
        .update({
            latitude: la,
            longitude: lo,
            geocoded_at: agora,
            geocode_fonte: 'manual',
            endereco_geocode_hash: hash || null,
            data_atualizacao: agora,
        })
        .eq('id', Number(prestadorId))
    if (error) throw new Error(error.message)
    return { latitude: la, longitude: lo }
}

/** Coordenadas vindas de import KMZ (ex.: Google My Maps). */
export async function atualizarCoordenadasPrestadorImport(
    supabase,
    prestadorId,
    lat,
    lng,
    prestadorParaHash = {},
    { geocodeFonte = 'import_mymaps' } = {},
) {
    const la = parseCoordenadaEntrada(lat)
    const lo = parseCoordenadaEntrada(lng)
    if (!coordenadasValidasBrasil(la, lo)) {
        throw new Error('Coordenadas inválidas para o Brasil.')
    }
    const agora = new Date().toISOString()
    const hash = hashEnderecoGeocode(montarEnderecoGeocodeFromPrestador(prestadorParaHash))
    const { error } = await supabase
        .from('prestadores')
        .update({
            latitude: la,
            longitude: lo,
            geocoded_at: agora,
            geocode_fonte: geocodeFonte,
            endereco_geocode_hash: hash || null,
            data_atualizacao: agora,
        })
        .eq('id', Number(prestadorId))
    if (error) throw new Error(error.message)
    return { latitude: la, longitude: lo }
}

export function coordenadasValidasBrasil(lat, lng) {
    const la = Number(lat)
    const lo = Number(lng)
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return false
    if (la < -35 || la > 6) return false
    if (lo < -75 || lo > -32) return false
    return true
}

/** Parse CSV simples (suporta campos entre aspas). */
export function parsearCsvTexto(texto) {
    const linhas = []
    let i = 0
    const s = String(texto || '').replace(/^\uFEFF/, '')
    const len = s.length

    const lerCampo = () => {
        if (s[i] === '"') {
            i += 1
            let buf = ''
            while (i < len) {
                if (s[i] === '"') {
                    if (s[i + 1] === '"') {
                        buf += '"'
                        i += 2
                        continue
                    }
                    i += 1
                    break
                }
                buf += s[i]
                i += 1
            }
            if (s[i] === ',') i += 1
            return buf
        }
        let buf = ''
        while (i < len && s[i] !== ',' && s[i] !== '\n' && s[i] !== '\r') {
            buf += s[i]
            i += 1
        }
        if (s[i] === ',') i += 1
        return buf
    }

    if (!s.trim()) return linhas

    const header = []
    while (i < len && s[i] !== '\n' && s[i] !== '\r') {
        header.push(lerCampo().trim())
    }
    while (i < len && (s[i] === '\n' || s[i] === '\r')) i += 1

    while (i < len) {
        const row = {}
        for (let c = 0; c < header.length; c += 1) {
            row[header[c]] = lerCampo()
        }
        while (i < len && (s[i] === '\n' || s[i] === '\r')) i += 1
        if (Object.values(row).some((v) => String(v || '').trim())) linhas.push(row)
    }
    return linhas
}

export function linhasCsvParaAtualizacaoCoordenadas(linhasCsv) {
    const out = []
    for (const row of linhasCsv || []) {
        const id = Number(row.prestador_id)
        if (!id) continue
        const lat = String(row.latitude ?? '').trim().replace(',', '.')
        const lng = String(row.longitude ?? '').trim().replace(',', '.')
        if (!coordenadasValidasBrasil(lat, lng)) continue
        out.push({
            id,
            latitude: Number(lat),
            longitude: Number(lng),
            geocode_fonte: 'import_csv',
            endereco_geocode_hash: hashEnderecoGeocode(row.endereco_completo || ''),
        })
    }
    return out
}
