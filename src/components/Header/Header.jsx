import React, { useEffect, useState } from 'react'
import "./Header.css"
import logoNav from '../../assets/Emerdog-logo-nav.svg'
import logoBranco from '../../assets/logo_branco.png'


import { logoutSessao } from '../../lib/authSession'
import { Link, useNavigate } from 'react-router-dom'



const Header = ({ onNavigate }) => {
    const navigate = useNavigate()
    const [darkModeAtivo, setDarkModeAtivo] = useState(() => {
        if (typeof window === 'undefined') return false
        return window.localStorage.getItem('sfsc-dark-mode') === '1'
    })

    useEffect(() => {
        if (darkModeAtivo) {
            document.body.classList.add('dark-mode')
            window.localStorage.setItem('sfsc-dark-mode', '1')
        } else {
            document.body.classList.remove('dark-mode')
            window.localStorage.setItem('sfsc-dark-mode', '0')
        }
    }, [darkModeAtivo])

    const handleLogout = async () => {
        await logoutSessao({
            navigate,
            onError: () => alert('Erro ao sair da sessão'),
        })
        onNavigate?.()
    }

    return (
        <header className='header'>
            <nav className='header_nav'>
                <img src={darkModeAtivo ? logoBranco : logoNav} alt="Emerdog" className='logo logo_header' />
                <Link className='header_nav_link' to="/supertabelamain" onClick={onNavigate}>Super-Tabela</Link>
                <Link className='header_nav_link' to="/credenciamento/cadastro" onClick={onNavigate}>Credenciamento</Link>
                <Link className='header_nav_link' to="/compras/orcamento" onClick={onNavigate}>Orçamentos</Link>
                <Link className='header_nav_link' to="/planos/impressao" onClick={onNavigate}>Impressão de Planos</Link>
                <Link className='header_nav_link' to="/contratos/clicksign" onClick={onNavigate}>Contratos</Link>
                <Link className='header_nav_link' to="/pagamentos/registro" onClick={onNavigate}>Pagamentos</Link>
                <button
                    type='button'
                    className='header_darkmode_button'
                    onClick={() => setDarkModeAtivo((anterior) => !anterior)}
                    title={darkModeAtivo ? 'Desativar modo escuro' : 'Ativar modo escuro'}
                >
                    {darkModeAtivo ? '☀️' : '🌙'}
                </button>
                <button className='logout_button' onClick={handleLogout}>Sair</button>
            </nav>
        </header>
    )
}

export default Header;