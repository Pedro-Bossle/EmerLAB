import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import './AiTest.css'

const PROMPT_MAX = 8000

async function authHeader() {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (!token) throw new Error('Sessão expirada. Faça login novamente.')
    return { Authorization: `Bearer ${token}` }
}

async function chamarApiAitest(method, body) {
    const headers = {
        Accept: 'application/json',
        ...(await authHeader()),
    }
    if (method === 'POST') headers['Content-Type'] = 'application/json'
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), method === 'GET' ? 12_000 : 100_000)
    let resp
    try {
        resp = await fetch('/api/aitest', {
            method,
            headers,
            body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
            signal: ctrl.signal,
        })
    } catch (e) {
        if (e?.name === 'AbortError') {
            throw new Error(
                method === 'GET'
                    ? 'Timeout ao ler a configuração do servidor.'
                    : 'O Gemini não devolveu a resposta a tempo. Vê o terminal do Vite ([gemini] / [aitest]).',
            )
        }
        throw e
    } finally {
        clearTimeout(timer)
    }
    const json = await resp.json().catch(() => ({}))
    if (!resp.ok) {
        throw new Error(json?.error || `Falha na API Gemini (${resp.status}).`)
    }
    return json
}

function rotuloStatus(s, loading) {
    if (loading && !s) return 'A verificar…'
    if (!s) return '—'
    if (!s.configurado) return 'Chave não configurada'
    if (s.ping === false) return 'Pronta para teste'
    if (s.disponivel) return 'Disponível'
    if (s.quotaExceeded) return 'Cota ou rate limit'
    if (s.sobrecarregado) return 'Sobrecarregado'
    if (s.modeloInvalido) return 'Modelo inválido'
    return 'Indisponível'
}

const AiTest = () => {
    const [status, setStatus] = useState(null)
    const [statusErro, setStatusErro] = useState('')
    const [statusLoading, setStatusLoading] = useState(true)
    const [prompt, setPrompt] = useState('')
    const [enviando, setEnviando] = useState(false)
    const [resposta, setResposta] = useState(null)
    const [erro, setErro] = useState('')

    const carregarStatus = useCallback(async () => {
        setStatusLoading(true)
        setStatusErro('')
        try {
            const json = await chamarApiAitest('GET')
            setStatus(json)
        } catch (e) {
            setStatus(null)
            setStatusErro(e?.message || 'Não foi possível verificar o Gemini.')
        } finally {
            setStatusLoading(false)
        }
    }, [])

    useEffect(() => {
        void carregarStatus()
    }, [carregarStatus])

    const enviar = useCallback(async () => {
        const texto = prompt.trim()
        if (!texto || enviando) return
        setEnviando(true)
        setErro('')
        setResposta(null)
        try {
            const json = await chamarApiAitest('POST', { prompt: texto })
            if (!json.ok) {
                setErro(json.error || 'Falha na consulta Gemini.')
                setResposta(json)
                return
            }
            setResposta(json)
        } catch (e) {
            setErro(e?.message || 'Falha na consulta Gemini.')
        } finally {
            setEnviando(false)
        }
    }, [prompt, enviando])

    const onKeyDown = (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void enviar()
        }
    }

    const estadoClasse = statusLoading && !status
        ? ''
        : !status
          ? ''
          : !status.configurado
            ? 'is-off'
            : status.disponivel === false
              ? 'is-warn'
              : 'is-ok'

    return (
        <div className="aitest">
            <header className="aitest_header">
                <div>
                    <p className="aitest_kicker">Dev Tool</p>
                    <h1>Playground Gemini</h1>
                    <p>Teste generateContent com a chave do servidor. Um turno por vez.</p>
                </div>
                <div className="aitest_header_acoes">
                    <button type="button" onClick={() => void carregarStatus()} disabled={statusLoading}>
                        {statusLoading ? 'A verificar…' : 'Atualizar status'}
                    </button>
                </div>
            </header>

            {statusErro ? <div className="aitest_erro">{statusErro}</div> : null}

            <section className={`aitest_status ${estadoClasse}`} aria-label="Status da API">
                <div>
                    <span className="aitest_status_label">API</span>
                    <strong>{rotuloStatus(status, statusLoading)}</strong>
                </div>
                <div>
                    <span className="aitest_status_label">Modelo</span>
                    <strong>
                        {statusLoading && !status
                            ? 'A verificar…'
                            : status?.modeloEfetivo || status?.modelo || '—'}
                    </strong>
                </div>
                <div>
                    <span className="aitest_status_label">Chave</span>
                    <strong>
                        {statusLoading && !status
                            ? 'A verificar…'
                            : status?.configurado
                              ? 'Configurada no servidor'
                              : 'Ausente'}
                    </strong>
                </div>
            </section>
            {status?.erro ? <p className="aitest_status_detalhe">{status.erro}</p> : null}

            <section className="aitest_prompt" aria-label="Prompt">
                <label htmlFor="aitest-prompt">Prompt</label>
                <textarea
                    id="aitest-prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value.slice(0, PROMPT_MAX))}
                    onKeyDown={onKeyDown}
                    placeholder="Escreva um prompt e envie (Ctrl/Cmd + Enter)."
                    rows={8}
                    disabled={enviando}
                />
                <div className="aitest_prompt_bar">
                    <span className="aitest_chars">
                        {prompt.length} / {PROMPT_MAX}
                    </span>
                    <button
                        type="button"
                        className="is-primary"
                        onClick={() => void enviar()}
                        disabled={enviando || !prompt.trim()}
                    >
                        {enviando ? 'A gerar…' : 'Enviar'}
                    </button>
                </div>
            </section>

            {erro ? <div className="aitest_erro">{erro}</div> : null}

            {resposta?.ok && resposta.texto ? (
                <section className="aitest_resposta" aria-label="Resposta">
                    <div className="aitest_resposta_meta">
                        <span>Modelo: {resposta.modeloEfetivo || resposta.modelo || '—'}</span>
                        {resposta.finishReason ? <span>finishReason: {resposta.finishReason}</span> : null}
                        {Number.isFinite(resposta.latenciaMs) ? (
                            <span>{(resposta.latenciaMs / 1000).toFixed(1)} s</span>
                        ) : null}
                    </div>
                    <pre>{resposta.texto}</pre>
                </section>
            ) : null}
        </div>
    )
}

export default AiTest
