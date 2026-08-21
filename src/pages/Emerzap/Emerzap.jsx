import React, { useEffect } from 'react'
import { Link } from 'react-router-dom'
import EmerzapComposer from '../../components/BatePapo/EmerzapComposer'
import { MensagemImagem, formatarHoraMensagem } from '../../components/BatePapo/batePapoUi'
import { useEmerzapChat } from '../../components/BatePapo/useEmerzapChat'
import './Emerzap.css'

export default function Emerzap() {
  const chat = useEmerzapChat({ ativo: true })

  useEffect(() => {
    const prev = document.title
    document.title = 'Emerzap'
    return () => {
      document.title = prev
    }
  }, [])

  if (!chat.permitido) {
    return (
      <div className="emerzap_web emerzap_web--bloqueado">
        <p>Sem permissão para o Emerzap.</p>
        <Link to="/home">Voltar ao início</Link>
      </div>
    )
  }

  return (
    <div className="emerzap_web">
      <aside className="emerzap_web_sidebar" aria-label="Conversas">
        <header className="emerzap_web_side_head">
          <div className="emerzap_web_brand">
            <span className="emerzap_web_brand_mark" aria-hidden="true">
              💬
            </span>
            <h1>Emerzap</h1>
          </div>
          <button
            type="button"
            className="emerzap_web_btn_grupo"
            onClick={() => chat.setModoGrupo(true)}
            title="Novo grupo"
          >
            + Grupo
          </button>
        </header>

        <div className="emerzap_web_busca_wrap">
          <input
            type="search"
            className="emerzap_web_busca"
            placeholder="Pesquisar ou começar nova conversa"
            value={chat.busca}
            onChange={(e) => chat.setBusca(e.target.value)}
          />
        </div>

        {chat.erro ? <p className="emerzap_web_erro">{chat.erro}</p> : null}

        <div className="emerzap_web_lista">
          {chat.carregandoLista ? (
            <p className="emerzap_web_status">Carregando…</p>
          ) : (
            <>
              {chat.listaFiltrada.conversasFiltradas.map((c) => {
                const ativa = c.conversaId && c.conversaId === chat.conversaId
                return (
                  <button
                    key={c.conversaId || c.peerId}
                    type="button"
                    className={`emerzap_web_contato${ativa ? ' is-active' : ''}`}
                    onClick={() => void chat.abrirConversa(c)}
                  >
                    <span className="emerzap_web_avatar" aria-hidden="true">
                      {c.tipo === 'grupo' ? '👥' : iniciais(c.nome)}
                    </span>
                    <span className="emerzap_web_contato_body">
                      <span className="emerzap_web_contato_top">
                        <span className="emerzap_web_contato_nome">{c.nome}</span>
                        {c.naoLidas > 0 ? (
                          <span className="emerzap_web_badge">{c.naoLidas > 99 ? '99+' : c.naoLidas}</span>
                        ) : null}
                      </span>
                      <small>{c.ultimaMensagem || 'Sem mensagens'}</small>
                    </span>
                  </button>
                )
              })}
              {chat.listaFiltrada.semConversa.length > 0 ? (
                <>
                  <p className="emerzap_web_secao">Iniciar conversa</p>
                  {chat.listaFiltrada.semConversa.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      className="emerzap_web_contato"
                      onClick={() => void chat.iniciarDm(u)}
                    >
                      <span className="emerzap_web_avatar" aria-hidden="true">
                        {iniciais(u.nome)}
                      </span>
                      <span className="emerzap_web_contato_body">
                        <span className="emerzap_web_contato_nome">{u.nome}</span>
                        <small>Nova conversa</small>
                      </span>
                    </button>
                  ))}
                </>
              ) : null}
              {!chat.listaFiltrada.conversasFiltradas.length && !chat.listaFiltrada.semConversa.length ? (
                <p className="emerzap_web_status">Nenhuma conversa encontrada.</p>
              ) : null}
            </>
          )}
        </div>
      </aside>

      <main className="emerzap_web_main" aria-label="Chat">
        {chat.modoGrupo ? (
          <form className="emerzap_web_grupo" onSubmit={chat.onCriarGrupo}>
            <header className="emerzap_web_chat_head">
              <button type="button" className="emerzap_web_voltar" onClick={chat.voltarLista} aria-label="Fechar grupo">
                ×
              </button>
              <h2>Novo grupo</h2>
            </header>
            <div className="emerzap_web_grupo_body">
              <input
                className="emerzap_web_busca"
                placeholder="Nome do grupo"
                value={chat.nomeGrupo}
                onChange={(e) => chat.setNomeGrupo(e.target.value)}
                required
              />
              <p className="emerzap_web_secao">Participantes</p>
              <ul className="emerzap_web_check_list">
                {chat.usuarios.map((u) => (
                  <li key={u.id}>
                    <label className="emerzap_web_check">
                      <input
                        type="checkbox"
                        checked={chat.membrosGrupo.has(u.id)}
                        onChange={() => {
                          chat.setMembrosGrupo((prev) => {
                            const next = new Set(prev)
                            if (next.has(u.id)) next.delete(u.id)
                            else next.add(u.id)
                            return next
                          })
                        }}
                      />
                      <span>{u.nome}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <button
                type="submit"
                className="emerzap_web_enviar"
                disabled={chat.enviando || !chat.nomeGrupo.trim() || !chat.membrosGrupo.size}
              >
                Criar grupo
              </button>
            </div>
          </form>
        ) : chat.conversaId ? (
          <div className="emerzap_web_chat">
            <header className="emerzap_web_chat_head">
              <span className="emerzap_web_avatar emerzap_web_avatar--sm" aria-hidden="true">
                {iniciais(chat.tituloThread)}
              </span>
              <h2>{chat.tituloThread || 'Conversa'}</h2>
            </header>

            <div className="emerzap_web_msgs">
              {chat.carregandoChat ? (
                <p className="emerzap_web_status">Carregando…</p>
              ) : chat.mensagensComDias.length === 0 ? (
                <p className="emerzap_web_status">Nenhuma mensagem ainda. Diga oi!</p>
              ) : (
                chat.mensagensComDias.map((item) => {
                  if (item.kind === 'day') {
                    return (
                      <div key={item.id} className="emerzap_web_day">
                        <span>{item.label}</span>
                      </div>
                    )
                  }
                  const minha = item.remetenteId === chat.userId
                  return (
                    <div key={item.id} className={`emerzap_web_msg${minha ? ' is-mine' : ''}`}>
                      <div className="emerzap_web_msg_meta">
                        <span>{minha ? 'Você' : item.remetenteNome}</span>
                        <time dateTime={item.criadoEm || undefined}>{formatarHoraMensagem(item.criadoEm)}</time>
                      </div>
                      {item.tipo === 'imagem' ? (
                        <MensagemImagem msg={item} className="emerzap_web_msg_img" />
                      ) : (
                        <p>{item.corpo}</p>
                      )}
                    </div>
                  )
                })
              )}
              <div ref={chat.fimRef} />
            </div>

            <EmerzapComposer
              variant="web"
              texto={chat.texto}
              onTextoChange={chat.setTexto}
              previewImg={chat.previewImg}
              onPreviewChange={chat.setPreviewImg}
              enviando={chat.enviando}
              onSubmit={chat.onEnviar}
              fileRef={chat.fileRef}
              inputRef={chat.inputRef}
            />
          </div>
        ) : (
          <div className="emerzap_web_empty">
            <div className="emerzap_web_empty_card">
              <span className="emerzap_web_empty_ico" aria-hidden="true">
                💬
              </span>
              <h2>Emerzap</h2>
              <p>Selecione uma conversa à esquerda para começar — no estilo WhatsApp Web.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function iniciais(nome) {
  const parts = String(nome || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase()
}
