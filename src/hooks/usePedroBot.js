import { useCallback, useState } from 'react'
import { supabase } from '../lib/supabase'

async function authHeader() {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (!token) throw new Error('Sessão expirada. Faça login novamente.')
    return { Authorization: `Bearer ${token}` }
}

async function chamarPedroBot(body, { timeoutMs = 100_000 } = {}) {
    const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(await authHeader()),
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    let resp
    try {
        resp = await fetch('/api/pedro-bot', {
            method: 'POST',
            headers,
            body: JSON.stringify(body || {}),
            signal: ctrl.signal,
        })
    } catch (e) {
        if (e?.name === 'AbortError') {
            throw new Error('O Pedro Bot não devolveu a resposta a tempo.')
        }
        throw e
    } finally {
        clearTimeout(timer)
    }
    const json = await resp.json().catch(() => ({}))
    if (!resp.ok) {
        throw new Error(json?.error || `Falha no Pedro Bot (${resp.status}).`)
    }
    return json
}

async function getPedroBotMeta() {
    const resp = await fetch('/api/pedro-bot', {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            ...(await authHeader()),
        },
    })
    const json = await resp.json().catch(() => ({}))
    if (!resp.ok) {
        throw new Error(json?.error || `Falha ao ler o Pedro Bot (${resp.status}).`)
    }
    return json
}

/**
 * Chat de sessão + CRUD da base. Não usa useGemini (prospectos).
 */
export function usePedroBot() {
    const [mensagens, setMensagens] = useState([])
    const [enviando, setEnviando] = useState(false)
    const [erro, setErro] = useState('')
    const [meta, setMeta] = useState(null)

    const carregarMeta = useCallback(async () => {
        try {
            const json = await getPedroBotMeta()
            setMeta(json)
            return json
        } catch (e) {
            setErro(e?.message || 'Não foi possível contactar o Pedro Bot.')
            return null
        }
    }, [])

    const enviar = useCallback(async (texto) => {
        const content = String(texto || '').trim()
        if (!content) return
        const userMsg = { role: 'user', content }
        const historico = [...mensagens, userMsg]
        setMensagens(historico)
        setEnviando(true)
        setErro('')
        try {
            const json = await chamarPedroBot({ action: 'chat', mensagens: historico })
            if (!json.ok) {
                throw new Error(json.error || 'O Pedro Bot não conseguiu responder.')
            }
            setMensagens((prev) => [...prev, { role: 'assistant', content: json.texto || '' }])
            if (json.podeEditar != null) {
                setMeta((m) => ({ ...(m || {}), ...json }))
            }
        } catch (e) {
            setErro(e?.message || 'Falha ao falar com o Pedro Bot.')
        } finally {
            setEnviando(false)
        }
    }, [mensagens])

    const novaConversa = useCallback(() => {
        setMensagens([])
        setErro('')
    }, [])

    const listarConhecimento = useCallback(async () => {
        const json = await chamarPedroBot({ action: 'listar' }, { timeoutMs: 20_000 })
        if (json.podeEditar != null) setMeta((m) => ({ ...(m || {}), ...json }))
        return json
    }, [])

    const salvarConhecimento = useCallback(async (bloco) => {
        const json = await chamarPedroBot({ action: 'salvar', ...bloco }, { timeoutMs: 20_000 })
        if (!json.ok) throw new Error(json.error || 'Não foi possível gravar.')
        return json
    }, [])

    const apagarConhecimento = useCallback(async (id) => {
        const json = await chamarPedroBot({ action: 'apagar', id }, { timeoutMs: 20_000 })
        if (!json.ok) throw new Error(json.error || 'Não foi possível apagar.')
        return json
    }, [])

    return {
        mensagens,
        enviando,
        erro,
        setErro,
        meta,
        carregarMeta,
        enviar,
        novaConversa,
        listarConhecimento,
        salvarConhecimento,
        apagarConhecimento,
    }
}
