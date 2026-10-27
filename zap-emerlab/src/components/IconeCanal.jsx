// Logos dos canais (Simple Icons, CC0) — preenchidos, centralizados na grade 24×24
import { siInstagram, siMessenger, siWhatsapp } from 'simple-icons'

const LOGOS = { whatsapp: siWhatsapp, instagram: siInstagram, messenger: siMessenger }

export default function IconeCanal({ canal, tamanho = 22, cor = 'currentColor', className }) {
    const logo = LOGOS[canal] || siWhatsapp
    return (
        <svg viewBox="0 0 24 24" width={tamanho} height={tamanho} fill={cor} className={`icone ${className || ''}`} aria-hidden="true" focusable="false">
            <path d={logo.path} />
        </svg>
    )
}
