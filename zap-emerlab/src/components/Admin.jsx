import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { respostasDaPlanilha, normalizarTextoBusca } from '../util.js'
import Modal from './Modal.jsx'
import Icone from './Icone.jsx'
import TextoComSugestoes from './TextoComSugestoes.jsx'
import SeletorDepartamentos from './SeletorDepartamentos.jsx'
import { lerRegras, resumirRegras } from '../regras.js'

const USUARIO_VAZIO = { nome: '', email: '', senha: '', papel: 'atendente', ativo: true, departamentos: [] }
const DEPTO_VAZIO = { nome: '', cor: '#25d366', equipeWati: '' }
const RESPOSTA_VAZIA = { atalho: '', titulo: '', texto: '', departamentoIds: [], regras: '' }

const EXEMPLO_REGRAS = 'locais {RS+Porto Alegre, SC}\nclientes {sim}\ndepartamentos {Comercial}'

const DIAS_ATRIBUICOES = 7

// Busca na WATI quem atende cada conversa dos últimos 7 dias, lote a lote (o servidor responde até `fim`)
async function sincronizarAtribuicoes({ soSemAtendente = false, aoProgresso }) {
    const desde = new Date(Date.now() - DIAS_ATRIBUICOES * 86400000).toISOString()
    let verificadas = 0
    let atribuidas = 0
    for (let pagina = 1; ; pagina++) {
        aoProgresso?.({ verificadas, atribuidas })
        const r = await api('usuarios/wati/atribuicoes', { method: 'POST', body: { pagina, desde, soSemAtendente } })
        verificadas += r.verificadas
        atribuidas += r.atribuidas
        if (r.fim) return { verificadas, atribuidas }
    }
}

// Traz os operadores da WATI como usuários (só as contas; convites saem pelo botão de cada um)
// e quem está atendendo cada conversa movimentada nos últimos 7 dias
function ImportarWati({ avisar, aoFechar }) {
    const [operadores, setOperadores] = useState(null)
    const [escolhidos, setEscolhidos] = useState(() => new Set())
    const [atribuicoes, setAtribuicoes] = useState(true)
    const [progresso, setProgresso] = useState(null)

    useEffect(() => {
        api('usuarios/wati')
            .then((r) => {
                setOperadores(r.operadores)
                setEscolhidos(new Set(r.operadores.filter((o) => !o.jaExiste).map((o) => o.email)))
            })
            .catch((e) => {
                avisar(e.message, 'erro')
                aoFechar(false)
            })
    }, [avisar, aoFechar])

    const alternar = (email) =>
        setEscolhidos((s) => {
            const n = new Set(s)
            if (n.has(email)) n.delete(email)
            else n.add(email)
            return n
        })

    const importar = async () => {
        setProgresso({ etapa: 'usuarios' })
        try {
            const { criados } = escolhidos.size ? await api('usuarios/wati/importar', { method: 'POST', body: { emails: [...escolhidos] } }) : { criados: 0 }
            const { verificadas, atribuidas } = atribuicoes
                ? await sincronizarAtribuicoes({ aoProgresso: (n) => setProgresso({ etapa: 'atribuicoes', ...n }) })
                : { verificadas: 0, atribuidas: 0 }
            const partes = [`${criados} usuário(s) criado(s)`]
            if (atribuicoes) partes.push(`${atribuidas} de ${verificadas} conversa(s) com atendente`)
            avisar(`Importação concluída: ${partes.join(', ')}. Envie os convites pelo ícone de e-mail de cada um.`)
            aoFechar(true)
        } catch (e) {
            avisar(`Importação interrompida: ${e.message}`, 'erro')
            setProgresso(null)
        }
    }

    if (!operadores) return <div className="spinner spinner-centro" aria-label="Carregando operadores da WATI" />

    if (progresso) {
        return (
            <div className="importar-progresso" role="status">
                <div className="spinner" aria-hidden="true" />
                <p>
                    {progresso.etapa === 'usuarios'
                        ? 'Criando as contas…'
                        : `Buscando quem atende cada conversa… ${progresso.verificadas} verificada(s), ${progresso.atribuidas} com atendente.`}
                </p>
                <small className="ajuda">A WATI limita as consultas, então isso pode levar alguns minutos. Mantenha esta janela aberta.</small>
            </div>
        )
    }

    const novos = operadores.filter((o) => !o.jaExiste).length
    return (
        <div>
            <p className="ajuda">
                Operadores da WATI. As contas são criadas com convite pendente e ninguém recebe e-mail agora: envie os convites pelo ícone de e-mail de cada usuário quando quiser.
            </p>
            {operadores.length === 0 ? <p className="ajuda">Nenhum operador com e-mail na WATI.</p> : null}
            <ul className="importar-lista">
                {operadores.map((o) => (
                    <li key={o.email} className={o.jaExiste ? 'inativo' : ''}>
                        <label>
                            <input type="checkbox" checked={!o.jaExiste && escolhidos.has(o.email)} disabled={o.jaExiste} onChange={() => alternar(o.email)} />
                            <span>
                                <strong>{o.nome}</strong>
                                <small>
                                    {o.email} · {o.papel === 'admin' ? 'Admin' : 'Atendente'}
                                    {o.jaExiste ? ' · já cadastrado' : ''}
                                </small>
                            </span>
                        </label>
                    </li>
                ))}
            </ul>
            <label className="check">
                <input type="checkbox" checked={atribuicoes} onChange={(e) => setAtribuicoes(e.target.checked)} /> Importar quem está atendendo cada conversa (últimos {DIAS_ATRIBUICOES} dias)
            </label>
            <div className="modal-acoes">
                <button type="button" className="botao botao-secundario" onClick={() => aoFechar(false)}>
                    Cancelar
                </button>
                <button className="botao" disabled={!escolhidos.size && !atribuicoes} onClick={importar}>
                    {escolhidos.size ? `Importar ${escolhidos.size} usuário(s)` : 'Importar atribuições'}
                </button>
            </div>
            {novos === 0 && operadores.length ? <small className="ajuda">Todos os operadores já estão cadastrados.</small> : null}
        </div>
    )
}

function Usuarios({ departamentos, avisar }) {
    const [lista, setLista] = useState(null)
    const [form, setForm] = useState(null)
    const [importando, setImportando] = useState(false)
    const [sincronia, setSincronia] = useState(null)
    // convite que não saiu por e-mail: o admin copia o link e repassa
    const [linkConvite, setLinkConvite] = useState(null)

    const carregar = useCallback(() => {
        api('usuarios')
            .then((r) => setLista(r.usuarios))
            .catch((e) => avisar(e.message, 'erro'))
    }, [avisar])
    useEffect(carregar, [carregar])

    const tratarConvite = (r, email) => {
        if (r.emailEnviado) return avisar(`Convite enviado para ${email}.`)
        setLinkConvite({ email, link: r.link, erro: r.erroEmail })
    }

    const salvar = async (e) => {
        e.preventDefault()
        try {
            const { id, ...corpo } = form
            if (id) {
                await api(`usuarios/${id}`, { method: 'PUT', body: { ...corpo, senha: corpo.senha || undefined } })
                avisar('Usuário salvo.')
            } else {
                const { senha: _, ...novo } = corpo
                tratarConvite(await api('usuarios', { method: 'POST', body: novo }), novo.email)
            }
            setForm(null)
            carregar()
        } catch (e2) {
            avisar(e2.message, 'erro')
        }
    }

    const reenviar = async (u) => {
        try {
            tratarConvite(await api(`usuarios/${u.id}/convite`, { method: 'POST' }), u.email)
        } catch (e) {
            avisar(e.message, 'erro')
        }
    }

    const copiarLink = async () => {
        try {
            await navigator.clipboard.writeText(linkConvite.link)
            avisar('Link copiado.')
        } catch {
            avisar('Não foi possível copiar. Selecione o link e copie manualmente.', 'erro')
        }
    }

    const remover = async (u) => {
        if (!confirm(`Remover ${u.nome}? Esta ação não pode ser desfeita.`)) return
        try {
            await api(`usuarios/${u.id}`, { method: 'DELETE' })
            carregar()
        } catch (e) {
            avisar(e.message, 'erro')
        }
    }

    const alternarDepto = (id) =>
        setForm((f) => ({ ...f, departamentos: f.departamentos.includes(id) ? f.departamentos.filter((d) => d !== id) : [...f.departamentos, id] }))

    // conversas que ainda estão sem atendente no painel: pergunta à WATI quem está com elas
    const sincronizar = async () => {
        setSincronia({ verificadas: 0, atribuidas: 0 })
        try {
            const { verificadas, atribuidas } = await sincronizarAtribuicoes({ soSemAtendente: true, aoProgresso: setSincronia })
            avisar(
                verificadas
                    ? `Sincronização concluída: ${atribuidas} de ${verificadas} conversa(s) sem atendente ganharam o atendente da WATI.`
                    : 'Nenhuma conversa sem atendente nos últimos 7 dias.',
            )
        } catch (e) {
            avisar(`Sincronização interrompida: ${e.message}`, 'erro')
        } finally {
            setSincronia(null)
        }
    }

    const fecharImportacao = useCallback(
        (importou) => {
            setImportando(false)
            if (importou) carregar()
        },
        [carregar],
    )

    if (importando) return <ImportarWati avisar={avisar} aoFechar={fecharImportacao} />

    if (form) {
        return (
            <form onSubmit={salvar}>
                <label className="campo">
                    <span>Nome</span>
                    <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
                </label>
                <label className="campo">
                    <span>E-mail (o mesmo do operador na WATI)</span>
                    <input type="email" value={form.email} disabled={Boolean(form.id)} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
                </label>
                {form.id ? (
                    <label className="campo">
                        <span>Nova senha (deixe vazio para manter)</span>
                        <input type="password" value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} minLength={8} autoComplete="new-password" />
                    </label>
                ) : (
                    <p className="ajuda">Ao salvar, a pessoa recebe um e-mail de convite para criar a própria senha no Emerzap.</p>
                )}
                <label className="campo">
                    <span>Papel</span>
                    <select value={form.papel} onChange={(e) => setForm({ ...form, papel: e.target.value })}>
                        <option value="atendente">Atendente — vê só os próprios departamentos</option>
                        <option value="admin">Administrador — vê tudo e gerencia o painel</option>
                    </select>
                </label>
                <fieldset className="campo">
                    <span>Departamentos</span>
                    {departamentos.length === 0 ? <small className="ajuda">Cadastre departamentos na aba Departamentos.</small> : null}
                    <div className="checks">
                        {departamentos.map((d) => (
                            <label key={d.id} className="check">
                                <input type="checkbox" checked={form.departamentos.includes(d.id)} onChange={() => alternarDepto(d.id)} />
                                <span className="tag" style={{ '--tag': d.cor }}>
                                    {d.nome}
                                </span>
                            </label>
                        ))}
                    </div>
                </fieldset>
                <label className="check">
                    <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /> Ativo
                </label>
                <div className="modal-acoes">
                    <button type="button" className="botao botao-secundario" onClick={() => setForm(null)}>
                        Cancelar
                    </button>
                    <button className="botao">{form.id ? 'Salvar' : 'Salvar e enviar convite'}</button>
                </div>
            </form>
        )
    }

    return (
        <>
            <button className="botao botao-pequeno" onClick={() => setForm({ ...USUARIO_VAZIO })}>
                <Icone nome="mais" tamanho={18} /> Novo usuário
            </button>{' '}
            <button className="botao botao-pequeno botao-secundario" onClick={() => setImportando(true)}>
                <Icone nome="baixar" tamanho={18} /> Importar da WATI
            </button>{' '}
            <button
                className="botao botao-pequeno botao-secundario"
                onClick={sincronizar}
                disabled={Boolean(sincronia)}
                data-dica="Busca na WATI o atendente das conversas dos últimos 7 dias que ainda estão sem atendente no painel"
            >
                <Icone nome="tentar" tamanho={18} /> {sincronia ? 'Sincronizando…' : 'Sincronizar atendimentos'}
            </button>
            {sincronia ? (
                <p className="ajuda" role="status">
                    {sincronia.verificadas} conversa(s) verificada(s), {sincronia.atribuidas} com atendente. Mantenha esta janela aberta.
                </p>
            ) : null}
            {linkConvite ? (
                <div className="alerta convite-link" role="alert">
                    <p>
                        Não foi possível enviar o e-mail para <strong>{linkConvite.email}</strong>
                        {linkConvite.erro ? ` (${linkConvite.erro})` : ''}. Copie o link abaixo e envie para a pessoa:
                    </p>
                    <input value={linkConvite.link} readOnly onFocus={(e) => e.target.select()} aria-label="Link do convite" />
                    <div className="modal-acoes">
                        <button className="botao botao-secundario botao-pequeno" onClick={() => setLinkConvite(null)}>
                            Fechar
                        </button>
                        <button className="botao botao-pequeno" onClick={copiarLink}>
                            Copiar link
                        </button>
                    </div>
                </div>
            ) : null}
            {lista === null ? <div className="spinner spinner-centro" /> : null}
            <ul className="tabela">
                {(lista || []).map((u) => (
                    <li key={u.id} className={u.ativo ? '' : 'inativo'}>
                        <div className="tabela-principal">
                            <strong>{u.nome}</strong>
                            <small>
                                {u.email} · {u.papel === 'admin' ? 'Admin' : 'Atendente'}
                                {u.fixo ? ' · definido no .env' : ''}
                                {u.convitePendente ? ' · convite pendente' : ''}
                                {!u.ativo ? ' · inativo' : ''}
                            </small>
                            <div className="item-tags">
                                {u.departamentos.map((id) => {
                                    const d = departamentos.find((x) => x.id === id)
                                    return d ? (
                                        <span key={id} className="tag" style={{ '--tag': d.cor }}>
                                            {d.nome}
                                        </span>
                                    ) : null
                                })}
                            </div>
                        </div>
                        {!u.fixo ? (
                            <div className="tabela-acoes">
                                {u.convitePendente ? (
                                    <button className="icone-botao" aria-label="Reenviar convite" data-dica="Reenviar convite" onClick={() => reenviar(u)}>
                                        <Icone nome="email" tamanho={20} />
                                    </button>
                                ) : null}
                                <button className="icone-botao" aria-label="Editar" data-dica="Editar" onClick={() => setForm({ ...u, senha: '' })}>
                                    <Icone nome="editar" tamanho={20} />
                                </button>
                                <button className="icone-botao perigo" aria-label="Remover" data-dica="Remover" onClick={() => remover(u)}>
                                    <Icone nome="lixo" tamanho={20} />
                                </button>
                            </div>
                        ) : null}
                    </li>
                ))}
            </ul>
        </>
    )
}

function Departamentos({ departamentos, aoMudar, avisar }) {
    const [form, setForm] = useState(null)

    const salvar = async (e) => {
        e.preventDefault()
        try {
            const { id, ...corpo } = form
            await api(id ? `departamentos/${id}` : 'departamentos', { method: id ? 'PUT' : 'POST', body: corpo })
            setForm(null)
            aoMudar()
        } catch (e2) {
            avisar(e2.message, 'erro')
        }
    }

    const remover = async (d) => {
        if (!confirm(`Remover o departamento ${d.nome}? As conversas dele voltam para "sem departamento".`)) return
        try {
            await api(`departamentos/${d.id}`, { method: 'DELETE' })
            aoMudar()
        } catch (e) {
            avisar(e.message, 'erro')
        }
    }

    if (form) {
        return (
            <form onSubmit={salvar}>
                <label className="campo">
                    <span>Nome</span>
                    <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="ex.: Comercial, Suporte, Financeiro" required />
                </label>
                <label className="campo">
                    <span>Cor</span>
                    <input type="color" value={form.cor} onChange={(e) => setForm({ ...form, cor: e.target.value })} />
                </label>
                <label className="campo">
                    <span>Equipe correspondente na WATI (opcional)</span>
                    <input value={form.equipeWati} onChange={(e) => setForm({ ...form, equipeWati: e.target.value })} placeholder="Nome exato do team na WATI" />
                    <small className="ajuda">Se preenchido, transferir para este departamento também atribui a equipe na WATI (plano Pro).</small>
                </label>
                <div className="modal-acoes">
                    <button type="button" className="botao botao-secundario" onClick={() => setForm(null)}>
                        Cancelar
                    </button>
                    <button className="botao">Salvar</button>
                </div>
            </form>
        )
    }

    return (
        <>
            <button className="botao botao-pequeno" onClick={() => setForm({ ...DEPTO_VAZIO })}>
                <Icone nome="mais" tamanho={18} /> Novo departamento
            </button>
            <ul className="tabela">
                {departamentos.length === 0 ? <p className="lista-vazia">Nenhum departamento ainda.</p> : null}
                {departamentos.map((d) => (
                    <li key={d.id}>
                        <div className="tabela-principal">
                            <span className="tag" style={{ '--tag': d.cor }}>
                                {d.nome}
                            </span>
                            {d.equipe_wati ? <small>Equipe WATI: {d.equipe_wati}</small> : null}
                        </div>
                        <div className="tabela-acoes">
                            <button className="icone-botao" aria-label="Editar" data-dica="Editar" onClick={() => setForm({ id: d.id, nome: d.nome, cor: d.cor, equipeWati: d.equipe_wati || '' })}>
                                <Icone nome="editar" tamanho={20} />
                            </button>
                            <button className="icone-botao perigo" aria-label="Remover" data-dica="Remover" onClick={() => remover(d)}>
                                <Icone nome="lixo" tamanho={20} />
                            </button>
                        </div>
                    </li>
                ))}
            </ul>
        </>
    )
}

const EXEMPLO_IMPORTACAO = 'atalho;titulo;texto\nbomdia;Saudação;Olá {{primeiro_nome}}, bom dia! Como posso ajudar?\nprazo;Prazo de entrega;Entregamos em até 3 dias úteis.'

// Cola de planilha ou arquivo .csv/.tsv → prévia → envio em lote
// bomdia, bomdia → bomdia, bomdia-2 (sem colidir com outro atalho da planilha)
function comAtalhosUnicos(itens) {
    const usados = new Set(itens.map((r) => r.atalho))
    const vistos = new Set()
    return itens.map((r) => {
        if (!vistos.has(r.atalho)) {
            vistos.add(r.atalho)
            return r
        }
        let n = 2
        while (usados.has(`${r.atalho.slice(0, 36)}-${n}`)) n += 1
        const atalho = `${r.atalho.slice(0, 36)}-${n}`
        usados.add(atalho)
        return { ...r, atalho }
    })
}

function ImportarRespostas({ departamentos, aoConcluir, aoCancelar, avisar }) {
    const [texto, setTexto] = useState('')
    const [departamentoId, setDepartamentoId] = useState('')
    const [enviando, setEnviando] = useState(false)
    // atalho repetido na planilha: o servidor guarda só a última linha; numerando, todas entram
    const [numerarRepetidos, setNumerarRepetidos] = useState(true)
    const lidas = respostasDaPlanilha(texto)
    // linha com regra inválida não entra (o servidor também a recusaria)
    const errosRegra = lidas.itens.map((r) => [r, lerRegras(r.regras, { departamentos }).erros[0]]).filter(([, e]) => e)
    const validas = lidas.itens.filter((r) => !errosRegra.some(([x]) => x === r))
    const repetidos = validas.length - new Set(validas.map((r) => r.atalho)).size
    const itens = numerarRepetidos ? comAtalhosUnicos(validas) : validas
    const erros = [...lidas.erros, ...errosRegra.map(([r, e]) => `/${r.atalho}: ${e}`)]

    const lerArquivo = async (e) => {
        const arq = e.target.files?.[0]
        e.target.value = ''
        if (arq) setTexto(await arq.text())
    }

    const importar = async (e) => {
        e.preventDefault()
        setEnviando(true)
        try {
            const r = await api('respostas/importar', { method: 'POST', body: { itens, departamentoId } })
            const extras = []
            if (r.repetidas) extras.push(`${r.repetidas} linha(s) com atalho repetido substituíram a anterior`)
            if (r.ignoradas) extras.push(`${r.ignoradas} linha(s) recusadas`)
            avisar(`${r.criadas} criada(s), ${r.atualizadas} atualizada(s)${extras.length ? `; ${extras.join('; ')}` : ''}.`, extras.length ? 'aviso' : 'info')
            aoConcluir()
        } catch (e2) {
            avisar(e2.message, 'erro')
        } finally {
            setEnviando(false)
        }
    }

    return (
        <form onSubmit={importar}>
            <p className="ajuda">
                Copie as respostas da WATI (Team Inbox → Respostas rápidas) para uma planilha com as colunas <code>atalho</code>, <code>titulo</code> e{' '}
                <code>texto</code> (e, se quiser, <code>regras</code>), e cole aqui ou escolha o arquivo .csv. Um atalho que já existe é atualizado.
            </p>
            <label className="campo">
                <span>Planilha</span>
                <textarea rows={8} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={EXEMPLO_IMPORTACAO} spellCheck={false} />
            </label>
            <label className="campo">
                <span>Ou arquivo</span>
                <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={lerArquivo} />
            </label>
            <label className="campo">
                <span>Disponível para</span>
                <select value={departamentoId} onChange={(e) => setDepartamentoId(e.target.value)}>
                    <option value="">Todos os departamentos</option>
                    {departamentos.map((d) => (
                        <option key={d.id} value={d.id}>
                            {d.nome}
                        </option>
                    ))}
                </select>
            </label>
            {texto.trim() ? (
                <div className="importacao-previa" aria-live="polite">
                    <strong>{itens.length} resposta(s) prontas para importar</strong>
                    {lidas.colunas ? (
                        <p className="ajuda importacao-colunas">
                            Atalho vem de {lidas.colunas.atalho}, texto de {lidas.colunas.texto}.
                            {lidas.colunas.semCabecalho ? ' Cabeçalho não reconhecido: use as colunas atalho, titulo e texto na primeira linha.' : ''}
                        </p>
                    ) : null}
                    {repetidos ? (
                        <label className="check importacao-repetidos">
                            <input type="checkbox" checked={numerarRepetidos} onChange={(e) => setNumerarRepetidos(e.target.checked)} />
                            <span>
                                {repetidos} linha(s) repetem um atalho. Numerar os repetidos (ex.: <code>/bomdia-2</code>) para importar todas
                                {numerarRepetidos ? '' : ` — desmarcado, só a última de cada atalho fica (${itens.length - repetidos} respostas)`}.
                            </span>
                        </label>
                    ) : null}
                    {itens.length ? (
                        <ul>
                            {itens.slice(0, 5).map((r, i) => (
                                <li key={i}>
                                    <code>/{r.atalho}</code> <span className="texto-limitado">{r.texto}</span>
                                </li>
                            ))}
                            {itens.length > 5 ? <li className="ajuda">e mais {itens.length - 5}…</li> : null}
                        </ul>
                    ) : null}
                    {erros.length ? (
                        <ul className="importacao-erros">
                            {erros.slice(0, 5).map((e) => (
                                <li key={e}>{e}</li>
                            ))}
                            {erros.length > 5 ? <li>e mais {erros.length - 5} linha(s) ignoradas.</li> : null}
                        </ul>
                    ) : null}
                </div>
            ) : null}
            <div className="modal-acoes">
                <button type="button" className="botao botao-secundario" onClick={aoCancelar}>
                    Cancelar
                </button>
                <button className="botao" disabled={!itens.length || enviando}>
                    {enviando ? 'Importando…' : `Importar ${itens.length || ''}`.trim()}
                </button>
            </div>
        </form>
    )
}

// Regras de relevância da resposta (ver src/regras.js), com validação e resumo enquanto digita
function CampoRegras({ valor, aoMudar, departamentos }) {
    const { regras, erros } = lerRegras(valor, { departamentos })
    return (
        <label className="campo">
            <span>Regras (opcional)</span>
            <textarea rows={3} value={valor} onChange={(e) => aoMudar(e.target.value)} placeholder={EXEMPLO_REGRAS} spellCheck={false} className="campo-codigo" />
            {erros.length ? (
                <small className="ajuda ajuda-motivo" role="alert">
                    {erros[0]}
                </small>
            ) : regras.length ? (
                <small className="ajuda">Aparece no topo da lista para contatos com {resumirRegras(regras)}.</small>
            ) : null}
            <details className="ajuda regras-ajuda">
                <summary>Como escrever regras</summary>
                <p>
                    Uma chave por linha, no formato <code>chave {'{'}valor, valor{'}'}</code>. Valores da mesma chave: basta um bater. Chaves diferentes: todas precisam bater. As
                    respostas que batem com o contato aberto aparecem primeiro; as demais vão para o fim da lista, depois de uma divisória.
                </p>
                <ul>
                    <li>
                        <code>locais {'{'}RS, SC+Joinville{'}'}</code>: UF inteira ou UF+cidade (ou só a cidade).
                    </li>
                    <li>
                        <code>departamentos {'{'}Comercial{'}'}</code>: departamento da conversa no painel.
                    </li>
                    <li>
                        <code>clientes {'{'}sim{'}'}</code> ou <code>{'{'}não{'}'}</code>: contato com tipo &quot;cliente&quot; na WATI.
                    </li>
                    <li>
                        Qualquer atributo da WATI: <code>tipo {'{'}clinica{'}'}</code>, <code>situacao {'{'}ativo, credenciada{'}'}</code>.
                    </li>
                    <li>
                        <code>!</code> exclui: <code>locais {'{'}RS, !RS+Porto Alegre{'}'}</code> = RS menos Porto Alegre.
                    </li>
                </ul>
            </details>
        </label>
    )
}

const ORDENS_RESPOSTA = {
    atalho: ['Atalho (A–Z)', (a, b) => a.atalho.localeCompare(b.atalho, 'pt-BR', { numeric: true })],
    'atalho-desc': ['Atalho (Z–A)', (a, b) => b.atalho.localeCompare(a.atalho, 'pt-BR', { numeric: true })],
    titulo: ['Título (A–Z)', (a, b) => (a.titulo || a.atalho).localeCompare(b.titulo || b.atalho, 'pt-BR', { numeric: true })],
    recentes: ['Mais recentes', (a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || ''))],
    antigas: ['Mais antigas', (a, b) => String(a.criado_em || '').localeCompare(String(b.criado_em || ''))],
}

function Respostas({ departamentos, aoMudar, avisar }) {
    const [lista, setLista] = useState(null)
    const [form, setForm] = useState(null)
    const [importando, setImportando] = useState(false)
    const [busca, setBusca] = useState('')
    // '' = qualquer · 'todos' = disponível para todos · id = vinculada a esse departamento
    const [filtroDepto, setFiltroDepto] = useState('')
    const [filtroRegras, setFiltroRegras] = useState('')
    const [ordem, setOrdem] = useState('atalho')

    const visiveis = useMemo(() => {
        const q = normalizarTextoBusca(busca)
        return (lista || [])
            .filter((r) => {
                const ids = r.departamento_ids || []
                if (filtroDepto === 'todos' && ids.length) return false
                if (filtroDepto && filtroDepto !== 'todos' && !ids.includes(filtroDepto)) return false
                if (filtroRegras === 'com' && !r.regras) return false
                if (filtroRegras === 'sem' && r.regras) return false
                return !q || normalizarTextoBusca([r.atalho, r.titulo, r.texto, r.regras].filter(Boolean).join(' ')).includes(q)
            })
            .sort(ORDENS_RESPOSTA[ordem][1])
    }, [lista, busca, filtroDepto, filtroRegras, ordem])
    const filtrando = Boolean(busca.trim() || filtroDepto || filtroRegras)
    const limparFiltros = () => {
        setBusca('')
        setFiltroDepto('')
        setFiltroRegras('')
    }

    const carregar = useCallback(() => {
        api('respostas')
            .then((r) => setLista(r.respostas))
            .catch((e) => avisar(e.message, 'erro'))
    }, [avisar])
    useEffect(carregar, [carregar])

    const salvar = async (e) => {
        e.preventDefault()
        try {
            const { id, ...corpo } = form
            await api(id ? `respostas/${id}` : 'respostas', { method: id ? 'PUT' : 'POST', body: corpo })
            setForm(null)
            carregar()
            aoMudar()
        } catch (e2) {
            avisar(e2.message, 'erro')
        }
    }

    const remover = async (r) => {
        if (!confirm(`Remover a resposta /${r.atalho}?`)) return
        try {
            await api(`respostas/${r.id}`, { method: 'DELETE' })
            carregar()
            aoMudar()
        } catch (e) {
            avisar(e.message, 'erro')
        }
    }

    if (importando) {
        return (
            <ImportarRespostas
                departamentos={departamentos}
                avisar={avisar}
                aoCancelar={() => setImportando(false)}
                aoConcluir={() => {
                    setImportando(false)
                    carregar()
                    aoMudar()
                }}
            />
        )
    }

    if (form) {
        return (
            <form onSubmit={salvar}>
                <label className="campo">
                    <span>Atalho (usado como /atalho)</span>
                    <input value={form.atalho} onChange={(e) => setForm({ ...form, atalho: e.target.value })} placeholder="ex.: bomdia" required />
                </label>
                <label className="campo">
                    <span>Título (opcional)</span>
                    <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="ex.: Saudação" />
                </label>
                <label className="campo">
                    <span>Texto</span>
                    <TextoComSugestoes rows={5} value={form.texto} onChange={(texto) => setForm({ ...form, texto })} required />
                    <small className="ajuda">
                        Digite <kbd>{'{'}</kbd> para inserir uma variável (<code>{'{{nome}}'}</code>, <code>{'{{tipo}}'}</code>, <code>{'{{uf}}'}</code>, <code>{'{{cidade}}'}</code>…) ou <kbd>*</kbd> <kbd>_</kbd>{' '}
                        <kbd>~</kbd> <kbd>`</kbd> para formatação do WhatsApp.
                    </small>
                </label>
                <SeletorDepartamentos departamentos={departamentos} valor={form.departamentoIds} aoMudar={(departamentoIds) => setForm({ ...form, departamentoIds })} />
                <CampoRegras valor={form.regras} aoMudar={(regras) => setForm({ ...form, regras })} departamentos={departamentos} />
                <div className="modal-acoes">
                    <button type="button" className="botao botao-secundario" onClick={() => setForm(null)}>
                        Cancelar
                    </button>
                    <button className="botao" disabled={lerRegras(form.regras, { departamentos }).erros.length > 0}>
                        Salvar
                    </button>
                </div>
            </form>
        )
    }

    return (
        <>
            <button className="botao botao-pequeno" onClick={() => setForm({ ...RESPOSTA_VAZIA })}>
                <Icone nome="mais" tamanho={18} /> Nova resposta rápida
            </button>{' '}
            <button className="botao botao-pequeno botao-secundario" onClick={() => setImportando(true)}>
                Importar planilha
            </button>
            {lista?.length ? (
                <div className="respostas-ferramentas">
                    <label className="busca-caixa respostas-busca">
                        <Icone nome="busca" tamanho={18} />
                        <input
                            type="search"
                            value={busca}
                            onChange={(e) => setBusca(e.target.value)}
                            placeholder="Buscar por atalho, título, texto ou regra"
                            aria-label="Buscar respostas rápidas"
                        />
                        {busca ? (
                            <button type="button" className="icone-botao" aria-label="Limpar busca" onClick={() => setBusca('')}>
                                <Icone nome="fechar" tamanho={16} />
                            </button>
                        ) : null}
                    </label>
                    <select className="entrada respostas-filtro" value={filtroDepto} onChange={(e) => setFiltroDepto(e.target.value)} aria-label="Filtrar por departamento">
                        <option value="">Qualquer departamento</option>
                        <option value="todos">Disponível para todos</option>
                        {departamentos.map((d) => (
                            <option key={d.id} value={d.id}>
                                {d.nome}
                            </option>
                        ))}
                    </select>
                    <select className="entrada respostas-filtro" value={filtroRegras} onChange={(e) => setFiltroRegras(e.target.value)} aria-label="Filtrar por regras">
                        <option value="">Com ou sem regras</option>
                        <option value="com">Com regras</option>
                        <option value="sem">Sem regras</option>
                    </select>
                    <select className="entrada respostas-filtro" value={ordem} onChange={(e) => setOrdem(e.target.value)} aria-label="Ordenar">
                        {Object.entries(ORDENS_RESPOSTA).map(([k, [rotulo]]) => (
                            <option key={k} value={k}>
                                {rotulo}
                            </option>
                        ))}
                    </select>
                    <small className="respostas-contagem" aria-live="polite">
                        {filtrando ? `${visiveis.length} de ${lista.length}` : lista.length} resposta(s)
                        {filtrando ? (
                            <button type="button" className="link-botao" onClick={limparFiltros}>
                                Limpar filtros
                            </button>
                        ) : null}
                    </small>
                </div>
            ) : null}
            {lista === null ? <div className="spinner spinner-centro" /> : null}
            <ul className="tabela">
                {lista && lista.length === 0 ? <p className="lista-vazia">Nenhuma resposta rápida ainda.</p> : null}
                {lista?.length && !visiveis.length ? <p className="lista-vazia">Nenhuma resposta com esses filtros.</p> : null}
                {visiveis.map((r) => {
                    const deptos = departamentos.filter((x) => (r.departamento_ids || []).includes(x.id))
                    return (
                        <li key={r.id}>
                            <div className="tabela-principal">
                                <strong>
                                    /{r.atalho} {r.titulo ? <small>— {r.titulo}</small> : null}
                                </strong>
                                <small className="texto-limitado">{r.texto}</small>
                                <div className="item-tags">
                                    {deptos.length ? (
                                        deptos.map((d) => (
                                            <span key={d.id} className="tag" style={{ '--tag': d.cor }}>
                                                {d.nome}
                                            </span>
                                        ))
                                    ) : (
                                        <span className="tag tag-neutra">Todos</span>
                                    )}
                                    {r.regras ? (
                                        <span className="tag tag-neutra" title={r.regras}>
                                            Regras: {resumirRegras(lerRegras(r.regras).regras)}
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                            <div className="tabela-acoes">
                                <button
                                    className="icone-botao"
                                    aria-label="Editar" data-dica="Editar"
                                    onClick={() => setForm({ id: r.id, atalho: r.atalho, titulo: r.titulo || '', texto: r.texto, departamentoIds: r.departamento_ids || [], regras: r.regras || '' })}
                                >
                                    <Icone nome="editar" tamanho={20} />
                                </button>
                                <button className="icone-botao perigo" aria-label="Remover" data-dica="Remover" onClick={() => remover(r)}>
                                    <Icone nome="lixo" tamanho={20} />
                                </button>
                            </div>
                        </li>
                    )
                })}
            </ul>
        </>
    )
}

export default function Admin({ departamentos, aoFechar, aoMudar, avisar }) {
    const [aba, setAba] = useState('usuarios')
    return (
        <Modal titulo="Administração" aoFechar={aoFechar} largo>
            <div className="abas">
                <button className={aba === 'usuarios' ? 'ativo' : ''} onClick={() => setAba('usuarios')}>
                    Usuários
                </button>
                <button className={aba === 'departamentos' ? 'ativo' : ''} onClick={() => setAba('departamentos')}>
                    Departamentos
                </button>
                <button className={aba === 'respostas' ? 'ativo' : ''} onClick={() => setAba('respostas')}>
                    Respostas rápidas
                </button>
            </div>
            {aba === 'usuarios' ? <Usuarios departamentos={departamentos} avisar={avisar} /> : null}
            {aba === 'departamentos' ? <Departamentos departamentos={departamentos} aoMudar={aoMudar} avisar={avisar} /> : null}
            {aba === 'respostas' ? <Respostas departamentos={departamentos} aoMudar={aoMudar} avisar={avisar} /> : null}
        </Modal>
    )
}
