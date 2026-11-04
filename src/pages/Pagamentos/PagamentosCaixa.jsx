import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PERMISSION_KEYS, getStoredAccessProfile, hasPermission } from '../../lib/accessControl.js'
import { getReadOnlyFlag } from '../../lib/supabase.js'
import { DESCONTO_RPA, formatarValorMonetarioBr, valorLiquidoRpa } from '../../lib/pagamentosValor.js'
import {
    carregarCaixa,
    lerConfigRepasse,
    linkDoRelatorio,
    marcarTratado,
    revisarDocumento,
    salvarConfigRepasse,
    urlArquivo,
} from '../../lib/repasse/repasseApi.js'
import { DIAS_RETENCAO_DOCUMENTOS } from '../../lib/repasse/repasseCore.js'
import { Badge, Button, Card, EmptyState, Input, LoadingState, Modal, PageHeader } from '../../components/ui'

const dataBr = (iso) => {
    if (!iso) return '—'
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}
const comp = (r) => `${String(r.mes).padStart(2, '0')}/${r.ano}`
/** «há 3 dias» / «hoje» a partir de uma data ISO. */
const haQuanto = (iso) => {
    const t = new Date(iso).getTime()
    if (!Number.isFinite(t)) return ''
    const dias = Math.floor((Date.now() - t) / 86_400_000)
    if (dias <= 0) return 'hoje'
    return dias === 1 ? 'há 1 dia' : `há ${dias} dias`
}
const idadeDias = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) || 0

const ABAS = [
    { id: 'revisar', rotulo: 'Para revisar', dica: 'Notas fiscais e boletos enviados pelos prestadores' },
    { id: 'reprovados', rotulo: 'Reprovados', dica: 'Relatórios que o prestador não aprovou' },
    { id: 'devolvidos', rotulo: 'Devolvidos', dica: 'Documentos que você devolveu e aguardam o prestador' },
    { id: 'arquivadas', rotulo: 'Aprovadas', dica: `Notas e boletos aprovados, consultáveis por ${DIAS_RETENCAO_DOCUMENTOS} dias` },
    { id: 'rpa', rotulo: 'RPA aprovados', dica: `Prestadores RPA que aprovaram o relatório, nos últimos ${DIAS_RETENCAO_DOCUMENTOS} dias` },
]

function Secao({ titulo, descricao, children }) {
    return (
        <section className="mb-8" aria-label={titulo}>
            <h2 className="mb-1">{titulo}</h2>
            {descricao ? <p className="mb-3 text-sm text-ink-soft dark:text-[#9eb4c8]">{descricao}</p> : null}
            <div className="flex flex-col gap-3">{children}</div>
        </section>
    )
}

export default function PagamentosCaixa() {
    const perfil = getStoredAccessProfile()
    const podeEditar = hasPermission(perfil, PERMISSION_KEYS.PAGAMENTOS_EDIT) && !getReadOnlyFlag()
    const ehAdmin = hasPermission(perfil, PERMISSION_KEYS.ACCESS_MANAGE)

    const [dados, setDados] = useState(null)
    const [erro, setErro] = useState('')
    const [ocupado, setOcupado] = useState('')
    const [devolvendo, setDevolvendo] = useState(null)
    const [motivo, setMotivo] = useState('')
    const [aba, setAba] = useState('revisar')
    const [config, setConfig] = useState(null)
    const [msgConfig, setMsgConfig] = useState('')

    const carregar = useCallback(async () => {
        try {
            setErro('')
            setDados(await carregarCaixa())
        } catch (e) {
            setErro(e.message || 'Não foi possível carregar a Caixa de entrada.')
        }
    }, [])

    useEffect(() => {
        void carregar()
        if (ehAdmin) lerConfigRepasse().then(setConfig).catch(() => {})
    }, [carregar, ehAdmin])

    const rodar = async (chave, fn) => {
        setOcupado(chave)
        setErro('')
        try {
            await fn()
            await carregar()
        } catch (e) {
            setErro(e.message)
        } finally {
            setOcupado('')
        }
    }

    const abrirArquivo = (ids) =>
        rodar('arq', async () => {
            const { url } = await urlArquivo(ids)
            if (url) window.open(url, '_blank', 'noopener')
        })

    const abrirRelatorio = (relatorioId) =>
        rodar('rel', async () => {
            const { link } = await linkDoRelatorio(relatorioId)
            window.open(link, '_blank', 'noopener')
        })

    const salvarConfig = async (e) => {
        e.preventDefault()
        setMsgConfig('')
        try {
            await salvarConfigRepasse({
                email_reprovacoes: config.email_reprovacoes,
                whatsapp_financeiro: String(config.whatsapp_financeiro).replace(/\D/g, ''),
                validade_link_dias: Number(config.validade_link_dias),
                remetente_nome: config.remetente_nome,
                competencia_inicial: config.competencia_inicial,
            })
            setMsgConfig('Configurações salvas.')
        } catch (err) {
            setMsgConfig(err.message)
        }
    }

    const emRevisao = (dados?.docs || []).filter((d) => d.status === 'em_revisao')
    const devolvidos = (dados?.docs || []).filter((d) => d.status === 'devolvido')

    return (
        <div className="el-page">
            <PageHeader kicker="Pagamentos" title="Caixa de entrada" description="Tudo que depende do financeiro antes de pagar: documentos para revisar e relatórios reprovados." actions={<Link className="ek-btn ek-btn--secondary" to="/pagamentos/registro">Ir ao Registro</Link>} />

            {erro ? (
                <p className="mb-4 rounded-xl bg-status-erro-bg px-3 py-2 text-sm font-semibold text-status-erro" role="alert">
                    {erro}
                </p>
            ) : null}

            {!dados && !erro ? <LoadingState /> : null}

            {dados ? (
                <>
                    <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" role="tablist" aria-label="Filas da Caixa de entrada">
                        {ABAS.map((x) => {
                            const n = x.id === 'revisar' ? emRevisao.length : x.id === 'reprovados' ? dados.reprovados.length : x.id === 'arquivadas' ? dados.arquivadas.length : x.id === 'rpa' ? (dados.rpaAprovados || []).length : devolvidos.length
                            const ativa = aba === x.id
                            const urgente = (x.id === 'revisar' || x.id === 'reprovados') && n > 0
                            return (
                                <button
                                    key={x.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={ativa}
                                    onClick={() => setAba(x.id)}
                                    className={`flex flex-col gap-1 rounded-2xl border p-4 text-left transition ${ativa ? 'border-brand bg-brand-pale' : 'border-line bg-white hover:bg-surface-tint'}`}
                                >
                                    <span className="flex items-baseline justify-between gap-2">
                                        <span className="text-sm font-bold">{x.rotulo}</span>
                                        <span className={`text-2xl font-extrabold tabular-nums ${urgente ? 'text-status-warn' : 'text-ink-soft'}`}>{n}</span>
                                    </span>
                                    <span className="text-xs text-ink-soft">{x.dica}</span>
                                </button>
                            )
                        })}
                    </div>

                    {aba === 'revisar' ? (
                        <Secao titulo="Notas fiscais e boletos para revisar" descricao="Compare o valor do documento com o repasse antes de aprovar. Os mais antigos aparecem primeiro.">
                            {emRevisao.length === 0 ? <EmptyState title="Nada para revisar" description="Quando um prestador anexar NF ou boleto, aparece aqui." /> : null}
                            {emRevisao.map((d) => {
                                const rel = dados.rels.get(d.relatorio_id)
                                const reg = rel ? dados.regs.get(rel.registro_id) : null
                                const diferenca = Number(d.valor) - Number(rel?.total_repasse || 0)
                                const confere = rel && Math.round(diferenca * 100) === 0
                                const antigo = idadeDias(d.criado_em) >= 3
                                return (
                                    <Card key={d.id} className="flex flex-col gap-3">
                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="truncate text-base font-bold">{reg?.prestador_nome || rel?.nome_a1 || 'Prestador'}</p>
                                                <p className="text-sm text-ink-soft">
                                                    {d.tipo === 'boleto' ? `Boleto · vence ${dataBr(d.vencimento)}` : `NF ${d.numero || ''}`}
                                                    {rel ? ` · competência ${comp(rel)}` : ''}
                                                </p>
                                            </div>
                                            <div className="flex flex-col items-end gap-1">
                                                <Badge tone={confere ? 'ok' : 'warn'}>{confere ? 'Valores conferem' : `Diferença de ${formatarValorMonetarioBr(diferenca)}`}</Badge>
                                                <span className={`text-xs font-semibold ${antigo ? 'text-status-warn' : 'text-ink-soft'}`}>Recebido {haQuanto(d.criado_em)} · {dataBr(d.criado_em)}</span>
                                            </div>
                                        </div>
                                        <div className={`grid grid-cols-2 gap-px overflow-hidden rounded-xl border text-sm sm:max-w-md ${confere ? 'border-line' : 'border-status-warn'}`}>
                                            <div className="bg-surface-tint px-3 py-2"><p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Repasse</p><p className="text-base font-bold tabular-nums">{formatarValorMonetarioBr(rel?.total_repasse)}</p></div>
                                            <div className="bg-surface-tint px-3 py-2"><p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Documento</p><p className={`text-base font-bold tabular-nums ${confere ? '' : 'text-status-warn'}`}>{formatarValorMonetarioBr(d.valor)}</p></div>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <Button variant="secondary" size="sm" disabled={Boolean(ocupado)} onClick={() => void abrirArquivo({ documento_id: d.id })}>Ver documento</Button>
                                            <Button variant="secondary" size="sm" disabled={Boolean(ocupado)} onClick={() => void abrirRelatorio(d.relatorio_id)}>Relatório</Button>
                                            {podeEditar ? (
                                                <span className="ml-auto flex flex-wrap gap-2">
                                                    <Button variant="danger" size="sm" disabled={Boolean(ocupado)} onClick={() => { setMotivo(''); setDevolvendo(d) }}>Devolver</Button>
                                                    <Button size="sm" disabled={Boolean(ocupado)} onClick={() => void rodar('ap', () => revisarDocumento(d.id, 'aprovar'))}>Aprovar e marcar respondido</Button>
                                                </span>
                                            ) : null}
                                        </div>
                                    </Card>
                                )
                            })}
                        </Secao>
                    ) : null}

                    {aba === 'reprovados' ? (
                        <Secao titulo="Relatórios reprovados" descricao="A correção é manual: fale com o prestador, ajuste na tabela e marque como tratado.">
                            {dados.reprovados.length === 0 ? <EmptyState title="Nenhuma reprovação pendente" description="Quando um prestador reprovar um relatório, aparece aqui com a observação dele." /> : null}
                            {dados.reprovados.map((r) => {
                                const reg = dados.regs.get(r.registro_id)
                                const ev = dados.obs.get(r.id)
                                return (
                                    <Card key={r.id} className="flex flex-col gap-3">
                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="truncate text-base font-bold">{reg?.prestador_nome || r.nome_a1}</p>
                                                <p className="text-sm text-ink-soft">Competência {comp(r)} · repasse de {formatarValorMonetarioBr(r.total_repasse)}</p>
                                            </div>
                                            <div className="flex flex-col items-end gap-1">
                                                <Badge tone="erro">{ev?.dados?.canal === 'whatsapp' ? 'Via WhatsApp' : 'Via e-mail'}</Badge>
                                                <span className="text-xs font-semibold text-ink-soft">Reprovado {haQuanto(r.respondido_em)} · {dataBr(r.respondido_em)}</span>
                                            </div>
                                        </div>
                                        <blockquote className="rounded-xl border-l-4 border-status-erro bg-surface-tint px-3 py-2 text-sm">{ev?.dados?.obs || 'Sem observação registrada.'}</blockquote>
                                        <div className="flex flex-wrap gap-2">
                                            <Button variant="secondary" size="sm" disabled={Boolean(ocupado)} onClick={() => void abrirRelatorio(r.id)}>Relatório</Button>
                                            {podeEditar ? <Button size="sm" className="ml-auto" disabled={Boolean(ocupado)} onClick={() => void rodar('tr', () => marcarTratado(r.id))}>Marcar como tratado</Button> : null}
                                        </div>
                                    </Card>
                                )
                            })}
                        </Secao>
                    ) : null}

                    {aba === 'arquivadas' ? (
                        <Secao titulo="Notas fiscais e boletos aprovados" descricao={`Ficam disponíveis para consulta por ${DIAS_RETENCAO_DOCUMENTOS} dias, contados do recebimento. Depois disso o arquivo é excluído do EmerLAB.`}>
                            {dados.arquivadas.length === 0 ? <EmptyState title="Nenhum documento aprovado nos últimos dias" description="As notas e boletos aprovados aparecem aqui até o fim do prazo." /> : null}
                            {dados.arquivadas.map((d) => {
                                const rel = dados.rels.get(d.relatorio_id)
                                const reg = rel ? dados.regs.get(rel.registro_id) : null
                                const exclusao = new Date(new Date(d.criado_em).getTime() + DIAS_RETENCAO_DOCUMENTOS * 86_400_000)
                                const restam = Math.max(0, Math.ceil((exclusao.getTime() - Date.now()) / 86_400_000))
                                return (
                                    <Card key={d.id} className="flex flex-col gap-3">
                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="truncate text-base font-bold">{reg?.prestador_nome || rel?.nome_a1 || 'Prestador'}</p>
                                                <p className="text-sm text-ink-soft">
                                                    {d.tipo === 'boleto' ? `Boleto · vence ${dataBr(d.vencimento)}` : `NF ${d.numero || ''}`}
                                                    {rel ? ` · competência ${comp(rel)}` : ''} · {formatarValorMonetarioBr(d.valor)}
                                                </p>
                                                <p className="text-xs text-ink-soft">Recebido em {dataBr(d.criado_em)}{d.revisado_em ? ` · aprovado em ${dataBr(d.revisado_em)}` : ''}</p>
                                            </div>
                                            <Badge tone={restam <= 7 ? 'warn' : 'ok'}>{restam === 0 ? 'Excluída hoje' : `Excluída em ${restam} dia${restam === 1 ? '' : 's'} (${dataBr(exclusao.toISOString())})`}</Badge>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <Button variant="secondary" size="sm" disabled={Boolean(ocupado)} onClick={() => void abrirArquivo({ documento_id: d.id })}>Ver documento</Button>
                                            <Button variant="secondary" size="sm" disabled={Boolean(ocupado)} onClick={() => void abrirRelatorio(d.relatorio_id)}>Relatório</Button>
                                        </div>
                                    </Card>
                                )
                            })}
                        </Secao>
                    ) : null}

                    {aba === 'rpa' ? (
                        <Secao titulo="RPA aprovados" descricao="Prestadores RPA não anexam documento: a aprovação do relatório é a confirmação. Somente leitura; o pagamento segue pelo Registro (Aprovados a pagar).">
                            {(dados.rpaAprovados || []).length === 0 ? <EmptyState title="Nenhuma aprovação de RPA recente" description="Quando um prestador RPA aprovar o relatório, aparece aqui." /> : null}
                            {(dados.rpaAprovados || []).map((e) => {
                                const rel = dados.rels.get(e.relatorio_id)
                                const reg = rel ? dados.regs.get(rel.registro_id) : null
                                const liquido = valorLiquidoRpa(rel?.total_repasse)
                                return (
                                    <Card key={e.id} className="flex flex-col gap-3">
                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="truncate text-base font-bold">{reg?.prestador_nome || rel?.nome_a1 || 'Prestador'}</p>
                                                <p className="text-sm text-ink-soft">{rel ? `Competência ${comp(rel)}` : ''}</p>
                                            </div>
                                            <div className="flex flex-col items-end gap-1">
                                                <Badge tone="ok">Aprovou o relatório</Badge>
                                                <span className="text-xs font-semibold text-ink-soft">{haQuanto(e.criado_em)} · {dataBr(e.criado_em)}</span>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line text-sm sm:max-w-md">
                                            <div className="bg-surface-tint px-3 py-2"><p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Repasse</p><p className="text-base font-bold tabular-nums">{formatarValorMonetarioBr(rel?.total_repasse)}</p></div>
                                            <div className="bg-surface-tint px-3 py-2"><p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">A receber (−{Math.round(DESCONTO_RPA * 100)}%)</p><p className="text-base font-bold tabular-nums">{liquido == null ? '—' : formatarValorMonetarioBr(liquido)}</p></div>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <Button variant="secondary" size="sm" disabled={Boolean(ocupado)} onClick={() => void abrirRelatorio(e.relatorio_id)}>Relatório</Button>
                                        </div>
                                    </Card>
                                )
                            })}
                        </Secao>
                    ) : null}

                    {aba === 'devolvidos' ? (
                        <Secao titulo="Devolvidos, aguardando o prestador" descricao="Somente leitura: quando o prestador reenviar, o documento volta para «Para revisar».">
                            {devolvidos.length === 0 ? <EmptyState title="Nenhum documento devolvido" /> : null}
                            {devolvidos.map((d) => {
                                const rel = dados.rels.get(d.relatorio_id)
                                const reg = rel ? dados.regs.get(rel.registro_id) : null
                                return (
                                    <Card key={d.id} className="flex flex-col gap-1">
                                        <p className="text-base font-bold">{reg?.prestador_nome || rel?.nome_a1} {rel ? `· ${comp(rel)}` : ''}</p>
                                        <p className="text-sm text-ink-soft">{d.tipo === 'boleto' ? 'Boleto' : `NF ${d.numero || ''}`} devolvido(a) · {haQuanto(d.criado_em)}</p>
                                        <p className="rounded-lg bg-surface-tint px-3 py-2 text-sm">Motivo: {d.motivo_devolucao}</p>
                                    </Card>
                                )
                            })}
                        </Secao>
                    ) : null}
                </>
            ) : null}

            {ehAdmin && config ? (
                <Secao titulo="Configurações do repasse" descricao="Visível só para administradores.">
                    <Card>
                        <form className="grid gap-3 sm:grid-cols-2" onSubmit={salvarConfig}>
                            <Input label="E-mail que recebe reprovações" type="email" value={config.email_reprovacoes} onChange={(e) => setConfig({ ...config, email_reprovacoes: e.target.value })} required />
                            <Input label="WhatsApp do financeiro (com DDI)" value={config.whatsapp_financeiro} onChange={(e) => setConfig({ ...config, whatsapp_financeiro: e.target.value })} required />
                            <Input label="Validade do link (dias)" type="number" min={1} max={365} value={config.validade_link_dias} onChange={(e) => setConfig({ ...config, validade_link_dias: e.target.value })} required />
                            <Input label="Nome do remetente" value={config.remetente_nome} onChange={(e) => setConfig({ ...config, remetente_nome: e.target.value })} required />
                            <Input label="Competência inicial do novo modelo (AAAA-MM)" pattern="\d{4}-(0[1-9]|1[0-2])" value={config.competencia_inicial} onChange={(e) => setConfig({ ...config, competencia_inicial: e.target.value })} required hint="Competências anteriores continuam como estão (legado)." />
                            <div className="flex items-end gap-3">
                                <Button type="submit">Salvar configurações</Button>
                                {msgConfig ? <span className="text-sm font-semibold" role="status">{msgConfig}</span> : null}
                            </div>
                        </form>
                    </Card>
                </Secao>
            ) : null}

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
                            onClick={() =>
                                void rodar('dev', async () => {
                                    await revisarDocumento(devolvendo.id, 'devolver', motivo.trim())
                                    setDevolvendo(null)
                                })
                            }
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
        </div>
    )
}
