import { useEffect, useRef, useState } from 'react'
import { ehTipoRpa, formatarValorMonetarioBr, valorLiquidoRpa } from '../../lib/pagamentosValor.js'
import { enviarComprovante, enviarComprovanteLote } from '../../lib/repasse/repasseApi.js'
import { validarArquivoRepasse } from '../../lib/repasse/repasseCore.js'
import { Button, Modal } from '../../components/ui'

const comp = (r) => `${String(r.mes).padStart(2, '0')}/${r.ano}`

const ROTULO_TIPO = { rpa: 'RPA', rpa_sd: 'RPA s/desc.', nota: 'Nota fiscal', boleto: 'Boleto' }

/** Tipo da chave PIX deduzido do texto cadastrado. */
function tipoDaChavePix(chave) {
    const c = String(chave || '').trim()
    if (!c) return ''
    if (c.includes('@')) return 'E-mail'
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)) return 'Chave aleatória'
    const d = c.replace(/\D/g, '')
    if (/[()+]/.test(c) || /^\d{2}\s?\d{4,5}-?\d{4}$/.test(c)) return 'Telefone'
    if (d.length === 14) return 'CNPJ'
    if (d.length === 11) return 'CPF ou telefone'
    return 'Outra'
}

/** Valor a pagar de um item: RPA já com o desconto de 11%. */
const valorAPagar = (item) => {
    const bruto = Number(item.relatorio?.total_repasse || 0)
    return ehTipoRpa(item.registro?.tipoRepasse) ? valorLiquidoRpa(bruto) ?? bruto : bruto
}

function BotaoCopiar({ texto, rotulo = 'Copiar' }) {
    const [ok, setOk] = useState(false)
    const copiar = async () => {
        try {
            await navigator.clipboard.writeText(texto)
        } catch {
            const t = document.createElement('textarea')
            t.value = texto
            document.body.appendChild(t)
            t.select()
            document.execCommand('copy')
            t.remove()
        }
        setOk(true)
        setTimeout(() => setOk(false), 1600)
    }
    return (
        <button type="button" className="comprovante_copiar" onClick={() => void copiar()} aria-live="polite">
            {ok ? 'Copiado ✓' : rotulo}
        </button>
    )
}

/**
 * itens = [{ registro, relatorio }]. Um item: comprovante de um mês. Vários (mesmo prestador): um comprovante
 * para todos os meses, um único e-mail ao prestador.
 */
export default function PagamentosComprovanteModal({ open, onClose, itens, onEnviado, aviso = '' }) {
    const lista = itens || []
    const somaBruta = lista.reduce((t, i) => t + Number(i.relatorio?.total_repasse || 0), 0)
    const somaRepasse = Math.round(lista.reduce((t, i) => t + valorAPagar(i), 0) * 100) / 100
    const temRpa = lista.some((i) => ehTipoRpa(i.registro?.tipoRepasse))
    const [arquivo, setArquivo] = useState(null)
    const [data, setData] = useState(() => new Date().toISOString().slice(0, 10))
    const [valor, setValor] = useState(somaRepasse.toFixed(2).replace('.', ','))
    const [enviando, setEnviando] = useState(false)
    const [erro, setErro] = useState('')
    const [arrastando, setArrastando] = useState(false)
    const inputRef = useRef(null)

    const aceitar = (f) => {
        if (!f) return
        setErro('')
        setArquivo(f)
    }

    // Ctrl+V: cola print/imagem ou arquivo copiado enquanto o modal está aberto.
    useEffect(() => {
        if (!open) return undefined
        const aoColar = (e) => {
            const f = Array.from(e.clipboardData?.files || [])[0]
            if (!f) return
            e.preventDefault()
            setErro('')
            setArquivo(f.name ? f : new File([f], `comprovante-colado.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type }))
        }
        document.addEventListener('paste', aoColar)
        return () => document.removeEventListener('paste', aoColar)
    }, [open])

    if (!lista.length) return null
    const registro = lista[0].registro
    const lote = lista.length > 1
    const tipo = String(registro.tipoRepasse || '').toLowerCase()
    const forma = tipo === 'boleto' ? 'boleto' : 'pix'
    const naoAprovados = lista.filter((i) => i.relatorio.status !== 'aprovado')

    const enviar = async () => {
        setErro('')
        const msg = arquivo ? validarArquivoRepasse({ nome: arquivo.name, tamanho: arquivo.size }) : 'Escolha o arquivo do comprovante.'
        if (msg) return setErro(msg)
        const v = Number(String(valor).replace(/\./g, '').replace(',', '.'))
        if (!Number.isFinite(v) || v <= 0) return setErro('Informe o valor pago.')
        setEnviando(true)
        try {
            if (lote) await enviarComprovanteLote(lista.map((i) => i.relatorio.id), arquivo, { data_pagamento: data, valor: v })
            else await enviarComprovante(lista[0].relatorio.id, arquivo, { data_pagamento: data, valor: v })
            onEnviado?.(lista.map((i) => i.registro.id))
            onClose()
        } catch (e) {
            setErro(e.message)
        } finally {
            setEnviando(false)
        }
    }

    const diferente = Math.round(Number(String(valor).replace(/\./g, '').replace(',', '.')) * 100) !== Math.round(somaRepasse * 100)

    return (
        <Modal
            open={open}
            onClose={onClose}
            busy={enviando}
            title={lote ? `Enviar comprovante de ${lista.length} meses` : 'Enviar comprovante'}
            description={`${registro.prestadorNome} · ${lista.map((i) => comp(i.relatorio)).join(', ')}`}
            footer={
                <>
                    <Button variant="secondary" disabled={enviando} onClick={onClose}>Cancelar</Button>
                    <Button disabled={enviando} onClick={() => void enviar()}>{enviando ? 'Enviando e avisando o prestador…' : 'Enviar comprovante e marcar pago'}</Button>
                </>
            }
        >
            <div className="flex flex-col gap-3">
                {naoAprovados.length ? (
                    <p className="rounded-xl bg-status-warn-bg px-3 py-2 text-sm font-semibold text-status-warn">
                        Atenção: {naoAprovados.length === 1 ? `o relatório de ${comp(naoAprovados[0].relatorio)} ainda não foi aprovado (${naoAprovados[0].relatorio.status.replace(/_/g, ' ')})` : `${naoAprovados.length} relatórios ainda não foram aprovados`}. Você pode enviar mesmo assim.
                    </p>
                ) : null}
                {aviso ? <p className="rounded-xl bg-surface-tint px-3 py-2 text-sm">{aviso}</p> : null}
                {lote ? (
                    <ul className="rounded-xl bg-surface-tint px-3 py-2 text-sm">
                        {lista.map((i) => (
                            <li key={i.relatorio.id} className="flex justify-between gap-3">
                                <span>{comp(i.relatorio)}</span>
                                <strong>{formatarValorMonetarioBr(valorAPagar(i))}</strong>
                            </li>
                        ))}
                        <li className="mt-1 flex justify-between gap-3 border-t border-line pt-1"><span>Total a pagar</span><strong>{formatarValorMonetarioBr(somaRepasse)}</strong></li>
                    </ul>
                ) : null}
                <div className="comprovante_info">
                    <div className="comprovante_info_linha">
                        <span className="comprovante_info_rot">Tipo</span>
                        <span className="comprovante_tag">{ROTULO_TIPO[tipo] || 'Não informado'}</span>
                        <span className="comprovante_info_rot">Forma</span>
                        <strong>{forma === 'pix' ? 'PIX' : 'Boleto'}</strong>
                    </div>
                    {forma === 'pix' ? (
                        <div className="comprovante_info_linha">
                            <span className="comprovante_info_rot">Chave{tipoDaChavePix(registro.chavePix) ? ` (${tipoDaChavePix(registro.chavePix)})` : ''}</span>
                            {registro.chavePix ? (
                                <>
                                    <strong className="break-all">{registro.chavePix}</strong>
                                    <BotaoCopiar texto={registro.chavePix} rotulo="Copiar chave" />
                                </>
                            ) : (
                                <strong>não cadastrada</strong>
                            )}
                        </div>
                    ) : (
                        <p className="text-sm">O boleto enviado pelo prestador está na Caixa de entrada.</p>
                    )}
                    <div className="comprovante_info_linha">
                        <span className="comprovante_info_rot">{temRpa ? 'A pagar (líquido −11%)' : 'A pagar'}</span>
                        <strong className="comprovante_info_valor">{formatarValorMonetarioBr(somaRepasse)}</strong>
                        <BotaoCopiar texto={somaRepasse.toFixed(2).replace('.', ',')} rotulo="Copiar valor" />
                        {temRpa ? <span className="comprovante_info_orig">original {formatarValorMonetarioBr(somaBruta)}</span> : null}
                    </div>
                </div>
                <div className="flex flex-col gap-1 text-sm font-semibold">
                    Comprovante
                    <div
                        className={`comprovante_drop${arrastando ? ' is-over' : ''}${arquivo ? ' has-file' : ''}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => inputRef.current?.click()}
                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), inputRef.current?.click())}
                        onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
                        onDragLeave={() => setArrastando(false)}
                        onDrop={(e) => { e.preventDefault(); setArrastando(false); aceitar(e.dataTransfer.files?.[0]) }}
                    >
                        {arquivo ? (
                            <>
                                <span className="comprovante_drop_nome">{arquivo.name}</span>
                                <span className="comprovante_drop_dica">{(arquivo.size / 1024).toFixed(0)} KB · clique para trocar</span>
                                <button type="button" className="comprovante_drop_remover" onClick={(e) => { e.stopPropagation(); setArquivo(null) }} aria-label="Remover arquivo">Remover</button>
                            </>
                        ) : (
                            <>
                                <span className="comprovante_drop_titulo">Escolher arquivo</span>
                                <span className="comprovante_drop_dica">ou arraste aqui · ou cole com <kbd>Ctrl</kbd> + <kbd>V</kbd> · PDF, PNG ou JPG até 10 MB</span>
                            </>
                        )}
                    </div>
                    <input ref={inputRef} type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => aceitar(e.target.files?.[0])} tabIndex={-1} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm font-semibold">Data do pagamento
                        <input type="date" className="min-h-touch rounded-xl border border-line px-2" value={data} onChange={(e) => setData(e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-semibold">Valor pago (R$)
                        <input className="min-h-touch rounded-xl border border-line px-2" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
                    </label>
                </div>
                {diferente ? <p className="text-xs font-semibold text-status-warn">O valor pago difere do repasse ({formatarValorMonetarioBr(somaRepasse)}). Confira antes de enviar.</p> : null}
                <p className="text-xs text-ink-soft">O prestador recebe {lote ? 'um único e-mail' : 'o e-mail'} «Pagamento realizado» com o comprovante anexado e {lote ? 'os registros são marcados como pagos' : 'o registro é marcado como pago'}.</p>
                {erro ? <p className="rounded-xl bg-status-erro-bg px-3 py-2 text-sm font-semibold text-status-erro" role="alert">{erro}</p> : null}
            </div>
        </Modal>
    )
}
