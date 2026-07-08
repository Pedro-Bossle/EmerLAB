/**
 * Exporta CSV de endereços: credenciados ativos, tipo LOCAL, com endereço.
 * Uso: node scripts/credenciamento/export-prestadores-enderecos-csv.mjs
 *      node scripts/credenciamento/export-prestadores-enderecos-csv.mjs --saida tmp/meu.csv
 *      node scripts/credenciamento/export-prestadores-enderecos-csv.mjs --todos
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { config as dotenvConfig } from 'dotenv'
import {
    especialidadePorIdMap,
    filtrarPrestadoresParaMapaEndereco,
    gerarCsvPrestadoresEnderecos,
    linhaExportEnderecoPrestador,
} from '../../src/lib/credenciamento/prestadorEnderecoGeocode.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..', '..')
dotenvConfig({ path: path.resolve(root, '.env.local') })

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) {
    console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ou ANON) em .env.local')
    process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

const parseArgs = () => {
    const args = process.argv.slice(2)
    let saida = path.resolve(root, 'tmp', 'prestadores_enderecos_export.csv')
    let apenasLocal = true
    for (let i = 0; i < args.length; i += 1) {
        if (args[i] === '--saida' && args[i + 1]) {
            saida = path.resolve(process.cwd(), args[i + 1])
            i += 1
        } else if (args[i] === '--todos') {
            apenasLocal = false
        }
    }
    return { saida, apenasLocal }
}

const COLS =
    'id, nome, tipo, ativo, especialidade_id, situacao_id, cep, endereco, endereco_logradouro, endereco_numero, endereco_bairro, endereco_cidade, endereco_uf, endereco_pais, latitude, longitude'

async function main() {
    const { saida, apenasLocal } = parseArgs()

    const [{ data: prestadores, error: eP }, { data: especialidades, error: eE }, { data: situacoes, error: eS }] =
        await Promise.all([
        supabase.from('prestadores').select(COLS).eq('ativo', true).order('nome'),
        supabase.from('especialidades').select('id, nome, tipo'),
        supabase.from('situacoes').select('id, descricao, ativo').eq('ativo', true),
    ])
    if (eP) throw new Error(eP.message)
    if (eE) throw new Error(eE.message)
    if (eS) throw new Error(eS.message)

    const mapa = especialidadePorIdMap(especialidades || [])
    const filtrados = filtrarPrestadoresParaMapaEndereco(prestadores || [], especialidades || [], {
        apenasLocal,
        apenasCredenciados: true,
        situacoes: situacoes || [],
    })
    const linhas = filtrados.map((p) => linhaExportEnderecoPrestador(p, mapa))
    const csv = gerarCsvPrestadoresEnderecos(linhas)

    await fs.mkdir(path.dirname(saida), { recursive: true })
    await fs.writeFile(saida, csv, 'utf-8')
    console.log(`Exportados ${linhas.length} prestador(es) → ${saida}`)
    console.log('Preencha latitude e longitude no CSV e importe com: npm run prestadores:import-coordenadas')
}

main().catch((e) => {
    console.error(e.message || e)
    process.exit(1)
})
