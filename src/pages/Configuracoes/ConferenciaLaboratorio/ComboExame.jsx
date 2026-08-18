import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { normalizarTextoBusca } from '../../../lib/prestadorCadastroHelpers.js'

function itemCorresponde(item, termo) {
    if (!termo) return true
    const blob = normalizarTextoBusca([item.rotulo, item.busca, item.id].filter(Boolean).join(' '))
    return blob.includes(termo)
}

/**
 * Dropdown de exames com busca e limpar (×).
 * Lista em portal para não ficar presa no overflow da tabela.
 */
export default function ComboExame({
    itens = [],
    value = '',
    disabled = false,
    placeholder = 'Buscar exame…',
    vazio = 'Nenhum exame',
    onChange,
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
        () => (itens || []).find((i) => String(i.id) === String(value)) || null,
        [itens, value],
    )

    const filtrados = useMemo(() => {
        const t = normalizarTextoBusca(query)
        return (itens || []).filter((i) => itemCorresponde(i, t)).slice(0, 80)
    }, [itens, query])

    const rotuloExibicao = selecionado?.rotulo || ''

    const atualizarPosicao = () => {
        const el = wrapRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        const espacoAbaixo = window.innerHeight - r.bottom
        const abrirCima = espacoAbaixo < 220 && r.top > espacoAbaixo
        const maxH = Math.min(280, Math.max(120, abrirCima ? r.top - 12 : espacoAbaixo - 12))
        const width = Math.min(Math.max(r.width, 240), Math.max(240, window.innerWidth - 16))
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

    const fechar = () => {
        setAberto(false)
        setQuery('')
        setHighlight(0)
        setPos(null)
    }

    const abrir = () => {
        if (disabled) return
        setQuery('')
        setHighlight(0)
        setAberto(true)
        requestAnimationFrame(() => atualizarPosicao())
    }

    const escolher = (item) => {
        if (!item) return
        onChange?.(item.id)
        fechar()
    }

    useEffect(() => {
        if (!aberto) return
        atualizarPosicao()
        const onReposition = (e) => {
            if (portalRef.current && e?.target && portalRef.current.contains(e.target)) return
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
            if (aberto && filtrados[highlight]) escolher(filtrados[highlight])
            else if (aberto && filtrados.length === 1) escolher(filtrados[0])
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
                          <div className="conf_lab_alias_combo_vazio">{vazio}</div>
                      ) : (
                          filtrados.map((item, idx) => {
                              const ativo = String(item.id) === String(value)
                              return (
                                  <button
                                      key={item.id || `${item.rotulo}-${idx}`}
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
                type="search"
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
                    aria-label="Limpar seleção"
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
