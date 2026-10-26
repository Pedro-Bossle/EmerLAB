// Preferências de aparência (por navegador)
import { useEffect, useState } from 'react'
import { ler, gravar } from './util.js'

export const PADRAO = {
    modo: 'sistema', // sistema | claro | escuro
    destaque: 'verde', // verde | azul | roxo | laranja | rosa | grafite
    fundo: 'padrao', // padrao | liso | nenhum
    fonte: 'normal', // pequena | normal | grande
    enterEnvia: true,
    som: true,
    identificarAtendente: true, // "*Atendente <nome>*" + quebra de linha no início de cada mensagem
    notificacoes: false,
}

export const DESTAQUES = {
    verde: '#00a884',
    azul: '#1e88e5',
    roxo: '#7c4dff',
    laranja: '#f57c00',
    rosa: '#d81b60',
    grafite: '#54656f',
}

function modoEfetivo(modo) {
    if (modo !== 'sistema') return modo
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro'
}

export function aplicarTema(p) {
    const html = document.documentElement
    html.dataset.tema = modoEfetivo(p.modo)
    html.dataset.destaque = p.destaque
    html.dataset.fundo = p.fundo
    html.dataset.fonte = p.fonte
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', html.dataset.tema === 'escuro' ? '#202c33' : '#f0f2f5')
}

export function usePreferencias() {
    const [prefs, setPrefs] = useState(() => ({ ...PADRAO, ...ler('zap.prefs', {}) }))

    useEffect(() => {
        aplicarTema(prefs)
        gravar('zap.prefs', prefs)
        if (prefs.modo !== 'sistema') return
        const mq = window.matchMedia('(prefers-color-scheme: dark)')
        const fn = () => aplicarTema(prefs)
        mq.addEventListener('change', fn)
        return () => mq.removeEventListener('change', fn)
    }, [prefs])

    const atualizar = (campos) => setPrefs((p) => ({ ...p, ...campos }))
    return [prefs, atualizar]
}
