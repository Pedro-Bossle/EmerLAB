// Publica o pacote do servidor de prospecção no Storage (bucket privado «emer-radar-worker»).
// Uso: node scripts/_publicar-worker.mjs <caminho do .zip>
import { readFileSync, statSync } from 'node:fs'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local', quiet: true })
const arquivo = process.argv[2]
if (!arquivo) throw new Error('Informe o caminho do .zip')
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const BUCKET = 'emer-radar-worker'
const tamanho = statSync(arquivo).size
console.log('arquivo:', (tamanho / 1024 / 1024).toFixed(1), 'MB')

const { data: buckets } = await sb.storage.listBuckets()
if (!buckets?.some((b) => b.name === BUCKET)) {
  const { error } = await sb.storage.createBucket(BUCKET, { public: false }) // herda o limite global do projeto (Settings → Storage)
  console.log('criar bucket:', error ? `ERRO ${error.message}` : 'ok (privado)')
  if (error) process.exit(1)
} else {
  console.log('bucket já existe')
}

const t0 = Date.now()
const { error } = await sb.storage.from(BUCKET).upload('EmerRadarWorker.zip', readFileSync(arquivo), {
  upsert: true,
  contentType: 'application/zip',
})
console.log('upload:', error ? `ERRO ${error.message} (${error.statusCode || ''})` : `ok em ${((Date.now() - t0) / 1000).toFixed(0)}s`)
if (error) process.exit(1)
const { data } = await sb.storage.from(BUCKET).list('', { limit: 10 })
console.log('no bucket:', (data || []).map((f) => `${f.name} ${(f.metadata?.size / 1024 / 1024).toFixed(1)}MB`).join(', '))
