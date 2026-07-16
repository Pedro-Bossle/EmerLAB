import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { registrarEventoAuthAuditoria } from '../../lib/auditoriaLogs.js'
import './Login.css'

const Login = () => {
  const [showPassword, setShowPassword] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const navigate = useNavigate()

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
        <h1 className='login_title'>Emerdog Super Tool</h1>
        <h4 className='login_subtitle'>Para credenciamento</h4>
        <p className='login_subtitle'>Faça login para continuar</p>

        <form className='login_form' onSubmit={handleLogin}>
          <input
            className='login_input'
            type='email'
            placeholder='Email'
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <div className='password_container'>
            <input
              className='login_input'
              type={showPassword ? 'text' : 'password'}
              placeholder='Senha'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            <button
              type='button'
              className='toggle_password'
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? '🙈' : '👁️'}
            </button>
          </div>

          {errorMsg && <p>{errorMsg}</p>}

          <button className='login_button' type='submit' disabled={loading}>
            {loading ? 'Entrando...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default Login
