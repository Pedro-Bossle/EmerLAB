import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

async function authHeader() {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (!token) throw new Error('Sessão expirada. Faça login novamente.')
    return { Authorization: `Bearer ${token}` }
}

/**
 * Lê RPM/RPD restantes deste processo via GET /api/gemini-rate.
 * A chave Gemini nunca sai do servidor.
 */
export function useGeminiRate() {
    const [rate, setRate] = useState(null)
    const [erro, setErro] = useState('')
    const [loading, setLoading] = useState(true)

    const recarregar = useCallback(async () => {
        setLoading(true)
        setErro('')
        try {
            const resp = await fetch('/api/gemini-rate', {
                method: 'GET',
                headers: {
                    Accept: 'application/json',
                    ...(await authHeader()),
                },
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
