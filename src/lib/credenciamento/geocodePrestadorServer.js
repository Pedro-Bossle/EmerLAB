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
import {
    bairroConfere,
    enderecoCanonicoDoPrestador,
    montarConsultasGeocode,
    ruaConfere,
    semAcentoMinusculo,
} from './enderecoBrasil.js'
import { distanciaKm } from '../municipiosCoordenadas.js'
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

const normalizar = semAcentoMinusculo

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

/** O município do resultado é o do cadastro? Sem cidade conhecida, não há o que comparar. */
export function cidadeConfere(cidadeEsperada, cidadeHit, displayName = '') {
    const esperada = normalizar(cidadeEsperada)
    if (!esperada) return true
    const obtida = normalizar(cidadeHit)
    if (obtida) return obtida === esperada || obtida.includes(esperada) || esperada.includes(obtida)
    return normalizar(displayName).includes(esperada)
}

const PALAVRAS_GENERICAS_NOME = new Set([
    'clinica', 'veterinaria', 'veterinario', 'veterinarios', 'vet', 'vets', 'pet', 'pets', 'petshop', 'shop', 'animal',
    'animais', 'hospital', 'consultorio', 'centro', 'banho', 'tosa', 'racao', 'racoes', 'agropecuaria', 'ltda', 'cia',
    'servicos', 'estetica', 'dos', 'das', 'de', 'da', 'do',
])

/** O estabelecimento procurado pelo nome? Todas as palavras distintivas do nome têm de aparecer no resultado. */
export function nomeDoLocalConfere(nomePrestador, hit) {
    const alvo = normalizar(nomePrestador)
    const blob = normalizar(`${hit?.nome || ''} ${hit?.displayName || ''}`)
    if (!alvo || !blob) return false
    const distintivos = alvo.split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !PALAVRAS_GENERICAS_NOME.has(t))
    if (distintivos.length) return distintivos.every((t) => blob.includes(t))
    const nomeHit = normalizar(hit?.nome)
    return Boolean(nomeHit) && (nomeHit.includes(alvo) || alvo.includes(nomeHit))
}

function fonteDaPrecisao(precisao) {
    if (precisao === 'casa') return 'nominatim'
    if (precisao === 'rua') return 'nominatim_rua'
    return 'nominatim_aprox'
}

const metros = (a, b) => distanciaKm(a.latitude, a.longitude, b.latitude, b.longitude) * 1000

/**
 * Escolhe, entre os resultados aceitos, o ponto mais confiável. Medido contra coordenadas conferidas à mão:
 * o ponto da RUA (consulta sem depender do nº) erra ~300 m; um «imóvel» do OSM às vezes cai a 1–2 km (nº
 * repetido em outro trecho) e a busca pelo NOME do local chegou a errar 13 km. Por isso:
 *  - «casa» só vale se confirmada: bairro igual ao do cadastro, ou a até 800 m do ponto da rua;
 *  - o estabelecimento pelo nome só refina se estiver a até 600 m do ponto da rua/casa;
 *  - sem confirmação, cai para a rua (aproximado) → centro do CEP → região.
 * @returns {{ ponto: object, precisao: 'casa'|'rua'|'cep'|'bairro', confirmado: boolean } | null}
 */
export function decidirGeocode(aceitos, { bairroEsperado = '' } = {}) {
    const lista = aceitos || []
    if (!lista.length) return null
    const ruas = lista.filter((x) => x.alvo === 'endereco' && x.precisao === 'rua')
    const ancora = ruas[0] || null
    const casas = lista.filter((x) => x.alvo === 'endereco' && x.precisao === 'casa')

    const casaConfirmada = casas.find(
        (c) =>
            (ancora && metros(c, ancora) <= 800) ||
            (bairroEsperado && c.bairro && bairroConfere(bairroEsperado, c.bairro)),
    )
    if (casaConfirmada) return { ponto: casaConfirmada, precisao: 'casa', confirmado: true }

    const referencia = ancora || null
    const nomes = lista.filter((x) => x.alvo === 'nome')
    if (referencia) {
        const poi = nomes.find((n) => metros(n, referencia) <= 600)
        if (poi) return { ponto: poi, precisao: 'casa', confirmado: true }
        return { ponto: referencia, precisao: 'rua', confirmado: false }
    }
    if (casas.length) return { ponto: casas[0], precisao: 'rua', confirmado: false }
    const cep = lista.find((x) => x.alvo === 'cep')
    if (cep) return { ponto: cep, precisao: 'cep', confirmado: false }
    // Só o nome do local, sem endereço para conferir: serve como aproximação da região.
    if (nomes.length) return { ponto: nomes[0], precisao: 'bairro', confirmado: false }
    return null
}

/** CEP no navegador passa pelo proxy do app (CSP); no Node vai direto ao ViaCEP. */
async function consultarCepPadrao(cep) {
    if (typeof window !== 'undefined') {
        const { buscarEnderecoPorCep } = await import('../viacepClient.js')
        const r = await buscarEnderecoPorCep(cep)
        return { logradouro: r.logradouro, bairro: r.bairro, cidade: r.cidade, uf: r.uf, cep }
    }
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    try {
        const resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: ctrl.signal })
        const j = await resp.json()
        if (!j || j.erro) return null
        return { logradouro: j.logradouro, bairro: j.bairro, cidade: j.localidade, uf: j.uf, cep }
    } finally {
        clearTimeout(t)
    }
}

async function viaCepSeguro(prestador, consultarCep) {
    const cep = String(prestador?.cep || '').replace(/\D/g, '')
    const canon = enderecoCanonicoDoPrestador(prestador)
    const digitos = cep.length === 8 ? cep : canon.cep
    if (!digitos || digitos.length !== 8) return null
    try {
        return (await consultarCep(digitos)) || null
    } catch {
        return null
    }
}

/**
 * Descobre as coordenadas de um prestador. Tenta, nesta ordem: rua+número (completando o que falta com o
 * ViaCEP), rua, centro do CEP e o nome do estabelecimento. Só aceita resultado do mesmo estado e município,
 * e guarda o mais preciso encontrado (`precisao`: casa > rua > cep/bairro).
 *
 * @param {object} prestador
 * @param {{ delayEntreConsultasMs?: number, orcamentoMs?: number, consultarCep?: (cep: string) => Promise<object|null>, pararNoExato?: boolean }} [opts]
 *   `pararNoExato: false` testa todas as consultas (usado em diagnóstico/calibração).
 *   `orcamentoMs`: para de tentar depois desse tempo (funções serverless têm limite de execução).
 */
export async function geocodificarPrestadorNominatim(
    prestador,
    { delayEntreConsultasMs = 1100, orcamentoMs = 0, consultarCep = consultarCepPadrao, pararNoExato = true } = {},
) {
    const inicio = Date.now()
    const dicasCadastro = diagnosticoCadastroEnderecoGeocode(prestador)
    const via = await viaCepSeguro(prestador, consultarCep)
    const canon = enderecoCanonicoDoPrestador(prestador, via)
    const consultas = montarConsultasGeocode(prestador, via)
    const ufEsperada = canon.uf || ufPrestadorParaValidacaoGeocode(prestador)
    const cidadeEsperada = canon.cidade
    const diagnosticoBase = {
        prestadorId: prestador?.id ?? null,
        nome: prestador?.nome ?? '',
        ufEsperada: ufEsperada || null,
        cidadeEsperada: cidadeEsperada || null,
        cepConsultado: Boolean(via),
        dicasCadastro,
        tentativas: [],
    }

    if (!consultas.length) {
        return {
            ok: false,
            erro: 'Sem endereço para geocodificar.',
            codigo: 'sem_endereco',
            diagnostico: {
                ...diagnosticoBase,
                resumo: 'Cadastro sem endereço utilizável (falta logradouro, CEP e cidade).',
            },
        }
    }

    const aceitos = []
    let decisao = null
    let ultimoCodigo = 'nominatim_nao_encontrado'
    let ultimoErro = 'Endereço não encontrado.'

    for (let i = 0; i < consultas.length; i += 1) {
        if (orcamentoMs > 0 && Date.now() - inicio > orcamentoMs) {
            diagnosticoBase.tentativas.push({ tentativa: consultas[i].rotulo, query: consultas[i].query, codigo: 'orcamento_tempo' })
            break
        }
        const { query, alvo, rotulo } = consultas[i]
        const registro = { tentativa: rotulo, alvo, query, codigo: '', detalhe: '' }

        // Já achou a rua: as outras consultas de endereço/CEP devolveriam a mesma via. Só falta tentar refinar pelo nome.
        const temRua = aceitos.some((x) => x.alvo === 'endereco' && x.precisao === 'rua')
        if (pararNoExato && temRua && (alvo === 'endereco' || alvo === 'cep')) {
            registro.codigo = 'dispensada'
            registro.detalhe = 'rua já localizada'
            diagnosticoBase.tentativas.push(registro)
            continue
        }

        try {
            let geo = await geocodificarEnderecoNominatim(query, { limite: 4 })
            if (!geo.ok && geo.codigo === 'rate_limit' && (!orcamentoMs || Date.now() - inicio < orcamentoMs - 4000)) {
                await delayMs(4000)
                geo = await geocodificarEnderecoNominatim(query, { limite: 4 })
            }
            if (!geo.ok) {
                const msg = String(geo.erro || '')
                registro.codigo = msg.includes('HTTP') || geo.codigo === 'rate_limit' ? 'nominatim_http' : 'nominatim_nao_encontrado'
                registro.detalhe = msg
                ultimoCodigo = registro.codigo
                ultimoErro = msg || ultimoErro
            } else {
                const candidatos = geo.candidatos?.length ? geo.candidatos : [geo]
                let aceito = null
                const motivos = []
                for (const c0 of candidatos) {
                    // Consulta por CEP devolve o ponto da região do CEP, mesmo que caia num comércio.
                    const c = alvo === 'cep' ? { ...c0, precisao: 'cep' } : c0
                    if (!coordenadasValidasBrasil(c.latitude, c.longitude)) {
                        motivos.push('fora do Brasil')
                    } else if (!displayNameBateComUf(c.displayName, ufEsperada)) {
                        motivos.push('UF diferente')
                    } else if (!cidadeConfere(cidadeEsperada, c.cidade, c.displayName)) {
                        motivos.push(`outra cidade (${c.cidade || '?'})`)
                    } else if (c.precisao === 'cidade') {
                        motivos.push('só a cidade (genérico)')
                    } else if (alvo === 'nome' && !nomeDoLocalConfere(prestador?.nome, c)) {
                        motivos.push('outro estabelecimento')
                    } else if (
                        alvo === 'endereco' &&
                        c.rua &&
                        canon.logradouro &&
                        !ruaConfere(canon.logradouro, c.rua) &&
                        !(canon.viaLogradouro && ruaConfere(canon.viaLogradouro, c.rua))
                    ) {
                        motivos.push(`outra rua (${c.rua})`)
                    } else {
                        aceito = c
                        break
                    }
                }
                if (aceito) {
                    registro.codigo = 'ok'
                    registro.detalhe = `${aceito.precisao}: ${aceito.displayName || ''}`
                    registro.displayName = aceito.displayName || ''
                    registro.latitude = aceito.latitude
                    registro.longitude = aceito.longitude
                    registro.precisao = aceito.precisao
                    aceitos.push({ ...aceito, alvo, tentativa: rotulo, queryUsada: query })
                    decisao = decidirGeocode(aceitos, { bairroEsperado: canon.bairro })
                } else {
                    registro.codigo = 'resultado_rejeitado'
                    registro.detalhe = [...new Set(motivos)].join('; ')
                    ultimoCodigo = registro.codigo
                    ultimoErro = `Resultado rejeitado: ${registro.detalhe}.`
                }
            }
        } catch (e) {
            registro.codigo = 'erro_rede'
            registro.detalhe = e?.message || String(e)
            ultimoCodigo = registro.codigo
            ultimoErro = registro.detalhe
        }

        diagnosticoBase.tentativas.push(registro)
        if (pararNoExato && decisao?.precisao === 'casa' && decisao.confirmado) break
        if (i < consultas.length - 1 && delayEntreConsultasMs > 0) {
            await delayMs(delayEntreConsultasMs)
        }
    }

    if (decisao) {
        const { ponto, precisao } = decisao
        return {
            ok: true,
            latitude: ponto.latitude,
            longitude: ponto.longitude,
            precisao,
            aproximado: precisao !== 'casa',
            geocodeFonte: fonteDaPrecisao(precisao),
            tentativa: ponto.tentativa,
            queryUsada: ponto.queryUsada,
            displayName: ponto.displayName,
            diagnostico: diagnosticoBase,
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
        partes.push(`${contagem.nominatim_nao_encontrado} consulta(s) sem resultado no mapa (endereço ambíguo ou incompleto)`)
    }
    if (contagem.resultado_rejeitado) {
        partes.push(`${contagem.resultado_rejeitado} consulta(s) com resultado descartado (outra cidade/UF ou genérico demais)`)
    }
    if (contagem.nominatim_http) partes.push('Erro HTTP no Nominatim (rate limit ou indisponível)')
    if (contagem.erro_rede) partes.push('Falha de rede ao consultar o mapa')
    if (contagem.orcamento_tempo) partes.push('Tempo esgotado antes de tentar todas as consultas')
    if (!partes.length) partes.push('Nenhuma consulta obteve coordenada válida.')
    if (dicasCadastro.length) partes.push(`Dica: ${dicasCadastro[0]}`)
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
export async function geocodificarESalvarPrestador(supabase, prestadorId, { forcar = false, orcamentoMs = 7000 } = {}) {
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

    // O servidor já espaça as chamadas ao Nominatim (1 por segundo); não somar espera aqui.
    const geo = await geocodificarPrestadorNominatim(prestador, { delayEntreConsultasMs: 0, orcamentoMs })
    if (!geo.ok) return { ok: false, erro: geo.erro, codigo: geo.codigo, diagnostico: geo.diagnostico }

    const agora = new Date().toISOString()
    const { error: upErr } = await supabase
        .from('prestadores')
        .update({
            latitude: geo.latitude,
            longitude: geo.longitude,
            geocoded_at: agora,
            geocode_fonte: geo.geocodeFonte,
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

    return { ok: true, latitude: geo.latitude, longitude: geo.longitude, precisao: geo.precisao }
}
