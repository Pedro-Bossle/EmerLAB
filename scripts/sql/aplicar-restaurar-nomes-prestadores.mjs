/**
 * Aplica restauração de nomes em prestadores (service role).
 * Uso: node scripts/sql/aplicar-restaurar-nomes-prestadores.mjs
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { config as dotenvConfig } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..', '..')
dotenvConfig({ path: path.resolve(root, '.env.local') })

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
    console.error('Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local')
    process.exit(1)
}

const supabase = createClient(url, key)

/** [id, nome] — lote 2 + 677 */
const RESTAURACOES = [
    [38, 'Clínica Veterinária Vet Tânia'],
    [39, 'Clínica Veterinária Meu Bichinho'],
    [66, 'Clínica Veterinária Busin'],
    [262, 'Clínica Veterinária Save Pet'],
    [268, 'Clínica Veterinária VetPlace'],
    [274, 'Clínica Veterinária Vets'],
    [276, 'Clínica Veterinária Do Pet a Vet'],
    [286, 'Clínica Veterinária Agropal'],
    [552, 'Clinica Veterinaria Apaixonados por 4 Patas'],
    [571, 'Clínica Veterinária Casa du Bicho'],
    [572, 'Clínica Veterinária Clinipop'],
    [594, 'Clinica Veterinaria Colina'],
    [605, 'Clinica Veterinaria Dog Doc'],
    [614, 'Clínica Veterinária Tudo em Ração'],
    [675, 'Clínica Veterinária Animali'],
    [677, 'Vet Vitality'],
]

const agora = new Date().toISOString()
let ok = 0
let falhas = 0

for (const [id, nome] of RESTAURACOES) {
    const { data, error } = await supabase
        .from('prestadores')
        .update({ nome, data_atualizacao: agora })
        .eq('id', id)
        .select('id')
    if (error) {
        console.error(`id ${id}:`, error.message)
        falhas++
    } else if (!data?.length) {
        console.warn(`id ${id}: nenhuma linha atualizada`)
        falhas++
    } else {
        ok++
    }
}

console.log(`Concluído: ${ok} atualizados, ${falhas} falhas de ${RESTAURACOES.length}.`)
process.exit(falhas ? 1 : 0)
