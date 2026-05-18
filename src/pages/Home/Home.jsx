import React, { useEffect, useState } from 'react'
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
        .eq('id', userId) // normalmente profiles.id = auth.users.id
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
      <div >
        <h1>Olá {loading ? '...' : name}</h1>
        <p>Bem-vindo ao Sistema Facilitador do Setor de Credenciamentos  (<strong>S.F.S.C.</strong>)</p>
        <p>Esta ferramenta existe para facilitar o dia a dia do setor de credenciamentos, aqui você encontrará todas as ferramentas necessárias para o seu trabalho.</p>
      </div>

      <div className='home_cards_container'>
        <div className='home_card'>
          <h2 className='card_nome'>Super Tabela</h2>
          <p className='card_texto'>Gerencie as tabelas de preços dos seus procedimentos e as negociações com os parceiros;</p>
          <a className='card_link' href="/Supertabeladoc">Conheça essa Ferramenta</a>
        </div>

        <div className='home_card'>
          <h2 className='card_nome'>Credenciamento</h2>
          <p className='card_texto'>Mantenha o processo de credenciamento dos parceiros a um toque de distância;</p>
          <a className='card_link' href="/Credenciamentodoc">Conheça essa Ferramenta</a>
        </div>

        <div className='home_card'>
          <h2 className='card_nome'>Orçamentos</h2>
          <p className='card_texto'>Calcule orçamento de compra de procedimentos para clientes de forma rápida e fácil;</p>
          <a className='card_link' href="/Compras/Orcamento">Conheça essa Ferramenta</a>
        </div>

        <div className='home_card'>
          <h2 className='card_nome'>Contratos</h2>
          <p className='card_texto'>
            Montar envelopes, acompanhar assinaturas e gerir documentos na Clicksign, integrado ao S.F.S.C.;
          </p>
          <a className='card_link' href='/contratos/clicksign'>
            Abrir Clicksign
          </a>
        </div>
        {/*<div className='home_card'>
          <h2 className='card_nome'>Formulário</h2>
          <p className='card_texto'>Cadastre os perfis de veterinários de maneira rápida e fácil com apenas um link individual;</p>
          <a className='card_link' href="https://www.jotform.com/pt/inbox/240603265780656/6520912807731027667">Conheça essa Ferramenta</a>
        </div>

        <div className='home_card'>
          <h2 className='card_nome'>Planos</h2>
          <p className='card_texto'>Gerencie os planos, visualize as tabelas OnLine e edite-as sem necessidade de abrir o Canva;</p>
          <a className='card_link' href="https://www.emerdog.com.br/planos">Conheça essa Ferramenta</a>
        </div>

        <div className='home_card'>
          <h2 className='card_nome'>Pagamentos</h2>
          <p className='card_texto'>Confira os repasses do mês, quem enviou a nota e quem deu o OK para os relatórios;</p>
          <a className='card_link' href="https://emerdogplano-my.sharepoint.com/:x:/g/personal/arthur_emerdog_com_br/IQDuea4Z4rpKQpSpyetdlhYwAYP6TxrTPvFdEAOd2eTK7k0?e=oXHdzG">Conheça essa Ferramenta</a>
        </div>

        <div className='home_card'>
          <h2 className='card_nome'>Emer Cast</h2>
          <p className='card_texto'>Fique por dentro do cronograma de episódios do Emer Cast;</p>
          <a className='card_link' href="https://docs.google.com/spreadsheets/d/1WqUUGcIDeM6NTdjzXoDqhDD1GWUshnaoZjiVQZH6l5M/edit?gid=956068756#gid=956068756">Conheça essa Ferramenta</a>
        </div>
        */}

        <div className='home_card'>
          <h2 className='card_nome'>Em breve...</h2>
          <p className='card_texto'>Em breve mais ferramentas serão adicionadas...</p>
        </div>
      </div>
    </div>
  )
}


//pesquisar como integrar o Clicksign (API) na plataforma, se isso funcionar vai ser muito bom pra todo mundo.


export default Home