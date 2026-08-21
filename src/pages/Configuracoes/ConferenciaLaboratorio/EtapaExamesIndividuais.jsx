import React, { useEffect, useMemo, useRef, useState } from 'react'
import { normalizarTextoBusca } from '../../../lib/prestadorCadastroHelpers.js'
import { pontuarPareamentoExamesIndividuais } from '../../../lib/configuracoes/conferenciaLaboratorio.js'
import {
    formatarDataConferencia,
    formatarValorConferencia,
} from '../../../lib/configuracoes/conferenciaLaboratorioPrecos.js'

const POR_PAGINA = 15

function IconeTrocarRegistro({ className = '' }) {
    return (
        <svg
            className={className}
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
        >
            <path d="M16 3h5v5" />
            <path d="M8 21H3v-5" />
            <path d="M21 3l-7 7" />
            <path d="M3 21l7-7" />
        </svg>
    )
}

function BandeiraPosRelatorio({ marcado, onToggle }) {
    return (
        <button
            type="button"
            className={`conf_lab_bandeira${marcado ? ' is-on' : ''}`}
            title={marcado ? 'Remover do pós-relatório' : 'Marcar para pós-relatório'}
            aria-label={marcado ? 'Remover do pós-relatório' : 'Marcar para pós-relatório'}
            aria-pressed={marcado}
            onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onToggle?.()
            }}
        >
            <svg viewBox="0 0 24 24" aria-hidden>
                <path
                    d="M6 3v18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                />
                <path
                    d="M6 4.5h9.5l-1.8 3.2 1.8 3.3H6V4.5z"
                    fill={marcado ? 'currentColor' : 'none'}
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinejoin="round"
                />
            </svg>
        </button>
    )
}

/** Chave estável para flag (prioriza par lab|plano quando já há escolha). */
function chaveFlagItemExame(item, idEmEscolhido) {
    const idLab = item?.idLabLocal || null
    const idEm =
        idEmEscolhido ||
        item?.idEmerdogLocal ||
        (item?.tipo === 'orfao_lab' ? item?.idEmSugerido : '') ||
        null
    if (idLab && idEm) return `par:${idLab}|${idEm}`
    if (idLab) return `lab:${idLab}`
    if (idEm) return `em:${idEm}`
    return item?.idItem || ''
}

function rotuloOpcaoCandidatoPlano(c) {
    const card = c?.card || {}
    const tutor = String(card.tutor || '—').trim()
    const pet = String(card.pet || '—').trim()
    const data = formatarDataConferencia(card.data) || '—'
    const cod = String(card.codigo || '').trim()
    const exame = String(card.exameEmerdog || '').trim()
    const valor = formatarValorConferencia(card.valorEmerdog)
    const exameLinha = cod ? `${cod} - ${exame}` : exame || '—'
    return `${tutor} - ${pet} · ${data} · ${exameLinha} · ${valor}`
}

function textoExameLinha(codigo, nome) {
    const cod = String(codigo || '').trim()
    const exame = String(nome || '—').trim()
    return cod ? `${cod} — ${exame}` : exame
}

/**
 * Verde: exame/código idêntico e valor ok
 * Amarelo: exame/código não idêntico (ou sem par)
 * Vermelho: exame/código idêntico, mas valor diverge
 */
function classificarDestaqueExame({
    temPar,
    codigoLab,
    exameLab,
    valorLab,
    codigoEm,
    exameEm,
    valorEm,
    forcarDiff = false,
}) {
    if (forcarDiff) return 'is-diff'
    if (!temPar) return 'is-sem-par'

    const codL = String(codigoLab || '').trim().toUpperCase()
    const codE = String(codigoEm || '').trim().toUpperCase()
    const nomeL = normalizarTextoBusca(exameLab)
    const nomeE = normalizarTextoBusca(exameEm)
    const codigoIdentico = Boolean(codL && codE && codL === codE)
    const nomeIdentico = Boolean(nomeL && nomeE && nomeL === nomeE)
    if (!codigoIdentico && !nomeIdentico) return 'is-sem-par'

    const vL = Number(valorLab)
    const vE = Number(valorEm)
    if (
        Number.isFinite(vL) &&
        Number.isFinite(vE) &&
        Math.abs(vL - vE) > 0.009
    ) {
        return 'is-diff'
    }
    return 'is-match'
}

/** Verde = OK/idêntico · Amarelo = parecido · Vermelho = diferente */
function tomBadgeMotivo(texto) {
    const t = normalizarTextoBusca(texto)
    if (!t) return 'is-warn'
    if (
        /difer|diverg|diff valor|valores diverg|sem sugest|sem lab|sem par|nao correspond/.test(
            t,
        )
    ) {
        return 'is-bad'
    }
    if (/identic|mesma data|aceito|ok\b|conferido/.test(t)) return 'is-ok'
    if (/parec|proxim|parcial/.test(t)) return 'is-warn'
    return 'is-warn'
}

/**
 * Tooltip só quando a badge não é OK — explica o que diverge entre lab e plano.
 */
function tooltipBadgeMotivo(motivo, ctx = {}) {
    const tom = tomBadgeMotivo(motivo)
    if (tom === 'is-ok') return undefined

    const t = normalizarTextoBusca(motivo)
    const lab = (v) => (v != null && String(v).trim() ? String(v).trim() : '—')
    const dataLab = formatarDataConferencia(ctx.dataLab) || lab(ctx.dataLab)
    const dataPlano = formatarDataConferencia(ctx.dataPlano) || lab(ctx.dataPlano)

    if (/tutor/.test(t)) {
        return `Tutor diferente na grafia — Lab: «${lab(ctx.tutorLab)}» · Plano: «${lab(ctx.tutorPlano)}»`
    }
    if (/animal|pet/.test(t)) {
        return `Animal diferente na grafia — Lab: «${lab(ctx.petLab)}» · Plano: «${lab(ctx.petPlano)}»`
    }
    if (/data/.test(t)) {
        return `Datas não são iguais — Lab: ${dataLab} · Plano: ${dataPlano}`
    }
    if (/exame|codigo/.test(t)) {
        return `Exame/código não idênticos — Lab: ${textoExameLinha(ctx.codigoLab, ctx.exameLab)} · Plano: ${textoExameLinha(ctx.codigoPlano, ctx.examePlano)}`
    }
    if (/valor/.test(t)) {
        const vL = Number(ctx.valorLab)
        const vE = Number(ctx.valorPlano)
        const temDelta = Number.isFinite(vL) && Number.isFinite(vE)
        const delta = temDelta
            ? formatarValorConferencia(Math.round(Math.abs(vL - vE) * 100) / 100)
            : null
        const faixa =
            /parec/.test(t)
                ? 'Diferença de até R$ 1,70'
                : 'Diferença acima de R$ 1,70'
        return `${faixa} — Lab: ${formatarValorConferencia(ctx.valorLab)} · Plano: ${formatarValorConferencia(ctx.valorPlano)}${delta ? ` · Δ ${delta}` : ''}`
    }
    if (/sem sugest|sem lab|sem par|so no plano|só no plano/.test(t)) {
        return String(motivo)
    }
    return String(motivo)
}

/**
 * Lista global paginada de exames pendentes (órfãos / diff de valor).
 * Cada linha tem sugestões do outro lado com base em tutor/pet.
 */
export default function EtapaExamesIndividuais({
    fila = [],
    decisoes = new Map(),
    escolhas = {},
    mapasAliasesPessoa = null,
    marcados = null,
    onToggleFlag,
    onEscolha,
    onAprovar,
    onRejeitar,
    onConcluir,
    podeEditar,
    processando,
    progressoPct = 0,
    feedbackResumo = '',
}) {
    const [busca, setBusca] = useState('')
    const [pagina, setPagina] = useState(1)
    const [filtroTipo, setFiltroTipo] = useState('todos')
    const [pickerAberto, setPickerAberto] = useState(null)
    const pickerRef = useRef(null)

    useEffect(() => {
        if (!pickerAberto) return undefined
        const onDoc = (e) => {
            if (pickerRef.current && !pickerRef.current.contains(e.target)) {
                setPickerAberto(null)
            }
        }
        const onEsc = (e) => {
            if (e.key === 'Escape') setPickerAberto(null)
        }
        document.addEventListener('mousedown', onDoc)
        document.addEventListener('keydown', onEsc)
        return () => {
            document.removeEventListener('mousedown', onDoc)
            document.removeEventListener('keydown', onEsc)
        }
    }, [pickerAberto])

    const filtrados = useMemo(() => {
        const termo = normalizarTextoBusca(busca)
        const labsAprovados = new Set()
        const emsAprovados = new Set()
        for (const [idItem, d] of decisoes || []) {
            if (d?.status !== 'aprovado' && d?.status !== 'rejeitado') continue
            if (String(idItem).startsWith('lab:')) labsAprovados.add(String(idItem).slice(4))
            if (String(idItem).startsWith('em:')) emsAprovados.add(String(idItem).slice(3))
            if (d?.idEm) emsAprovados.add(String(d.idEm))
        }
        return (fila || []).filter((item) => {
            const dec = decisoes.get(item.idItem)
            if (dec?.status === 'aprovado' || dec?.status === 'rejeitado') return false
            if (item.idLabLocal && labsAprovados.has(String(item.idLabLocal))) return false
            if (item.idEmerdogLocal && emsAprovados.has(String(item.idEmerdogLocal))) return false
            if (filtroTipo === 'orfao_lab' && item.tipo !== 'orfao_lab') return false
            if (filtroTipo === 'orfao_emerdog' && item.tipo !== 'orfao_emerdog') return false
            if (filtroTipo === 'diff' && item.tipo !== 'diff_valor') return false
            if (!termo) return true
            const blob = normalizarTextoBusca(
                [item.tutor, item.pet, item.exame, item.examePlano, item.codigo]
                    .filter(Boolean)
                    .join(' '),
            )
            return blob.includes(termo)
        })
    }, [fila, busca, filtroTipo, decisoes])

    const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA))
    const paginaSafe = Math.min(pagina, totalPaginas)
    const paginaItens = useMemo(() => {
        const ini = (paginaSafe - 1) * POR_PAGINA
        return filtrados.slice(ini, ini + POR_PAGINA)
    }, [filtrados, paginaSafe])

    const qtdResolvidos = useMemo(() => {
        let n = 0
        for (const item of fila || []) {
            const d = decisoes.get(item.idItem)
            if (d?.status === 'aprovado' || d?.status === 'rejeitado') n += 1
        }
        return n
    }, [fila, decisoes])

    return (
        <section className="conf_lab_card conf_lab_orfaos_card conf_lab_exames_ind_card">
            <div className="conf_lab_map_head">
                <div>
                    <h2>Conferência de exames</h2>
                    <p className="conf_lab_muted">
                        Cada linha é um exame. Sugestões usam tutor e animal parecidos.
                        {feedbackResumo ? ` ${feedbackResumo}` : ''}
                        {' · '}
                        {qtdResolvidos} resolvido(s) · {filtrados.length} pendente(s) nesta vista
                    </p>
                </div>
                <div className="conf_lab_map_head_actions">
                    <button
                        type="button"
                        className="credenciamento_main_action_btn secondary"
                        onClick={onConcluir}
                    >
                        Ir para comparação
                    </button>
                    <div className="conf_lab_progress" aria-hidden>
                        <div
                            className="conf_lab_progress_bar"
                            style={{ width: `${progressoPct}%` }}
                        />
                    </div>
                </div>
            </div>

            <div className="conf_lab_exames_ind_toolbar">
                <label className="conf_lab_busca_comparacao">
                    <span className="conf_lab_sr">Buscar tutor, animal ou exame</span>
                    <input
                        type="search"
                        value={busca}
                        onChange={(e) => {
                            setBusca(e.target.value)
                            setPagina(1)
                        }}
                        placeholder="Buscar tutor, animal ou exame…"
                        autoComplete="off"
                    />
                </label>
                <div className="conf_lab_filtros" role="tablist">
                    {[
                        { id: 'todos', label: 'Todos' },
                        { id: 'orfao_lab', label: 'Órfãos lab' },
                        { id: 'orfao_emerdog', label: 'Só plano' },
                        { id: 'diff', label: 'Diff valor' },
                    ].map((f) => (
                        <button
                            key={f.id}
                            type="button"
                            className={filtroTipo === f.id ? 'is-active' : ''}
                            onClick={() => {
                                setFiltroTipo(f.id)
                                setPagina(1)
                            }}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
            </div>

            {!paginaItens.length ? (
                <p className="conf_lab_muted conf_lab_orfaos_vazio">
                    {fila.length === 0
                        ? 'Nenhum exame pendente — tudo pareado automaticamente.'
                        : 'Nenhum exame neste filtro/busca (ou já resolvidos).'}
                </p>
            ) : (
                <div className="conf_lab_cards_lista conf_lab_exames_ind_lista">
                    {paginaItens.map((item) => {
                        const escolha =
                            escolhas[item.idItem] ??
                            item.idEmSugerido ??
                            item.idLabSugerido ??
                            ''
                        const tipoLabel =
                            item.tipo === 'diff_valor'
                                ? 'Diff valor'
                                : item.tipo === 'orfao_emerdog'
                                  ? 'Só plano'
                                  : 'Órfão lab'
                        const candidatos = item.candidatos || []
                        const candSel =
                            item.tipo === 'orfao_lab'
                                ? candidatos.find(
                                      (c) => String(c.idLocal) === String(escolha),
                                  ) || candidatos[0]
                                : null
                        const cardPlano =
                            item.tipo === 'orfao_lab'
                                ? candSel?.card
                                : item.cardEm || item
                        const tutorLab = item.tutor || item.cardLab?.tutor || '—'
                        const petLab = item.pet || item.cardLab?.pet || '—'
                        const dataLab = item.data || item.cardLab?.data
                        const tutorPlano = cardPlano?.tutor || item.tutor || '—'
                        const petPlano = cardPlano?.pet || item.pet || '—'
                        const dataPlano = cardPlano?.data || item.data
                        const linhaLab = textoExameLinha(
                            item.codigo || item.cardLab?.codigo,
                            item.exame || item.cardLab?.exameLaboratorio,
                        )
                        const linhaPlano = textoExameLinha(
                            cardPlano?.codigo || item.codigo,
                            cardPlano?.exameEmerdog ||
                                item.examePlano ||
                                item.exame ||
                                cardPlano?.exameLaboratorio,
                        )
                        const valorLab = item.valorLab ?? item.cardLab?.valorLab ?? null
                        const valorPlano =
                            cardPlano?.valorEmerdog ?? item.valorEm ?? null
                        const codigoLab = item.codigo || item.cardLab?.codigo || ''
                        const exameLab =
                            item.exame || item.cardLab?.exameLaboratorio || ''
                        const codigoPlano = cardPlano?.codigo || item.codigo || ''
                        const examePlano =
                            cardPlano?.exameEmerdog ||
                            item.examePlano ||
                            item.exame ||
                            cardPlano?.exameLaboratorio ||
                            ''
                        const temParComparavel =
                            item.tipo === 'diff_valor' ||
                            (item.tipo === 'orfao_lab' && Boolean(candSel)) ||
                            (item.tipo === 'orfao_emerdog' && Boolean(item.cardLab))
                        const destaqueExame = classificarDestaqueExame({
                            temPar: temParComparavel,
                            codigoLab,
                            exameLab,
                            valorLab,
                            codigoEm: codigoPlano,
                            exameEm: examePlano,
                            valorEm: valorPlano,
                            forcarDiff: item.tipo === 'diff_valor',
                        })
                        const liLabClass =
                            item.tipo === 'orfao_emerdog' ? 'is-sem-par' : destaqueExame
                        const liPlanoClass =
                            item.tipo === 'orfao_emerdog' && !item.cardLab
                                ? 'is-sem-par'
                                : destaqueExame
                        const motivosTags = (() => {
                            if (item.tipo === 'orfao_lab' && candSel?.card) {
                                const ladoLab = {
                                    tipo: 'orfao_lab',
                                    tutor: tutorLab,
                                    pet: petLab,
                                    data: dataLab,
                                    exameLaboratorio: exameLab,
                                    codigo: codigoLab,
                                    valorLab,
                                    valorEmerdog: null,
                                }
                                const ladoPlano = {
                                    tipo: 'orfao_emerdog',
                                    tutor: tutorPlano,
                                    pet: petPlano,
                                    data: dataPlano,
                                    exameEmerdog: examePlano,
                                    codigo: codigoPlano,
                                    valorLab: null,
                                    valorEmerdog: valorPlano,
                                }
                                return pontuarPareamentoExamesIndividuais(
                                    ladoLab,
                                    ladoPlano,
                                    mapasAliasesPessoa,
                                ).motivos
                            }
                            if (item.tipo === 'diff_valor') {
                                return pontuarPareamentoExamesIndividuais(
                                    {
                                        tipo: 'orfao_lab',
                                        tutor: tutorLab,
                                        pet: petLab,
                                        data: dataLab,
                                        exameLaboratorio: exameLab,
                                        codigo: codigoLab,
                                        valorLab,
                                        valorEmerdog: null,
                                    },
                                    {
                                        tipo: 'orfao_emerdog',
                                        tutor: tutorPlano,
                                        pet: petPlano,
                                        data: dataPlano,
                                        exameEmerdog: examePlano,
                                        codigo: codigoPlano,
                                        valorLab: null,
                                        valorEmerdog: valorPlano,
                                    },
                                    mapasAliasesPessoa,
                                ).motivos
                            }
                            return item.motivos || []
                        })()
                        const pickerEstaAberto = pickerAberto === item.idItem
                        const chaveFlag = chaveFlagItemExame(item, escolha)
                        const flagMarcado =
                            Boolean(chaveFlag) &&
                            marcados instanceof Set &&
                            marcados.has(chaveFlag)

                        return (
                            <article
                                key={item.idItem}
                                className={`conf_lab_pair_card conf_lab_exame_ind_card status-pendente has-orfao tipo-${item.tipo}${flagMarcado ? ' is-flagged' : ''}`}
                            >
                                <header>
                                    <div className="conf_lab_atendimento_titulo">
                                        <div>
                                            <strong>
                                                {item.tutor || '—'} ·{' '}
                                                <span className="conf_lab_card_pet">
                                                    {item.pet || '—'}
                                                </span>
                                            </strong>
                                            <span>{formatarDataConferencia(item.data)}</span>
                                        </div>
                                    </div>
                                    <div className="conf_lab_header_right">
                                        <BandeiraPosRelatorio
                                            marcado={flagMarcado}
                                            onToggle={() => onToggleFlag?.(chaveFlag)}
                                        />
                                        <span className="conf_lab_status_pill status-pendente">
                                            {tipoLabel}
                                        </span>
                                    </div>
                                </header>

                                <div className="conf_lab_exame_ind_corpo">
                                    <div className="conf_lab_orfaos_versus conf_lab_map_versus !flex !flex-col gap-3 md:!grid md:!grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                                        <div className="conf_lab_map_side is-lab">
                                            <div className="conf_lab_map_side_head">
                                                <span className="conf_lab_map_side_label">
                                                    Laboratório
                                                </span>
                                                <span
                                                    className="conf_lab_map_side_head_spacer"
                                                    aria-hidden
                                                />
                                            </div>
                                            {item.tipo === 'orfao_emerdog' ? (
                                                <p className="conf_lab_muted conf_lab_tutor_lado_vazio">
                                                    Sem exame no lab
                                                </p>
                                            ) : (
                                                <div className="conf_lab_exame_lado_corpo">
                                                    <p className="conf_lab_exame_lado_tutor">
                                                        {tutorLab} - {petLab}
                                                    </p>
                                                    <p className="conf_lab_exame_lado_data">
                                                        {formatarDataConferencia(dataLab) || '—'}
                                                    </p>
                                                    <ul className="conf_lab_orfao_exames">
                                                        <li className={liLabClass}>
                                                            <span className="conf_lab_exame_txt">
                                                                {linhaLab}
                                                            </span>
                                                            <em>
                                                                {formatarValorConferencia(
                                                                    valorLab,
                                                                )}
                                                            </em>
                                                        </li>
                                                    </ul>
                                                </div>
                                            )}
                                        </div>
                                        <div className="conf_lab_map_eq" aria-hidden>
                                            ?
                                        </div>
                                        <div className="conf_lab_map_side is-plan">
                                            <div className="conf_lab_map_side_head">
                                                <span className="conf_lab_map_side_label">
                                                    Plano
                                                </span>
                                                {item.tipo === 'orfao_lab' &&
                                                candidatos.length > 0 ? (
                                                    <div
                                                        className="conf_lab_plano_picker"
                                                        ref={
                                                            pickerEstaAberto
                                                                ? pickerRef
                                                                : null
                                                        }
                                                    >
                                                        <button
                                                            type="button"
                                                            className="conf_lab_plano_picker_btn"
                                                            title="Selecionar outro registro do plano"
                                                            aria-label="Selecionar outro registro do plano"
                                                            aria-expanded={pickerEstaAberto}
                                                            disabled={!podeEditar || processando}
                                                            onClick={() =>
                                                                setPickerAberto(
                                                                    pickerEstaAberto
                                                                        ? null
                                                                        : item.idItem,
                                                                )
                                                            }
                                                        >
                                                            <IconeTrocarRegistro />
                                                        </button>
                                                        {pickerEstaAberto ? (
                                                            <div
                                                                className="conf_lab_plano_picker_menu"
                                                                role="listbox"
                                                            >
                                                                {candidatos.map((c) => {
                                                                    const ativo =
                                                                        String(c.idLocal) ===
                                                                        String(
                                                                            escolha ||
                                                                                candSel?.idLocal,
                                                                        )
                                                                    return (
                                                                        <button
                                                                            key={c.idLocal}
                                                                            type="button"
                                                                            role="option"
                                                                            aria-selected={ativo}
                                                                            className={
                                                                                ativo
                                                                                    ? 'is-active'
                                                                                    : ''
                                                                            }
                                                                            onClick={() => {
                                                                                onEscolha?.(
                                                                                    item.idItem,
                                                                                    c.idLocal,
                                                                                )
                                                                                setPickerAberto(
                                                                                    null,
                                                                                )
                                                                            }}
                                                                        >
                                                                            {rotuloOpcaoCandidatoPlano(
                                                                                c,
                                                                            )}
                                                                        </button>
                                                                    )
                                                                })}
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                ) : null}
                                            </div>
                                            {item.tipo === 'orfao_lab' && !candSel ? (
                                                <p className="conf_lab_muted conf_lab_tutor_lado_vazio">
                                                    Sem sugestão — use o ícone para escolher
                                                </p>
                                            ) : (
                                                <div className="conf_lab_exame_lado_corpo">
                                                    <p className="conf_lab_exame_lado_tutor">
                                                        {tutorPlano} - {petPlano}
                                                    </p>
                                                    <p className="conf_lab_exame_lado_data">
                                                        {formatarDataConferencia(dataPlano) ||
                                                            '—'}
                                                    </p>
                                                    <ul className="conf_lab_orfao_exames">
                                                        <li className={liPlanoClass}>
                                                            <span className="conf_lab_exame_txt">
                                                                {linhaPlano}
                                                            </span>
                                                            <em>
                                                                {formatarValorConferencia(
                                                                    valorPlano,
                                                                )}
                                                                {item.tipo === 'diff_valor' &&
                                                                item.diferenca != null
                                                                    ? ` (Δ ${formatarValorConferencia(item.diferenca)})`
                                                                    : ''}
                                                            </em>
                                                        </li>
                                                    </ul>
                                                    {item.tipo === 'orfao_emerdog' ? (
                                                        <p className="conf_lab_muted">
                                                            Sem lab correspondente próximo
                                                        </p>
                                                    ) : null}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <footer className="conf_lab_exame_ind_rodape">
                                    {motivosTags.length ? (
                                        <ul className="conf_lab_orfaos_motivos conf_lab_exame_ind_motivos">
                                            {motivosTags.slice(0, 6).map((m) => {
                                                const tom = tomBadgeMotivo(m)
                                                const dica = tooltipBadgeMotivo(m, {
                                                    tutorLab,
                                                    tutorPlano,
                                                    petLab,
                                                    petPlano,
                                                    dataLab,
                                                    dataPlano,
                                                    codigoLab,
                                                    exameLab,
                                                    codigoPlano,
                                                    examePlano,
                                                    valorLab,
                                                    valorPlano,
                                                })
                                                return (
                                                    <li
                                                        key={m}
                                                        className={tom}
                                                        title={dica}
                                                    >
                                                        {m}
                                                    </li>
                                                )
                                            })}
                                        </ul>
                                    ) : null}
                                    <div className="conf_lab_exame_ind_acoes">
                                        {item.tipo === 'orfao_emerdog' ? (
                                            <button
                                                type="button"
                                                className="credenciamento_main_action_btn secondary"
                                                disabled={!podeEditar || processando}
                                                onClick={() => onRejeitar?.(item)}
                                            >
                                                Manter órfão
                                            </button>
                                        ) : (
                                            <>
                                                <button
                                                    type="button"
                                                    className="credenciamento_main_action_btn secondary"
                                                    disabled={!podeEditar || processando}
                                                    onClick={() => onRejeitar?.(item)}
                                                >
                                                    {item.tipo === 'diff_valor'
                                                        ? 'Manter diff'
                                                        : 'Não — órfão'}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="credenciamento_main_action_btn"
                                                    disabled={
                                                        !podeEditar ||
                                                        processando ||
                                                        (item.tipo === 'orfao_lab' &&
                                                            !(escolha || candSel?.idLocal))
                                                    }
                                                    onClick={() =>
                                                        onAprovar?.(
                                                            item,
                                                            escolha || candSel?.idLocal || '',
                                                        )
                                                    }
                                                >
                                                    {item.tipo === 'diff_valor'
                                                        ? 'Aceitar par'
                                                        : 'Aprovar pareamento'}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </footer>
                            </article>
                        )
                    })}
                </div>
            )}

            {filtrados.length > POR_PAGINA ? (
                <div className="conf_lab_paginacao flex flex-wrap items-center justify-center gap-3">
                    <button
                        type="button"
                        className="credenciamento_main_action_btn secondary min-h-11 px-4"
                        disabled={paginaSafe <= 1}
                        onClick={() => setPagina((p) => Math.max(1, p - 1))}
                    >
                        ← Anterior
                    </button>
                    <span>
                        Página {paginaSafe} de {totalPaginas}
                    </span>
                    <button
                        type="button"
                        className="credenciamento_main_action_btn secondary min-h-11 px-4"
                        disabled={paginaSafe >= totalPaginas}
                        onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                    >
                        Próxima →
                    </button>
                </div>
            ) : null}
        </section>
    )
}
