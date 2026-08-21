/** Preferência: sidebar fixada (aberta) no desktop. Default: aberta. */
export const SIDEBAR_PINNED_KEY = 'emerlab-sidebar-pinned'
export const DARK_MODE_KEY = 'emerlab-dark-mode'

function lerStorage(chave, fallback = null) {
  if (typeof window === 'undefined') return fallback
  try {
    return window.localStorage.getItem(chave)
  } catch {
    return fallback
  }
}

function escreverStorage(chave, valor) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(chave, valor)
  } catch {
    /* ignore quota / private mode */
  }
}

export function lerSidebarFixada() {
  const v = lerStorage(SIDEBAR_PINNED_KEY, null)
  if (v === null || v === undefined || v === '') return true
  return v === '1'
}

export function salvarSidebarFixada(fixada) {
  escreverStorage(SIDEBAR_PINNED_KEY, fixada ? '1' : '0')
}

export function lerDarkModeAtivo() {
  return lerStorage(DARK_MODE_KEY, null) === '1'
}

export function salvarDarkModeAtivo(ativo) {
  escreverStorage(DARK_MODE_KEY, ativo ? '1' : '0')
}
