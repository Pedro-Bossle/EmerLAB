import { Children, Fragment, isValidElement, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { normalizarTextoBusca } from '../../lib/prestadorCadastroHelpers.js'
// Estilos do dropdown (UI Kit): mesmas classes do SelectMunicipioBusca, que agora é um invólucro deste componente.
import '../SelectMunicipioBusca/SelectMunicipioBusca.css'

const MAX_ITENS = 200
const BUSCA_AUTOMATICA_A_PARTIR_DE = 8

/**
 * Dropdown padrão do EmerLab (gatilho + painel com busca e ✓ no item escolhido).
 *
 * options: [{ value, label, group?, disabled? }]. `searchable`: true | false | 'auto' (busca se houver 8+ opções).
 * onChange(value, option). `clearable` mostra o × no gatilho quando há valor.
 * Teclado: ↑/↓ movem, Enter escolhe, Esc fecha. Painel em portal (não é cortado por tabelas/cartões).
 */
export function Dropdown({
  options = [],
  value = '',
  onChange,
  placeholder = 'Selecione…',
  searchPlaceholder = 'Buscar…',
  searchable = 'auto',
  clearable = false,
  disabled = false,
  loading = false,
  emptyLabel = 'Nenhum resultado',
  className = '',
  triggerClassName = '',
  id,
  name,
  title,
  'aria-label': ariaLabel,
  creatable = false,
  createLabel,
  onBlur,
  emptyAsPlaceholder = false,
}) {
  const reactId = useId()
  const listId = `${reactId}-list`
  const wrapRef = useRef(null)
  const triggerRef = useRef(null)
  const searchRef = useRef(null)
  const portalRef = useRef(null)
  const [aberto, setAberto] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [pos, setPos] = useState(null)

  const valorAtual = String(value ?? '')
  const comBusca = searchable === 'auto' ? options.length >= BUSCA_AUTOMATICA_A_PARTIR_DE || creatable : Boolean(searchable)

  const selecionado = useMemo(() => options.find((o) => String(o.value) === valorAtual) || null, [options, valorAtual])
  const vazioComoPlaceholder = emptyAsPlaceholder && valorAtual === ''
  const rotuloSelecionado = vazioComoPlaceholder ? '' : selecionado ? selecionado.label : valorAtual && !selecionado && creatable ? valorAtual : ''
  const mostraPlaceholder = !selecionado || vazioComoPlaceholder

  const filtrados = useMemo(() => {
    const t = normalizarTextoBusca(query)
    if (!t) return options.slice(0, MAX_ITENS)
    const pontuados = []
    for (const o of options) {
      const n = normalizarTextoBusca(o.label)
      if (!n || !n.includes(t)) continue
      pontuados.push({ o, score: n.startsWith(t) ? 0 : 1, n })
    }
    pontuados.sort((a, b) => a.score - b.score || a.n.localeCompare(b.n, 'pt-BR'))
    return pontuados.slice(0, MAX_ITENS).map((x) => x.o)
  }, [options, query])

  const podeCriar = useMemo(() => {
    if (!creatable) return false
    const t = String(query || '').trim()
    if (!t) return false
    const tn = normalizarTextoBusca(t)
    return !options.some((o) => normalizarTextoBusca(o.label) === tn)
  }, [creatable, query, options])

  const totalItens = filtrados.length + (podeCriar ? 1 : 0)
  const destaque = totalItens ? Math.min(highlight, totalItens - 1) : 0

  const atualizarPosicao = () => {
    const el = wrapRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const espacoAbaixo = window.innerHeight - r.bottom
    const abrirCima = espacoAbaixo < 260 && r.top > espacoAbaixo
    const maxHeight = Math.min(340, Math.max(160, abrirCima ? r.top - 12 : espacoAbaixo - 12))
    const width = Math.min(Math.max(r.width, 280), Math.max(220, window.innerWidth - 16))
    let left = r.left
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8)
    setPos({
      left,
      width,
      top: abrirCima ? undefined : r.bottom + 6,
      bottom: abrirCima ? window.innerHeight - r.top + 6 : undefined,
      maxHeight,
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
    // começa destacando o item atual
    const idx = options.findIndex((o) => String(o.value) === valorAtual)
    setHighlight(idx >= 0 ? idx : 0)
    setAberto(true)
    requestAnimationFrame(() => atualizarPosicao())
  }

  const escolher = (opt) => {
    if (!opt || opt.disabled) return
    onChange?.(String(opt.value ?? ''), opt)
    fechar()
    triggerRef.current?.focus()
  }

  const escolherCriar = () => {
    const t = String(query || '').trim()
    if (!t) return
    onChange?.(t, { value: t, label: t, criado: true })
    fechar()
    triggerRef.current?.focus()
  }

  const limpar = (e) => {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    onChange?.('', null)
    setQuery('')
    triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!aberto) return undefined
    atualizarPosicao()
    const reposicionar = (ev) => {
      if (portalRef.current && ev?.target && portalRef.current.contains(ev.target)) return
      atualizarPosicao()
    }
    const fora = (ev) => {
      const t = ev.target
      if (wrapRef.current?.contains(t) || portalRef.current?.contains(t)) return
      fechar()
    }
    window.addEventListener('scroll', reposicionar, true)
    window.addEventListener('resize', reposicionar)
    document.addEventListener('mousedown', fora)
    return () => {
      window.removeEventListener('scroll', reposicionar, true)
      window.removeEventListener('resize', reposicionar)
      document.removeEventListener('mousedown', fora)
    }
  }, [aberto])

  // Foco: na busca (se houver) assim que o painel existir; sem busca, no próprio painel (teclado).
  useEffect(() => {
    if (!aberto || !pos) return undefined
    const t = window.setTimeout(() => {
      const el = comBusca ? searchRef.current : portalRef.current
      el?.focus?.({ preventScroll: true })
      if (comBusca) el?.select?.()
    }, 0)
    return () => window.clearTimeout(t)
  }, [aberto, pos, comBusca])

  const moverOuEscolher = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, Math.max(0, totalItens - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(0, h - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (podeCriar && destaque >= filtrados.length) escolherCriar()
      else if (filtrados[destaque]) escolher(filtrados[destaque])
      else if (podeCriar) escolherCriar()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      fechar()
      triggerRef.current?.focus()
    } else if (e.key === 'Tab') {
      fechar()
    }
  }

  const aoTeclarGatilho = (e) => {
    if (disabled || loading) return
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!aberto) abrir()
    } else if (e.key === 'Escape' && aberto) {
      e.preventDefault()
      fechar()
    }
  }

  // Linhas com cabeçalho de grupo quando as opções trazem `group`.
  const itens = filtrados.map((o, idx) => ({
    o,
    idx,
    cabecalho: o.group && o.group !== filtrados[idx - 1]?.group ? o.group : null,
  }))

  const painel =
    aberto && pos && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={portalRef}
            className="select_municipio_busca_painel"
            tabIndex={-1}
            onKeyDown={comBusca ? undefined : moverOuEscolher}
            style={{
              position: 'fixed',
              left: pos.left,
              width: pos.width,
              top: pos.top,
              bottom: pos.bottom,
              maxHeight: pos.maxHeight,
              zIndex: 20000,
              outline: 'none',
            }}
          >
            {comBusca ? (
              <div className="select_municipio_busca_search">
                <span className="select_municipio_busca_search_icon" aria-hidden="true">
                  <svg viewBox="0 0 20 20" width="16" height="16" fill="none">
                    <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M12.8 12.8L16.5 16.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </span>
                <input
                  ref={searchRef}
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
                  onKeyDown={moverOuEscolher}
                />
              </div>
            ) : null}
            <ul id={listId} className="select_municipio_busca_lista" role="listbox">
              {filtrados.length === 0 && !podeCriar ? (
                <li className="select_municipio_busca_vazio" role="presentation">
                  {loading ? 'Carregando…' : emptyLabel}
                </li>
              ) : null}
              {itens.map(({ o, idx, cabecalho }) => {
                const sel = String(o.value) === valorAtual
                return (
                  <Fragment key={`${o.value}-${idx}`}>
                    {cabecalho ? (
                      <li role="presentation" className="select_municipio_busca_grupo">
                        {cabecalho}
                      </li>
                    ) : null}
                    <li role="option" aria-selected={sel} aria-disabled={o.disabled || undefined}>
                      <button
                        type="button"
                        disabled={o.disabled}
                        className={`select_municipio_busca_item${idx === destaque ? ' is-active' : ''}${sel ? ' is-selected' : ''}`}
                        onMouseEnter={() => setHighlight(idx)}
                        onMouseDown={(ev) => ev.preventDefault()}
                        onClick={() => escolher(o)}
                      >
                        <span className="select_municipio_busca_check" aria-hidden="true">
                          {sel ? (
                            <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                              <path d="M3.2 8.2L6.4 11.4L12.8 4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          ) : null}
                        </span>
                        <span className="select_municipio_busca_item_label">{o.label}</span>
                      </button>
                    </li>
                  </Fragment>
                )
              })}
              {podeCriar ? (
                <li role="option" aria-selected={false}>
                  <button
                    type="button"
                    className={`select_municipio_busca_item select_municipio_busca_criar${destaque >= filtrados.length ? ' is-active' : ''}`}
                    onMouseEnter={() => setHighlight(filtrados.length)}
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={escolherCriar}
                  >
                    <span className="select_municipio_busca_check" aria-hidden="true">+</span>
                    <span className="select_municipio_busca_item_label">
                      {typeof createLabel === 'function' ? createLabel(String(query || '').trim()) : `Usar «${String(query || '').trim()}»`}
                    </span>
                  </button>
                </li>
              ) : null}
            </ul>
          </div>,
          document.body,
        )
      : null

  const rotuloGatilho = loading ? 'Carregando…' : rotuloSelecionado || placeholder

  return (
    <div
      ref={wrapRef}
      className={`select_municipio_busca${className ? ` ${className}` : ''}${disabled ? ' is-disabled' : ''}${aberto ? ' is-open' : ''}`}
    >
      {name ? <input type="hidden" name={name} value={valorAtual} readOnly /> : null}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        title={title}
        className={`select_municipio_busca_trigger${triggerClassName ? ` ${triggerClassName}` : ''}${mostraPlaceholder ? ' is-placeholder' : ''}`}
        disabled={disabled || loading}
        aria-label={ariaLabel}
        aria-expanded={aberto}
        aria-haspopup="listbox"
        aria-controls={listId}
        onClick={() => (aberto ? fechar() : abrir())}
        onKeyDown={aoTeclarGatilho}
        onBlur={onBlur}
      >
        <span className="select_municipio_busca_trigger_label">{rotuloGatilho}</span>
        <span className="select_municipio_busca_trigger_actions">
          {clearable && valorAtual && !disabled && !loading ? (
            <span role="button" tabIndex={-1} className="select_municipio_busca_clear" aria-label="Limpar seleção" onMouseDown={(e) => e.preventDefault()} onClick={limpar}>
              ×
            </span>
          ) : null}
          <span className="select_municipio_busca_chevron" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
              <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </span>
      </button>
      {painel}
    </div>
  )
}

/** Converte os <option>/<optgroup> de um <select> em opções do Dropdown. */
function opcoesDeChildren(children) {
  const saida = []
  const visitar = (nos, grupo) => {
    Children.forEach(nos, (no) => {
      if (!isValidElement(no)) return
      if (no.type === Fragment) return visitar(no.props.children, grupo)
      if (no.type === 'optgroup') return visitar(no.props.children, no.props.label)
      if (no.type === 'option') {
        const texto = Children.toArray(no.props.children).join('')
        saida.push({
          value: no.props.value != null ? String(no.props.value) : texto,
          label: texto,
          disabled: Boolean(no.props.disabled),
          group: grupo,
        })
      }
    })
  }
  visitar(children, undefined)
  return saida
}

/**
 * Substitui <select> nativo mantendo a mesma API (value, onChange(e), disabled, name, id, className, <option> filhos).
 * onChange recebe um evento mínimo `{ target: { value, name } }`. `multiple` mantém o select nativo.
 */
export function SelectDropdown({ children, value, defaultValue, onChange, className = '', multiple, size, ref: _ref, ...resto }) {
  const opcoes = useMemo(() => opcoesDeChildren(children), [children])
  const [interno, setInterno] = useState(defaultValue ?? '')
  const controlado = value !== undefined
  if (multiple || size > 1) {
    return (
      <select className={className} value={value} defaultValue={defaultValue} onChange={onChange} multiple={multiple} size={size} {...resto}>
        {children}
      </select>
    )
  }
  const atual = controlado ? value : interno
  const vazio = opcoes.find((o) => o.value === '')
  return (
    <Dropdown
      options={opcoes}
      value={atual == null ? '' : String(atual)}
      placeholder={vazio?.label || 'Selecione…'}
      triggerClassName={className.split(' ').filter((c) => c && c !== 'ek-select').join(' ')}
      disabled={resto.disabled}
      id={resto.id}
      name={resto.name}
      title={resto.title}
      aria-label={resto['aria-label']}
      onBlur={resto.onBlur}
      onChange={(v) => {
        if (!controlado) setInterno(v)
        onChange?.({ target: { value: v, name: resto.name, id: resto.id }, currentTarget: { value: v, name: resto.name } })
      }}
    />
  )
}
