import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { formatarValorMonetarioBr } from '../../lib/pagamentosValor.js'
import { enviarLote, lerRelatorioCompleto, planejarEnvio } from '../../lib/repasse/repasseApi.js'
import {
    ASSUNTO_PADRAO,
    CORPO_PADRAO,
    TIPOS_REPASSE_ROTULO,
    aplicarVariaveis,
    distribuirHorarios,
    descontoRpaDoRepasse,
    instrucaoPorTipo,
    rotuloStatusRelatorio,
    periodoMesAnteriorLabel,
} from '../../lib/repasse/repasseCore.js'
import { normalizarTextoBusca } from '../../lib/prestadorCadastroHelpers.js'
import { Badge, Button, Modal } from '../../components/ui'
import { SelectDropdown } from '../../components/ui/Dropdown.jsx'

const FILTROS = [
    { id: 'pendentes', label: 'Ainda não enviados' },
    { id: 'reenvio', label: 'Reprovados / documento devolvido' },
    { id: 'todos', label: 'Todos' },
]
const PASSOS = ['Destinatários', 'Mensagem', 'Horário', 'Revisão']

const tipoDe = (r) => {
    const t = String(r || '').toLowerCase()
    return t === 'nota' || t === 'boleto' ? t : 'rpa'
}

/** registros = linhas do Registro já mapeadas; relatorios = Map(registroId → relatório). */
export default function PagamentosEnvioWizard({ open, onClose, registros, relatorios, onConcluido }) {
    const [passo, setPasso] = useState(0)
    const [filtro, setFiltro] = useState('pendentes')
    const [busca, setBusca] = useState('')
    const [selecionados, setSelecionados] = useState(() => new Set())
    const [emails, setEmails] = useState(new Map())
    const [assunto, setAssunto] = useState(ASSUNTO_PADRAO)
    const [corpo, setCorpo] = useState(CORPO_PADRAO)
    const [previaId, setPreviaId] = useState('')
    const [modo, setModo] = useState('agora')
    const [dia, setDia] = useState('')
    const [das, setDas] = useState('09:00')
    const [ate, setAte] = useState('17:00')
    const [ordem, setOrdem] = useState('aleatoria')
    const [enviando, setEnviando] = useState(false)
    const [progresso, setProgresso] = useState({ feitos: 0, total: 0 })
    const [resultado, setResultado] = useState(null)
    const [erro, setErro] = useState('')

    const candidatos = useMemo(
        () => registros.map((reg) => ({ reg, rel: relatorios.get(reg.id) })).filter((x) => x.rel),
        [registros, relatorios],
    )

    useEffect(() => {
        if (!open) return
        const ids = [...new Set(candidatos.map((c) => c.reg.prestadorId).filter(Boolean))]
        if (!ids.length) return
        let ativo = true
        supabase
            .from('prestadores')
            .select('id, email')
            .in('id', ids)
            .then(({ data }) => {
                if (ativo) setEmails(new Map((data || []).map((p) => [String(p.id), String(p.email || '').trim()])))
            })
        return () => {
            ativo = false
        }
    }, [open, candidatos])

    const motivoBloqueio = (c) => {
        if (c.rel.divergente) return 'Total não confere'
        if (c.rel.fluxo === 'laboratorio_manual') return 'Laboratório · manual'
        if (c.rel.token_revogado_em) return 'Link revogado'
        if (!emails.get(String(c.reg.prestadorId))) return 'Prestador sem e-mail no cadastro'
        return ''
    }

    const lista = useMemo(() => {
        const termo = normalizarTextoBusca(busca)
        return candidatos.filter((c) => {
            const st = c.rel.status
            if (filtro === 'pendentes' && st !== 'nao_enviado') return false
            if (filtro === 'reenvio' && !['reprovado', 'documento_devolvido', 'tratado'].includes(st)) return false
            if (termo && !normalizarTextoBusca(c.reg.prestadorNome).includes(termo)) return false
            return true
        })
    }, [candidatos, filtro, busca])

    const elegiveis = lista.filter((c) => !motivoBloqueio(c) && ['nao_enviado', 'reprovado', 'documento_devolvido', 'tratado'].includes(c.rel.status))
    const escolhidos = candidatos.filter((c) => selecionados.has(c.rel.id))
    const totalValor = escolhidos.reduce((s, c) => s + Number(c.rel.total_repasse), 0)
    const porTipo = escolhidos.reduce((m, c) => ({ ...m, [tipoDe(c.reg.tipoRepasse)]: (m[tipoDe(c.reg.tipoRepasse)] || 0) + 1 }), {})

    const alternar = (id) =>
        setSelecionados((atual) => {
            const n = new Set(atual)
            if (n.has(id)) n.delete(id)
            else n.add(id)
            return n
        })

    const janelaIso = useMemo(() => {
        if (modo !== 'periodo' || !dia) return null
        return { inicio: new Date(`${dia}T${das}`), fim: new Date(`${dia}T${ate}`) }
    }, [modo, dia, das, ate])

    const horariosPrevios = useMemo(() => {
        if (!janelaIso || !escolhidos.length) return []
        try {
            return distribuirHorarios({ n: escolhidos.length, inicio: janelaIso.inicio, fim: janelaIso.fim, ordem })
        } catch {
            return []
        }
    }, [janelaIso, escolhidos.length, ordem])

    const previa = escolhidos.find((c) => c.rel.id === previaId) || escolhidos[0]
    // A lista de relatórios não traz os atendimentos (JSON pesado): busca só o do relatório em prévia.
    const [atendPrevia, setAtendPrevia] = useState({})
    const previaRelId = previa?.rel.id
    useEffect(() => {
        if (!previaRelId || atendPrevia[previaRelId] != null) return undefined
        let ativo = true
        lerRelatorioCompleto(previaRelId)
            .then((r) => {
                const n = (r?.dados?.grupos || []).reduce((s, g) => s + (g.atendimentos || []).length, 0)
                if (ativo) setAtendPrevia((p) => ({ ...p, [previaRelId]: n }))
            })
            .catch(() => {})
        return () => {
            ativo = false
        }
    }, [previaRelId, atendPrevia])
    const varsPrevia = previa
        ? (() => {
              const valor = formatarValorMonetarioBr(previa.rel.total_repasse)
              return {
                  prestador: previa.reg.prestadorNome,
                  competencia: periodoMesAnteriorLabel(),
                  valor,
                  atendimentos: atendPrevia[previa.rel.id] ?? '…',
                  instrucao_tipo: instrucaoPorTipo(tipoDe(previa.reg.tipoRepasse), valor, {
                      descontoRpa: String(previa.reg.tipoRepasse || '').toLowerCase() === 'rpa',
                      valorBruto: previa.rel.total_repasse,
                  }),
              }
          })()
        : null

    const janelaValida = modo === 'agora' || (janelaIso && janelaIso.fim > janelaIso.inicio && horariosPrevios.length === escolhidos.length)
    const podeAvancar = [escolhidos.length > 0, assunto.trim() && corpo.trim(), Boolean(janelaValida), true][passo]

    const enviar = async () => {
        setErro('')
        setEnviando(true)
        setResultado(null)
        try {
            const { envio_id, plano } = await planejarEnvio({
                assunto,
                corpo,
                modo,
                janela_inicio: janelaIso?.inicio.toISOString(),
                janela_fim: janelaIso?.fim.toISOString(),
                ordem,
                relatorio_ids: escolhidos.map((c) => c.rel.id),
            })
            setProgresso({ feitos: 0, total: plano.length })
            const falhas = []
            let ok = 0
            for (let i = 0; i < plano.length; i += 10) {
                const lote = plano.slice(i, i + 10)
                const { resultados } = await enviarLote(envio_id, lote)
                for (const r of resultados) {
                    if (r.ok) ok += 1
                    else falhas.push(r)
                }
                setProgresso({ feitos: Math.min(i + 10, plano.length), total: plano.length })
            }
            setResultado({ ok, falhas })
            onConcluido?.()
        } catch (e) {
            setErro(e.message)
        } finally {
            setEnviando(false)
        }
    }

    const nomeDe = (id) => candidatos.find((c) => c.rel.id === id)?.reg.prestadorNome || id
    const fechar = () => {
        if (enviando) return
        setPasso(0)
        setSelecionados(new Set())
        setResultado(null)
        setErro('')
        onClose()
    }

    return (
        <Modal
            open={open}
            onClose={fechar}
            busy={enviando}
            size="xl"
            title="Enviar relatórios por e-mail"
            description={`Passo ${passo + 1} de 4 — ${PASSOS[passo]}`}
            footer={
                resultado ? (
                    <Button onClick={fechar}>Concluir</Button>
                ) : (
                    <>
                        <Button variant="secondary" disabled={enviando} onClick={() => (passo === 0 ? fechar() : setPasso(passo - 1))}>
                            {passo === 0 ? 'Cancelar' : 'Voltar'}
                        </Button>
                        {passo < 3 ? (
                            <Button disabled={!podeAvancar} onClick={() => setPasso(passo + 1)}>
                                Continuar
                            </Button>
                        ) : (
                            <Button disabled={enviando || !escolhidos.length} onClick={() => void enviar()}>
                                {enviando ? `Enviando ${progresso.feitos}/${progresso.total}…` : modo === 'periodo' ? `Agendar ${escolhidos.length} e-mails` : `Enviar ${escolhidos.length} e-mails`}
                            </Button>
                        )}
                    </>
                )
            }
        >
            {erro ? <p className="mb-3 rounded-xl bg-status-erro-bg px-3 py-2 text-sm font-semibold text-status-erro" role="alert">{erro}</p> : null}

            {resultado ? (
                <div className="flex flex-col gap-3">
                    <p className="rounded-xl bg-status-ok-bg px-3 py-2 font-semibold text-status-ok" role="status">
                        {resultado.ok} e-mail(s) {modo === 'periodo' ? 'agendado(s)' : 'enviado(s)'}.
                    </p>
                    {resultado.falhas.length > 0 && (
                        <div className="rounded-xl bg-status-erro-bg px-3 py-2 text-sm text-status-erro">
                            <p className="font-bold">{resultado.falhas.length} não saíram:</p>
                            <ul className="list-disc pl-5">
                                {resultado.falhas.map((f) => (
                                    <li key={f.relatorio_id}>{nomeDe(f.relatorio_id)} — {f.error}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            ) : null}

            {!resultado && passo === 0 && (
                <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                        {FILTROS.map((f) => (
                            <button key={f.id} type="button" className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${filtro === f.id ? 'border-brand bg-brand-pale text-brand-deep' : 'border-line'}`} onClick={() => setFiltro(f.id)}>
                                {f.label}
                            </button>
                        ))}
                        <input className="min-h-touch flex-1 rounded-xl border border-line px-3" placeholder="Buscar prestador…" aria-label="Buscar prestador" value={busca} onChange={(e) => setBusca(e.target.value)} />
                    </div>
                    <div className="flex items-center justify-between text-sm">
                        <span>{escolhidos.length} selecionado(s) · {formatarValorMonetarioBr(totalValor)}</span>
                        <span className="flex gap-3">
                            <button type="button" className="font-semibold text-brand underline" onClick={() => setSelecionados(new Set([...selecionados, ...elegiveis.map((c) => c.rel.id)]))}>Selecionar todos os elegíveis ({elegiveis.length})</button>
                            <button type="button" className="font-semibold underline" onClick={() => setSelecionados(new Set())}>Limpar</button>
                        </span>
                    </div>
                    {lista.length === 0 ? <p className="text-sm text-ink-soft">Nenhum relatório neste filtro. Crie os relatórios pela Inclusão em massa (com o .xlsx anexado) ou por «Vincular relatório».</p> : null}
                    <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
                        {lista.map((c) => {
                            const bloqueio = motivoBloqueio(c) || (['nao_enviado', 'reprovado', 'documento_devolvido', 'tratado'].includes(c.rel.status) ? '' : 'Já enviado')
                            return (
                                <li key={c.rel.id} className="flex items-center gap-3 px-3 py-2">
                                    <input type="checkbox" className="h-5 w-5" disabled={Boolean(bloqueio)} checked={selecionados.has(c.rel.id)} onChange={() => alternar(c.rel.id)} aria-label={`Selecionar ${c.reg.prestadorNome}`} />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate font-semibold">{c.reg.prestadorNome}</p>
                                        <p className="truncate text-xs text-ink-soft">{emails.get(String(c.reg.prestadorId)) || 'sem e-mail'} · {TIPOS_REPASSE_ROTULO[tipoDe(c.reg.tipoRepasse)]} · {formatarValorMonetarioBr(c.rel.total_repasse)}</p>
                                    </div>
                                    {bloqueio ? <Badge tone="erro">{bloqueio}</Badge> : <Badge tone="neutral">{rotuloStatusRelatorio(c.rel.status)}</Badge>}
                                </li>
                            )
                        })}
                    </ul>
                </div>
            )}

            {!resultado && passo === 1 && (
                <div className="grid gap-4 md:grid-cols-2">
                    <div className="flex flex-col gap-3">
                        <label className="flex flex-col gap-1 text-sm font-semibold">Assunto
                            <input className="min-h-touch rounded-xl border border-line px-3 font-medium" value={assunto} onChange={(e) => setAssunto(e.target.value)} />
                        </label>
                        <label className="flex flex-col gap-1 text-sm font-semibold">Mensagem
                            <textarea rows={10} className="rounded-xl border border-line p-3 font-medium" value={corpo} onChange={(e) => setCorpo(e.target.value)} />
                        </label>
                        <p className="text-xs text-ink-soft">Variáveis: {'{prestador} {competencia} {valor} {atendimentos} {instrucao_tipo}'}. O cartão de valores e os botões «Ver relatório e aprovar» e «Dúvidas? WhatsApp» entram sempre no fim e não podem ser removidos.</p>
                    </div>
                    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-tint p-3 text-sm">
                        <label className="flex flex-col gap-1 font-semibold">Pré-visualizar como
                            <SelectDropdown className="min-h-touch rounded-xl border border-line px-2" value={previa?.rel.id || ''} onChange={(e) => setPreviaId(e.target.value)}>
                                {escolhidos.map((c) => <option key={c.rel.id} value={c.rel.id}>{c.reg.prestadorNome}</option>)}
                            </SelectDropdown>
                        </label>
                        {varsPrevia ? (
                            <>
                                <p className="font-bold">{aplicarVariaveis(assunto, varsPrevia)}</p>
                                <p className="whitespace-pre-wrap">{aplicarVariaveis(corpo, varsPrevia)}</p>
                                <div className="flex flex-col gap-1 rounded-lg border border-line bg-white p-2">
                                    <p>Repasse Emerdog: <strong>{varsPrevia.valor}</strong></p>
                                    {String(previa.reg.tipoRepasse || '').toLowerCase() === 'rpa' ? (
                                        <>
                                            <p>Desconto de INSS ({descontoRpaDoRepasse(previa.rel.total_repasse).pct}%): <strong>− {formatarValorMonetarioBr(descontoRpaDoRepasse(previa.rel.total_repasse).desconto)}</strong></p>
                                            <p>Valor a receber: <strong>{formatarValorMonetarioBr(descontoRpaDoRepasse(previa.rel.total_repasse).liquido)}</strong></p>
                                        </>
                                    ) : null}
                                    <p>Atendimentos: <strong>{varsPrevia.atendimentos}</strong></p>
                                </div>
                                <p className="font-semibold text-brand">[Ver relatório e aprovar] [Dúvidas? WhatsApp]</p>
                            </>
                        ) : null}
                    </div>
                </div>
            )}

            {!resultado && passo === 2 && (
                <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap gap-2">
                        <button type="button" className={`rounded-full border px-4 py-2 font-semibold ${modo === 'agora' ? 'border-brand bg-brand-pale' : 'border-line'}`} onClick={() => setModo('agora')}>Enviar agora</button>
                        <button type="button" className={`rounded-full border px-4 py-2 font-semibold ${modo === 'periodo' ? 'border-brand bg-brand-pale' : 'border-line'}`} onClick={() => setModo('periodo')}>Distribuir em um período</button>
                    </div>
                    {modo === 'periodo' && (
                        <>
                            <div className="grid gap-3 sm:grid-cols-4">
                                <label className="flex flex-col gap-1 text-sm font-semibold">Dia<input type="date" className="min-h-touch rounded-xl border border-line px-2" value={dia} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDia(e.target.value)} /></label>
                                <label className="flex flex-col gap-1 text-sm font-semibold">Das<input type="time" className="min-h-touch rounded-xl border border-line px-2" value={das} onChange={(e) => setDas(e.target.value)} /></label>
                                <label className="flex flex-col gap-1 text-sm font-semibold">Até<input type="time" className="min-h-touch rounded-xl border border-line px-2" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
                                <label className="flex flex-col gap-1 text-sm font-semibold">Horários
                                    <SelectDropdown className="min-h-touch rounded-xl border border-line px-2" value={ordem} onChange={(e) => setOrdem(e.target.value)}>
                                        <option value="aleatoria">Aleatórios</option>
                                        <option value="iguais">Intervalos iguais</option>
                                    </SelectDropdown>
                                </label>
                            </div>
                            {dia && horariosPrevios.length === 0 && escolhidos.length > 0 ? (
                                <p className="rounded-xl bg-status-warn-bg px-3 py-2 text-sm font-semibold text-status-warn">Janela inválida ou curta demais (mínimo de 20 s entre e-mails).</p>
                            ) : null}
                            {horariosPrevios.length > 0 && (
                                <p className="text-sm text-ink-soft">
                                    {horariosPrevios.length} e-mails entre {horariosPrevios[0].toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} e {horariosPrevios[horariosPrevios.length - 1].toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. O horário de cada destinatário é sorteado no envio.
                                </p>
                            )}
                        </>
                    )}
                </div>
            )}

            {!resultado && passo === 3 && (
                <div className="flex flex-col gap-2">
                    <p><strong>{escolhidos.length}</strong> destinatário(s): {Object.entries(porTipo).map(([t, n]) => `${n} ${TIPOS_REPASSE_ROTULO[t]}`).join(' · ')}</p>
                    <p>Total em repasses: <strong>{formatarValorMonetarioBr(totalValor)}</strong></p>
                    <p>{modo === 'agora' ? 'Envio imediato.' : `Janela: ${dia.split('-').reverse().join('/')} das ${das} às ${ate} (${ordem === 'iguais' ? 'intervalos iguais' : 'horários aleatórios'}).`}</p>
                    <p className="rounded-xl bg-status-warn-bg px-3 py-2 text-sm font-semibold text-status-warn">Os e-mails saem para os prestadores reais. Confira a mensagem antes de confirmar.</p>
                    {enviando && <progress className="w-full" max={progresso.total || 1} value={progresso.feitos} aria-label="Progresso do envio" />}
                </div>
            )}
        </Modal>
    )
}
