// Atualização periódica da lista e do chat sem estourar o limite da WATI (6 pessoas × várias abas):
// com a aba oculta, espaça para `oculta` (as notificações dependem dela, então não para);
// depois de um 429, a aba inteira espera a pausa de api.js antes da próxima rodada.
import { useEffect, useRef, useState } from 'react'
import { emLimiteWati, pedirDadoFresco } from './api.js'
import { assinar, criarAgendadorDeAviso } from './tempoReal.js'

// `tempoReal` (opcional): { nome, visivelRt }. Com o canal conectado, o aviso dispara a recarga na hora e o
// polling da aba visível espaça para `visivelRt`. Se o canal cair, volta sozinho ao `visivel` de sempre.
// Aba oculta mantém `oculta` (as notificações dependem dela). Sem `tempoReal`, tudo funciona como antes.
export function usarAtualizacao(atualizar, { visivel, oculta = 60000, tempoReal = null }) {
    const fn = useRef(atualizar)
    fn.current = atualizar
    const [rtAtivo, setRtAtivo] = useState(false)
    const nomeCanal = tempoReal?.nome || null
    const visivelRt = tempoReal?.visivelRt || visivel
    const intervaloVisivel = rtAtivo ? visivelRt : visivel

    // canal em tempo real
    useEffect(() => {
        if (!nomeCanal) return undefined
        let vivo = true
        const recarregar = async () => {
            if (!vivo || emLimiteWati()) return
            pedirDadoFresco()
            try {
                await fn.current()
            } catch {
                // cada tela mostra o próprio erro
            }
        }
        const agendador = criarAgendadorDeAviso(recarregar, { esperaMs: 400, intervaloMinMs: 2000 })
        let jaConectou = false
        const sair = assinar(nomeCanal, {
            aoAviso: () => agendador.aviso(),
            aoEstado: (conectado) => {
                if (!vivo) return
                setRtAtivo(conectado)
                // reconectou depois de uma queda: recupera o que pode ter passado enquanto estava fora
                if (conectado && jaConectou) agendador.aviso()
                if (conectado) jaConectou = true
            },
        })
        return () => {
            vivo = false
            agendador.cancelar()
            sair()
            setRtAtivo(false)
        }
    }, [nomeCanal])

    useEffect(() => {
        let timer = null
        let vivo = true
        const agendar = () => {
            if (!vivo) return
            timer = setTimeout(rodar, document.hidden ? oculta : intervaloVisivel)
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
    }, [intervaloVisivel, oculta])
}
