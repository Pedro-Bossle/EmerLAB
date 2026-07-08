/**
 * Primeira carga de coordenadas direto no banco (sem CSV).
 * Ordem: legado → estruturado. Diagnóstico detalhado em falhas.
 *
 * Uso:
 *   npm run prestadores:geocode-primeira-carga -- --dry-run
 *   npm run prestadores:geocode-primeira-carga -- --saida-diagnostico tmp/geocode-falhas.json
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { config as dotenvConfig } from 'dotenv'
import {
    coordenadasValidasBrasil,
    filtrarPrestadoresParaMapaEndereco,
    hashEnderecoGeocode,
    listarConsultasGeocodePrestador,
    montarEnderecoGeocodeFromPrestador,
} from '../../src/lib/credenciamento/prestadorEnderecoGeocode.js'
import { geocodificarPrestadorNominatim } from '../../src/lib/credenciamento/geocodePrestadorServer.js'
import { delayMs } from '../../src/lib/credenciamento/geocodeNominatim.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..', '..')
dotenvConfig({ path: path.resolve(root, '.env.local') })

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
    console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local')
    process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

const CODIGO_LABEL = {
    nominatim_nao_encontrado: 'Nominatim sem resultado',
    uf_nao_confere: 'UF divergente',
    coordenada_fora_brasil: 'Fora do Brasil',
    nominatim_http: 'Erro HTTP Nominatim',
    erro_rede: 'Erro de rede',
}

function parseArgs() {
    const args = process.argv.slice(2)
    const out = {
        dryRun: false,
        forcar: false,
        limite: 0,
        delay: 1200,
        saidaDiagnostico: path.resolve(root, 'tmp', `geocode-diagnostico-${new Date().toISOString().slice(0, 10)}.json`),
    }
    for (let i = 0; i < args.length; i += 1) {
        const a = args[i]
        if (a === '--dry-run') out.dryRun = true
        else if (a === '--forcar') out.forcar = true
        else if (a === '--limite' && args[i + 1]) {
            out.limite = Math.max(0, Number(args[i + 1]) || 0)
            i += 1
        } else if (a === '--delay' && args[i + 1]) {
            out.delay = Math.max(1000, Number(args[i + 1]) || 1200)
            i += 1
        } else if (a === '--saida-diagnostico' && args[i + 1]) {
            out.saidaDiagnostico = path.resolve(process.cwd(), args[i + 1])
            i += 1
        }
    }
    return out
}

function imprimirDiagnosticoConsole(geo) {
    const d = geo.diagnostico
    if (!d) return
    if (d.resumo) console.log(`    resumo: ${d.resumo}`)
    if (d.dicasCadastro?.length) {
        d.dicasCadastro.forEach((tip) => console.log(`    dica: ${tip}`))
    }
    if (d.tentativas?.length) {
        d.tentativas.forEach((t, idx) => {
            const rotulo = CODIGO_LABEL[t.codigo] || t.codigo
            console.log(`    tentativa ${idx + 1} [${t.tentativa}] ${rotulo}`)
            console.log(`      query: ${t.query}`)
            if (t.detalhe && t.codigo !== 'ok') console.log(`      detalhe: ${t.detalhe}`)
        })
    }
}

async function carregarBase() {
    const cols =
        'id, nome, tipo, ativo, especialidade_id, situacao_id, cep, endereco, endereco_logradouro, endereco_numero, endereco_bairro, endereco_cidade, endereco_uf, endereco_pais, latitude, longitude, endereco_geocode_hash'
    const [{ data: prestadores, error: eP }, { data: especialidades, error: eE }, { data: situacoes, error: eS }] =
        await Promise.all([
            supabase.from('prestadores').select(cols).eq('ativo', true).order('nome'),
            supabase.from('especialidades').select('id, nome, tipo'),
            supabase.from('situacoes').select('id, descricao, ativo').eq('ativo', true),
        ])
    if (eP) throw new Error(eP.message)
    if (eE) throw new Error(eE.message)
    if (eS) throw new Error(eS.message)
    return { prestadores: prestadores || [], especialidades: especialidades || [], situacoes: situacoes || [] }
}

async function main() {
    const args = parseArgs()
    const { prestadores, especialidades, situacoes } = await carregarBase()

    let lista = filtrarPrestadoresParaMapaEndereco(prestadores, especialidades, {
        apenasLocal: true,
        apenasCredenciados: true,
        situacoes,
    })

    if (!args.forcar) {
        lista = lista.filter((p) => !coordenadasValidasBrasil(p.latitude, p.longitude))
    }
    if (args.limite > 0) {
        lista = lista.slice(0, args.limite)
    }
    if (!lista.length) {
        console.log('Nada para geocodificar com os filtros atuais.')
        return
    }

    console.log(
        `Iniciando geocodificação de ${lista.length} prestador(es) | dry-run=${args.dryRun ? 'sim' : 'nao'} | forcar=${args.forcar ? 'sim' : 'nao'}`,
    )

    let atualizados = 0
    let viaLegado = 0
    let viaEstruturado = 0
    let falhas = 0
    let pulados = 0
    let semEndereco = 0
    const idsSemEndereco = []
    const relatorioFalhas = []
    const agora = new Date().toISOString()

    for (let i = 0; i < lista.length; i += 1) {
        const p = lista[i]
        const consultas = listarConsultasGeocodePrestador(p)
        if (!consultas.length) {
            semEndereco += 1
            idsSemEndereco.push(Number(p.id))
            relatorioFalhas.push({
                prestadorId: p.id,
                nome: p.nome,
                codigo: 'sem_endereco',
                erro: 'Sem endereço legado nem estruturado.',
            })
            continue
        }

        const enderecoCanonico = montarEnderecoGeocodeFromPrestador(p)
        const hash = hashEnderecoGeocode(enderecoCanonico || consultas[0].query)
        if (!args.forcar && coordenadasValidasBrasil(p.latitude, p.longitude) && p.endereco_geocode_hash === hash) {
            pulados += 1
            continue
        }

        process.stdout.write(`[${i + 1}/${lista.length}] ${p.nome || p.id} ... `)
        try {
            const geo = await geocodificarPrestadorNominatim(p, { delayEntreConsultasMs: 1100 })
            if (!geo.ok) {
                falhas += 1
                console.log(`falha (${geo.erro})`)
                imprimirDiagnosticoConsole(geo)
                relatorioFalhas.push({
                    prestadorId: p.id,
                    nome: p.nome,
                    codigo: geo.codigo || 'falha',
                    erro: geo.erro,
                    diagnostico: geo.diagnostico,
                })
            } else if (args.dryRun) {
                atualizados += 1
                if (geo.tentativa === 'estruturado') viaEstruturado += 1
                else viaLegado += 1
                console.log(`ok dry-run [${geo.tentativa}] (${geo.latitude}, ${geo.longitude})`)
            } else {
                const fonte =
                    geo.tentativa === 'estruturado' ? 'nominatim_primeira_carga_estruturado' : 'nominatim_primeira_carga'
                const { error: upErr } = await supabase
                    .from('prestadores')
                    .update({
                        latitude: geo.latitude,
                        longitude: geo.longitude,
                        geocoded_at: agora,
                        geocode_fonte: fonte,
                        endereco_geocode_hash: hash,
                        data_atualizacao: agora,
                    })
                    .eq('id', Number(p.id))
                if (upErr) {
                    falhas += 1
                    console.log(`falha update (${upErr.message})`)
                    relatorioFalhas.push({
                        prestadorId: p.id,
                        nome: p.nome,
                        codigo: 'erro_banco',
                        erro: upErr.message,
                    })
                } else {
                    atualizados += 1
                    if (geo.tentativa === 'estruturado') viaEstruturado += 1
                    else viaLegado += 1
                    console.log(`ok [${geo.tentativa}] (${geo.latitude}, ${geo.longitude})`)
                }
            }
        } catch (e) {
            falhas += 1
            const msg = e?.message || String(e)
            console.log(`falha (${msg})`)
            relatorioFalhas.push({ prestadorId: p.id, nome: p.nome, codigo: 'erro_rede', erro: msg })
        }
        if (i < lista.length - 1) {
            await delayMs(args.delay)
        }
    }

    console.log('\nResumo:')
    console.log(`- Atualizados: ${atualizados} (legado: ${viaLegado}, estruturado: ${viaEstruturado})`)
    console.log(`- Falhas: ${falhas}`)
    console.log(`- Pulados (já atualizados): ${pulados}`)
    console.log(`- Sem endereço legado nem estruturado: ${semEndereco}`)
    if (idsSemEndereco.length) {
        console.log(`IDs sem endereço: ${idsSemEndereco.join(', ')}`)
    }

    if (relatorioFalhas.length) {
        await fs.mkdir(path.dirname(args.saidaDiagnostico), { recursive: true })
        await fs.writeFile(args.saidaDiagnostico, JSON.stringify(relatorioFalhas, null, 2), 'utf-8')
        console.log(`\nDiagnóstico de falhas salvo em: ${args.saidaDiagnostico}`)
    }
}

main().catch((e) => {
    console.error(e?.message || e)
    process.exit(1)
})
