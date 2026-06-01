import { createClient } from '@supabase/supabase-js'
import { clearStoredAccessProfile } from './accessControl'

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

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

const guardedFetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || ''
  const method = String(init?.method || 'GET').toUpperCase()
  const isDbRestCall = url.includes('/rest/v1/')
  const isWriteMethod = method === 'POST' || method === 'PATCH' || method === 'DELETE' || method === 'PUT'

  if (
    isDbRestCall &&
    isWriteMethod &&
    getReadOnlyFlag() &&
    !isRotaFormularioPublicoCredenciamento()
  ) {
    throw new Error('Acesso somente leitura: alterações estão bloqueadas para este perfil.')
  }

  return fetch(input, init)
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  global: {
    fetch: guardedFetch,
  },
})

// O Supabase aplica um teto de 1000 linhas por requisição (PostgREST default).
// Quando temos tabelas como planos_cidade/procedimentos/repasses que excedem isso,
// é necessário paginar via .range() para trazer todos os registros.
const TAMANHO_PAGINA_SUPABASE = 1000

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