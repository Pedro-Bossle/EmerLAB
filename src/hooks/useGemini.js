import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { buildServerApiUrl, serverApiAuthHeaders, useSupabaseEdgeApi } from '../lib/api/serverBackend.js'

async function authHeaders() {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (!token) throw new Error('Sessão expirada. Faça login novamente.')
    const headers = {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
    }
    // Edge Functions exigem também apikey (anon)
    if (useSupabaseEdgeApi('gemini-rate')) {
        Object.assign(headers, serverApiAuthHeaders())
        // Preferir JWT do utilizador no Authorization (verify_jwt)
        headers.Authorization = `Bearer ${token}`
    }
    return headers
}

/**
 * Lê RPM/RPD — Edge (`prospectos-coletar?route=gemini-rate`) ou Vite `/api/gemini-rate`.
 */
export function useGeminiRate() {
    const [rate, setRate] = useState(null)
    const [erro, setErro] = useState('')
    const [loading, setLoading] = useState(true)

    const recarregar = useCallback(async () => {
        setLoading(true)
        setErro('')
        try {
            const url = buildServerApiUrl('gemini-rate')
            const resp = await fetch(url, {
                method: 'GET',
                headers: await authHeaders(),
            })
            const json = await resp.json().catch(() => ({}))
            if (!resp.ok) {
                throw new Error(json?.error || `Falha ao ler rate Gemini (${resp.status}).`)
            }
            setRate(json)
        } catch (e) {
            setRate(null)
            setErro(e?.message || 'Não foi possível ler o rate do Gemini.')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void recarregar()
    }, [recarregar])

    return { rate, erro, loading, recarregar }
}
