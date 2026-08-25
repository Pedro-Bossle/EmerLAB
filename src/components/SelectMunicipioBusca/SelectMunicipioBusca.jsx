import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { normalizarTextoBusca } from '../../lib/prestadorCadastroHelpers.js'
import './SelectMunicipioBusca.css'

const MAX_SUGESTOES = 80

/**
 * @param {{ id?: string|number, nome?: string, [k: string]: unknown }} opt
 * @param {'id'|'nome'} valueKey
 */
function valorOpcao(opt, valueKey) {
    if (!opt) return ''
    if (valueKey === 'id') return opt.id == null ? '' : String(opt.id)
    return String(opt.nome || '').trim()
}

function rotuloOpcao(opt) {
    return String(opt?.nome || '').trim()
}

/**
 * Drop de município com busca digitável (trigger + painel com filtro).
 * @param {{
 *   options?: Array<{ id?: string|number, nome: string }>,
 *   value?: string,
 *   onChange?: (value: string) => void,
 *   valueKey?: 'id'|'nome',
 *   disabled?: boolean,
 *   loading?: boolean,
 *   placeholder?: string,
 *   searchPlaceholder?: string,
 *   className?: string,
 *   inputClassName?: string,
 *   emptyLabel?: string,
 *   creatable?: boolean,
 *   createLabel?: (query: string) => string,
 *   id?: string,
 *   name?: string,
 *   'aria-label'?: string,
 * }} props
 */
export default function SelectMunicipioBusca({
    options = [],
    value = '',
    onChange,
    valueKey = 'nome',
    disabled = false,
    loading = false,
    placeholder = 'Selecionar cidade…',
    searchPlaceholder = 'Buscar cidade…',
    className = '',
    inputClassName = '',
    emptyLabel = '—',
    creatable = false,
    createLabel,
    id,
    name,
    'aria-label': ariaLabel = 'Cidade',
}) {
    const reactId = useId()
    const listId = `${reactId}-list`
    const searchId = `${reactId}-search`
    const wrapRef = useRef(null)
    const triggerRef = useRef(null)
    const searchRef = useRef(null)
    const portalRef = useRef(null)
    const [aberto, setAberto] = useState(false)
    const [query, setQuery] = useState('')
    const [highlight, setHighlight] = useState(0)
    const [pos, setPos] = useState(null)

    const selecionado = useMemo(() => {
        const v = String(value ?? '').trim()
        if (!v) return null
        return (options || []).find((o) => valorOpcao(o, valueKey) === v) || null
    }, [options, value, valueKey])

    const rotuloSelecionado = selecionado
        ? rotuloOpcao(selecionado)
        : String(value || '').trim()
          ? String(value).trim()
          : ''

    const filtrados = useMemo(() => {
        const lista = options || []
        const t = normalizarTextoBusca(query)
        if (!t) return lista.slice(0, MAX_SUGESTOES)
        const scored = []
        for (const o of lista) {
            const nomeN = normalizarTextoBusca(o.nome)
            if (!nomeN || !nomeN.includes(t)) continue
            const score = nomeN.startsWith(t) ? 0 : 1
            scored.push({ o, score, nomeN })
        }
        scored.sort((a, b) => a.score - b.score || a.nomeN.localeCompare(b.nomeN, 'pt-BR'))
        return scored.slice(0, MAX_SUGESTOES).map((x) => x.o)
    }, [options, query])

    const podeCriar = useMemo(() => {
        if (!creatable) return false
        const t = String(query || '').trim()
        if (!t) return false
        const tn = normalizarTextoBusca(t)
        return !(options || []).some((o) => normalizarTextoBusca(o.nome) === tn)
    }, [creatable, query, options])

    const escolherCriar = () => {
        const t = String(query || '').trim()
        if (!t) return
        onChange?.(t)
        fechar()
        triggerRef.current?.focus()
    }

    const atualizarPosicao = () => {
        const el = wrapRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        const espacoAbaixo = window.innerHeight - r.bottom
        const abrirCima = espacoAbaixo < 260 && r.top > espacoAbaixo
        const maxH = Math.min(320, Math.max(160, abrirCima ? r.top - 12 : espacoAbaixo - 12))
        const width = Math.min(Math.max(r.width, 220), Math.max(220, window.innerWidth - 16))
        let left = r.left
        if (left + width > window.innerWidth - 8) {
            left = Math.max(8, window.innerWidth - width - 8)
        }
        setPos({
            left,
            width,
            top: abrirCima ? undefined : r.bottom + 6,
            bottom: abrirCima ? window.innerHeight - r.top + 6 : undefined,
            maxHeight: maxH,
        })
    }

    const fechar = () => {
        setAberto(false)
        setQuery('')
        setHighlight(0)
        setPos(null)
    }

    const abrir = () => {
        if (disabled || loading) return
        setQuery('')
        setHighlight(0)
        setAberto(true)
        requestAnimationFrame(() => {
            atualizarPosicao()
            searchRef.current?.focus()
        })
    }

    const escolher = (opt) => {
        if (!opt) return
        onChange?.(valorOpcao(opt, valueKey))
        fechar()
        triggerRef.current?.focus()
    }

    const limpar = (e) => {
        e?.preventDefault?.()
        e?.stopPropagation?.()
        onChange?.('')
        setQuery('')
        if (aberto) searchRef.current?.focus()
        else triggerRef.current?.focus()
    }

    useEffect(() => {
        if (!aberto) return undefined
        atualizarPosicao()
        const onReposition = (ev) => {
            if (portalRef.current && ev?.target && portalRef.current.contains(ev.target)) return
            atualizarPosicao()
        }
        const onClick = (ev) => {
            const t = ev.target
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

    const totalItens = filtrados.length + (podeCriar ? 1 : 0)
    const highlightSafe = totalItens
        ? Math.min(highlight, totalItens - 1)
        : 0

    const onTriggerKeyDown = (e) => {
        if (disabled || loading) return
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            if (!aberto) abrir()
        } else if (e.key === 'Escape' && aberto) {
            e.preventDefault()
            fechar()
        }
    }

    const onSearchKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHighlight((h) => Math.min(h + 1, Math.max(0, totalItens - 1)))
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight((h) => Math.max(0, h - 1))
        } else if (e.key === 'Enter') {
            e.preventDefault()
            if (podeCriar && highlightSafe >= filtrados.length) escolherCriar()
            else if (filtrados[highlightSafe]) escolher(filtrados[highlightSafe])
            else if (podeCriar) escolherCriar()
        } else if (e.key === 'Escape') {
            e.preventDefault()
            fechar()
            triggerRef.current?.focus()
        }
    }

    const listaPortal =
        aberto && pos && typeof document !== 'undefined'
            ? createPortal(
                  <div
                      ref={portalRef}
                      className="select_municipio_busca_painel"
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
                      <div className="select_municipio_busca_search">
                          <span className="select_municipio_busca_search_icon" aria-hidden="true">
                              <svg viewBox="0 0 20 20" width="16" height="16" fill="none">
                                  <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.6" />
                                  <path
                                      d="M12.8 12.8L16.5 16.5"
                                      stroke="currentColor"
                                      strokeWidth="1.6"
                                      strokeLinecap="round"
                                  />
                              </svg>
                          </span>
                          <input
                              ref={searchRef}
                              id={searchId}
                              type="search"
                              className="select_municipio_busca_search_input"
                              placeholder={searchPlaceholder}
                              value={query}
                              autoComplete="off"
                              aria-label={searchPlaceholder}
                              aria-controls={listId}
                              aria-autocomplete="list"
                              onChange={(e) => {
                                  setQuery(e.target.value)
                                  setHighlight(0)
                              }}
                              onKeyDown={onSearchKeyDown}
                          />
                      </div>
                      <ul id={listId} className="select_municipio_busca_lista" role="listbox">
                          {filtrados.length === 0 && !podeCriar ? (
                              <li className="select_municipio_busca_vazio" role="presentation">
                                  {loading ? 'A carregar…' : 'Nenhum resultado'}
                              </li>
                          ) : null}
                          {filtrados.map((o, idx) => {
                              const v = valorOpcao(o, valueKey)
                              const ativo = idx === highlightSafe
                              const sel = v === String(value ?? '').trim()
                              return (
                                  <li key={`${v}-${rotuloOpcao(o)}`} role="option" aria-selected={sel}>
                                      <button
                                          type="button"
                                          className={`select_municipio_busca_item${ativo ? ' is-active' : ''}${sel ? ' is-selected' : ''}`}
                                          onMouseEnter={() => setHighlight(idx)}
                                          onMouseDown={(ev) => ev.preventDefault()}
                                          onClick={() => escolher(o)}
                                      >
                                          <span className="select_municipio_busca_check" aria-hidden="true">
                                              {sel ? (
                                                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                                                      <path
                                                          d="M3.2 8.2L6.4 11.4L12.8 4.6"
                                                          stroke="currentColor"
                                                          strokeWidth="1.8"
                                                          strokeLinecap="round"
                                                          strokeLinejoin="round"
                                                      />
                                                  </svg>
                                              ) : null}
                                          </span>
                                          <span className="select_municipio_busca_item_label">
                                              {rotuloOpcao(o)}
                                          </span>
                                      </button>
                                  </li>
                              )
                          })}
                          {podeCriar ? (
                              <li role="option" aria-selected={false}>
                                  <button
                                      type="button"
                                      className={`select_municipio_busca_item select_municipio_busca_criar${
                                          highlightSafe >= filtrados.length ? ' is-active' : ''
                                      }`}
                                      onMouseEnter={() => setHighlight(filtrados.length)}
                                      onMouseDown={(ev) => ev.preventDefault()}
                                      onClick={escolherCriar}
                                  >
                                      <span className="select_municipio_busca_check" aria-hidden="true">
                                          +
                                      </span>
                                      <span className="select_municipio_busca_item_label">
                                          {typeof createLabel === 'function'
                                              ? createLabel(String(query || '').trim())
                                              : `Usar «${String(query || '').trim()}»`}
                                      </span>
                                  </button>
                              </li>
                          ) : null}
                      </ul>
                  </div>,
                  document.body,
              )
            : null

    const rotuloTrigger = loading
        ? 'A carregar…'
        : rotuloSelecionado || placeholder || emptyLabel

    return (
        <div
            ref={wrapRef}
            className={`select_municipio_busca${className ? ` ${className}` : ''}${disabled ? ' is-disabled' : ''}${aberto ? ' is-open' : ''}`}
        >
            {name ? <input type="hidden" name={name} value={String(value ?? '')} readOnly /> : null}
            <button
                ref={triggerRef}
                id={id}
                type="button"
                className={`select_municipio_busca_trigger${inputClassName ? ` ${inputClassName}` : ''}${!rotuloSelecionado ? ' is-placeholder' : ''}`}
                disabled={disabled || loading}
                aria-label={ariaLabel}
                aria-expanded={aberto}
                aria-haspopup="listbox"
                aria-controls={listId}
                onClick={() => (aberto ? fechar() : abrir())}
                onKeyDown={onTriggerKeyDown}
            >
                <span className="select_municipio_busca_trigger_label">{rotuloTrigger}</span>
                <span className="select_municipio_busca_trigger_actions">
                    {String(value || '').trim() && !disabled && !loading ? (
                        <span
                            role="button"
                            tabIndex={-1}
                            className="select_municipio_busca_clear"
                            aria-label="Limpar cidade"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={limpar}
                        >
                            ×
                        </span>
                    ) : null}
                    <span className="select_municipio_busca_chevron" aria-hidden="true">
                        <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                            <path
                                d="M4 6L8 10L12 6"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        </svg>
                    </span>
                </span>
            </button>
            {listaPortal}
        </div>
    )
}
