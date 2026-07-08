import {
    hashEnderecoGeocode,
    montarEnderecoGeocodeFromPrestador,
    prestadorEhTipoLocal,
    especialidadePorIdMap,
    listarConsultasGeocodePrestador,
    coordenadasValidasBrasil,
    diagnosticoCadastroEnderecoGeocode,
    ufPrestadorParaValidacaoGeocode,
} from './prestadorEnderecoGeocode.js'
import { geocodificarEnderecoNominatim, delayMs } from './geocodeNominatim.js'

const UF_NOME = {
    AC: 'acre',
    AL: 'alagoas',
    AM: 'amazonas',
    AP: 'amapa',
    BA: 'bahia',
    CE: 'ceara',
    DF: 'distrito federal',
    ES: 'espirito santo',
    GO: 'goias',
    MA: 'maranhao',
    MG: 'minas gerais',
    MS: 'mato grosso do sul',
    MT: 'mato grosso',
    PA: 'para',
    PB: 'paraiba',
    PE: 'pernambuco',
    PI: 'piaui',
    PR: 'parana',
    RJ: 'rio de janeiro',
    RN: 'rio grande do norte',
    RO: 'rondonia',
    RR: 'roraima',
    RS: 'rio grande do sul',
    SC: 'santa catarina',
    SE: 'sergipe',
    SP: 'sao paulo',
    TO: 'tocantins',
}

const normalizar = (t) =>
    String(t || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()

function displayNameBateComUf(displayName, uf) {
    const u = String(uf || '').trim().toUpperCase()
    if (!u) return true
    const alvo = normalizar(displayName)
    const nomeUf = UF_NOME[u]
    if (alvo.includes(` ${normalizar(u)} `) || alvo.endsWith(` ${normalizar(u)}`) || alvo.includes(`, ${normalizar(u)}`)) {
        return true
    }
    if (nomeUf && alvo.includes(nomeUf)) return true
    return false
}

export async function geocodificarPrestadorNominatim(prestador, { delayEntreConsultasMs = 1100 } = {}) {
    const consultas = listarConsultasGeocodePrestador(prestador)
    const dicasCadastro = diagnosticoCadastroEnderecoGeocode(prestador)
    const ufEsperada = ufPrestadorParaValidacaoGeocode(prestador)
    const diagnosticoBase = {
        prestadorId: prestador?.id ?? null,
        nome: prestador?.nome ?? '',
        ufEsperada: ufEsperada || null,
        dicasCadastro,
        tentativas: [],
    }

    if (!consultas.length) {
        return {
            ok: false,
            erro: 'Sem endereço para geocodificar.',
            diagnostico: {
                ...diagnosticoBase,
                resumo: 'Cadastro sem texto de endereço (legado e estruturado vazios).',
            },
        }
    }

    let ultimoCodigo = 'nominatim_nao_encontrado'
    let ultimoErro = 'Endereço não encontrado.'

    for (let i = 0; i < consultas.length; i += 1) {
        const { query, tentativa } = consultas[i]
        const registro = { tentativa, query, codigo: '', detalhe: '' }

        try {
            const geo = await geocodificarEnderecoNominatim(query)
            if (!geo.ok) {
                const msg = String(geo.erro || '')
                if (msg.includes('HTTP')) {
                    registro.codigo = 'nominatim_http'
                    registro.detalhe = msg
                } else {
                    registro.codigo = 'nominatim_nao_encontrado'
                    registro.detalhe = 'Nominatim não retornou resultado para esta consulta.'
                }
                ultimoCodigo = registro.codigo
                ultimoErro = msg || ultimoErro
            } else if (!coordenadasValidasBrasil(geo.latitude, geo.longitude)) {
                registro.codigo = 'coordenada_fora_brasil'
                registro.detalhe = `Resultado fora da faixa BR: ${geo.latitude}, ${geo.longitude}`
                registro.displayName = geo.displayName || ''
                ultimoCodigo = registro.codigo
                ultimoErro = registro.detalhe
            } else if (!displayNameBateComUf(geo.displayName, ufEsperada)) {
                registro.codigo = 'uf_nao_confere'
                registro.detalhe = `Esperado UF ${ufEsperada || '?'}; Nominatim: "${geo.displayName || ''}"`
                registro.latitude = geo.latitude
                registro.longitude = geo.longitude
                registro.displayName = geo.displayName || ''
                ultimoCodigo = registro.codigo
                ultimoErro = 'UF do resultado não confere com o cadastro.'
            } else {
                registro.codigo = 'ok'
                registro.detalhe = geo.displayName || ''
                diagnosticoBase.tentativas.push(registro)
                return {
                    ok: true,
                    latitude: geo.latitude,
                    longitude: geo.longitude,
                    tentativa,
                    queryUsada: query,
                    displayName: geo.displayName,
                    diagnostico: diagnosticoBase,
                }
            }
        } catch (e) {
            registro.codigo = 'erro_rede'
            registro.detalhe = e?.message || String(e)
            ultimoCodigo = registro.codigo
            ultimoErro = registro.detalhe
        }

        diagnosticoBase.tentativas.push(registro)
        if (i < consultas.length - 1 && delayEntreConsultasMs > 0) {
            await delayMs(delayEntreConsultasMs)
        }
    }

    const contagem = diagnosticoBase.tentativas.reduce((acc, t) => {
        acc[t.codigo] = (acc[t.codigo] || 0) + 1
        return acc
    }, {})

    return {
        ok: false,
        erro: ultimoErro,
        codigo: ultimoCodigo,
        diagnostico: {
            ...diagnosticoBase,
            resumo: resumirFalhaGeocode(contagem, dicasCadastro),
        },
    }
}

function resumirFalhaGeocode(contagem, dicasCadastro) {
    const partes = []
    if (contagem.nominatim_nao_encontrado) {
        partes.push(`${contagem.nominatim_nao_encontrado} consulta(s) sem match no Nominatim (endereço ambíguo ou incompleto)`)
    }
    if (contagem.uf_nao_confere) {
        partes.push(`${contagem.uf_nao_confere} resultado(s) rejeitado(s) por UF diferente do cadastro`)
    }
    if (contagem.coordenada_fora_brasil) {
        partes.push(`${contagem.coordenada_fora_brasil} resultado(s) fora do Brasil`)
    }
    if (contagem.nominatim_http) partes.push('Erro HTTP no Nominatim (rate limit ou indisponível)')
    if (contagem.erro_rede) partes.push('Falha de rede ao consultar Nominatim')
    if (!partes.length) partes.push('Nenhuma consulta obteve coordenada válida.')
    if (dicasCadastro.length) partes.push(`Dicas cadastro: ${dicasCadastro[0]}`)
    return partes.join('; ')
}

const COLS_PRESTADOR_GEO =
    'id, nome, tipo, especialidade_id, cep, endereco, endereco_logradouro, endereco_numero, endereco_bairro, endereco_cidade, endereco_uf, endereco_pais, latitude, longitude, endereco_geocode_hash'

export async function carregarPrestadorParaGeocode(supabase, prestadorId) {
    const { data, error } = await supabase
        .from('prestadores')
        .select(COLS_PRESTADOR_GEO)
        .eq('id', Number(prestadorId))
        .maybeSingle()
    if (error) throw new Error(error.message)
    return data
}

export async function carregarEspecialidadesMap(supabase) {
    const { data, error } = await supabase.from('especialidades').select('id, nome, tipo')
    if (error) throw new Error(error.message)
    return especialidadePorIdMap(data || [])
}

/**
 * Geocodifica e persiste se o prestador for LOCAL e o endereço mudou (ou sem coordenadas).
 * @returns {Promise<{ ok: boolean, skipped?: boolean, erro?: string, latitude?: number, longitude?: number }>}
 */
export async function geocodificarESalvarPrestador(supabase, prestadorId, { forcar = false } = {}) {
    const prestador = await carregarPrestadorParaGeocode(supabase, prestadorId)
    if (!prestador) return { ok: false, erro: 'Prestador não encontrado.' }

    const mapaEsp = await carregarEspecialidadesMap(supabase)
    if (!prestadorEhTipoLocal(prestador, mapaEsp)) {
        return { ok: true, skipped: true, motivo: 'nao_local' }
    }

    const enderecoCanonico = montarEnderecoGeocodeFromPrestador(prestador)
    if (!enderecoCanonico.trim() && !listarConsultasGeocodePrestador(prestador).length) {
        return { ok: true, skipped: true, motivo: 'sem_endereco' }
    }

    const hash = hashEnderecoGeocode(enderecoCanonico || listarConsultasGeocodePrestador(prestador)[0]?.query || '')
    if (
        !forcar &&
        prestador.latitude != null &&
        prestador.longitude != null &&
        prestador.endereco_geocode_hash === hash
    ) {
        return { ok: true, skipped: true, motivo: 'ja_atualizado' }
    }

    const geo = await geocodificarPrestadorNominatim(prestador)
    if (!geo.ok) return { ok: false, erro: geo.erro, codigo: geo.codigo, diagnostico: geo.diagnostico }

    const agora = new Date().toISOString()
    const { error: upErr } = await supabase
        .from('prestadores')
        .update({
            latitude: geo.latitude,
            longitude: geo.longitude,
            geocoded_at: agora,
            geocode_fonte: geo.tentativa === 'legado' ? 'nominatim' : 'nominatim_estruturado',
            endereco_geocode_hash: hash,
            data_atualizacao: agora,
        })
        .eq('id', Number(prestadorId))

    if (upErr) {
        const msg = String(upErr.message || '')
        if (msg.includes('latitude') || msg.includes('longitude')) {
            return {
                ok: false,
                erro: 'Colunas latitude/longitude ausentes. Execute scripts/sql/prestadores_geocode.sql no Supabase.',
            }
        }
        return { ok: false, erro: upErr.message }
    }

    return { ok: true, latitude: geo.latitude, longitude: geo.longitude }
}
