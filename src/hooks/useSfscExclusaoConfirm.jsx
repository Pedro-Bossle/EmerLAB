import { useCallback, useState } from 'react'
import SfscExclusaoConfirmToast from '../components/Toast/SfscExclusaoConfirmToast'

/**
 * Confirmação de exclusão/descarte via toast (canto superior direito, sem cobrir o sininho).
 */
export function useSfscExclusaoConfirm() {
    const [pending, setPending] = useState(null)

    const askExclusao = useCallback(
        (mensagem, onConfirmar, titulo = 'Confirmar exclusão', opcoes = {}) => {
            setPending({
                mensagem,
                onConfirmar,
                titulo,
                variante: opcoes.variante || 'danger',
                rotuloConfirmar: opcoes.rotuloConfirmar || 'Confirmar',
            })
        },
        [],
    )

    const cancelar = useCallback(() => setPending(null), [])

    const exclusaoToast = pending ? (
        <SfscExclusaoConfirmToast
            titulo={pending.titulo}
            mensagem={pending.mensagem}
            variante={pending.variante}
            rotuloConfirmar={pending.rotuloConfirmar}
            onConfirmar={async () => {
                const fn = pending.onConfirmar
                setPending(null)
                await fn()
            }}
            onCancelar={cancelar}
        />
    ) : null

    return { askExclusao, exclusaoToast }
}
