import React, { useEffect, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Input } from '../../components/ui'
import { normalizarProfileAcesso, setStoredAccessProfile } from '../../lib/accessControl'
import { carregarSessaoEPerfilAcesso, invalidarCachePerfilAcesso } from '../../lib/authSession'
import { supabase } from '../../lib/supabase'
import {
  PASSWORD_MIN_LENGTH,
  textoAjudaPoliticaSenha,
  validarPoliticaSenha,
} from '../../lib/passwordPolicy'

const DARK_MODE_KEY = 'emerlab-dark-mode'

function aplicarTemaSalvoNoBody() {
  if (typeof window === 'undefined') return
  const ativo = window.localStorage.getItem(DARK_MODE_KEY) === '1'
  document.body.classList.toggle('dark-mode', ativo)
}

function destinoPosTroca(nextRaw) {
  const next = String(nextRaw || '').trim()
  if (!next.startsWith('/') || next.startsWith('//')) return '/home'
  if (next === '/alterar-senha' || next.startsWith('/alterar-senha?')) return '/home'
  return next
}

async function limparExigenciaSenha(password) {
  const refreshed = await supabase.auth.refreshSession()
  const session =
    refreshed.data?.session || (await supabase.auth.getSession()).data?.session
  const token = session?.access_token
  if (!token) throw new Error('Sessão expirada. Faça login novamente.')

  const resp = await fetch('/api/admin-users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action: 'clearOwnForcePassword', password }),
  })
  const raw = await resp.text()
  let json = {}
  try {
    json = raw ? JSON.parse(raw) : {}
  } catch {
    json = {}
  }
  if (!resp.ok || json?.ok === false) {
    throw new Error(json?.error || `Falha ao alterar a senha (HTTP ${resp.status}).`)
  }
  if (json.profile) setStoredAccessProfile(json.profile)
  return json.profile
}

const AlterarSenha = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const destino = destinoPosTroca(searchParams.get('next'))

  const [ready, setReady] = useState(false)
  const [obrigatorio, setObrigatorio] = useState(false)
  const [motivo, setMotivo] = useState(null)
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    aplicarTemaSalvoNoBody()
    const prev = document.title
    document.title = 'Alterar senha · EmerLAB'
    return () => {
      document.title = prev
    }
  }, [])

  useEffect(() => {
    let ativo = true
    void (async () => {
      try {
        const { session, profile } = await carregarSessaoEPerfilAcesso()
        if (!ativo) return
        if (!session?.user?.id) {
          navigate('/', { replace: true })
          return
        }
        setObrigatorio(Boolean(profile?.forcePasswordChange))
        setMotivo(profile?.forcePasswordChangeReason || null)
        setReady(true)
      } catch {
        if (!ativo) return
        navigate('/', { replace: true })
      }
    })()
    return () => {
      ativo = false
    }
  }, [navigate])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorMsg('')

    const check = validarPoliticaSenha(password)
    if (!check.ok) {
      setErrorMsg(check.error)
      return
    }
    if (password !== passwordConfirm) {
      setErrorMsg('A confirmação de senha não confere.')
      return
    }

    setLoading(true)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const uid = userData?.user?.id || null

      const agora = new Date().toISOString()
      let profileLiberado = null
      try {
        profileLiberado = await limparExigenciaSenha(password)
      } catch (errClear) {
        console.warn('[AlterarSenha] Falha ao alterar senha / limpar exigência:', errClear?.message || errClear)
        setErrorMsg(errClear?.message || 'Não foi possível alterar a senha.')
        return
      }

      invalidarCachePerfilAcesso(uid)
      const base = profileLiberado || (await carregarSessaoEPerfilAcesso()).profile || {}
      setStoredAccessProfile(
        normalizarProfileAcesso({
          ...base,
          force_password_change: false,
          forcePasswordChange: false,
          password_changed_at: agora,
          passwordChangedAt: agora,
        }),
      )

      navigate(destino, { replace: true })
    } catch (err) {
      setErrorMsg(err?.message || 'Falha ao alterar a senha.')
    } finally {
      setLoading(false)
    }
  }

  if (!ready) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[linear-gradient(165deg,#eef6fb_0%,#f7fbfd_42%,#e8f2f8_100%)] p-6 dark:bg-[linear-gradient(165deg,#0d1520_0%,#121c2a_45%,#0f1a26_100%)]">
        <p className="text-sm font-semibold text-ink-soft dark:text-[#9eb4c8]">Carregando…</p>
      </main>
    )
  }

  if (!obrigatorio) {
    return <Navigate to={destino} replace />
  }

  const textoApoio =
    motivo === 'expired'
      ? 'Por segurança, a senha precisa ser renovada a cada 90 dias. Escolha uma nova senha para continuar.'
      : 'Um administrador solicitou a alteração da sua senha neste acesso. Escolha uma nova senha para continuar.'

  return (
    <main className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden bg-[radial-gradient(1200px_700px_at_12%_-10%,#cfe8f8_0%,transparent_55%),radial-gradient(900px_600px_at_100%_0%,#d9eef7_0%,transparent_50%),linear-gradient(165deg,#eef6fb_0%,#f7fbfd_42%,#e8f2f8_100%)] p-6 dark:bg-[radial-gradient(1000px_640px_at_10%_-8%,#1a3a52_0%,transparent_55%),linear-gradient(165deg,#0d1520_0%,#121c2a_45%,#0f1a26_100%)]">
      <div className="el-stage relative z-10 w-full max-w-md">
        <p className="mb-4 font-display text-[clamp(1.85rem,4.5vw,2.5rem)] font-extrabold leading-none tracking-tight text-ink dark:text-[#e8f1f8]">
          EmerLAB
        </p>
        <h1 className="mb-2 font-sans text-xl font-extrabold tracking-tight text-[#123e59] dark:text-[#e8f1f8]">
          {motivo === 'expired' ? 'Senha expirada' : 'Defina uma nova senha'}
        </h1>
        <p className="mb-6 max-w-[38ch] text-[0.95rem] font-medium leading-relaxed text-ink-soft dark:text-[#9eb4c8]">
          {textoApoio}
        </p>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
          <Input
            label="Nova senha"
            type="password"
            placeholder={textoAjudaPoliticaSenha()}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={PASSWORD_MIN_LENGTH}
            autoComplete="new-password"
            autoFocus
          />
          <Input
            label="Confirmar nova senha"
            type="password"
            placeholder="Repita a senha"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            required
            minLength={PASSWORD_MIN_LENGTH}
            autoComplete="new-password"
          />

          {errorMsg ? (
            <p
              className="rounded-xl border border-status-erro/20 bg-status-erro-bg px-3 py-2 text-sm font-semibold text-status-erro"
              role="alert"
            >
              {errorMsg}
            </p>
          ) : null}

          <Button type="submit" className="mt-1 w-full" disabled={loading}>
            {loading ? 'Salvando…' : 'Salvar nova senha'}
          </Button>
        </form>
      </div>
    </main>
  )
}

export default AlterarSenha
