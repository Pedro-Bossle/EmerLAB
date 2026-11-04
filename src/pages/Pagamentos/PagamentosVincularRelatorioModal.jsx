import { useEffect, useMemo, useRef, useState } from 'react'
import { formatarValorMonetarioBr } from '../../lib/pagamentosValor.js'
import { COLUNAS_RELATORIO, lerRelatorioXlsx, validarAbaRelatorio } from '../../lib/repasse/lerRelatorioExcel.js'
import { gerarModeloRelatorioXlsx } from '../../lib/repasse/modeloRelatorio.js'
import { criarRelatorios } from '../../lib/repasse/repasseApi.js'
import { normalizarTextoBusca } from '../../lib/prestadorCadastroHelpers.js'
import { Button, Modal } from '../../components/ui'

/**
 * Vínculo manual do relatório de UM registro: o financeiro anexa a planilha (mesmo formato do sistema principal),
 * o sistema confere as colunas e os totais e cria o relatório + link. Não altera o registro (valor, tipo, pix…).
 */
export default function PagamentosVincularRelatorioModal({ open, onClose, registro, relatorioAtual, onVinculado }) {
    const [arquivo, setArquivo] = useState(null)
    const [relatorio, setRelatorio] = useState(null)
    const [indiceAba, setIndiceAba] = useState(0)
    const [lendo, setLendo] = useState(false)
    const [salvando, setSalvando] = useState(false)
    const [erro, setErro] = useState('')
    const [arrastando, setArrastando] = useState(false)
    const inputRef = useRef(null)

    useEffect(() => {
        if (!open) return
        setArquivo(null)
        setRelatorio(null)
        setIndiceAba(0)
        setErro('')
    }, [open])

    const ler = async (f) => {
        if (!f) return
        setErro('')
        setRelatorio(null)
        setArquivo(f)
        setLendo(true)
        try {
            if (!/\.xlsx$/i.test(f.name)) throw new Error('Envie um arquivo .xlsx.')
            const r = await lerRelatorioXlsx(f)
            if (!r.abas.length) throw new Error('Nenhuma aba de prestador encontrada no arquivo. Confira o modelo.')
            setRelatorio(r)
            // com várias abas, escolhe a que tem o nome do prestador
            const alvo = normalizarTextoBusca(registro?.prestadorNome)
            const achada = r.abas.findIndex((a) => normalizarTextoBusca(a.nomeA1) === alvo)
            setIndiceAba(achada >= 0 ? achada : 0)
        } catch (e) {
            setRelatorio(null)
            setErro(e?.message || 'Não foi possível ler o arquivo.')
        } finally {
            setLendo(false)
        }
    }

    // Ctrl+V cola o .xlsx copiado do Explorer enquanto o modal está aberto
    useEffect(() => {
        if (!open) return undefined
        const aoColar = (e) => {
            const f = Array.from(e.clipboardData?.files || []).find((x) => /\.xlsx$/i.test(x.name))
            if (!f) return
            e.preventDefault()
            void ler(f)
        }
        document.addEventListener('paste', aoColar)
        return () => document.removeEventListener('paste', aoColar)
    }) // eslint-disable-line react-hooks/exhaustive-deps

    const aba = relatorio?.abas?.[indiceAba] || null
    const validacao = useMemo(() => (aba ? validarAbaRelatorio(aba, { valorRegistro: registro?.valor }) : null), [aba, registro?.valor])
    const podeVincular = Boolean(aba && validacao && validacao.erros.length === 0 && !salvando)

    const baixarModelo = async () => {
        try {
            const blob = await gerarModeloRelatorioXlsx(registro?.prestadorNome)
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'modelo-relatorio-repasse.xlsx'
            a.click()
            URL.revokeObjectURL(url)
        } catch {
            setErro('Não foi possível gerar o modelo.')
        }
    }

    const vincular = async () => {
        if (!podeVincular) return
        setSalvando(true)
        setErro('')
        try {
            const { itens } = await criarRelatorios([{ registro_id: registro.id, aba, arquivo: arquivo?.name || '', periodo: relatorio?.periodo || null }])
            const r = itens?.[0]
            if (!r?.ok) throw new Error(r?.error || 'Não foi possível vincular o relatório.')
            onVinculado?.(r)
            onClose()
        } catch (e) {
            setErro(e?.message || 'Não foi possível vincular o relatório.')
        } finally {
            setSalvando(false)
        }
    }

    if (!registro) return null
    const substituindo = Boolean(relatorioAtual)

    return (
        <Modal
            open={open}
            onClose={onClose}
            busy={salvando}
            size="lg"
            title={substituindo ? 'Substituir relatório' : 'Vincular relatório manualmente'}
            description={`${registro.prestadorNome || 'Prestador'} · ${String(registro.mes).padStart(2, '0')}/${registro.ano}`}
            footer={
                <>
                    <Button variant="secondary" disabled={salvando} onClick={onClose}>Cancelar</Button>
                    <Button disabled={!podeVincular} onClick={() => void vincular()}>{salvando ? 'Vinculando…' : substituindo ? 'Substituir relatório' : 'Vincular relatório'}</Button>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <section className="rounded-xl border border-line bg-surface-tint p-3 text-sm" aria-label="Como preparar a planilha">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <strong>Como preparar a planilha (.xlsx)</strong>
                        <Button variant="secondary" size="sm" onClick={() => void baixarModelo()}>Baixar modelo</Button>
                    </div>
                    <p className="mb-2">Uma linha de cabeçalho com estas colunas, <strong>nesta ordem</strong>:</p>
                    <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Colunas obrigatórias">
                        {COLUNAS_RELATORIO.map((c, i) => (
                            <span key={c} className="rounded-md border border-line bg-white px-2 py-0.5 text-xs font-bold">
                                {String.fromCharCode(65 + i)} · {c}
                            </span>
                        ))}
                    </div>
                    <ul className="list-disc space-y-1 pl-5 text-ink-soft">
                        <li><strong>A1</strong>: nome do prestador/clínica.</li>
                        <li>Opcional: uma linha com o <strong>nome do veterinário</strong> antes de cada cabeçalho (uma tabela por veterinário).</li>
                        <li>Atendimento com vários procedimentos: <strong>Atendimento, Tutor, Pet e Data só na primeira linha</strong>; nas seguintes deixe esses campos vazios (ou mesclados).</li>
                        <li>Valores com vírgula (25,00) ou números; data como dd/mm/aaaa.</li>
                        <li>Última linha, <strong>«Totais Prestador»</strong>, com o total de Repasse (coluna F) e de Diferença (coluna G). O sistema confere se a soma das linhas bate com ele e com o valor do registro ({formatarValorMonetarioBr(registro.valor) || 'sem valor'}).</li>
                    </ul>
                </section>

                <div
                    className={`comprovante_drop${arrastando ? ' is-over' : ''}${arquivo && relatorio ? ' has-file' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => inputRef.current?.click()}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), inputRef.current?.click())}
                    onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
                    onDragLeave={() => setArrastando(false)}
                    onDrop={(e) => { e.preventDefault(); setArrastando(false); void ler(e.dataTransfer.files?.[0]) }}
                >
                    {arquivo ? (
                        <>
                            <span className="comprovante_drop_nome">{arquivo.name}</span>
                            <span className="comprovante_drop_dica">{lendo ? 'Lendo…' : 'clique para trocar o arquivo'}</span>
                        </>
                    ) : (
                        <>
                            <span className="comprovante_drop_titulo">Escolher planilha .xlsx</span>
                            <span className="comprovante_drop_dica">ou arraste aqui · ou cole com <kbd>Ctrl</kbd> + <kbd>V</kbd></span>
                        </>
                    )}
                </div>
                <input ref={inputRef} type="file" accept=".xlsx" className="sr-only" tabIndex={-1} onChange={(e) => { void ler(e.target.files?.[0]); e.target.value = '' }} />

                {relatorio && relatorio.abas.length > 1 ? (
                    <label className="flex flex-col gap-1 text-sm font-semibold">
                        O arquivo tem {relatorio.abas.length} abas. Qual é a deste prestador?
                        <select className="min-h-touch rounded-xl border border-line px-2 font-medium" value={indiceAba} onChange={(e) => setIndiceAba(Number(e.target.value))}>
                            {relatorio.abas.map((a, i) => (
                                <option key={`${a.abaOriginal}-${i}`} value={i}>{a.nomeA1 || a.abaOriginal}</option>
                            ))}
                        </select>
                    </label>
                ) : null}

                {aba ? (
                    <section className="rounded-xl border border-line p-3 text-sm" aria-label="Conferência do arquivo">
                        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <div><dt className="text-xs font-semibold uppercase text-ink-muted">Atendimentos</dt><dd className="font-bold">{aba.atendimentos}</dd></div>
                            <div><dt className="text-xs font-semibold uppercase text-ink-muted">Veterinários</dt><dd className="font-bold">{aba.veterinarios}</dd></div>
                            <div><dt className="text-xs font-semibold uppercase text-ink-muted">Repasse</dt><dd className="font-bold tabular-nums">{formatarValorMonetarioBr(aba.totalAba ?? aba.somaLinhas)}</dd></div>
                            <div><dt className="text-xs font-semibold uppercase text-ink-muted">Diferença</dt><dd className="font-bold tabular-nums">{formatarValorMonetarioBr(aba.totalTutor)}</dd></div>
                        </dl>
                        {validacao?.erros.length === 0 && validacao?.avisos.length === 0 ? (
                            <p className="mt-2 rounded-lg bg-status-ok-bg px-3 py-2 font-semibold text-status-ok">Tudo confere: colunas, totais e valor do registro.</p>
                        ) : null}
                        {validacao?.erros.map((m) => (
                            <p key={m} className="mt-2 rounded-lg bg-status-erro-bg px-3 py-2 font-semibold text-status-erro" role="alert">{m}</p>
                        ))}
                        {validacao?.avisos.map((m) => (
                            <p key={m} className="mt-2 rounded-lg bg-status-warn-bg px-3 py-2 font-semibold text-status-warn">{m} O relatório será vinculado como «total não confere» e ficará fora do envio.</p>
                        ))}
                    </section>
                ) : null}

                {erro ? <p className="rounded-xl bg-status-erro-bg px-3 py-2 text-sm font-semibold text-status-erro" role="alert">{erro}</p> : null}
                {substituindo ? <p className="text-xs text-ink-soft">Já existe um relatório não enviado para este registro: ele será refeito com esta planilha (o link continua o mesmo).</p> : null}
            </div>
        </Modal>
    )
}
