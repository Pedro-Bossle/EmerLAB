import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
    chaveAliasExame,
    normalizarNomeExame,
} from '../../../lib/configuracoes/conferenciaLaboratorio.js'
import { formatarValorConferencia } from '../../../lib/configuracoes/conferenciaLaboratorioPrecos.js'
import { normalizarTextoBusca } from '../../../lib/prestadorCadastroHelpers.js'

function rotuloStatus(status) {
    if (status === 'ok') return 'OK'
    if (status === 'valor_diff') return 'Valor ≠'
    if (status === 'auditoria') return 'Auditar'
    return 'Pendente'
}

function chaveLinha(row) {
    return row?.chave || chaveAliasExame(row?.nomeLabNorm, row?.valorLab)
}

function itemCorrespondeBusca(item, termo) {
    if (!termo) return true
    const blob = normalizarTextoBusca(
        [item.codigo, item.nome, item.nomeAlternativo, item.nomeExibicao, item.rotulo]
            .filter(Boolean)
            .join(' '),
    )
    return blob.includes(termo)
}

function acharItemCatalogo(itens, nome) {
    const n = normalizarNomeExame(nome)
    if (!n) return null
    return (itens || []).find((i) => normalizarNomeExame(i.nome) === n) || null
}

/**
 * Combobox digitável para procedimentos da negociação.
 * Lista renderizada em portal no body (evita sumir com hover/filter da tabela).
 */
function CatalogoCombobox({
    itens = [],
    value = '',
    disabled = false,
    placeholder = 'Digite código ou nome…',
    onChange,
    onCommit,
}) {
    const id = useId()
    const listId = `${id}-list`
    const wrapRef = useRef(null)
    const inputRef = useRef(null)
    const portalRef = useRef(null)
    const [aberto, setAberto] = useState(false)
    const [query, setQuery] = useState('')
    const [highlight, setHighlight] = useState(0)
    const [pos, setPos] = useState(null)

    const selecionado = useMemo(
        () => acharItemCatalogo(itens, value),
        [itens, value],
    )

    const filtrados = useMemo(() => {
        const t = normalizarTextoBusca(query)
        const base = (itens || []).filter((i) => itemCorrespondeBusca(i, t))
        return base.slice(0, 80)
    }, [itens, query])

    const rotuloExibicao = selecionado?.rotulo || value || ''

    const atualizarPosicao = () => {
        const el = wrapRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        const espacoAbaixo = window.innerHeight - r.bottom
        const abrirCima = espacoAbaixo < 220 && r.top > espacoAbaixo
        const maxH = Math.min(280, Math.max(120, abrirCima ? r.top - 12 : espacoAbaixo - 12))
        // Largura = campo; no máximo a viewport (sem forçar 280px e gerar scroll na tabela)
        const width = Math.min(Math.max(r.width, 200), Math.max(200, window.innerWidth - 16))
        let left = r.left
        if (left + width > window.innerWidth - 8) {
            left = Math.max(8, window.innerWidth - width - 8)
        }
        setPos({
            left,
            width,
            top: abrirCima ? undefined : r.bottom + 4,
            bottom: abrirCima ? window.innerHeight - r.top + 4 : undefined,
            maxHeight: maxH,
        })
    }

    const abrir = () => {
        if (disabled) return
        setQuery('')
        setHighlight(0)
        setAberto(true)
        // posição no próximo frame (refs estáveis)
        requestAnimationFrame(() => atualizarPosicao())
    }

    const fechar = () => {
        setAberto(false)
        setQuery('')
        setHighlight(0)
        setPos(null)
    }

    const escolher = (item) => {
        if (!item?.nome) return
        onChange?.(item.nome)
        fechar()
        onCommit?.(item.nome)
    }

    useEffect(() => {
        if (!aberto) return
        atualizarPosicao()
        const onReposition = (e) => {
            // Não reposicionar ao rolar a própria lista
            if (portalRef.current && e?.target && portalRef.current.contains(e.target)) {
                return
            }
            atualizarPosicao()
        }
        const onClick = (e) => {
            const t = e.target
            if (wrapRef.current?.contains(t) || portalRef.current?.contains(t)) return
            fechar()
        }
        window.addEventListener('scroll', onReposition, true)
        window.addEventListener('resize', onReposition)
        document.addEventListener('mousedown', onClick)
        return () => {
            window.removeEventListener('scroll', onReposition, true)
            window.removeEventListener('resize', onReposition)
            document.removeEventListener('mousedown', onClick)
        }
    }, [aberto])

    const onKeyDown = (e) => {
        if (disabled) return
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (!aberto) abrir()
            else setHighlight((h) => Math.min(h + 1, Math.max(filtrados.length - 1, 0)))
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight((h) => Math.max(h - 1, 0))
        } else if (e.key === 'Enter') {
            e.preventDefault()
            if (aberto && filtrados[highlight]) {
                escolher(filtrados[highlight])
            } else if (aberto && filtrados.length === 1) {
                escolher(filtrados[0])
            } else if (value && onCommit) {
                onCommit(value)
            }
        } else if (e.key === 'Escape') {
            e.preventDefault()
            fechar()
            inputRef.current?.blur()
        }
    }

    const lista =
        aberto && pos
            ? createPortal(
                  <div
                      ref={portalRef}
                      className="conf_lab_alias_combo_portal"
                      id={listId}
                      role="listbox"
                      style={{
                          position: 'fixed',
                          left: pos.left,
                          width: pos.width,
                          top: pos.top,
                          bottom: pos.bottom,
                          maxHeight: pos.maxHeight,
                          zIndex: 10050,
                      }}
                  >
                      {!filtrados.length ? (
                          <div className="conf_lab_alias_combo_vazio">
                              Nenhum procedimento
                          </div>
                      ) : (
                          filtrados.map((item, idx) => {
                              const ativo =
                                  normalizarNomeExame(item.nome) ===
                                  normalizarNomeExame(value)
                              return (
                                  <button
                                      key={`${item.norm}-${item.codigo || idx}`}
                                      type="button"
                                      role="option"
                                      aria-selected={ativo}
                                      className={`conf_lab_alias_combo_opcao${
                                          idx === highlight ? ' is-hl' : ''
                                      }${ativo ? ' is-sel' : ''}`}
                                      onMouseEnter={() => setHighlight(idx)}
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={() => escolher(item)}
                                  >
                                      <span className="conf_lab_alias_combo_opcao_txt">
                                          {item.rotulo}
                                      </span>
                                  </button>
                              )
                          })
                      )}
                  </div>,
                  document.body,
              )
            : null

    return (
        <div className="conf_lab_alias_combo" ref={wrapRef}>
            <input
                ref={inputRef}
                type="text"
                className="conf_lab_alias_combo_input"
                role="combobox"
                aria-expanded={aberto}
                aria-controls={listId}
                aria-autocomplete="list"
                disabled={disabled}
                placeholder={placeholder}
                value={aberto ? query : rotuloExibicao}
                onChange={(e) => {
                    setQuery(e.target.value)
                    if (!aberto) {
                        setAberto(true)
                        requestAnimationFrame(() => atualizarPosicao())
                    }
                    setHighlight(0)
                }}
                onFocus={abrir}
                onKeyDown={onKeyDown}
                autoComplete="off"
            />
            {value && !disabled ? (
                <button
                    type="button"
                    className="conf_lab_alias_combo_limpar"
                    aria-label="Limpar vínculo"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                        e.preventDefault()
                        onChange?.('')
                        setQuery('')
                        inputRef.current?.focus()
                        abrir()
                    }}
                >
                    ×
                </button>
            ) : null}
            {lista}
        </div>
    )
}

/**
 * Lista exames do lab separados por nome+valor × pares da negociação.
 * Permite vínculos distintos quando o mesmo exame tem preços diferentes.
 */
export default function EtapaAliasesExames({
    labNome = '',
    lista = [],
    itensCatalogo = [],
    total = 0,
    vinculados = 0,
    restantes = 0,
    comValorDiff = 0,
    progressoPct = 0,
    modoRevisao = false,
    podeEditar,
    processando,
    onVincular,
    onAuditar,
    onContinuar,
    onRecalcular,
}) {
    const [busca, setBusca] = useState('')
    const [filtro, setFiltro] = useState('todos')
    const [selecionados, setSelecionados] = useState(() => new Set())
    const [escolhaCatalogo, setEscolhaCatalogo] = useState('')
    const [escolhasLinha, setEscolhasLinha] = useState({})

    const linhasVisiveis = useMemo(() => {
        let rows = lista || []
        if (filtro === 'pendentes') rows = rows.filter((r) => r.status === 'pendente')
        else if (filtro === 'valor_diff') rows = rows.filter((r) => r.valorDiff)
        else if (filtro === 'ok') rows = rows.filter((r) => r.status === 'ok')
        const t = normalizarTextoBusca(busca)
        if (t) {
            rows = rows.filter((r) => {
                const blob = normalizarTextoBusca(
                    [
                        r.nomeLab,
                        r.nomeEmerdog,
                        r.itemCatalogo?.codigo,
                        r.itemCatalogo?.rotulo,
                        r.valorLab != null ? String(r.valorLab) : '',
                    ]
                        .filter(Boolean)
                        .join(' '),
                )
                return blob.includes(t)
            })
        }
        return rows
    }, [lista, filtro, busca])

    const toggleSel = (chave) => {
        setSelecionados((prev) => {
            const next = new Set(prev)
            if (next.has(chave)) next.delete(chave)
            else next.add(chave)
            return next
        })
    }

    const toggleTodosVisiveis = () => {
        const chaves = linhasVisiveis.map((r) => chaveLinha(r))
        const todosOn = chaves.length > 0 && chaves.every((n) => selecionados.has(n))
        setSelecionados((prev) => {
            const next = new Set(prev)
            if (todosOn) chaves.forEach((n) => next.delete(n))
            else chaves.forEach((n) => next.add(n))
            return next
        })
    }

    const vincularSelecionados = () => {
        if (!escolhaCatalogo || !selecionados.size) return
        const itens = (lista || []).filter((r) => selecionados.has(chaveLinha(r)))
        onVincular?.(itens, escolhaCatalogo)
        setSelecionados(new Set())
        setEscolhaCatalogo('')
    }

    const definirEscolhaLinha = (row, nome) => {
        const k = chaveLinha(row)
        setEscolhasLinha((prev) => ({ ...prev, [k]: nome }))
    }

    const salvarLinha = (row, nomeForcado) => {
        const k = chaveLinha(row)
        const nome =
            String(nomeForcado || escolhasLinha[k] || row.nomeEmerdog || '').trim()
        if (!nome) return
        if (normalizarNomeExame(nome) === normalizarNomeExame(row.nomeEmerdog || '')) {
            return
        }
        onVincular?.([row], nome)
    }

    return (
        <section className="conf_lab_card conf_lab_map_card conf_lab_alias_lista_card">
            <div className="conf_lab_map_head">
                <div>
                    <h2>{modoRevisao ? 'Revisar aliases' : 'Aliases de exames'}</h2>
                    <p className="conf_lab_muted">
                        {labNome ? `${labNome} · ` : ''}
                        Digite código ou nome na coluna Negociação para buscar e vincular.
                        Escolher um procedimento já salva o vínculo.
                    </p>
                </div>
                <div className="conf_lab_map_head_actions">
                    {modoRevisao ? (
                        <button
                            type="button"
                            className="credenciamento_main_action_btn secondary conf_lab_btn_tutor_main"
                            disabled={processando}
                            onClick={() => onRecalcular?.()}
                        >
                            Recalcular conferência
                        </button>
                    ) : null}
                    <div className="conf_lab_progress" aria-hidden>
                        <div
                            className="conf_lab_progress_bar"
                            style={{ width: `${progressoPct}%` }}
                        />
                    </div>
                </div>
            </div>

            <div className="conf_lab_alias_resumo" role="status">
                <span>
                    Vinculados <strong>{vinculados}</strong> / {total}
                </span>
                <span>
                    Restantes <strong>{restantes}</strong>
                </span>
                {comValorDiff > 0 ? (
                    <span className="is-warn">
                        Nome igual · valor ≠ <strong>{comValorDiff}</strong>
                    </span>
                ) : null}
                <span>{progressoPct}%</span>
            </div>

            <div className="conf_lab_alias_toolbar">
                <div className="conf_lab_filtros conf_lab_alias_filtros" role="tablist">
                    {[
                        { id: 'todos', label: `Todos (${total})` },
                        { id: 'pendentes', label: `Pendentes (${restantes})` },
                        { id: 'valor_diff', label: `Valor ≠ (${comValorDiff})` },
                        { id: 'ok', label: 'OK' },
                    ].map((f) => (
                        <button
                            key={f.id}
                            type="button"
                            className={filtro === f.id ? 'is-active' : ''}
                            onClick={() => setFiltro(f.id)}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
                <label className="conf_lab_busca_comparacao conf_lab_alias_busca">
                    <span className="conf_lab_sr">Filtrar lista</span>
                    <input
                        type="search"
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                        placeholder="Filtrar exames da lista…"
                        autoComplete="off"
                    />
                </label>
            </div>

            {podeEditar && selecionados.size > 0 ? (
                <div className="conf_lab_mescla_bar conf_lab_alias_batch">
                    <p>
                        <strong>{selecionados.size}</strong> exame(s) selecionado(s) → um da
                        negociação
                    </p>
                    <div className="conf_lab_mescla_bar_acoes">
                        <CatalogoCombobox
                            itens={itensCatalogo}
                            value={escolhaCatalogo}
                            disabled={processando}
                            placeholder="Digite o procedimento…"
                            onChange={setEscolhaCatalogo}
                        />
                        <button
                            type="button"
                            className="credenciamento_main_action_btn secondary"
                            onClick={() => setSelecionados(new Set())}
                        >
                            Limpar
                        </button>
                        <button
                            type="button"
                            className="credenciamento_main_action_btn"
                            disabled={!escolhaCatalogo || processando}
                            onClick={vincularSelecionados}
                        >
                            Vincular selecionados
                        </button>
                    </div>
                </div>
            ) : null}

            <div className="conf_lab_alias_table_wrap">
                <table className="conf_lab_alias_table">
                    <thead>
                        <tr>
                            <th className="conf_lab_alias_col_check">
                                <input
                                    type="checkbox"
                                    checked={
                                        linhasVisiveis.length > 0 &&
                                        linhasVisiveis.every((r) =>
                                            selecionados.has(chaveLinha(r)),
                                        )
                                    }
                                    onChange={toggleTodosVisiveis}
                                    disabled={!podeEditar || processando}
                                    aria-label="Selecionar todos visíveis"
                                />
                            </th>
                            <th className="conf_lab_alias_col_lab">Laboratório</th>
                            <th className="conf_lab_alias_col_valor">Valor lab</th>
                            <th className="conf_lab_alias_col_neg">Negociação</th>
                            <th className="conf_lab_alias_col_valor">Valor neg.</th>
                            <th className="conf_lab_alias_col_status">Status</th>
                            <th className="conf_lab_alias_col_acoes" />
                        </tr>
                    </thead>
                    <tbody>
                        {!linhasVisiveis.length ? (
                            <tr>
                                <td colSpan={7} className="conf_lab_muted">
                                    Nenhum exame neste filtro/busca.
                                </td>
                            </tr>
                        ) : (
                            linhasVisiveis.map((row) => {
                                const k = chaveLinha(row)
                                const escolha =
                                    escolhasLinha[k] ?? row.nomeEmerdog ?? ''
                                const catSel =
                                    acharItemCatalogo(itensCatalogo, escolha) ||
                                    row.itemCatalogo
                                const sujo =
                                    Boolean(escolha) &&
                                    normalizarNomeExame(escolha) !==
                                        normalizarNomeExame(row.nomeEmerdog || '')
                                return (
                                    <tr
                                        key={k}
                                        className={
                                            row.nomeIgualValorDiff || row.valorDiff
                                                ? 'is-valor-diff'
                                                : row.status === 'pendente'
                                                  ? 'is-pendente'
                                                  : ''
                                        }
                                    >
                                        <td className="conf_lab_alias_col_check">
                                            <input
                                                type="checkbox"
                                                checked={selecionados.has(k)}
                                                onChange={() => toggleSel(k)}
                                                disabled={!podeEditar || processando}
                                                aria-label={`Selecionar ${row.nomeLab}`}
                                            />
                                        </td>
                                        <td className="conf_lab_alias_col_lab">
                                            <strong className="conf_lab_alias_lab_nome">
                                                {row.nomeLab}
                                            </strong>
                                            <span className="conf_lab_alias_meta">
                                                {row.qtd}× neste valor
                                            </span>
                                        </td>
                                        <td className="conf_lab_alias_col_valor">
                                            {row.valorLab != null ? (
                                                <span className="conf_lab_alias_valores">
                                                    <em>
                                                        {formatarValorConferencia(row.valorLab)}
                                                    </em>
                                                </span>
                                            ) : (
                                                '—'
                                            )}
                                        </td>
                                        <td className="conf_lab_alias_col_neg">
                                            <CatalogoCombobox
                                                itens={itensCatalogo}
                                                value={escolha}
                                                disabled={!podeEditar || processando}
                                                placeholder="Digite código ou nome…"
                                                onChange={(nome) =>
                                                    definirEscolhaLinha(row, nome)
                                                }
                                                onCommit={(nome) => salvarLinha(row, nome)}
                                            />
                                            {row.nomeIgualValorDiff ? (
                                                <span className="conf_lab_alias_aviso">
                                                    Mesmo nome · valores diferentes
                                                </span>
                                            ) : null}
                                        </td>
                                        <td className="conf_lab_alias_col_valor">
                                            {catSel?.valor != null
                                                ? formatarValorConferencia(catSel.valor)
                                                : '—'}
                                        </td>
                                        <td className="conf_lab_alias_col_status">
                                            <span
                                                className={`conf_lab_alias_status status-${row.status}`}
                                            >
                                                {rotuloStatus(row.status)}
                                            </span>
                                        </td>
                                        <td className="conf_lab_alias_acoes">
                                            {podeEditar ? (
                                                <>
                                                    {sujo ? (
                                                        <button
                                                            type="button"
                                                            className="credenciamento_main_action_btn conf_lab_alias_btn"
                                                            disabled={processando || !escolha}
                                                            onClick={() => salvarLinha(row)}
                                                        >
                                                            Salvar
                                                        </button>
                                                    ) : null}
                                                    {row.status === 'pendente' ? (
                                                        <button
                                                            type="button"
                                                            className="credenciamento_main_action_btn secondary conf_lab_alias_btn"
                                                            disabled={processando}
                                                            onClick={() => onAuditar?.(row)}
                                                        >
                                                            Auditar
                                                        </button>
                                                    ) : null}
                                                </>
                                            ) : null}
                                        </td>
                                    </tr>
                                )
                            })
                        )}
                    </tbody>
                </table>
            </div>

            <div className="conf_lab_actions conf_lab_alias_footer_actions">
                <button
                    type="button"
                    className="credenciamento_main_action_btn"
                    disabled={processando}
                    onClick={() => onContinuar?.()}
                >
                    {restantes > 0
                        ? `Continuar com ${restantes} restante(s)`
                        : modoRevisao
                          ? 'Recalcular / ir à comparação'
                          : 'Continuar para comparação'}
                </button>
            </div>
        </section>
    )
}
