import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import './Home.css'

const Home = () => {
  const [name, setName] = useState('Usuário')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadProfile = async () => {
      const { data: userData, error: userError } = await supabase.auth.getUser()

      if (userError || !userData?.user) {
        setLoading(false)
        return
      }

      const userId = userData.user.id

      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('name')
        .eq('id', userId)
        .single()

      if (!profileError && profiles?.name) {
        setName(profiles.name)
      }

      setLoading(false)
    }

    loadProfile()
  }, [])

  return (
    <div className='home'>
      <div>
        <h1>Olá {loading ? '...' : name}</h1>
        <p>
          Bem-vindo ao Sistema Facilitador do Setor de Credenciamentos (<strong>S.F.S.C.</strong>)
        </p>
        <p>
          Esta ferramenta existe para facilitar o dia a dia do setor de credenciamentos; aqui você encontra as
          principais rotinas do seu trabalho.
        </p>
      </div>

      <div className='home_cards_container'>
        <div className='home_card'>
          <h2 className='card_nome'>Super Tabela</h2>
          <p className='card_texto'>
            Gerencie tabelas de valores por cidade, planos, procedimentos e negociações com os parceiros.
          </p>
          <Link className='card_link' to='/supertabelamain'>
            Conheça essa Ferramenta
          </Link>
        </div>

        <div className='home_card'>
          <h2 className='card_nome'>Credenciamento</h2>
          <p className='card_texto'>
            Cadastre e atualize prestadores, especialidades e vínculos — o ponto de partida do credenciamento no
            sistema.
          </p>
          <Link className='card_link' to='/credenciamento/cadastro'>
            Conheça essa Ferramenta
          </Link>
        </div>

        <div className='home_card'>
          <h2 className='card_nome'>Orçamentos</h2>
          <p className='card_texto'>
            Calcule orçamentos de compra de procedimentos para clientes de forma rápida e objetiva.
          </p>
          <Link className='card_link' to='/compras/orcamento'>
            Conheça essa Ferramenta
          </Link>
        </div>

        <div className='home_card'>
          <h2 className='card_nome'>Impressão de Planos</h2>
          <p className='card_texto'>
            Gere o PDF do plano por cidade e variante, escolhendo procedimentos, diferenças, carências e limites antes
            de imprimir.
          </p>
          <Link className='card_link' to='/planos/impressao'>
            Conheça essa Ferramenta
          </Link>
        </div>

        <div className='home_card'>
          <h2 className='card_nome'>Contratos</h2>
          <p className='card_texto'>
            Monte envelopes, acompanhe assinaturas e gerencie documentos na Clicksign, integrado ao S.F.S.C.
          </p>
          <Link className='card_link' to='/contratos/clicksign'>
            Conheça essa Ferramenta
          </Link>
        </div>

        <div className='home_card'>
          <h2 className='card_nome'>Pagamentos</h2>
          <p className='card_texto'>
            Registre e acompanhe repasses, notas e pendências de pagamento aos prestadores credenciados.
          </p>
          <Link className='card_link' to='/pagamentos/registro'>
            Conheça essa Ferramenta
          </Link>
        </div>
      </div>
    </div>
  )
}

export default Home
