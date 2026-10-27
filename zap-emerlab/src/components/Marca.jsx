// Monograma do zap.emerlab: balão de conversa na cor de destaque com um "z" vazado
export default function Marca({ tamanho = 32 }) {
    return (
        <svg viewBox="0 0 32 32" width={tamanho} height={tamanho} aria-hidden="true" focusable="false" className="icone marca">
            <path d="M16 3C9.1 3 3.5 8.4 3.5 15c0 2.4.7 4.6 2 6.5L4 28l6.9-2.3c1.6.7 3.3 1 5.1 1 6.9 0 12.5-5.4 12.5-12S22.9 3 16 3Z" fill="var(--destaque)" />
            <path d="M11 10.5h10l-10 10h10" fill="none" stroke="var(--destaque-texto)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}
