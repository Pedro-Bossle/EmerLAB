import React, { useEffect, useState } from 'react'
import './Footer.css'
import logoNav from '../../assets/Emerdog-logo-nav.svg'
import logoBranco from '../../assets/logo_branco.png'
import youtubeIcon from '../../assets/youtube-ico.svg'
import whatsappIcon from '../../assets/whatsapp-ico.svg'
import instagramIcon from '../../assets/instagram-ico.svg'
import tiktokIcon from '../../assets/tiktok-ico.svg'
import cloudIcon from '../../assets/cloud-ico.svg'
import { lerDarkModeAtivo } from '../../lib/sidebarPrefs'
import { useStoredAccessProfile } from '../../lib/accessControl'
import { urlEmerMarketing, usuarioPodeAbrirEmerMarketing } from '../../lib/emermarketingAccess.js'

// Emerzap: painel de atendimento WhatsApp (app separado, com login próprio). Override com VITE_EMERZAP_URL.
const EMERZAP_URL = String(import.meta.env?.VITE_EMERZAP_URL || 'https://zap.emerlab.com.br').replace(/\/+$/, '')

function IconeApp({ tipo }) {
  const comum = { className: 'el_footer_social_svg', viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true }
  const tra = { stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' }
  if (tipo === 'tv') {
    // TV com «E» (EmerMarketing)
    return (
      <svg {...comum}>
        <rect x="3" y="5" width="18" height="12.5" rx="2.2" {...tra} />
        <path d="M9 20.5h6" {...tra} />
        <path d="M10.2 8.5h3.8M10.2 8.5v5.5M10.2 11.2h3M10.2 14h3.8" {...tra} strokeWidth="1.5" />
      </svg>
    )
  }
  // balão de mensagem com «E» (Emerzap)
  return (
    <svg {...comum}>
      <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.5 3.5V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" {...tra} />
      <path d="M10.2 8.2h3.8M10.2 8.2v5.2M10.2 10.8h3M10.2 13.4h3.8" {...tra} strokeWidth="1.5" />
    </svg>
  )
}

const Footer = () => {
  const [darkModeAtivo, setDarkModeAtivo] = useState(() => lerDarkModeAtivo())
  const accessProfile = useStoredAccessProfile()
  const podeMarketing = usuarioPodeAbrirEmerMarketing(accessProfile?.permissions || {})

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDarkModeAtivo(document.body.classList.contains('dark-mode'))
    })
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return (
    <footer className="el_footer">
      <div className="el_footer_inner">
        <div className="el_footer_brand">
          <img
            src={darkModeAtivo ? logoBranco : logoNav}
            alt="EmerLAB"
            className="el_footer_logo"
          />
          <p className="el_footer_tagline">
            Livro de Apoio Base
          </p>
          <div className="el_footer_social" aria-label="Redes e atalhos">
            {podeMarketing ? (
              <a href={urlEmerMarketing()} target="_blank" rel="noreferrer" title="Abrir EmerMarketing" aria-label="EmerMarketing">
                <IconeApp tipo="tv" />
              </a>
            ) : null}
            <a href={EMERZAP_URL} target="_blank" rel="noreferrer" title="Abrir Emerzap (atendimento WhatsApp)" aria-label="Emerzap">
              <IconeApp tipo="msg" />
            </a>
            <a href="https://www.youtube.com/@Emerdog" target="_blank" rel="noreferrer" title="YouTube">
              <img src={youtubeIcon} alt="" className="el_footer_social_ico" />
            </a>
            <a href="https://wa.me/555499041695" target="_blank" rel="noreferrer" title="WhatsApp">
              <img src={whatsappIcon} alt="" className="el_footer_social_ico" />
            </a>
            <a href="https://www.instagram.com/emerdogplano/" target="_blank" rel="noreferrer" title="Instagram">
              <img src={instagramIcon} alt="" className="el_footer_social_ico" />
            </a>
            <a href="https://www.tiktok.com/@emerdog" target="_blank" rel="noreferrer" title="TikTok">
              <img src={tiktokIcon} alt="" className="el_footer_social_ico" />
            </a>
            <a
              href="https://emerdogplano-my.sharepoint.com/:f:/g/personal/pedro_emerdog_com_br/EhguapSFJdRLnCcY6ECXf5YBpODEspc_AXI_goxAoI3o1g?e=hFYBlm"
              target="_blank"
              rel="noreferrer"
              title="Arquivos"
            >
              <img src={cloudIcon} alt="" className="el_footer_social_ico" />
            </a>
          </div>
        </div>

        <div className="el_footer_cols">
          <div className="el_footer_col">
            <h3>Tutoriais Internos</h3>
            <a href="https://youtu.be/Stan3e_LyjM" className="el_footer_link" target="_blank" rel="noreferrer">
              <img src={youtubeIcon} alt="" />
              Adicionar Clientes e Cobranças
            </a>
            <a href="https://www.youtube.com/watch?v=rUNF0hKrO20" className="el_footer_link" target="_blank" rel="noreferrer">
              <img src={youtubeIcon} alt="" />
              O que é Emerdog?
            </a>
          </div>

          <div className="el_footer_col">
            <h3>Tutoriais Veterinários</h3>
            <a href="https://youtu.be/xOasi7Equ_w" className="el_footer_link" target="_blank" rel="noreferrer">
              <img src={youtubeIcon} alt="" />
              Como Chamar Volantes
            </a>
            <a href="https://youtu.be/Z3bn9i386Zs" className="el_footer_link" target="_blank" rel="noreferrer">
              <img src={youtubeIcon} alt="" />
              Requisições de Exames (Laboratórios)
            </a>
            <a href="https://youtu.be/EPjNRcNBf1U" className="el_footer_link" target="_blank" rel="noreferrer">
              <img src={youtubeIcon} alt="" />
              Requisições de Exames (Veterinários)
            </a>
            <a href="https://youtu.be/7g6EyzJ4Yx0" className="el_footer_link" target="_blank" rel="noreferrer">
              <img src={youtubeIcon} alt="" />
              Tutorial de Atendimento
            </a>
          </div>

          <div className="el_footer_col">
            <h3>Tutoriais Clientes</h3>
            <a href="https://youtu.be/0q92qBVLaJI" className="el_footer_link" target="_blank" rel="noreferrer">
              <img src={youtubeIcon} alt="" />
              Como alterar a Forma de pagamento
            </a>
            <a href="https://youtu.be/ftwUfQjl_eQ" className="el_footer_link" target="_blank" rel="noreferrer">
              <img src={youtubeIcon} alt="" />
              Tutorial de Primeiro Acesso
            </a>
            <a href="https://youtu.be/tV7-PWHH-CE" className="el_footer_link" target="_blank" rel="noreferrer">
              <img src={youtubeIcon} alt="" />
              Tour pelo Site
            </a>
            <a href="https://youtu.be/w74R5f0nA_Y" className="el_footer_link" target="_blank" rel="noreferrer">
              <img src={youtubeIcon} alt="" />
              Compra de Procedimentos
            </a>
            <a href="https://youtu.be/u-G4bFZxs1M" className="el_footer_link" target="_blank" rel="noreferrer">
              <img src={youtubeIcon} alt="" />
              Adiantamento de Carências
            </a>
            <a href="https://youtu.be/37dha4CtZzU" className="el_footer_link" target="_blank" rel="noreferrer">
              <img src={youtubeIcon} alt="" />
              Tutorial de Empresas e Colaboradores
            </a>
          </div>
        </div>
      </div>

      <p className="el_footer_copy">
        Feito por{' '}
        <a href="https://www.devbossle.com.br/" target="_blank" rel="noreferrer">
          Pedro Bossle
        </a>
      </p>
    </footer>
  )
}

export default Footer
