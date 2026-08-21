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

const IconEye = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" />
  </svg>
)

const IconEyeOff = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M3 3l18 18M10.5 10.6a3 3 0 0 0 4.1 4.3M9.4 5.4A10.4 10.4 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 3.6M6.2 6.4C3.9 8 2.5 12 2.5 12S6 18.5 12 18.5c1.3 0 2.5-.3 3.6-.7"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

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
    <main className="login">
      <div className="login_atmosphere" aria-hidden="true" />
      <div className="login_glow login_glow--a" aria-hidden="true" />
      <div className="login_glow login_glow--b" aria-hidden="true" />

      <p className="login_watermark" aria-hidden="true">
        LAB
      </p>

      <div className="login_stage">
        <p className="login_brand">EmerLAB</p>
        <h1 className="login_title">Bem-vindo de volta</h1>
        <p className="login_lead">Entre com sua conta para continuar no Livro de Apoio Base.</p>

        <form className="login_form" onSubmit={handleLogin} noValidate>
          <label className="login_field">
            <span className="login_label">Email</span>
            <input
              className="login_input"
              type="email"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              autoFocus
            />
          </label>

          <label className="login_field">
            <span className="login_label">Senha</span>
            <div className="login_password">
              <input
                className="login_input"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                className="login_toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showPassword ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
          </label>

          {errorMsg ? (
            <p className="login_erro" role="alert">
              {errorMsg}
            </p>
          ) : null}

          <button className="login_submit" type="submit" disabled={loading}>
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </main>
  )
}

export default Login
