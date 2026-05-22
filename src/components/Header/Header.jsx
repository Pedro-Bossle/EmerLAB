import React, { useEffect, useState } from 'react'
import "./Header.css"
import logoNav from '../../assets/Emerdog-logo-nav.svg'
import logoBranco from '../../assets/logo_branco.png'


import { clearAccessState, supabase } from '../../lib/supabase' // ajuste o caminho se necessário
import { Link, useNavigate } from 'react-router-dom'



const Header = () => {
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
        const { error } = await supabase.auth.signOut()
        if (error) {
            alert('Erro ao sair da sessão')
            return
        }
        clearAccessState()
        navigate('/', { replace: true })
    }

    return (
        <header className='header'>
            <nav className='header_nav'>
                <img src={darkModeAtivo ? logoBranco : logoNav} alt="Emerdog" className='logo logo_header' />
                <Link className='header_nav_link' to="/home">Início</Link>
                <Link className='header_nav_link' to="/supertabelamain">Super-Tabela</Link>
                <Link className='header_nav_link' to="/credenciamento/principal">Credenciamento</Link>
                <Link className='header_nav_link' to="/Compras/Orcamento">Orçamentos</Link>
                <Link className='header_nav_link' to="/contratos/clicksign">
                    Contratos
                </Link>
                {/*<a className='header_nav_link' href="#">Formulário</a>
                <a className='header_nav_link' href="#">Planos</a>
                <a className='header_nav_link' href="#">Pagamentos</a>
                <a className='header_nav_link' href="#">Emer-Cast</a>*/}
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