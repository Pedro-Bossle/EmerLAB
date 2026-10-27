// Atualização periódica da lista e do chat sem estourar o limite da WATI (6 pessoas × várias abas):
// com a aba oculta, espaça para `oculta` (as notificações dependem dela, então não para);
// depois de um 429, a aba inteira espera a pausa de api.js antes da próxima rodada.
import { useEffect, useRef } from 'react'
import { emLimiteWati } from './api.js'

export function usarAtualizacao(atualizar, { visivel, oculta = 60000 }) {
    const fn = useRef(atualizar)
    fn.current = atualizar

    useEffect(() => {
        let timer = null
        let vivo = true
        const agendar = () => {
            if (!vivo) return
            timer = setTimeout(rodar, document.hidden ? oculta : visivel)
        }
        const rodar = async () => {
            if (!emLimiteWati()) {
                try {
                    await fn.current()
                } catch {
                    // cada tela mostra o próprio erro; aqui só segue agendando
                }
            }
            agendar()
        }
        // voltou para a aba: atualiza na hora em vez de esperar o intervalo longo
        const aoVisivel = () => {
            if (document.hidden || !vivo) return
            clearTimeout(timer)
            rodar()
        }
        agendar()
        document.addEventListener('visibilitychange', aoVisivel)
        return () => {
            vivo = false
            clearTimeout(timer)
            document.removeEventListener('visibilitychange', aoVisivel)
        }
    }, [visivel, oculta])
}
