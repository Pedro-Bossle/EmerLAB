/** Preferência: sidebar fixada (aberta) no desktop. Default: aberta. */
export const SIDEBAR_PINNED_KEY = 'emerlab-sidebar-pinned'

export function lerSidebarFixada() {
  if (typeof window === 'undefined') return true
  const v = window.localStorage.getItem(SIDEBAR_PINNED_KEY)
  if (v === null || v === undefined || v === '') return true
  return v === '1'
}

export function salvarSidebarFixada(fixada) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SIDEBAR_PINNED_KEY, fixada ? '1' : '0')
}
