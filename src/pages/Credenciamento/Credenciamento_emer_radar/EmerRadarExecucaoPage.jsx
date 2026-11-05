import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  ResponsiveTable,
  Select,
  Toolbar,
} from '../../../components/ui'
import { emerRadarCarregarExecucao } from '../../../lib/credenciamento/emerRadarApi.js'
import {
  PLANO_ORDER,
  cidadeFromEndereco,
  displayCategory,
  formatarNotaMaps,
  isSomenteRede,
  isVinculado,
  planoLabel,
  planoPrincipal,
  unifyContato,
} from '../../../lib/credenciamento/emerRadarUi.js'
import { exportarExecucaoEmerRadarParaExcel } from '../../../lib/credenciamento/exportEmerRadarRun.js'
import { avisar } from '../../../lib/dialogos.js'
import './CredenciamentoEmerRadar.css'

const PAGINA = 100

const semAcento = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

const numero = (v) => {
  if (v == null || String(v).trim() === '') return null // ausente não é zero
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

const fmtDataHora = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

/** Campo de texto ligado à URL: digita sem perder letras e só grava na URL depois de uma pausa. */
function useCampoComPausa(valorUrl, gravar, espera = 250) {
  const [local, setLocal] = useState(valorUrl)
  const ultimoGravado = useRef(valorUrl)
  useEffect(() => {
    // Mudança vinda de fora (ex.: «Limpar filtros»): acompanha a URL.
    if (valorUrl !== ultimoGravado.current) {
      ultimoGravado.current = valorUrl
      setLocal(valorUrl)
    }
  }, [valorUrl])
  useEffect(() => {
    if (local === ultimoGravado.current) return undefined
    const t = setTimeout(() => {
      ultimoGravado.current = local
      gravar(local)
    }, espera)
    return () => clearTimeout(t)
  }, [local, gravar, espera])
  return [local, setLocal]
}

/** Dados normalizados por registro (uma vez), para filtrar e ordenar sem refazer parsing. */
function prepararLinha(r, i) {
  const cidade = cidadeFromEndereco(r.endereco, r.cidade) || ''
  const tipo = displayCategory(r)
  const contato = unifyContato(r.telefone, r.whatsapp)
  return {
    r,
    key: `${r.id || r.nome}-${i}`,
    nome: String(r.nome || '').trim(),
    tipo,
    cidade,
    uf: String(r.uf || '').trim().toUpperCase(),
    contato,
    nota: (() => {
      const n = numero(formatarNotaMaps(r.nota))
      return n > 0 ? n : null // 0 = sem avaliação
    })(),
    avaliacoes: numero(r.num_avaliacoes),
    vinculado: isVinculado(r),
    credenciada: r.credenciada === true,
    busca: semAcento([r.nome, r.endereco, cidade, tipo, r.bairro, contato].join(' ')),
  }
}

const COLUNAS_MAPS = [
  { id: 'nome', rotulo: 'Nome' },
  { id: 'tipo', rotulo: 'Tipo' },
  { id: 'cidade', rotulo: 'Cidade' },
  { id: 'nota', rotulo: 'Nota', numerica: true },
  { id: 'avaliacoes', rotulo: 'Avaliações', numerica: true },
  { id: 'contato', rotulo: 'Contato' },
]
const COLUNAS_PLANO = [
  { id: 'nome', rotulo: 'Nome' },
  { id: 'tipo', rotulo: 'Tipo' },
  { id: 'cidade', rotulo: 'Cidade / bairro' },
  { id: 'credenciada', rotulo: 'Credenciada' },
  { id: 'contato', rotulo: 'Contato' },
]

function hrefMaps(r) {
  const direto = String(r?.link_maps || '').trim()
  if (direto) return direto
  const q = [r?.nome, r?.endereco, r?.cidade, r?.uf].filter(Boolean).join(', ')
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : ''
}

function comparar(a, b, col) {
  const va = a[col]
  const vb = b[col]
  const vazioA = va == null || va === ''
  const vazioB = vb == null || vb === ''
  if (vazioA && vazioB) return 0
  if (vazioA) return 1 // vazios sempre no fim, em qualquer direção
  if (vazioB) return -1
  if (typeof va === 'number' && typeof vb === 'number') return va - vb
  if (typeof va === 'boolean' && typeof vb === 'boolean') return Number(va) - Number(vb)
  return String(va).localeCompare(String(vb), 'pt-BR', { sensitivity: 'base' })
}

/**
 * Resultados de uma execução do pipeline, em página própria (nova aba):
 * abas por fonte, busca, filtros, ordenação por coluna e Excel.
 */
export default function EmerRadarExecucaoPage() {
  const { runId } = useParams()
  const [busca, setBusca] = useSearchParams()
  const [estado, setEstado] = useState({ carregando: true, erro: '', data: null })

  const aba = busca.get('aba') || 'maps'
  const q = busca.get('q') || ''
  const fCidade = busca.get('cidade') || ''
  const fTipo = busca.get('tipo') || ''
  const fVinculo = busca.get('vinculo') || ''
  const soContato = busca.get('contato') === '1'
  const notaMin = busca.get('nota') || ''
  const ordem = busca.get('ordem') || 'nome'
  const dir = busca.get('dir') === 'desc' ? 'desc' : 'asc'
  const limite = Number(busca.get('n')) || PAGINA

  const atualizar = useCallback(
    (patch) =>
      setBusca(
      (prev) => {
        const p = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(patch)) {
          if (v === '' || v == null || v === false) p.delete(k)
          else p.set(k, String(v))
        }
        if (!('n' in patch)) p.delete('n')
        return p
      },
      { replace: true },
    ),
    [setBusca],
  )

  const [qLocal, setQLocal] = useCampoComPausa(q, useCallback((v) => atualizar({ q: v }), [atualizar]))
  const [notaLocal, setNotaLocal] = useCampoComPausa(notaMin, useCallback((v) => atualizar({ nota: v }), [atualizar]))

  const carregar = () => {
    setEstado({ carregando: true, erro: '', data: null })
    emerRadarCarregarExecucao(runId)
      .then((data) => setEstado({ carregando: false, erro: '', data }))
      .catch((e) => setEstado({ carregando: false, erro: e?.message || 'Não foi possível abrir a execução.', data: null }))
  }
  useEffect(carregar, [runId]) // eslint-disable-line react-hooks/exhaustive-deps

  const linhas = useMemo(() => (estado.data?.results || []).map(prepararLinha), [estado.data])

  /** Abas: Maps + cada rede que tem registro exclusivo. */
  const abas = useMemo(() => {
    const maps = linhas.filter((l) => !isSomenteRede(l.r))
    const porFonte = new Map()
    for (const l of linhas) {
      if (!isSomenteRede(l.r)) continue
      const f = planoPrincipal(l.r)
      if (!porFonte.has(f)) porFonte.set(f, [])
      porFonte.get(f).push(l)
    }
    const ordemFontes = [
      ...PLANO_ORDER.filter((f) => porFonte.has(f)),
      ...[...porFonte.keys()].filter((f) => !PLANO_ORDER.includes(f)).sort(),
    ]
    return [
      { id: 'maps', rotulo: 'Google Maps', linhas: maps, colunas: COLUNAS_MAPS },
      ...ordemFontes.map((f) => ({ id: f, rotulo: planoLabel(f), linhas: porFonte.get(f), colunas: COLUNAS_PLANO })),
    ]
  }, [linhas])

  const atual = abas.find((a) => a.id === aba) || abas[0]
  const ehMaps = atual?.id === 'maps'

  const opcoes = useMemo(() => {
    const base = atual?.linhas || []
    const contar = (campo) => {
      const m = new Map()
      for (const l of base) if (l[campo]) m.set(l[campo], (m.get(l[campo]) || 0) + 1)
      return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
    }
    return { cidades: contar('cidade'), tipos: contar('tipo') }
  }, [atual])

  const filtradas = useMemo(() => {
    const termo = semAcento(q).trim()
    // O campo numérico entrega «4.5» (ponto) ou «4,5» (vírgula): ambos são decimais, nunca milhar.
    const minBruto = ehMaps ? Number(String(notaMin).replace(',', '.')) : NaN
    const min = notaMin !== '' && Number.isFinite(minBruto) ? minBruto : null
    const col = (atual?.colunas || []).some((c) => c.id === ordem) ? ordem : 'nome'
    const lista = (atual?.linhas || []).filter((l) => {
      if (termo && !l.busca.includes(termo)) return false
      if (fCidade && l.cidade !== fCidade) return false
      if (fTipo && l.tipo !== fTipo) return false
      if (soContato && !l.contato) return false
      if (min != null && !(l.nota != null && l.nota >= min)) return false
      if (fVinculo === 'vinculado' && !l.vinculado) return false
      if (fVinculo === 'novo' && l.vinculado) return false
      if (fVinculo === 'credenciada' && !l.credenciada) return false
      if (fVinculo === 'nao_credenciada' && l.credenciada) return false
      return true
    })
    const sinal = dir === 'desc' ? -1 : 1
    return [...lista].sort((a, b) => sinal * comparar(a, b, col) || a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [atual, ehMaps, q, fCidade, fTipo, soContato, notaMin, fVinculo, ordem, dir])

  const temFiltro = Boolean(q || fCidade || fTipo || soContato || (ehMaps && notaMin) || fVinculo)
  const visiveis = filtradas.slice(0, limite)

  const ordenarPor = (id) =>
    atualizar({ ordem: id, dir: ordem === id && dir === 'asc' ? 'desc' : 'asc' })

  const baixar = async () => {
    try {
      const res = await exportarExecucaoEmerRadarParaExcel(
        filtradas.map((l) => l.r),
        `${runId}${temFiltro ? '-filtrado' : ''}`,
      )
      if (!res.ok) avisar({ titulo: 'Nada para exportar', mensagem: res.erro })
    } catch (e) {
      avisar({ titulo: 'Falha ao gerar o Excel', mensagem: e?.message || 'Erro desconhecido.' })
    }
  }

  const run = estado.data?.run
  const cidadesRun = (run?.cidades || []).map((c) => `${c.cidade}/${c.uf}`).join(', ')

  if (estado.carregando) return <div className="el-page emer-radar-page"><LoadingState label="Carregando execução…" /></div>
  if (estado.erro) {
    return (
      <div className="el-page emer-radar-page">
        <ErrorState title="Não foi possível abrir a execução" description={estado.erro} onRetry={carregar} />
      </div>
    )
  }

  return (
    <div className="el-page emer-radar-page er-run">
      <PageHeader
        kicker="Emer-Radar"
        title={`Execução de ${fmtDataHora(run?.started_at) || runId}`}
        description={`${cidadesRun || 'Cidades não informadas'} · ${estado.data.total} registros`}
        actions={
          <Button variant="secondary" onClick={() => void baixar()} disabled={!filtradas.length}>
            {temFiltro ? `Excel (${filtradas.length} filtrados)` : 'Baixar Excel'}
          </Button>
        }
      />

      <nav className="er-run__abas" aria-label="Fontes da execução">
        {abas.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`er-run__aba${a.id === atual?.id ? ' is-active' : ''}`}
            aria-current={a.id === atual?.id ? 'page' : undefined}
            onClick={() => atualizar({ aba: a.id === 'maps' ? '' : a.id, ordem: '', dir: '', cidade: '', tipo: '', vinculo: '', nota: '', contato: '' })}
          >
            {a.rotulo}
            <Badge tone={a.id === atual?.id ? 'info' : 'neutral'}>{a.linhas.length}</Badge>
          </button>
        ))}
      </nav>

      {abas.every((a) => a.linhas.length === 0) ? (
        <EmptyState title="Esta execução não tem registros" description="O pipeline terminou sem resultados." />
      ) : (
        <>
          <Toolbar title="Filtros e ordenação" stickyTop={0}>
            <Input
              label="Buscar"
              type="search"
              placeholder="Nome, endereço, telefone…"
              value={qLocal}
              onChange={(e) => setQLocal(e.target.value)}
            />
            <Select label="Cidade" value={fCidade} onChange={(e) => atualizar({ cidade: e.target.value })}>
              <option value="">Todas ({opcoes.cidades.length})</option>
              {opcoes.cidades.map(([c, n]) => (
                <option key={c} value={c}>
                  {c} ({n})
                </option>
              ))}
            </Select>
            <Select label="Tipo" value={fTipo} onChange={(e) => atualizar({ tipo: e.target.value })}>
              <option value="">Todos</option>
              {opcoes.tipos.map(([t, n]) => (
                <option key={t} value={t}>
                  {t} ({n})
                </option>
              ))}
            </Select>
            <Select label={ehMaps ? 'Vínculo com planos' : 'Situação'} value={fVinculo} onChange={(e) => atualizar({ vinculo: e.target.value })}>
              <option value="">Todos</option>
              {ehMaps ? (
                <>
                  <option value="vinculado">Já está em algum plano</option>
                  <option value="novo">Fora dos planos (prospecção)</option>
                </>
              ) : (
                <>
                  <option value="credenciada">Credenciada</option>
                  <option value="nao_credenciada">Não credenciada</option>
                </>
              )}
            </Select>
            {ehMaps ? (
              <Input
                label="Nota mínima"
                type="number"
                min="0"
                max="5"
                step="0.1"
                placeholder="ex.: 4,5"
                value={notaLocal}
                onChange={(e) => setNotaLocal(e.target.value)}
              />
            ) : null}
            <div className="ek-toolbar__actions">
              <label className="ek-check">
                <input type="checkbox" checked={soContato} onChange={(e) => atualizar({ contato: e.target.checked })} />
                Só com contato
              </label>
              {temFiltro ? (
                <Button
                  variant="secondary"
                  onClick={() => atualizar({ q: '', cidade: '', tipo: '', vinculo: '', contato: '', nota: '' })}
                >
                  Limpar filtros
                </Button>
              ) : null}
            </div>
          </Toolbar>

          <p className="er-run__contagem" role="status">
            {filtradas.length === (atual?.linhas.length || 0)
              ? `${filtradas.length} registros`
              : `${filtradas.length} de ${atual?.linhas.length} registros`}
          </p>

          {filtradas.length === 0 ? (
            <EmptyState
              title="Nenhum registro com esses filtros"
              action={<Button variant="secondary" onClick={() => atualizar({ q: '', cidade: '', tipo: '', vinculo: '', contato: '', nota: '' })}>Limpar filtros</Button>}
            />
          ) : (
            <ResponsiveTable stack>
              <thead>
                <tr>
                  {atual.colunas.map((c) => {
                    const ativo = ordem === c.id || (!busca.get('ordem') && c.id === 'nome')
                    return (
                      <th key={c.id} aria-sort={ativo ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        <button type="button" className="er-run__sort" onClick={() => ordenarPor(c.id)}>
                          {c.rotulo}
                          <span aria-hidden>{ativo ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                        </button>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {visiveis.map((l) => {
                  const href = hrefMaps(l.r)
                  return (
                    <tr key={l.key}>
                      <td data-label="Nome">
                        <strong>{l.nome || '—'}</strong>
                        {href ? (
                          <>
                            {' '}
                            <a href={href} target="_blank" rel="noopener noreferrer" className="er-run__maps">
                              Maps ↗
                            </a>
                          </>
                        ) : null}
                        {ehMaps && l.vinculado ? (
                          <div className="er-run__planos">
                            {(l.r.planos || []).map((p) => (
                              <Badge key={p} tone="info">
                                {planoLabel(p)}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                      </td>
                      <td data-label="Tipo">{l.tipo || '—'}</td>
                      <td data-label="Cidade">{l.cidade || l.r.bairro || '—'}</td>
                      {ehMaps ? (
                        <>
                          <td data-label="Nota" className="tabular-nums">
                            {l.nota != null ? l.nota.toFixed(1).replace('.', ',') : '—'}
                          </td>
                          <td data-label="Avaliações" className="tabular-nums">
                            {l.avaliacoes ?? '—'}
                          </td>
                        </>
                      ) : (
                        <td data-label="Credenciada">
                          {l.r.credenciada === true ? (
                            <Badge tone="ok">Credenciada</Badge>
                          ) : l.r.credenciada === false ? (
                            <Badge>Não</Badge>
                          ) : (
                            '—'
                          )}
                        </td>
                      )}
                      <td data-label="Contato" className="whitespace-nowrap">
                        {l.contato || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </ResponsiveTable>
          )}

          {filtradas.length > visiveis.length ? (
            <div className="er-run__mais">
              <Button variant="secondary" onClick={() => atualizar({ n: limite + PAGINA })}>
                Mostrar mais {Math.min(PAGINA, filtradas.length - visiveis.length)} ({visiveis.length} de {filtradas.length})
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
