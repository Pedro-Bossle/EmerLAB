import React, { useEffect, useState } from 'react'
import './Footer.css'
import logoNav from '../../assets/Emerdog-logo-nav.svg'
import logoBranco from '../../assets/logo_branco.png'
import youtubeIcon from '../../assets/youtube-ico.svg'
import whatsappIcon from '../../assets/whatsapp-ico.svg'
import instagramIcon from '../../assets/instagram-ico.svg'
import tiktokIcon from '../../assets/tiktok-ico.svg'
import cloudIcon from '../../assets/cloud-ico.svg'

const Footer = () => {
  const [darkModeAtivo, setDarkModeAtivo] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('emerlab-dark-mode') === '1'
  })

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
            Sistema Facilitador do Setor de Credenciamentos
          </p>
          <div className="el_footer_social" aria-label="Redes e atalhos">
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
            <a href="#" className="el_footer_link">
              <img src={youtubeIcon} alt="" />
              Como usar o EmerLAB 1
            </a>
            <a href="#" className="el_footer_link">
              <img src={youtubeIcon} alt="" />
              Como usar o EmerLAB 2
            </a>
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
            <a href="https://youtu.be/VR6N7T-A2R4" className="el_footer_link" target="_blank" rel="noreferrer">
              <img src={youtubeIcon} alt="" />
              Compra de procedimentos e carência
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
        <a href="https://www.linkedin.com/in/pedro-bossle-sandi-685625277" target="_blank" rel="noreferrer">
          Pedro Bossle
        </a>
      </p>
    </footer>
  )
}

export default Footer
