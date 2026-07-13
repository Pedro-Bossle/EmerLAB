import React, { useEffect, useRef, useState } from 'react'
import './SupertabelaMenuFlutuante.css'

/**
 * Menu de ações fixo (canto inferior direito), acima do Dev Tool quando presente.
 */
export default function SupertabelaMenuFlutuante({ itens = [], ariaLabel = 'Ações da tabela' }) {
    const [aberto, setAberto] = useState(false)
    const painelRef = useRef(null)
    const btnRef = useRef(null)

    const lista = (itens || []).filter(Boolean)

    useEffect(() => {
        if (!aberto) return undefined
        const onDoc = (e) => {
            const alvo = e.target
            if (painelRef.current?.contains(alvo) || btnRef.current?.contains(alvo)) return
            setAberto(false)
        }
        const onKey = (e) => {
            if (e.key === 'Escape') setAberto(false)
        }
        document.addEventListener('mousedown', onDoc)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onDoc)
            document.removeEventListener('keydown', onKey)
        }
    }, [aberto])

    if (!lista.length) return null

    return (
        <div className='supertabela_menu_flutuante' aria-live='polite'>
            {aberto && (
                <div ref={painelRef} className='supertabela_menu_flutuante_panel' role='menu' aria-label={ariaLabel}>
                    <p className='supertabela_menu_flutuante_titulo'>Ações</p>
                    <ul className='supertabela_menu_flutuante_lista'>
                        {lista.map((item) => (
                            <li key={item.id}>
                                <button
                                    type='button'
                                    role='menuitem'
                                    className='supertabela_menu_flutuante_item'
                                    disabled={item.disabled || item.carregando}
                                    onClick={() => {
                                        setAberto(false)
                                        item.onClick?.()
                                    }}
                                >
                                    {item.icone ? (
                                        <span className='supertabela_menu_flutuante_ico' aria-hidden>
                                            {item.icone}
                                        </span>
                                    ) : null}
                                    <span>{item.carregando ? item.rotuloCarregando || 'Exportando…' : item.rotulo}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            <button
                ref={btnRef}
                type='button'
                className={`supertabela_menu_flutuante_btn${aberto ? ' is-open' : ''}`}
                aria-label={ariaLabel}
                aria-expanded={aberto}
                aria-haspopup='menu'
                title='Ações'
                onClick={() => setAberto((v) => !v)}
            >
                <span className='supertabela_menu_flutuante_btn_ico' aria-hidden>
                    ☰
                </span>
            </button>
        </div>
    )
}
