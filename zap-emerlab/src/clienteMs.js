// Lado do navegador da integração Microsoft (Outlook e Teams): conta, Teams (canais) e e-mails reais.
// Quando o servidor não está com MS_ATIVO, `ativo` é false e as abas seguem na prévia simulada.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import { assinar, criarAgendadorDeAviso } from './tempoReal.js'

const PASTAS_EMAIL = ['entrada', 'enviados', 'arquivo', 'lixeira', 'rascunhos']
const PREFIXOS_LOCAIS = ['enviado-', 'rascunho-'] // ids criados na tela (ver novoIdPrevia): ainda não existem na Microsoft

const doisDigitos = (n) => String(n).padStart(2, '0')
const hora = (d) => `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`

function rotuloDia(d, agora = new Date()) {
    const dia = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
    const dif = Math.round((dia(agora) - dia(d)) / 86_400_000)
    if (dif === 0) return 'Hoje'
    if (dif === 1) return 'Ontem'
    return `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}/${d.getFullYear()}`
}

/** Mensagem de canal vinda do servidor → formato que a tela de Teams já usa. */
export function formatarMensagemCanal(m) {
    const d = new Date(m.criado)
    return {
        id: m.id,
        autor: m.minha ? 'você' : m.autor,
        texto: m.texto,
        hora: hora(d),
        dia: rotuloDia(d),
        minha: m.minha,
        mencao: m.mencao || undefined,
        reacoes: m.reacoes?.length ? m.reacoes : undefined,
        arquivo: m.arquivo ? { ...m.arquivo, tamanho: m.arquivo.tamanho || '' } : undefined,
        _em: d.getTime(),
    }
}

// ---------- visto por canal (a Microsoft não informa "não lido" de canal: guardamos no navegador) ----------

const chaveVisto = (id) => `zap.ms.visto.${id}`
function lerVisto(id) {
    try {
        return Number(localStorage.getItem(chaveVisto(id))) || 0
    } catch {
        return 0
    }
}
function gravarVisto(id, ms) {
    try {
        localStorage.setItem(chaveVisto(id), String(ms))
    } catch {
        /* sem armazenamento: só não lembra */
    }
}

// ---------- conta ----------

/** Estado da conta Microsoft desta pessoa. Trata o retorno do login (?ms=teams|outlook|erro). */
export function useContaMs() {
    const [st, setSt] = useState({ carregando: true, ativo: false, conectado: false, reconectar: false, email: null, canal: null })
    const [aviso, setAviso] = useState('')

    const carregar = useCallback(async () => {
        try {
            const r = await api('ms/status')
            setSt({ carregando: false, ativo: Boolean(r.ativo), conectado: Boolean(r.conectado), reconectar: Boolean(r.reconectar), email: r.email || null, canal: r.canal || null })
            if (r.ativo && r.conectado) api('ms/sincronizar', { method: 'POST' }).catch(() => {}) // cria/renova os webhooks
        } catch {
            setSt((s) => ({ ...s, carregando: false }))
        }
    }, [])

    useEffect(() => {
        carregar()
        const p = new URLSearchParams(window.location.search)
        if (p.has('ms')) {
            if (p.get('ms') === 'erro') setAviso('Não foi possível conectar a conta Microsoft. Tente de novo.')
            p.delete('ms')
            const resto = p.toString()
            window.history.replaceState(null, '', window.location.pathname + (resto ? `?${resto}` : ''))
        }
    }, [carregar])

    const conectar = async (app) => {
        setAviso('')
        try {
            const { url } = await api(`ms/login?app=${encodeURIComponent(app)}`)
            window.location.assign(url)
        } catch (e) {
            setAviso(e.message)
        }
    }
    const desconectar = async () => {
        try {
            await api('ms/desconectar', { method: 'POST' })
            await carregar()
        } catch (e) {
            setAviso(e.message)
        }
    }
    return { st, aviso, conectar, desconectar, recarregar: carregar }
}

/** Recarrega `fn` quando o webhook avisa (Realtime) e, como garantia, de tempos em tempos. */
function useAtualizacaoMs(ligado, canal, fn) {
    const ref = useRef(fn)
    useEffect(() => {
        ref.current = fn
    })
    useEffect(() => {
        if (!ligado) return undefined
        let rtOk = false
        const agendador = criarAgendadorDeAviso(() => ref.current(), { esperaMs: 600, intervaloMinMs: 5000 })
        const cancelar = assinar(canal, { aoAviso: () => agendador.aviso(), aoEstado: (v) => (rtOk = v) })
        // sem Realtime a conferência é mais frequente; com ele, só uma garantia contra aviso perdido
        let batidas = 0
        const t = setInterval(() => {
            batidas += 1
            if (document.visibilityState !== 'visible') return
            if (!rtOk || batidas % 4 === 0) ref.current()
        }, 45_000)
        const aoVoltar = () => document.visibilityState === 'visible' && ref.current()
        document.addEventListener('visibilitychange', aoVoltar)
        return () => {
            clearInterval(t)
            document.removeEventListener('visibilitychange', aoVoltar)
            agendador.cancelar()
            cancelar()
        }
    }, [ligado, canal])
}

// ---------- Teams ----------

export function useTeamsMs(ligado, canalAvisos) {
    const [canais, setCanais] = useState(null) // null = carregando
    const [erro, setErro] = useState('')
    const [versao, setVersao] = useState(0) // força recalcular "não lidas" quando marca como visto

    const carregar = useCallback(async () => {
        try {
            const r = await api('ms/teams/canais')
            // primeira vez neste navegador: o que já existe conta como visto (senão tudo apareceria como não lido)
            for (const c of r.canais) {
                if (!lerVisto(c.id)) gravarVisto(c.id, c.mensagens.length ? Date.parse(c.mensagens.at(-1).criado) : Date.now())
            }
            setCanais(r.canais)
            setErro('')
        } catch (e) {
            setErro(e.message)
            setCanais((c) => c ?? [])
        }
    }, [])
    useEffect(() => {
        if (ligado) carregar()
    }, [ligado, carregar])
    useAtualizacaoMs(ligado, canalAvisos, carregar)

    const conversas = (canais || []).map((c) => {
        const mensagens = c.mensagens.map(formatarMensagemCanal)
        const visto = lerVisto(c.id)
        const naoLidas = mensagens.filter((m) => !m.minha && m._em > visto).length
        return { id: c.id, nome: c.nome, tipo: 'canal', privado: c.privado, erro: c.erro, naoLidas, mensagens }
    })
    void versao

    const marcarVisto = (id) => {
        const c = (canais || []).find((x) => x.id === id)
        const ultimo = c?.mensagens.at(-1)
        gravarVisto(id, ultimo ? Date.parse(ultimo.criado) : Date.now())
        setVersao((v) => v + 1)
    }
    const enviar = async (id, texto) => {
        await api('ms/teams/enviar', { method: 'POST', body: { canal: id, texto } })
        await carregar()
        marcarVisto(id)
    }
    return { conversas, carregando: canais === null, erro, enviar, marcarVisto, recarregar: carregar }
}

// ---------- Outlook ----------

const ehLocal = (id) => PREFIXOS_LOCAIS.some((p) => String(id).startsWith(p))

export function useEmailsMs(ligado, canalAvisos) {
    const [emails, setEmailsEstado] = useState(null) // null = carregando
    const [erro, setErro] = useState('')
    const ref = useRef([])

    const gravarLista = (lista) => {
        ref.current = lista
        setEmailsEstado(lista)
    }

    const carregar = useCallback(async () => {
        try {
            const listas = await Promise.all(PASTAS_EMAIL.map((p) => api(`ms/outlook/emails?pasta=${p}`).then((r) => r.emails)))
            // mantém corpo/anexos já baixados dos e-mails que continuam na lista
            const antigos = new Map(ref.current.map((e) => [e.id, e]))
            const lista = listas.flat().map((e) => {
                const a = antigos.get(e.id)
                return a?.carregado ? { ...e, html: a.html, corpo: a.corpo, anexos: a.anexos, carregado: true } : e
            })
            gravarLista(lista)
            setErro('')
        } catch (e) {
            setErro(e.message)
            setEmailsEstado((l) => l ?? [])
        }
    }, [])
    useEffect(() => {
        if (ligado) carregar()
    }, [ligado, carregar])
    useAtualizacaoMs(ligado, canalAvisos, carregar)

    /** Envia ao servidor o que mudou entre duas listas (lido, sinalizado, pasta, excluído, enviado). */
    const sincronizar = async (antes, depois) => {
        const a = new Map(antes.map((e) => [e.id, e]))
        const d = new Map(depois.map((e) => [e.id, e]))
        const tarefas = []
        const post = (rota, body) => api(`ms/outlook/${rota}`, { method: 'POST', body })
        let respondido = null
        for (const e of depois) {
            const velho = a.get(e.id)
            if (!velho) continue
            if (e.respondidoEm && !velho.respondidoEm) respondido = e
            if (ehLocal(e.id)) continue
            if (velho.lido !== e.lido || velho.sinalizado !== e.sinalizado) {
                tarefas.push(post('alterar', { id: e.id, ...(velho.lido !== e.lido ? { lido: Boolean(e.lido) } : {}), ...(velho.sinalizado !== e.sinalizado ? { sinalizado: Boolean(e.sinalizado) } : {}) }))
            }
            if (velho.pasta !== e.pasta && e.pasta !== 'rascunhos') {
                tarefas.push(
                    post('mover', { id: e.id, pasta: e.pasta }).then((r) => {
                        // mover muda o id na Microsoft: troca na lista para as próximas ações funcionarem
                        if (r?.id && r.id !== e.id) gravarLista(ref.current.map((x) => (x.id === e.id ? { ...x, id: r.id } : x)))
                    }),
                )
            }
        }
        for (const e of antes) if (!d.has(e.id) && !ehLocal(e.id)) tarefas.push(post('excluir', { id: e.id }))
        for (const e of depois) {
            if (a.has(e.id) || !String(e.id).startsWith('enviado-')) continue // rascunhos locais não vão para a Microsoft
            const html = e.html || `<p>${String(e.texto || '').replace(/[<>&]/g, '')}</p>`
            if (respondido && /^(Re|Enc):/i.test(e.assunto)) {
                const modo = /^Enc:/i.test(e.assunto) ? 'encaminhar' : e.para.length > 1 ? 'todos' : 'responder'
                tarefas.push(post('responder', { id: respondido.id, modo, html, para: e.paraEmails || e.para }))
            } else {
                tarefas.push(post('enviar', { para: e.para, cc: e.cc || [], assunto: e.assunto, html }))
            }
        }
        if (!tarefas.length) return
        const resultados = await Promise.allSettled(tarefas)
        const falha = resultados.find((r) => r.status === 'rejected')
        if (falha) setErro(falha.reason?.message || 'Não foi possível concluir na Microsoft.')
        // reconfere com a Microsoft: mostra o estado real (e desfaz na tela o que não pegou)
        await carregar()
    }

    const setEmails = (fn) => {
        const antes = ref.current
        const depois = typeof fn === 'function' ? fn(antes) : fn
        gravarLista(depois)
        sincronizar(antes, depois)
    }

    /** Baixa o corpo e os anexos de um e-mail ao abrir (a lista só traz o resumo). */
    const abrir = async (id) => {
        const e = ref.current.find((x) => x.id === id)
        if (!e || e.carregado || ehLocal(id)) return
        try {
            const r = await api(`ms/outlook/email?id=${encodeURIComponent(id)}`)
            gravarLista(ref.current.map((x) => (x.id === id ? { ...x, html: r.html || undefined, corpo: r.corpo, anexos: r.anexos?.length ? r.anexos : undefined, carregado: true } : x)))
        } catch (err) {
            setErro(err.message)
        }
    }

    return { emails, setEmails, erro, limparErro: () => setErro(''), abrir, carregando: emails === null }
}
