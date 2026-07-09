/**
 * Coleta prospectos OSM por cidade no Supabase.
 *
 * Uso:
 *   npm run prospectos:coletar-osm -- --cidade "Passo Fundo" --uf RS
 *   npm run prospectos:coletar-osm -- --cidade "Santa Maria" --uf RS --dry-run
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { config as dotenvConfig } from 'dotenv'
import { coletarProspectosCidade, resolverFonteColeta } from '../../src/lib/credenciamento/prospectosColeta.js'

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

function parseArgs() {
    const args = process.argv.slice(2)
    const out = { cidade: '', uf: '', dryRun: false, fonte: '' }
    for (let i = 0; i < args.length; i += 1) {
        const a = args[i]
        if (a === '--cidade' && args[i + 1]) {
            out.cidade = args[++i]
        } else if (a === '--uf' && args[i + 1]) {
            out.uf = args[++i]
        } else if (a === '--fonte' && args[i + 1]) {
            out.fonte = args[++i]
        } else if (a === '--dry-run') {
            out.dryRun = true
        }
    }
    return out
}

const opts = parseArgs()
if (!opts.cidade) {
    console.error('Uso: npm run prospectos:coletar-osm -- --cidade "Passo Fundo" --uf RS')
    process.exit(1)
}

if (opts.dryRun) {
    const fonte = resolverFonteColeta(opts.fonte)
    console.log(`[dry-run] Coletaria (${fonte}) para ${opts.cidade}/${opts.uf || '?'}`)
    process.exit(0)
}

const fonte = resolverFonteColeta(opts.fonte)
console.log(`Coletando prospectos (${fonte}): ${opts.cidade}${opts.uf ? ` / ${opts.uf}` : ''}...`)
const r = await coletarProspectosCidade(supabase, { cidade: opts.cidade, uf: opts.uf, fonte })
if (!r.ok) {
    console.error('Falha:', r.erro)
    process.exit(1)
}
console.log(`OK — ${r.inseridos} registro(s) upsert.`)
if (r.aviso) console.warn('Aviso:', r.aviso)
