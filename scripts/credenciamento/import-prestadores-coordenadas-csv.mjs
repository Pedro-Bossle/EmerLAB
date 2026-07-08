/**
 * Importa latitude/longitude do CSV exportado.
 * Uso: node scripts/credenciamento/import-prestadores-coordenadas-csv.mjs tmp/prestadores_enderecos_export.csv
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { config as dotenvConfig } from 'dotenv'
import {
    linhasCsvParaAtualizacaoCoordenadas,
    parsearCsvTexto,
} from '../../src/lib/credenciamento/prestadorEnderecoGeocode.js'

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

const arquivo = process.argv[2]
if (!arquivo) {
    console.error('Uso: node scripts/credenciamento/import-prestadores-coordenadas-csv.mjs <arquivo.csv>')
    process.exit(1)
}

const caminho = path.resolve(process.cwd(), arquivo)

async function main() {
    const texto = await fs.readFile(caminho, 'utf-8')
    const rows = parsearCsvTexto(texto)
    const updates = linhasCsvParaAtualizacaoCoordenadas(rows)
    if (!updates.length) {
        console.error('Nenhuma linha válida com prestador_id, latitude e longitude.')
        process.exit(1)
    }

    const agora = new Date().toISOString()
    let ok = 0
    let falhas = 0

    for (const u of updates) {
        const { error } = await supabase
            .from('prestadores')
            .update({
                latitude: u.latitude,
                longitude: u.longitude,
                geocoded_at: agora,
                geocode_fonte: u.geocode_fonte,
                endereco_geocode_hash: u.endereco_geocode_hash || null,
                data_atualizacao: agora,
            })
            .eq('id', u.id)
        if (error) {
            falhas += 1
            console.error(`ID ${u.id}: ${error.message}`)
        } else {
            ok += 1
        }
    }

    console.log(`Importação concluída: ${ok} atualizado(s), ${falhas} falha(s).`)
    if (falhas) process.exit(1)
}

main().catch((e) => {
    console.error(e.message || e)
    process.exit(1)
})
