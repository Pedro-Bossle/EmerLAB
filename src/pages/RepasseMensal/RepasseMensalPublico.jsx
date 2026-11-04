import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
    publicoAprovar,
    publicoComprovante,
    publicoEnviarDocumento,
    publicoLer,
    publicoReprovar,
} from '../../lib/repasse/repasseApi.js'
import {
    TIPOS_REPASSE_ROTULO,
    avaliarValorDocumento,
    linkWhatsapp,
    mensagemReprovacao,
    validarArquivoRepasse,
} from '../../lib/repasse/repasseCore.js'
import { DESCONTO_RPA, valorLiquidoRpa } from '../../lib/pagamentosValor.js'
import './RepasseMensalPublico.css'

const WHATS_PADRAO = '555499041695'
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBr = (iso) => {
    const [a, m, d] = String(iso || '').slice(0, 10).split('-')
    return d ? `${d}/${m}/${a}` : ''
}

function TabelaAtendimentos({ grupos }) {
    const totalRepasse = grupos.reduce((s, g) => s + (g.atendimentos || []).reduce((s2, a) => s2 + (a.itens || []).reduce((s3, it) => s3 + Number(it[1] || 0), 0), 0), 0)
    const totalTutor = grupos.reduce((s, g) => s + (g.atendimentos || []).reduce((s2, a) => s2 + (a.itens || []).reduce((s3, it) => s3 + Number(it[2] || 0), 0), 0), 0)
    const totalAtend = grupos.reduce((s, g) => s + (g.atendimentos || []).length, 0)
    return (
        <div className="rm_tabela_wrap" tabIndex={0} role="region" aria-label="Tabela de atendimentos">
            <table className="rm_tabela">
                {grupos.map((g, gi) => {
                    const sub = (g.atendimentos || []).reduce(
                        (s, a) => s + (a.itens || []).reduce((s2, it) => s2 + Number(it[1] || 0), 0),
                        0,
                    )
                    return (
                        <tbody key={`${g.titulo}-${gi}`} className="rm_bloco">
                            <tr className="rm_grupo">
                                <th colSpan={6}>
                                    <span className="rm_vet_rot">Veterinário {grupos.length > 1 ? `${gi + 1} de ${grupos.length}` : ''}</span>
                                    <span className="rm_vet_nome">{g.titulo}</span>
                                    <span className="rm_vet_qtd">{(g.atendimentos || []).length} atendimento(s)</span>
                                </th>
                                <th className="rm_col_repasse">
                                    <span className="rm_vet_sub_rot">Subtotal</span>
                                    {brl(sub)}
                                </th>
                            </tr>
                            <tr className="rm_colunas">
                                <th className="rm_td_id">Prontuário</th>
                                <th className="rm_td_data">Data</th>
                                <th>Tutor</th>
                                <th>Pet</th>
                                <th>Procedimento</th>
                                <th className="rm_col_num">Diferença</th>
                                <th className="rm_col_repasse">Repasse</th>
                            </tr>
                            {(g.atendimentos || []).flatMap((a, ai) =>
                                (a.itens || []).map((it, ii) => (
                                    <tr key={`${a.id}-${ai}-${ii}`} className={ii === 0 ? 'rm_linha_inicio' : undefined}>
                                        {ii === 0 && (
                                            <>
                                                <td rowSpan={a.itens.length} className="rm_td_id">{a.id}</td>
                                                <td rowSpan={a.itens.length} className="rm_td_data">{a.data}</td>
                                                <td rowSpan={a.itens.length}>{a.tutor}</td>
                                                <td rowSpan={a.itens.length}>{a.pet}</td>
                                            </>
                                        )}
                                        <td>{it[0]}</td>
                                        <td className="rm_col_num">{brl(it[2])}</td>
                                        <td className="rm_col_repasse">{brl(it[1])}</td>
                                    </tr>
                                )),
                            )}
                        </tbody>
                    )
                })}
                <tfoot>
                    <tr className="rm_total_geral">
                        <th colSpan={5}>
                            <span className="rm_vet_rot">Total geral</span>
                            <span className="rm_total_geral_sub">{grupos.length} veterinário(s) · {totalAtend} atendimento(s)</span>
                        </th>
                        <th className="rm_col_num">{brl(totalTutor)}</th>
                        <th className="rm_col_repasse">{brl(totalRepasse)}</th>
                    </tr>
                </tfoot>
            </table>
        </div>
    )
}

function FormDocumento({ token, relatorio, whatsapp, aoEnviado }) {
    const tipo = relatorio.tipo
    const [arquivo, setArquivo] = useState(null)
    const [numero, setNumero] = useState('')
    const [vencimento, setVencimento] = useState('')
    const [valor, setValor] = useState(String(relatorio.totalRepasse).replace('.', ','))
    const [enviando, setEnviando] = useState(false)
    const [erro, setErro] = useState('')
    const [erroRede, setErroRede] = useState(false)
    const [arrastando, setArrastando] = useState(false)
    const inputRef = useRef(null)
    const enviandoRef = useRef(false)
    const valorNum = Number(String(valor).replace(/\./g, '').replace(',', '.'))

    // Ctrl+V cola o arquivo copiado enquanto o formulário está na tela.
    useEffect(() => {
        const aoColar = (e) => {
            const f = Array.from(e.clipboardData?.files || [])[0]
            if (!f) return
            e.preventDefault()
            setErro('')
            setArquivo(f)
        }
        document.addEventListener('paste', aoColar)
        return () => document.removeEventListener('paste', aoColar)
    }, [])
    const aval = avaliarValorDocumento(valorNum, relatorio.totalRepasse, relatorio.totalTutor)
    const rotulo = tipo === 'boleto' ? 'boleto' : 'nota fiscal'

    const enviar = async (e) => {
        e.preventDefault()
        setErro('')
        const msg = arquivo ? validarArquivoRepasse({ nome: arquivo.name, tamanho: arquivo.size, tipos: ['pdf', 'xml'] }) : 'Escolha o arquivo.'
        if (msg) return setErro(msg)
        if (aval.nivel === 'erro_tutor' || aval.nivel === 'erro_invalido') return setErro('Confira o valor do documento.')
        // trava síncrona: dois cliques/toques antes do botão desabilitar enviavam o mesmo documento duas vezes
        if (enviandoRef.current) return
        enviandoRef.current = true
        setEnviando(true)
        try {
            await publicoEnviarDocumento(token, arquivo, { numero, vencimento: tipo === 'boleto' ? vencimento : null, valor: valorNum })
            aoEnviado()
        } catch (err) {
            setErro(err.message)
            setErroRede(Boolean(err.rede))
        } finally {
            enviandoRef.current = false
            setEnviando(false)
        }
    }

    return (
        <form className="rm_form" onSubmit={enviar}>
            <h3 className="rm_form_titulo">Vincular {rotulo}</h3>
            <div className="rm_campo">
                <span className="rm_campo_rot">Arquivo da {rotulo} (PDF ou XML, até 10 MB)</span>
                <div
                    className={`rm_drop${arrastando ? ' is-over' : ''}${arquivo ? ' has-file' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => inputRef.current?.click()}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), inputRef.current?.click())}
                    onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
                    onDragLeave={() => setArrastando(false)}
                    onDrop={(e) => { e.preventDefault(); setArrastando(false); if (e.dataTransfer.files?.[0]) { setErro(''); setArquivo(e.dataTransfer.files[0]) } }}
                >
                    {arquivo ? (
                        <>
                            <span className="rm_drop_nome">{arquivo.name}</span>
                            <span className="rm_drop_dica">{(arquivo.size / 1024).toFixed(0)} KB · toque para trocar</span>
                            <button type="button" className="rm_drop_remover" onClick={(e) => { e.stopPropagation(); setArquivo(null) }}>Remover</button>
                        </>
                    ) : (
                        <>
                            <span className="rm_drop_titulo">Escolher arquivo</span>
                            <span className="rm_drop_dica">ou arraste aqui · ou cole com Ctrl + V</span>
                        </>
                    )}
                </div>
                <input ref={inputRef} type="file" accept=".pdf,.xml" className="rm_sr" tabIndex={-1} onChange={(e) => { setErro(''); setArquivo(e.target.files?.[0] || null) }} />
            </div>
            <div className="rm_form_grade">
                <label className="rm_campo">
                    <span className="rm_campo_rot">{tipo === 'boleto' ? 'Linha digitável' : 'Número da nota'}</span>
                    <input value={numero} onChange={(e) => setNumero(e.target.value)} required maxLength={120} />
                </label>
                {tipo === 'boleto' && (
                    <label className="rm_campo">
                        <span className="rm_campo_rot">Vencimento</span>
                        <input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} required />
                    </label>
                )}
                <label className="rm_campo">
                    <span className="rm_campo_rot">Valor do documento (R$)</span>
                    <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" required />
                </label>
            </div>
            {aval.nivel === 'erro_tutor' && (
                <p className="rm_aviso rm_aviso--erro" role="alert">
                    Esse é o valor pago pelo tutor, não o repasse. Use {brl(relatorio.totalRepasse)}.
                </p>
            )}
            {aval.nivel === 'aviso_diferente' && (
                <p className="rm_aviso rm_aviso--alerta" role="status">
                    O valor é diferente do repasse ({brl(relatorio.totalRepasse)}). Você pode enviar, mas o financeiro vai conferir.
                </p>
            )}
            {erro && (
                <div className="rm_aviso rm_aviso--erro" role="alert">
                    <p>{erro}</p>
                    {erroRede && (
                        <p>
                            Não conseguiu? Envie a {rotulo} pelo WhatsApp do financeiro:{' '}
                            <a href={linkWhatsapp(whatsapp, `Olá! Não consegui anexar a ${rotulo} do repasse de ${relatorio.competencia} (${relatorio.prestador}) pelo site.`)}>
                                abrir conversa
                            </a>
                        </p>
                    )}
                </div>
            )}
            <button type="submit" className="rm_btn rm_btn--aprovar" disabled={enviando}>
                {enviando ? 'Enviando…' : `Aprovar e anexar ${rotulo}`}
            </button>
        </form>
    )
}

function FormReprovar({ token, relatorio, whatsapp, aoReprovado }) {
    const [obs, setObs] = useState('')
    const [enviando, setEnviando] = useState(false)
    const [erro, setErro] = useState('')
    const texto = mensagemReprovacao({ prestador: relatorio.prestador, competencia: relatorio.competencia, observacao: obs.trim() || '…' })

    const reprovar = async (canal) => {
        setErro('')
        if (obs.trim().length < 5) return setErro('Descreva o que precisa ser ajustado.')
        if (canal === 'whatsapp') window.open(linkWhatsapp(whatsapp, texto), '_blank', 'noopener')
        setEnviando(true)
        try {
            await publicoReprovar(token, obs.trim(), canal)
            aoReprovado()
        } catch (err) {
            setErro(err.message)
        } finally {
            setEnviando(false)
        }
    }

    return (
        <div className="rm_form">
            <label>
                <span>O que precisa ser ajustado?</span>
                <textarea rows={4} value={obs} onChange={(e) => setObs(e.target.value)} maxLength={2000} />
            </label>
            <p className="rm_previa">{texto}</p>
            {erro && (
                <p className="rm_aviso rm_aviso--erro" role="alert">
                    {erro}
                </p>
            )}
            <div className="rm_acoes">
                <button type="button" className="rm_btn" disabled={enviando} onClick={() => void reprovar('whatsapp')}>
                    Enviar pelo WhatsApp
                </button>
                <button type="button" className="rm_btn" disabled={enviando} onClick={() => void reprovar('email')}>
                    Enviar por e-mail
                </button>
            </div>
        </div>
    )
}

export default function RepasseMensalPublico() {
    const { token } = useParams()
    const [estado, setEstado] = useState({ carregando: true, erro: '', dados: null })
    const [reprovando, setReprovando] = useState(false)
    const [confirmando, setConfirmando] = useState(false)
    const [baixando, setBaixando] = useState('')
    const [erroAcao, setErroAcao] = useState('')

    useEffect(() => {
        const meta = document.createElement('meta')
        meta.name = 'robots'
        meta.content = 'noindex, nofollow'
        document.head.appendChild(meta)
        const tituloAnterior = document.title
        document.title = 'Relatório de repasse · Emerdog'
        return () => {
            meta.remove()
            document.title = tituloAnterior
        }
    }, [])

    const carregar = useCallback(async () => {
        try {
            const dados = await publicoLer(token)
            setEstado({ carregando: false, erro: '', dados })
        } catch (e) {
            setEstado({ carregando: false, erro: e.message, dados: null })
        }
    }, [token])

    useEffect(() => {
        void carregar()
    }, [carregar])

    const r = estado.dados?.relatorio
    const whatsapp = estado.dados?.config?.whatsapp || WHATS_PADRAO
    const grupos = useMemo(() => r?.dados?.grupos || [], [r])

    const aprovar = async () => {
        setErroAcao('')
        try {
            await publicoAprovar(token)
            setConfirmando(false)
            await carregar()
        } catch (e) {
            setErroAcao(e.message)
        }
    }

    const baixar = async (tipo) => {
        setBaixando(tipo)
        try {
            const mod = await import('../../lib/repasse/exportRelatorio.js')
            if (tipo === 'xlsx') await mod.baixarRelatorioExcel(r)
            else await mod.baixarRelatorioPdf(r)
        } catch {
            setErroAcao('Não foi possível gerar o arquivo. Tente novamente.')
        } finally {
            setBaixando('')
        }
    }

    const abrirComprovante = async () => {
        try {
            const { url } = await publicoComprovante(token)
            if (url) window.open(url, '_blank', 'noopener')
        } catch (e) {
            setErroAcao(e.message)
        }
    }

    if (estado.carregando) {
        return (
            <main className="rm_pagina">
                <p className="rm_centro">Carregando relatório…</p>
            </main>
        )
    }

    if (!r) {
        return (
            <main className="rm_pagina">
                <div className="rm_cartao rm_centro">
                    <h1>Link indisponível</h1>
                    <p>Este link é inválido, venceu ou foi revogado. Fale com o financeiro da Emerdog.</p>
                    <a className="rm_btn rm_btn--primario" href={linkWhatsapp(whatsapp, 'Olá! Preciso de um novo link do relatório de repasse.')}>
                        Falar pelo WhatsApp
                    </a>
                </div>
            </main>
        )
    }

    const tipoRotulo = TIPOS_REPASSE_ROTULO[r.tipo] || r.tipo
    const doc = r.documento
    const respondido = ['aprovado', 'documento_em_revisao', 'reprovado', 'tratado'].includes(r.status)

    return (
        <main className="rm_pagina">
            <header className="rm_topo">
                <p className="rm_marca">Emerdog</p>
                <h1>Relatório de repasse</h1>
                <p className="rm_sub">
                    {r.competencia}
                    {r.periodoInicio ? ` · ${dataBr(r.periodoInicio)} a ${dataBr(r.periodoFim)}` : ''}
                </p>
                <p className="rm_prestador">{r.prestador}</p>
                <p className="rm_meta">
                    Pagamento: <strong>{tipoRotulo}</strong> · {r.atendimentos} atendimentos · {r.veterinarios} veterinário(s)
                </p>
            </header>

            {r.interno && (
                <div className="rm_aviso rm_aviso--info" role="status">
                    Visualização interna: abrir o relatório por aqui não altera o status dele.
                </div>
            )}

            {r.comprovante && (
                <div className="rm_aviso rm_aviso--ok" role="status">
                    Pagamento feito por {r.comprovante.forma === 'pix' ? 'PIX' : 'boleto'} em {dataBr(r.comprovante.data)} ({brl(r.comprovante.valor)}).{' '}
                    <button type="button" className="rm_link" onClick={abrirComprovante}>
                        Ver comprovante
                    </button>
                </div>
            )}

            <section className="rm_totais" aria-label="Totais">
                <div className="rm_total">
                    <span>Valor total dos atendimentos <small>(diferença + repasse)</small></span>
                    <strong>{brl(Number(r.totalRepasse) + Number(r.totalTutor))}</strong>
                </div>
                <div className="rm_total">
                    <span>Diferença</span>
                    <strong>{brl(r.totalTutor)}</strong>
                </div>
                <div className="rm_total rm_total--destaque">
                    <span>Repasse Emerdog</span>
                    <strong>{brl(r.totalRepasse)}</strong>
                </div>
            </section>

            {r.descontoRpa && (
                <section className="rm_desconto" aria-label="Desconto do RPA">
                    <h2>Desconto do RPA</h2>
                    <dl>
                        <div><dt>Repasse Emerdog</dt><dd>{brl(r.totalRepasse)}</dd></div>
                        <div className="rm_desconto_menos"><dt>Desconto de INSS ({Math.round(DESCONTO_RPA * 100)}%)</dt><dd>− {brl(Number(r.totalRepasse) - (valorLiquidoRpa(r.totalRepasse) ?? Number(r.totalRepasse)))}</dd></div>
                        <div className="rm_desconto_final"><dt>Valor a receber</dt><dd>{brl(valorLiquidoRpa(r.totalRepasse) ?? r.totalRepasse)}</dd></div>
                    </dl>
                    <p>
                        <strong>Por que há desconto?</strong> No pagamento por RPA (Recibo de Pagamento Autônomo), a Emerdog retém {Math.round(DESCONTO_RPA * 100)}% do valor a título de contribuição ao INSS do profissional autônomo e recolhe esse valor em nome dele. Por isso o valor depositado é menor que o repasse do relatório.
                    </p>
                </section>
            )}

            {r.tipo !== 'rpa' && !respondido && (
                <p className="rm_aviso rm_aviso--info">
                    A {r.tipo === 'boleto' ? 'boleto' : 'nota fiscal'} deve ser emitida no valor do Repasse:{' '}
                    <strong>{brl(r.totalRepasse)}</strong>. Não use o valor pago pelo tutor.
                </p>
            )}

            <div className="rm_acoes rm_acoes--download">
                <button type="button" className="rm_btn" disabled={Boolean(baixando)} onClick={() => void baixar('xlsx')}>
                    {baixando === 'xlsx' ? 'Gerando…' : 'Baixar Excel'}
                </button>
                <button type="button" className="rm_btn" disabled={Boolean(baixando)} onClick={() => void baixar('pdf')}>
                    {baixando === 'pdf' ? 'Gerando…' : 'Baixar PDF'}
                </button>
            </div>

            <TabelaAtendimentos grupos={grupos} />

            <section className="rm_cartao" aria-labelledby="rm-resposta">
                <h2 id="rm-resposta">Sua resposta</h2>
                {erroAcao && (
                    <p className="rm_aviso rm_aviso--erro" role="alert">
                        {erroAcao}
                    </p>
                )}

                {r.status === 'aprovado' && <p className="rm_aviso rm_aviso--ok">Relatório aprovado. Obrigado! O financeiro dará andamento ao pagamento.</p>}
                {r.status === 'documento_em_revisao' && (
                    <p className="rm_aviso rm_aviso--info">Recebemos sua {doc?.tipo === 'boleto' ? 'boleto' : 'nota fiscal'} e ela está em revisão pelo financeiro.</p>
                )}
                {(r.status === 'reprovado' || r.status === 'tratado') && (
                    <p className="rm_aviso rm_aviso--alerta">
                        {r.status === 'tratado'
                            ? 'Sua reprovação foi tratada pelo financeiro. Se ainda houver divergência, fale conosco.'
                            : 'Você reprovou este relatório. O financeiro entrará em contato para ajustar.'}
                    </p>
                )}
                {r.status === 'documento_devolvido' && doc?.motivo_devolucao && (
                    <p className="rm_aviso rm_aviso--alerta" role="status">
                        Documento devolvido pelo financeiro: {doc.motivo_devolucao}
                    </p>
                )}

                {!respondido && !reprovando && (
                    <>
                        {r.tipo === 'rpa' ? (
                            confirmando ? (
                                <div className="rm_confirma" role="group" aria-label="Confirmar aprovação">
                                    <p>
                                        Confirma a aprovação do relatório de <strong>{r.competencia}</strong> no valor de <strong>{brl(r.totalRepasse)}</strong>
                                        {r.descontoRpa ? <> (a receber <strong>{brl(valorLiquidoRpa(r.totalRepasse) ?? r.totalRepasse)}</strong> após o desconto de INSS)</> : null}?
                                    </p>
                                    <div className="rm_decisao">
                                        <button type="button" className="rm_btn rm_btn--neutro" onClick={() => setConfirmando(false)}>
                                            Voltar
                                        </button>
                                        <button type="button" className="rm_btn rm_btn--aprovar" onClick={() => void aprovar()}>
                                            <span aria-hidden="true">✓</span> Sim, aprovar
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="rm_decisao">
                                    <button type="button" className="rm_btn rm_btn--reprovar" onClick={() => setReprovando(true)}>
                                        <span aria-hidden="true">✕</span> Reprovar
                                    </button>
                                    <button type="button" className="rm_btn rm_btn--aprovar" onClick={() => setConfirmando(true)}>
                                        <span aria-hidden="true">✓</span> Aprovar relatório
                                    </button>
                                </div>
                            )
                        ) : (
                            <>
                                <FormDocumento token={token} relatorio={r} whatsapp={whatsapp} aoEnviado={carregar} />
                                <div className="rm_decisao rm_decisao--solo">
                                    <button type="button" className="rm_btn rm_btn--reprovar" onClick={() => setReprovando(true)}>
                                        <span aria-hidden="true">✕</span> Reprovar relatório
                                    </button>
                                </div>
                            </>
                        )}
                    </>
                )}

                {!respondido && reprovando && (
                    <>
                        <FormReprovar token={token} relatorio={r} whatsapp={whatsapp} aoReprovado={() => { setReprovando(false); void carregar() }} />
                        <button type="button" className="rm_btn rm_btn--texto" onClick={() => setReprovando(false)}>
                            Cancelar
                        </button>
                    </>
                )}
            </section>

            <footer className="rm_rodape">
                Dúvidas?{' '}
                <a href={linkWhatsapp(whatsapp, `Olá! Tenho uma dúvida sobre o relatório de repasse de ${r.competencia} (${r.prestador}).`)}>
                    Fale com o financeiro pelo WhatsApp
                </a>
            </footer>
        </main>
    )
}
