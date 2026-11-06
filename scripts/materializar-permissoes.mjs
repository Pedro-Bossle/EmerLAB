/**
 * Materializa as permissões implícitas dos perfis.
 *
 * Contexto: até aqui, o sistema INFERIA acesso a ferramentas (ex.: quem tinha «editar Inbox do formulário» ganhava
 * Conferência de Laboratório e Observações) toda vez que o perfil era lido. Isso impedia revogar e ampliava acesso
 * sem ninguém conceder. A tela de acessos agora grava o conjunto COMPLETO (true/false por ferramenta e ação) e o
 * sistema para de inferir para perfis completos.
 *
 * Este script transforma o que cada pessoa tem HOJE (inclusive o implícito) em permissões explícitas, para que
 * ninguém perca acesso na virada e o administrador possa revisar e revogar o que não faz sentido.
 *
 * Uso (simulação, não grava nada):
 *   node scripts/materializar-permissoes.mjs
 * Gravar de verdade:
 *   node scripts/materializar-permissoes.mjs --apply
 *
 * Variáveis: SUPABASE_URL (ou VITE_SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY (.env.local na raiz).
 * A saída não mostra e-mails: só nome abreviado e o começo do id.
 */
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { normalizarPermissions } from '../src/lib/accessControl.js'
import {
    PERMISSION_CATALOG,
    aclCompleto,
    listarTodasChavesAcl,
    sanitizarPermissionsParaSalvar,
} from '../src/lib/permissionCatalog.js'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: path.join(raiz, '.env.local'), quiet: true })
dotenv.config({ path: path.join(raiz, '.env'), quiet: true })

const aplicar = process.argv.includes('--apply')
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const chave = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !chave) {
    console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (.env.local).')
    process.exit(1)
}

const supabase = createClient(url, chave, { auth: { persistSession: false } })

const rotuloChave = (k) => {
    for (const g of PERMISSION_CATALOG) {
        for (const t of g.tools) {
            for (const a of t.actions) {
                if (k === `${t.id}.${a}`) return `${g.label} › ${t.label} (${a})`
            }
        }
    }
    return k
}

const nomeAbreviado = (nome) => {
    const partes = String(nome || 'Sem nome').trim().split(/\s+/)
    return partes.length > 1 ? `${partes[0]} ${partes[partes.length - 1][0]}.` : partes[0]
}

const { data: perfis, error } = await supabase.from('profiles').select('id, name, permissions')
if (error) {
    console.error('Falha ao ler os perfis:', error.message)
    process.exit(1)
}

const chavesAcl = listarTodasChavesAcl()
let jaCompletos = 0
let mudaram = 0
let totalImplicitas = 0
const linhas = []
const gravacoes = []

for (const p of perfis || []) {
    const bruto = p.permissions && typeof p.permissions === 'object' ? p.permissions : {}
    if (aclCompleto(bruto)) {
        jaCompletos += 1
        continue
    }
    // o que a pessoa efetivamente tem hoje (inclui a herança implícita)
    const efetivo = normalizarPermissions({ permissions: bruto })
    const materializado = sanitizarPermissionsParaSalvar(efetivo)
    const implicitas = chavesAcl.filter((k) => materializado[k] && bruto[k] !== true)
    mudaram += 1
    totalImplicitas += implicitas.length
    linhas.push({
        usuario: nomeAbreviado(p.name),
        id: String(p.id).slice(0, 8),
        'acessos só implícitos': implicitas.length,
        exemplos: implicitas.slice(0, 3).map(rotuloChave).join(' | '),
    })
    gravacoes.push({ id: p.id, permissions: materializado })
}

console.log(`Perfis: ${perfis?.length || 0} | já completos: ${jaCompletos} | a materializar: ${mudaram}`)
console.log(`Acessos que hoje existem só por herança implícita: ${totalImplicitas}`)
if (linhas.length) console.table(linhas)

if (!aplicar) {
    console.log('\nSIMULAÇÃO: nada foi gravado. Revise e rode com --apply para gravar.')
    process.exit(0)
}

let ok = 0
for (const g of gravacoes) {
    const { error: e } = await supabase.from('profiles').update({ permissions: g.permissions }).eq('id', g.id)
    if (e) console.error(`Falhou (${String(g.id).slice(0, 8)}): ${e.message}`)
    else ok += 1
}
console.log(`\nGravado: ${ok} de ${gravacoes.length} perfis. O acesso efetivo de cada pessoa não mudou.`)
