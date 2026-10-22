import { useEffect, useState } from 'react'

/** Mesmo corte do Tailwind `sm` (640 px): abaixo disso as tabelas viram cartões. */
export const MQ_TELA_PEQUENA = '(max-width: 640px)'

export function useTelaPequena() {
    const [pequena, setPequena] = useState(() =>
        typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(MQ_TELA_PEQUENA).matches : false,
    )
    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return undefined
        const mq = window.matchMedia(MQ_TELA_PEQUENA)
        const sync = () => setPequena(mq.matches)
        mq.addEventListener('change', sync)
        return () => mq.removeEventListener('change', sync)
    }, [])
    return pequena
}
