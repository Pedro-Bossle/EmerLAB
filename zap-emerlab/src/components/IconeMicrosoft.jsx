import { APPS_MS } from '../util.js'

// Ícones simplificados de Teams e Outlook (o Simple Icons não traz as marcas da Microsoft) e o símbolo de
// quatro quadrados usado no botão "Entrar com a Microsoft", como pedem as diretrizes de login da Microsoft.

export default function IconeMicrosoft({ app, tamanho = 24 }) {
    const cor = APPS_MS[app]?.cor || '#5B5FC7'
    return (
        <svg viewBox="0 0 24 24" width={tamanho} height={tamanho} className="icone" aria-hidden="true" focusable="false">
            <rect x="2" y="2" width="20" height="20" rx="5" fill={cor} />
            {app === 'outlook' ? (
                // "O" com um envelope pequeno no canto
                <>
                    <circle cx="10" cy="12" r="4.6" fill="none" stroke="#fff" strokeWidth="2.2" />
                    <path d="M15.5 9.5h4v5h-4z" fill="#fff" opacity="0.9" />
                    <path d="M15.5 9.5l2 1.8 2-1.8" fill="none" stroke={cor} strokeWidth="0.9" />
                </>
            ) : (
                // "T" com o ponto de pessoa do Teams
                <>
                    <path d="M6.5 8h8v2.4h-2.8V17H9.3v-6.6H6.5z" fill="#fff" />
                    <circle cx="17.4" cy="8.6" r="1.9" fill="#fff" opacity="0.9" />
                </>
            )}
        </svg>
    )
}

export function LogoMicrosoft({ tamanho = 18 }) {
    const q = tamanho / 2 - 0.5
    return (
        <svg viewBox={`0 0 ${tamanho} ${tamanho}`} width={tamanho} height={tamanho} aria-hidden="true" focusable="false">
            <rect x="0" y="0" width={q} height={q} fill="#F25022" />
            <rect x={q + 1} y="0" width={q} height={q} fill="#7FBA00" />
            <rect x="0" y={q + 1} width={q} height={q} fill="#00A4EF" />
            <rect x={q + 1} y={q + 1} width={q} height={q} fill="#FFB900" />
        </svg>
    )
}
