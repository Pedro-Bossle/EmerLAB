import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { normalizarTextoBusca } from '../../lib/prestadorCadastroHelpers.js'
import './SelectMunicipioBusca.css'

const MAX_SUGESTOES = 40

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
 * Combobox de município: digita para filtrar (parcial, sem acento) + escolhe na lista.
 * @param {{
 *   options?: Array<{ id?: string|number, nome: string }>,
 *   value?: string,
 *   onChange?: (value: string) => void,
 *   valueKey?: 'id'|'nome',
 *   disabled?: boolean,
 *   loading?: boolean,
 *   placeholder?: string,
 *   className?: string,
 *   inputClassName?: string,
 *   emptyLabel?: string,
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
    placeholder = 'Buscar cidade…',
    className = '',
    inputClassName = 'credenciamento_main_input',
    emptyLabel = '—',
    id,
    name,
    'aria-label': ariaLabel = 'Cidade',
}) {
    const reactId = useId()
    const listId = `${reactId}-list`
    const wrapRef = useRef(null)
    const inputRef = useRef(null)
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

    const rotuloSelecionado = selecionado ? rotuloOpcao(selecionado) : ''

    const filtrados = useMemo(() => {
        const lista = options || []
        const t = normalizarTextoBusca(query)
        if (!t) {
            return lista.slice(0, MAX_SUGESTOES)
        }
        const scored = []
        for (const o of lista) {
            const nomeN = normalizarTextoBusca(o.nome)
            if (!nomeN) continue
            if (!nomeN.includes(t)) continue
            const score = nomeN.startsWith(t) ? 0 : nomeN.indexOf(t) === 0 ? 0 : 1
            scored.push({ o, score, nomeN })
        }
        scored.sort((a, b) => a.score - b.score || a.nomeN.localeCompare(b.nomeN, 'pt-BR'))
        return scored.slice(0, MAX_SUGESTOES).map((x) => x.o)
    }, [options, query])

    const textoInput = aberto ? query : rotuloSelecionado

    const atualizarPosicao = () => {
        const el = wrapRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        const espacoAbaixo = window.innerHeight - r.bottom
        const abrirCima = espacoAbaixo < 220 && r.top > espacoAbaixo
        const maxH = Math.min(280, Math.max(120, abrirCima ? r.top - 12 : espacoAbaixo - 12))
        const width = Math.min(Math.max(r.width, 180), Math.max(180, window.innerWidth - 16))
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
        if (disabled || loading) return
        setQuery(rotuloSelecionado)
        setHighlight(0)
        setAberto(true)
        requestAnimationFrame(() => atualizarPosicao())
    }

    const fechar = () => {
        setAberto(false)
        setQuery('')
        setHighlight(0)
        setPos(null)
    }

    const escolher = (opt) => {
        if (!opt) return
        onChange?.(valorOpcao(opt, valueKey))
        fechar()
    }

    const resolverDigitado = (texto) => {
        const t = normalizarTextoBusca(texto)
        if (!t) {
            onChange?.('')
            return
        }
        const lista = options || []
        const exact = lista.find((o) => normalizarTextoBusca(o.nome) === t)
        if (exact) {
            onChange?.(valorOpcao(exact, valueKey))
            return
        }
        const starts = lista.filter((o) => normalizarTextoBusca(o.nome).startsWith(t))
        if (starts.length === 1) {
            onChange?.(valorOpcao(starts[0], valueKey))
            return
        }
        const contains = lista.filter((o) => normalizarTextoBusca(o.nome).includes(t))
        if (contains.length === 1) {
            onChange?.(valorOpcao(contains[0], valueKey))
            return
        }
        // Mantém seleção anterior se o texto digitado não resolve de forma única
    }

    useEffect(() => {
        if (!aberto) return undefined
        atualizarPosicao()
        const onReposition = (e) => {
            if (portalRef.current && e?.target && portalRef.current.contains(e.target)) return
            atualizarPosicao()
        }
        const onClick = (e) => {
            const t = e.target
            if (wrapRef.current?.contains(t) || portalRef.current?.contains(t)) return
            resolverDigitado(query)
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
        // eslint-disable-next-line react-hooks/exhaustive-deps -- fechar/resolver usam query atual no handler
    }, [aberto, query, options, valueKey])

    useEffect(() => {
        if (!aberto) return
        setHighlight((h) => (filtrados.length ? Math.min(h, filtrados.length - 1) : 0))
    }, [filtrados, aberto])

    const onKeyDown = (e) => {
        if (disabled || loading) return
        if (!aberto && (e.key === 'ArrowDown' || e.key === 'Enter')) {
            e.preventDefault()
            abrir()
            return
        }
        if (!aberto) return
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHighlight((h) => Math.min(h + 1, Math.max(0, filtrados.length - 1)))
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight((h) => Math.max(0, h - 1))
        } else if (e.key === 'Enter') {
            e.preventDefault()
            if (filtrados[highlight]) escolher(filtrados[highlight])
            else {
                resolverDigitado(query)
                fechar()
            }
        } else if (e.key === 'Escape') {
            e.preventDefault()
            fechar()
        }
    }

    const limpar = (e) => {
        e.preventDefault()
        e.stopPropagation()
        onChange?.('')
        setQuery('')
        inputRef.current?.focus()
        if (!aberto) abrir()
    }

    const listaPortal =
        aberto && pos && typeof document !== 'undefined'
            ? createPortal(
                  <ul
                      ref={portalRef}
                      id={listId}
                      className="select_municipio_busca_lista"
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
                      {filtrados.length === 0 ? (
                          <li className="select_municipio_busca_vazio" role="presentation">
                              {loading ? 'A carregar…' : 'Nenhuma cidade encontrada'}
                          </li>
                      ) : (
                          filtrados.map((o, idx) => {
                              const v = valorOpcao(o, valueKey)
                              const ativo = idx === highlight
                              const sel = v === String(value ?? '').trim()
                              return (
                                  <li key={`${v}-${rotuloOpcao(o)}`} role="option" aria-selected={sel || ativo}>
                                      <button
                                          type="button"
                                          className={`select_municipio_busca_item${ativo ? ' is-active' : ''}${sel ? ' is-selected' : ''}`}
                                          onMouseEnter={() => setHighlight(idx)}
                                          onMouseDown={(ev) => ev.preventDefault()}
                                          onClick={() => escolher(o)}
                                      >
                                          {rotuloOpcao(o)}
                                      </button>
                                  </li>
                              )
                          })
                      )}
                  </ul>,
                  document.body,
              )
            : null

    return (
        <div
            ref={wrapRef}
            className={`select_municipio_busca${className ? ` ${className}` : ''}${disabled ? ' is-disabled' : ''}`}
        >
            <div className="select_municipio_busca_campo">
                <input
                    ref={inputRef}
                    id={id}
                    name={name}
                    type="text"
                    role="combobox"
                    aria-label={ariaLabel}
                    aria-expanded={aberto}
                    aria-controls={listId}
                    aria-autocomplete="list"
                    autoComplete="off"
                    disabled={disabled || loading}
                    className={inputClassName}
                    placeholder={loading ? 'A carregar…' : placeholder || emptyLabel}
                    value={loading && !aberto ? 'A carregar…' : textoInput}
                    onChange={(e) => {
                        if (!aberto) abrir()
                        setQuery(e.target.value)
                        setHighlight(0)
                    }}
                    onFocus={() => abrir()}
                    onKeyDown={onKeyDown}
                />
                {String(value || '').trim() && !disabled && !loading ? (
                    <button
                        type="button"
                        className="select_municipio_busca_clear"
                        aria-label="Limpar cidade"
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={limpar}
                    >
                        ×
                    </button>
                ) : null}
            </div>
            {listaPortal}
        </div>
    )
}
