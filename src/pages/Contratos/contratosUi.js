/** Tempo até o toast fechar sozinho (toasts de confirmação não usam auto-dismiss). */
export const TOAST_AUTO_DISMISS_MS = 10_000

/** Datas ISO → DD/MM/AAAA HH:mm:ss (hora local). */
export function formatarDataPtBr(iso) {
    if (!iso) return '—'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return String(iso)
    const pad = (n) => String(n).padStart(2, '0')
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function abrirUrlDownload(url) {
    const u = String(url || '').trim()
    if (!u) return false
    const a = document.createElement('a')
    a.href = u
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    a.remove()
    return true
}
