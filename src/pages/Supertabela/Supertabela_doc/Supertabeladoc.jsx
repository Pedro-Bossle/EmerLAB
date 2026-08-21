import React, { useEffect, useState } from 'react'
import './Supertabeladoc.css'

const Supertabeladoc = () => {
    const [isHoveringIframe, setIsHoveringIframe] = useState(false)
    const planilhaId = '1LIKUGWPx6Dd5mjYhDIcdOHWikYDIKEyW9hxA_vHif4s'
    const planilhaPreviewUrl = `https://docs.google.com/spreadsheets/d/${planilhaId}/preview`
    const planilhaEditUrl = `https://docs.google.com/spreadsheets/d/${planilhaId}/edit`

    useEffect(() => {
        if (!isHoveringIframe) return undefined

        const previousOverflow = document.body.style.overflow
        const previousPaddingRight = document.body.style.paddingRight
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth

        document.body.style.overflow = 'hidden'
        if (scrollbarWidth > 0) {
            document.body.style.paddingRight = `${scrollbarWidth}px`
        }

        return () => {
            document.body.style.overflow = previousOverflow
            document.body.style.paddingRight = previousPaddingRight
        }
    }, [isHoveringIframe])

    return (
        <div className='documentation'>
            <h1>Supertabela - Documentação</h1>
            <div>
                <h2>Por que Existe?</h2>
                <p>Criada para unificar as tabelas das regiões, negociações e planos todas em uma unica ferramenta, montada a partir de abas individuais de excel que se relacionavam entre si, impedindo a perda de dados e a inconsistência de informações.</p>
                <h2>Como Funciona?</h2>
                <p>Em resumo, ela possui uma tabela base com os valores das cidades e dos planos, essa qual é referenciada em todas as outras abas para serem feitos os calculos e filtragens de cobertura.</p>
                <h2>Como Usar?</h2>
                <p>AUsada quando feito negociações especificas com veterinários, alteração de valores de procedimentos ou quando será aberto uma nova região no plano. Para negociações bastava adicionar uma aba nova conforme a cidade e deixar apenas os procedimentos do vet.</p>
                <h2>Por que criar uma ferramenta para isso?</h2>
                <p>Durante seu tempo no setor de credenciamento, irá perceber que é muito difícil manter todas as tabelas de preços e negociações em um só lugar, e que é muito difícil de manter as informações atualizadas e consistentes, por isso criamos um "Super Computador em Excel" para facilitar isso, e hoje, este super computador está aqui para facilitar o seu trabalho na plataforma EmerLAB.</p>
                <h2>Por que sair do Excel?</h2>
                <p>O Excel é uma baita ferramenta, isso estamos de acordo, porém a manutenção dele é dificl quando não se tem o conhecimento do funcionamento interno da “máquina”, e isso acaba prejudicando e pode desencadear erros em toda a tabela, portanto decidimos colocar tudo numa unica plataforma de fácil manutenção. Abaixo você poderá ver um trecho da “Super-Tabela MK3” e algumas informações para “Nerds” de como ela funcionava.</p>
            </div>

            <h2>A Super Tabela Original</h2>
            <div
                className="documentation_iframe_wrapper"
                onMouseEnter={() => setIsHoveringIframe(true)}
                onMouseLeave={() => setIsHoveringIframe(false)}
            >
                <iframe
                    className="documentation_iframe"
                    src={planilhaPreviewUrl}
                    title="Super Tabela"
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                />
            </div>
            <p>
                Se a pré-visualização não carregar no site, abra a planilha em uma nova aba:{' '}
                <a href={planilhaEditUrl} target="_blank" rel="noreferrer">
                    Abrir no Google Sheets
                </a>
            </p>
            <div>
                <h2>A Tabela Excel</h2>
                <p>A aba principal é o ponto central dela, nela você visualiza todos os planos de todas as cidades, na “Planos Caxias” você via as informações dos planos em Caxias do Sul, em seguida temos a Sutilvet (uma tabela de negociação especifica) e a Lab Axys, uma tabela de Porto Alegre para um laboratório. Temos também as tabelas DATA, a DATA é a enorme galeria de valores, para esse display ela está limitada a somente Caxias do Sul e Porto Alegre, porém eram repetidas estas colunas para TODAS as regiões. A DATA COD é mais leve, serve somente para filtrar os nomes e os códigos dos procedimentos. Quer conferir como ela funcionava nas formulas? Olhe nas celulas A13 e B13 da tabela DATA e se divirta nas linhas de código! </p>
            </div>
        </div>

    )
}

export default Supertabeladoc




