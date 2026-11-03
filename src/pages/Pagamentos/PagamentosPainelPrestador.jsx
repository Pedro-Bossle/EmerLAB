import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ehTipoRpa, formatarValorMonetarioBr, valorLiquidoRpa } from '../../lib/pagamentosValor.js'
import { atualizarPagamentoRegistro, mapRowPagamento } from '../../lib/pagamentosRegistros.js'
import {
    linkDoRelatorio,
    listarDocumentosEmRevisao,
    listarRegistrosDoPrestador,
    listarRelatoriosPorRegistros,
    revisarDocumento,
    urlArquivo,
} from '../../lib/repasse/repasseApi.js'
import { ehCompetenciaNovoModelo, rotuloStatusRelatorio } from '../../lib/repasse/repasseCore.js'
import { Button, Modal } from '../../components/ui'
import PagamentosComprovanteModal from './PagamentosComprovanteModal.jsx'

const comp = (r) => `${String(r.mes).padStart(2, '0')}/${String(r.ano).slice(2)}`
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const mesExtenso = (r) => `${MESES[(Number(r.mes) || 1) - 1]} de ${r.ano}`
const ROTULO_TIPO = { rpa: 'RPA', rpa_sd: 'RPA s/desc.', nota: 'Nota fiscal', boleto: 'Boleto' }
/** Valor que o prestador recebe: RPA com o desconto de 11%. */
const aReceber = (reg, bruto) => (ehTipoRpa(reg.tipoRepasse) ? valorLiquidoRpa(bruto) ?? Number(bruto || 0) : Number(bruto || 0))

/**
 * Painel lateral do prestador: todos os meses dele num lugar só, com aprovação de NF/boleto e
 * um comprovante único para vários meses. Abre a partir do Registro.
 */
export default function PagamentosPainelPrestador({ prestadorId, prestadorNome, competenciaInicial, podeEditar, onClose, onMudou }) {
    const [regs, setRegs] = useState([])
    const [rels, setRels] = useState(new Map())
    const [docs, setDocs] = useState(new Map())
    const [carregando, setCarregando] = useState(true)
    const [erro, setErro] = useState('')
    const [ocupado, setOcupado] = useState('')
    const [mostrarPagos, setMostrarPagos] = useState(false)
    const [sel, setSel] = useState(() => new Set())
    const [pagando, setPagando] = useState(null)
    const [confirmaManual, setConfirmaManual] = useState(null)
    const [devolvendo, setDevolvendo] = useState(null)
    const [motivo, setMotivo] = useState('')

    const carregar = useCallback(async () => {
        try {
            setErro('')
            const lista = (await listarRegistrosDoPrestador(prestadorId)).map(mapRowPagamento)
            const mapa = await listarRelatoriosPorRegistros(lista.map((r) => r.id))
            const dm = await listarDocumentosEmRevisao([...mapa.values()].map((r) => r.id))
            setRegs(lista)
            setRels(mapa)
            setDocs(dm)
            // Pré-seleciona o que já está aprovado e sem comprovante.
            setSel(new Set(lista.filter((r) => mapa.get(r.id)?.status === 'aprovado' && !mapa.get(r.id)?.comprovante && !mapa.get(r.id)?.divergente && !r.pago).map((r) => r.id)))
        } catch (e) {
            setErro(e.message || 'Não foi possível carregar os meses do prestador.')
        } finally {
            setCarregando(false)
        }
    }, [prestadorId])

    useEffect(() => {
        void carregar()
    }, [carregar])

    useEffect(() => {
        const aoTecla = (e) => e.key === 'Escape' && !pagando && !devolvendo && onClose()
        document.addEventListener('keydown', aoTecla)
        return () => document.removeEventListener('keydown', aoTecla)
    }, [onClose, pagando, devolvendo])

    const novoModelo = (r) => ehCompetenciaNovoModelo(r.mes, r.ano, competenciaInicial || '2026-10')
    const pagavel = (r) => {
        const rel = rels.get(r.id)
        return Boolean(rel && !rel.divergente && !rel.comprovante)
    }
    /** Sem relatório (legado ou ainda não vinculado): paga-se à mão, sem comprovante nem e-mail. */
    const manualPagavel = (r) => !r.pago && (!novoModelo(r) || !rels.get(r.id))

    const resumo = useMemo(() => {
        let aberto = 0
        let aprovado = 0
        let aguardando = 0
        for (const r of regs) {
            if (r.pago) continue
            const v = aReceber(r, r.valor)
            aberto += v
            const rel = rels.get(r.id)
            if (rel?.status === 'aprovado') aprovado += v
            else aguardando += v
        }
        return { aberto, aprovado, aguardando }
    }, [regs, rels])

    const rodar = async (chave, fn) => {
        setOcupado(chave)
        setErro('')
        try {
            await fn()
            await carregar()
            onMudou?.()
        } catch (e) {
            setErro(e.message)
        } finally {
            setOcupado('')
        }
    }

    const abrirRelatorio = (rel) =>
        rodar(`rel-${rel.id}`, async () => {
            const { link } = await linkDoRelatorio(rel.id)
            window.open(link, '_blank', 'noopener')
        })
    const abrirDocumento = (d) =>
        rodar(`doc-${d.id}`, async () => {
            const { url } = await urlArquivo({ documento_id: d.id })
            if (url) window.open(url, '_blank', 'noopener')
        })

    const itensSelecionados = regs.filter((r) => sel.has(r.id) && pagavel(r)).map((r) => ({ registro: r, relatorio: rels.get(r.id) }))
    const legadosSelecionados = regs.filter((r) => sel.has(r.id) && manualPagavel(r))
    const totalSel =
        itensSelecionados.reduce((t, i) => t + aReceber(i.registro, i.relatorio.total_repasse), 0) +
        legadosSelecionados.reduce((t, r) => t + aReceber(r, r.valor), 0)
    const qtdSel = itensSelecionados.length + legadosSelecionados.length

    const marcarPagosManual = (lista) =>
        rodar('manual', async () => {
            for (const r of lista) await atualizarPagamentoRegistro(r.id, { ...r, pago: true })
            setConfirmaManual(null)
        })

    const aoPagar = () => {
        if (itensSelecionados.length) setPagando({ itens: itensSelecionados, legados: legadosSelecionados })
        else setConfirmaManual(legadosSelecionados)
    }

    const selecionaveis = regs.filter((r) => !r.pago && (pagavel(r) || manualPagavel(r)))
    const todosMarcados = selecionaveis.length > 0 && selecionaveis.every((r) => sel.has(r.id))
    const alternarTodos = () => setSel(todosMarcados ? new Set() : new Set(selecionaveis.map((r) => r.id)))
    const abertos = regs.filter((r) => !r.pago)
    const pagos = regs.filter((r) => r.pago).reverse()
    const ref = [...regs].reverse().find((r) => r.chavePix || r.tipoRepasse) || regs[0]
    const [copiado, setCopiado] = useState(false)
    const copiarPix = async () => {
        try {
            await navigator.clipboard.writeText(ref.chavePix)
            setCopiado(true)
            setTimeout(() => setCopiado(false), 1600)
        } catch {
            setErro('Não foi possível copiar a chave.')
        }
    }

    const alternar = (id) =>
        setSel((prev) => {
            const n = new Set(prev)
            if (n.has(id)) n.delete(id)
            else n.add(id)
            return n
        })

    return createPortal(
        <>
            <div className="pag_painel_fundo" onClick={onClose} aria-hidden="true" />
            <aside className="pag_painel" role="dialog" aria-label={`Meses de ${prestadorNome}`}>
                <header className="pag_painel_head">
                    <div className="pag_painel_titulo">
                        <h3>{prestadorNome || 'Prestador'}</h3>
                        <p>{regs.length} registro(s) · {abertos.length} em aberto</p>
                    </div>
                    <button type="button" className="pag_reg_btn_mais" onClick={onClose} aria-label="Fechar painel">×</button>
                    {ref && (ref.tipoRepasse || ref.chavePix) ? (
                        <div className="pag_painel_pagto">
                            {ref.tipoRepasse ? <span className="comprovante_tag">{ROTULO_TIPO[String(ref.tipoRepasse).toLowerCase()] || ref.tipoRepasse}</span> : null}
                            {ref.chavePix ? (
                                <>
                                    <span className="pag_painel_pix" title={ref.chavePix}>{ref.chavePix}</span>
                                    <button type="button" className="comprovante_copiar" onClick={() => void copiarPix()} aria-live="polite">{copiado ? 'Copiado ✓' : 'Copiar chave'}</button>
                                </>
                            ) : null}
                        </div>
                    ) : null}
                    <dl className="pag_painel_kpi">
                        <div><dt>Em aberto</dt><dd>{formatarValorMonetarioBr(resumo.aberto)}</dd></div>
                        <div><dt>Aprovado</dt><dd className="is-ok">{formatarValorMonetarioBr(resumo.aprovado)}</dd></div>
                        <div><dt>Aguardando</dt><dd className="is-warn">{formatarValorMonetarioBr(resumo.aguardando)}</dd></div>
                    </dl>
                </header>

                {erro ? <p className="pag_painel_erro" role="alert">{erro}</p> : null}
                {carregando ? <p className="pag_painel_vazio">A carregar…</p> : null}

                <div className="pag_painel_meses">
                    {!carregando && abertos.length > 0 ? (
                        <div className="pag_painel_secao">
                            <span>Em aberto · {abertos.length}</span>
                            {podeEditar && selecionaveis.length > 1 ? (
                                <label className="pag_painel_todos">
                                    <input type="checkbox" checked={todosMarcados} onChange={alternarTodos} />
                                    Selecionar todos
                                </label>
                            ) : null}
                        </div>
                    ) : null}
                    {!carregando && abertos.length === 0 ? <p className="pag_painel_vazio">Nenhum mês em aberto.</p> : null}

                    {abertos.map((r) => {
                        const rel = rels.get(r.id)
                        const doc = rel ? docs.get(rel.id) : null
                        const selecionavel = podeEditar && (pagavel(r) || manualPagavel(r))
                        const marcado = sel.has(r.id)
                        const rpa = ehTipoRpa(r.tipoRepasse) && valorLiquidoRpa(r.valor) != null
                        const estado = rel?.divergente ? 'bad' : ''
                        return (
                            <section key={r.id} className={`pag_painel_mes ${estado}${marcado ? ' is-sel' : ''}`}>
                                <label className={`pag_painel_linha${selecionavel ? ' is-clicavel' : ''}`}>
                                    {selecionavel ? (
                                        <input type="checkbox" className="pag_painel_chk" checked={marcado} onChange={() => alternar(r.id)} aria-label={`Incluir ${mesExtenso(r)} no pagamento`} />
                                    ) : (
                                        <span className="pag_painel_chk_vazio" aria-hidden="true" />
                                    )}
                                    <span className="pag_painel_info">
                                        <strong className="pag_painel_mes_nome">{mesExtenso(r)}</strong>
                                        <span className="pag_painel_l2">
                                            {!novoModelo(r) ? <span className="pag_reg_rel">Legado · pago à mão</span> : !rel ? <span className="pag_reg_rel">Sem relatório</span> : rel.divergente ? <span className="pag_reg_rel pag_reg_rel--erro">Total não confere</span> : (
                                                <span className={`pag_reg_rel pag_reg_rel--${rel.status}`}>{rotuloStatusRelatorio(rel.status)}</span>
                                            )}
                                            <span
                                                className={`pag_reg_rel pag_painel_resp ${r.resposta ? 'is-sim' : 'is-nao'}`}
                                                title={r.resposta ? 'O prestador respondeu a este relatório' : 'Ainda sem resposta do prestador'}
                                            >
                                                {r.resposta ? '✓ Respondido' : '○ Sem resposta'}
                                                {r.resposta && rel?.respondido_em ? ` · ${new Date(rel.respondido_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}` : ''}
                                            </span>
                                        </span>
                                    </span>
                                    <span className="pag_painel_valor">
                                        {formatarValorMonetarioBr(aReceber(r, r.valor))}
                                        {rpa ? <small className="pag_painel_orig">original {formatarValorMonetarioBr(r.valor)}</small> : null}
                                    </span>
                                </label>
                                {doc ? (
                                    <p className="pag_painel_doc">
                                        {doc.tipo === 'boleto' ? 'Boleto' : `NF ${doc.numero || ''}`} de {formatarValorMonetarioBr(doc.valor)} aguardando revisão
                                        {Math.round(Number(doc.valor) * 100) !== Math.round(Number(rel.total_repasse) * 100) ? ' (diferente do repasse)' : ''}
                                    </p>
                                ) : null}
                                {(rel && !rel.divergente) || doc ? (
                                    <div className="pag_painel_acoes">
                                        {rel && !rel.divergente ? <button type="button" className="pag_reg_btn pag_reg_btn--sec pag_reg_btn--mini" disabled={Boolean(ocupado)} onClick={() => void abrirRelatorio(rel)}>Relatório</button> : null}
                                        {doc ? <button type="button" className="pag_reg_btn pag_reg_btn--sec pag_reg_btn--mini" disabled={Boolean(ocupado)} onClick={() => void abrirDocumento(doc)}>Ver documento</button> : null}
                                        {doc && podeEditar ? (
                                            <>
                                                <button type="button" className="pag_reg_btn pag_reg_btn--mini pag_painel_aprovar" disabled={Boolean(ocupado)} onClick={() => void rodar('ap', () => revisarDocumento(doc.id, 'aprovar'))}>Aprovar</button>
                                                <button type="button" className="pag_reg_btn pag_reg_btn--sec pag_reg_btn--mini" disabled={Boolean(ocupado)} onClick={() => { setMotivo(''); setDevolvendo(doc) }}>Devolver</button>
                                            </>
                                        ) : null}
                                    </div>
                                ) : null}
                            </section>
                        )
                    })}

                    {pagos.length > 0 ? (
                        <>
                            <button type="button" className="pag_painel_secao pag_painel_secao--btn" aria-expanded={mostrarPagos} onClick={() => setMostrarPagos((v) => !v)}>
                                <span>Já pagos · {pagos.length}</span>
                                <span aria-hidden="true">{mostrarPagos ? '▴' : '▾'}</span>
                            </button>
                            {mostrarPagos
                                ? pagos.map((r) => {
                                      const rel = rels.get(r.id)
                                      return (
                                          <div key={r.id} className="pag_painel_pago">
                                              <span>{mesExtenso(r)}</span>
                                              <span className="pag_reg_rel pag_reg_rel--aprovado">{rel?.comprovante ? 'Comprovante' : 'Pago'}</span>
                                              <strong>{formatarValorMonetarioBr(aReceber(r, r.valor))}</strong>
                                          </div>
                                      )
                                  })
                                : null}
                        </>
                    ) : null}
                </div>

                {podeEditar ? (
                    <footer className="pag_painel_rodape">
                        {qtdSel > 0 ? (
                            <p className="pag_painel_dica">
                                {itensSelecionados.length > 0 ? `${itensSelecionados.length} com relatório: um comprovante e um e-mail.` : ''}
                                {itensSelecionados.length > 0 && legadosSelecionados.length > 0 ? ' ' : ''}
                                {legadosSelecionados.length > 0 ? `${legadosSelecionados.length} sem relatório: marcado(s) como pago(s), sem comprovante.` : ''}
                            </p>
                        ) : null}
                        <div className="pag_painel_total">
                            <span>{qtdSel === 0 ? 'Nenhum mês selecionado' : `${qtdSel} ${qtdSel === 1 ? 'mês selecionado' : 'meses selecionados'}`}</span>
                            <strong>{formatarValorMonetarioBr(totalSel)}</strong>
                        </div>
                        <button type="button" className="pag_reg_btn pag_reg_btn--pri" disabled={qtdSel === 0 || Boolean(ocupado)} onClick={aoPagar}>
                            {qtdSel === 0 ? 'Selecione os meses para pagar' : `Pagar ${qtdSel === 1 ? 'mês' : `${qtdSel} meses`}`}
                        </button>
                    </footer>
                ) : null}
            </aside>

            {pagando ? (
                <PagamentosComprovanteModal
                    open
                    key={pagando.itens.map((i) => i.registro.id).join(',')}
                    itens={pagando.itens}
                    aviso={pagando.legados.length ? `Depois do envio, ${pagando.legados.length} mês(es) legado/sem relatório (${pagando.legados.map(comp).join(', ')}, ${formatarValorMonetarioBr(pagando.legados.reduce((t, r) => t + Number(r.valor || 0), 0))}) também serão marcados como pagos, sem comprovante. O valor acima considera só os meses com relatório.` : ''}
                    onClose={() => setPagando(null)}
                    onEnviado={() => void rodar('pg', async () => { for (const r of pagando.legados) await atualizarPagamentoRegistro(r.id, { ...r, pago: true }) })}
                />
            ) : null}

            <Modal
                open={Boolean(confirmaManual)}
                onClose={() => setConfirmaManual(null)}
                busy={Boolean(ocupado)}
                title="Marcar meses como pagos"
                description="Meses legado ou sem relatório vinculado não têm comprovante nem e-mail pelo sistema."
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setConfirmaManual(null)}>Cancelar</Button>
                        <Button disabled={Boolean(ocupado)} onClick={() => void marcarPagosManual(confirmaManual)}>Marcar como pagos</Button>
                    </>
                }
            >
                <ul className="rounded-xl bg-surface-tint px-3 py-2 text-sm">
                    {(confirmaManual || []).map((r) => (
                        <li key={r.id} className="flex justify-between gap-3"><span>{comp(r)}</span><strong>{formatarValorMonetarioBr(r.valor)}</strong></li>
                    ))}
                </ul>
            </Modal>

            <Modal
                open={Boolean(devolvendo)}
                onClose={() => setDevolvendo(null)}
                title="Devolver documento"
                description="O motivo aparece para o prestador na página do relatório e no e-mail."
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setDevolvendo(null)}>Cancelar</Button>
                        <Button
                            variant="dangerSolid"
                            disabled={motivo.trim().length < 5 || Boolean(ocupado)}
                            onClick={() => void rodar('dev', async () => { await revisarDocumento(devolvendo.id, 'devolver', motivo.trim()); setDevolvendo(null) })}
                        >
                            Devolver ao prestador
                        </Button>
                    </>
                }
            >
                <label className="flex flex-col gap-1.5 text-sm font-semibold">
                    Motivo (obrigatório)
                    <textarea rows={4} className="rounded-xl border border-line p-3 text-base font-medium" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={1000} />
                </label>
            </Modal>
        </>,
        document.body,
    )
}
