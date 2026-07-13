/**
 * Aplica scripts/sql/beneficios_descontos.sql no projeto Supabase.
 * Usa a Management API se SUPABASE_ACCESS_TOKEN estiver definido,
 * senão tenta `npx supabase db query` com project-ref.
 *
 * Uso: node ./scripts/inject-beneficios-descontos.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sqlPath = path.join(__dirname, 'sql', 'beneficios_descontos.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')
const projectRef = 'ftgjsyoplkbawdrypphu'

async function viaManagementApi(token) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: sql }),
    })
    const text = await res.text()
    if (!res.ok) {
        throw new Error(`Management API ${res.status}: ${text}`)
    }
    console.log('SQL aplicado via Management API.')
    console.log(text.slice(0, 500))
}

function viaCli() {
    const r = spawnSync(
        'npx',
        ['supabase', 'db', 'query', '--linked', '-f', sqlPath],
        { encoding: 'utf8', shell: true, stdio: 'inherit' },
    )
    if (r.status !== 0) {
        throw new Error('Falha no supabase db query. Rode o SQL manualmente no SQL Editor.')
    }
}

const token = process.env.SUPABASE_ACCESS_TOKEN || ''
try {
    if (token) {
        await viaManagementApi(token)
    } else {
        console.log('SUPABASE_ACCESS_TOKEN ausente — tentando CLI…')
        viaCli()
    }
} catch (e) {
    console.error(e.message || e)
    console.error('\nAplique manualmente no Supabase SQL Editor:')
    console.error(sqlPath)
    process.exit(1)
}
