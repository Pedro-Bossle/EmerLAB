// Contagens do sino de notificações, compartilhadas com a sidebar (bolinhas nos itens do menu).
// O sino calcula; a sidebar só exibe. Sem o sino montado (sem permissão), as contagens ficam em zero.
import { useEffect, useState } from 'react'

const EVENTO = 'emerdog-notif-contagens'
let atuais = { form: 0, contratos: 0, pagamentos: 0 }

export function publicarContagens(parcial) {
    const prox = { ...atuais, ...parcial }
    if (prox.form === atuais.form && prox.contratos === atuais.contratos && prox.pagamentos === atuais.pagamentos) return
    atuais = prox
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENTO, { detail: atuais }))
}

export function lerContagens() {
    return atuais
}

export function useContagensNotif() {
    const [c, setC] = useState(atuais)
    useEffect(() => {
        const aoMudar = (e) => setC(e.detail)
        window.addEventListener(EVENTO, aoMudar)
        setC(atuais) // pode ter mudado entre o primeiro render e o efeito
        return () => window.removeEventListener(EVENTO, aoMudar)
    }, [])
    return c
}
