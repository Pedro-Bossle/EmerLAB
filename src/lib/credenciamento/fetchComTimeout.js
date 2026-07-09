/**
 * fetch com limite de tempo (evita coleta travada indefinidamente).
 * @param {string | URL} url
 * @param {RequestInit} [options]
 * @param {number} [timeoutMs]
 */
export async function fetchComTimeout(url, options = {}, timeoutMs = 60_000) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
        return await fetch(url, { ...options, signal: ctrl.signal })
    } catch (e) {
        if (e?.name === 'AbortError') {
            const seg = Math.round(timeoutMs / 1000)
            throw new Error(`Tempo esgotado (${seg}s) aguardando resposta do servidor.`)
        }
        throw e
    } finally {
        clearTimeout(t)
    }
}
