import { createClient } from '@supabase/supabase-js'
import { clearStoredAccessProfile } from './accessControl'

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

function assertSupabaseConfig() {
  if (supabaseUrl && supabaseKey) return
  const faltando = []
  if (!supabaseUrl) faltando.push('VITE_SUPABASE_URL')
  if (!supabaseKey) faltando.push('VITE_SUPABASE_PUBLISHABLE_KEY ou VITE_SUPABASE_ANON_KEY')
  throw new Error(
    `Supabase não configurado (${faltando.join(', ')}). ` +
      'Copie env.chaves.modelo para .env.local na raiz, preencha as chaves e reinicie npm run dev.',
  )
}

const READ_ONLY_STORAGE_KEY = 'sfsc-read-only'

export const setReadOnlyFlag = (enabled) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(READ_ONLY_STORAGE_KEY, enabled ? '1' : '0')
}

export const getReadOnlyFlag = () => {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(READ_ONLY_STORAGE_KEY) === '1'
}

/** Formulário de credenciamento aberto sem login (link público). */
export function isRotaFormularioPublicoCredenciamento() {
  if (typeof window === 'undefined') return false
  const path = String(window.location.pathname || '')
  return path.includes('/credenciamento/cadastro-publico')
}

export const clearAccessState = () => {
  setReadOnlyFlag(false)
  clearStoredAccessProfile()
}

/**
 * Tabelas de uso pessoal (Home) que qualquer autenticado pode gravar,
 * mesmo com perfil global «somente leitura» nos módulos.
 * A segurança continua nas policies RLS do Supabase.
 */
const REST_WRITES_PERMITIDOS_EM_SOMENTE_LEITURA = [
  'home_tarefas',
  'home_tarefas_mensagens',
  'home_bate_papo_mensagens',
]

function isEscritaPessoalPermitidaEmSomenteLeitura(url) {
  const raw = String(url || '')
  return REST_WRITES_PERMITIDOS_EM_SOMENTE_LEITURA.some((tabela) => {
    // PostgREST: .../rest/v1/home_tarefas ou .../rest/v1/home_tarefas?...
    const re = new RegExp(`/rest/v1/${tabela}(?:\\?|$|/|$)`)
    return re.test(raw)
  })
}

const guardedFetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || ''
  const method = String(init?.method || 'GET').toUpperCase()
  const isDbRestCall = url.includes('/rest/v1/')
  const isWriteMethod = method === 'POST' || method === 'PATCH' || method === 'DELETE' || method === 'PUT'

  if (
    isDbRestCall &&
    isWriteMethod &&
    getReadOnlyFlag() &&
    !isRotaFormularioPublicoCredenciamento() &&
    !isEscritaPessoalPermitidaEmSomenteLeitura(url)
  ) {
    throw new Error('Acesso somente leitura: alterações estão bloqueadas para este perfil.')
  }

  return fetch(input, init)
}

assertSupabaseConfig()

function limparTokensAuthLegadoLocalStorage() {
  if (typeof window === 'undefined') return
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const key = window.localStorage.key(i)
      if (key && /^sb-.*-auth-token$/.test(key)) {
        window.localStorage.removeItem(key)
      }
    }
  } catch {
    /* ignore */
  }
}

limparTokensAuthLegadoLocalStorage()

/** Serializa operações de auth (evita Navigator Lock / Strict Mode em paralelo). */
let authLockChain = Promise.resolve()
function serialAuthLock(_name, _acquireTimeout, fn) {
    const run = authLockChain.then(() => fn())
    authLockChain = run.then(
        () => undefined,
        () => undefined,
    )
    return run
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  global: {
    fetch: guardedFetch,
  },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== 'undefined' ? window.sessionStorage : undefined,
    lock: typeof window !== 'undefined' ? serialAuthLock : undefined,
  },
})

// O Supabase aplica um teto de 1000 linhas por requisição (PostgREST default).
// Quando temos tabelas como planos_cidade/procedimentos/repasses que excedem isso,
// é necessário paginar via .range() para trazer todos os registros.
export const TAMANHO_PAGINA_SUPABASE = 1000

export const buscarTodosPaginado = async (montarQuery) => {
  const acumulado = []
  let pagina = 0

  while (true) {
    const inicio = pagina * TAMANHO_PAGINA_SUPABASE
    const fim = inicio + TAMANHO_PAGINA_SUPABASE - 1
    const resp = await montarQuery().range(inicio, fim)

    if (resp.error) {
      return { data: acumulado, error: resp.error }
    }

    const lote = resp.data || []
    acumulado.push(...lote)

    if (lote.length < TAMANHO_PAGINA_SUPABASE) break
    pagina += 1

    // safety: limite máximo de 200 páginas (= 200k registros) para evitar loop infinito
    if (pagina > 200) break
  }

  return { data: acumulado, error: null }
}

/**
 * Busca com filtro `.in(...)` em fatias + paginação por range em cada fatia.
 *
 * Necessário quando um único `.in(ids)` pode devolver >1000 linhas
 * (ex.: prestador_procedimentos de ~25–40 prestadores numa região grande).
 * Sem isso o PostgREST corta silenciosamente e contagens de realizadores ficam erradas.
 *
 * @param {unknown[]} ids — valores para o `.in` (números ou strings)
 * @param {(fatia: unknown[]) => any} montarQuery — deve incluir `.order(...)` estável
 * @param {{ tamanhoLote?: number }} [opcoes]
 * @returns {Promise<{ data: any[], error: Error|null }>}
 */
export const buscarEmLotesPaginado = async (ids, montarQuery, opcoes = {}) => {
  const tamanhoLote = Math.max(1, Number(opcoes.tamanhoLote) || 25)
  const vistos = new Set()
  const lista = []
  for (const raw of ids || []) {
    if (raw == null || raw === '') continue
    const chave = typeof raw === 'number' || typeof raw === 'string' ? raw : String(raw)
    if (vistos.has(chave)) continue
    vistos.add(chave)
    lista.push(raw)
  }

  const acumulado = []
  for (let i = 0; i < lista.length; i += tamanhoLote) {
    const fatia = lista.slice(i, i + tamanhoLote)
    const { data, error } = await buscarTodosPaginado(() => montarQuery(fatia))
    if (error) return { data: acumulado, error }
    acumulado.push(...(data || []))
  }
  return { data: acumulado, error: null }
}