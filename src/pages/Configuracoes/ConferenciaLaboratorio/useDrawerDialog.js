import { useEffect, useRef } from 'react'

export function useDrawerDialog({ aberto, onClose }) {
    const closeRef = useRef(null)

    useEffect(() => {
        if (!aberto) return undefined
        closeRef.current?.focus()
        const onKey = (e) => {
            if (e.key !== 'Escape') return
            e.preventDefault()
            onClose?.()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [aberto, onClose])

    return closeRef
}
