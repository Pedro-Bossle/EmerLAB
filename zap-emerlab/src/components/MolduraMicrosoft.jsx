import Icone from './Icone.jsx'
import IconeMicrosoft, { LogoMicrosoft } from './IconeMicrosoft.jsx'
import { APPS_MS } from '../util.js'

// lista à esquerda e leitura à direita, com o cabeçalho da conta e a tela de login
export default function MolduraMicrosoft({ app, usuario, conectado, conectar, lista, conteudo, real }) {
    const info = APPS_MS[app]
    return (
        <>
            <aside className="lateral" style={{ '--ms': info.cor }}>
                <header className="barra barra-lateral">
                    <div className="barra-titulo">
                        <h1 className="titulo-canal">
                            <IconeMicrosoft app={app} tamanho={20} /> {info.nome}
                        </h1>
                        <small>{conectado ? `${(real && real.email) || usuario.email} · conta Microsoft` : 'Conta Microsoft não conectada'}</small>
                    </div>
                    {conectado ? (
                        <div className="barra-acoes">
                            <button className="icone-botao" aria-label="Sair da conta Microsoft" data-dica="Sair da conta Microsoft" data-dica-lado="esquerda" onClick={() => conectar(false)}>
                                <Icone nome="sair" />
                            </button>
                        </div>
                    ) : null}
                </header>
                {!real ? (
                    <p className="ms-faixa" role="note">
                        <Icone nome="info" tamanho={14} /> Prévia: dados de exemplo e envio simulado, até a integração com a Microsoft.
                    </p>
                ) : real.aviso ? (
                    <p className="ms-faixa" role="alert">
                        <Icone nome="info" tamanho={14} /> {real.aviso}
                    </p>
                ) : null}
                {conectado ? (
                    lista
                ) : (
                    <div className="estado-vazio">
                        <p>Entre com a sua conta Microsoft da Emerdog para ver {app === 'teams' ? 'as conversas do Teams' : 'os e-mails do Outlook'} aqui.</p>
                    </div>
                )}
            </aside>

            <main className="principal" style={{ '--ms': info.cor }}>
                {!conectado ? (
                    <div className="ms-login">
                        <IconeMicrosoft app={app} tamanho={56} />
                        <h2>{real?.reconectar ? 'Reconecte sua conta Microsoft' : 'Conecte sua conta Microsoft'}</h2>
                        {real?.reconectar ? <p>O acesso da sua conta expirou ou foi revogado. Entre de novo para continuar.</p> : null}
                        <p>
                            Para usar o {info.rotulo} dentro do Emerzap, entre com a sua conta Microsoft da Emerdog (<strong>@emerdog.com.br</strong>). O acesso
                            usa o seu próprio login, com as mesmas permissões que você tem no {info.rotulo}.
                        </p>
                        <button className="ms-entrar" onClick={() => conectar(true)}>
                            <LogoMicrosoft /> Entrar com a Microsoft
                        </button>
                        {!real ? <small>Prévia: o login ainda é simulado, enquanto o app não é registrado no Azure.</small> : null}
                    </div>
                ) : (
                    conteudo || (
                        <div className="estado-vazio ms-vazio">
                            <IconeMicrosoft app={app} tamanho={48} />
                            <p>{app === 'teams' ? 'Escolha uma conversa do Teams na lista.' : 'Escolha um e-mail na lista para ler.'}</p>
                        </div>
                    )
                )}
            </main>
        </>
    )
}
