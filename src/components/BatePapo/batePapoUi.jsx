import React, { useEffect, useState } from 'react'
import { baixarImagemDescriptografada } from '../../lib/homeBatePapo'

export function formatarHoraMensagem(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function chaveDia(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function rotuloDia(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hoje = new Date()
  const ontem = new Date()
  ontem.setDate(hoje.getDate() - 1)
  if (chaveDia(iso) === chaveDia(hoje.toISOString())) return 'Hoje'
  if (chaveDia(iso) === chaveDia(ontem.toISOString())) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function MensagemImagem({ msg, className = 'bate_papo_float_msg_img' }) {
  const [url, setUrl] = useState(null)
  const [erro, setErro] = useState('')
  useEffect(() => {
    let alive = true
    let objectUrl = null
    void (async () => {
      try {
        objectUrl = await baixarImagemDescriptografada(msg)
        if (alive) setUrl(objectUrl)
      } catch (e) {
        if (alive) setErro(e?.message || 'Falha ao abrir imagem')
      }
    })()
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [msg])
  if (erro) return <p className="bate_papo_float_msg_erro">{erro}</p>
  if (!url) return <p className="bate_papo_float_status">A carregar imagem…</p>
  return <img src={url} alt="" className={className} />
}

export function urlEmerzapNovaAba() {
  const base = String(import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')
  return `${window.location.origin}${base}emerzap`
}
