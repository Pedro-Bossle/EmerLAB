import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { registrarEventoAuthAuditoria } from '../../lib/auditoriaLogs.js'
import './Login.css'

const DARK_MODE_KEY = 'emerlab-dark-mode'

/** Mantém o tema da sessão anterior na tela de login (body.dark-mode). */
function aplicarTemaSalvoNoBody() {
  if (typeof window === 'undefined') return
  const ativo = window.localStorage.getItem(DARK_MODE_KEY) === '1'
  document.body.classList.toggle('dark-mode', ativo)
}

const Login = () => {
  const [showPassword, setShowPassword] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    aplicarTemaSalvoNoBody()
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()
    setErrorMsg('')
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setLoading(false)

    if (error) {
      setErrorMsg('Email ou senha inválidos.')
      return
    }

    void registrarEventoAuthAuditoria('LOGIN')
    navigate('/home')
  }

  return (
    <div className='login'>
      <div className='login_container'>
        <h1 className='login_title'>EmerLAB</h1>
        <h4 className='login_subtitle'>Seja Bem Vindo(a)!</h4>
        <p className='login_subtitle'>Faça login para continuar</p>

        <form className='login_form' onSubmit={handleLogin}>
          <input
            className='login_input'
            type='email'
            placeholder='Email'
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete='username'
          />

          <div className='password_container'>
            <input
              className='login_input'
              type={showPassword ? 'text' : 'password'}
              placeholder='Senha'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete='current-password'
            />

            <button
              type='button'
              className='toggle_password'
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
            >
              {showPassword ? '🙈' : '👁️'}
            </button>
          </div>

          {errorMsg ? <p className='login_erro'>{errorMsg}</p> : null}

          <button className='login_button' type='submit' disabled={loading}>
            {loading ? 'Entrando...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default Login
