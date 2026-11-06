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
import { supabase } from '../../../lib/supabase.js'
import { emerRadarCarregarExecucao, emerRadarCatalogar } from '../../../lib/credenciamento/emerRadarApi.js'
import {
  PLANO_ORDER,
  cidadeFromEndereco,
  displayCategory,
  isSomenteRede,
  planoLabel,
  planoPrincipal,
  unifyContato,
} from '../../../lib/credenciamento/emerRadarUi.js'
import { exportarExecucaoEmerRadarParaExcel } from '../../../lib/credenciamento/exportEmerRadarRun.js'
import { enriquecerResultadosComSalvos } from '../../../lib/credenciamento/prospectosMapsRepo.js'
import { avisar } from '../../../lib/dialogos.js'
import EmerRadarProspectResults from './EmerRadarProspectResults.jsx'
import './CredenciamentoEmerRadar.css'

const PAGINA = 100

const semAcento = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

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

/** Linha das abas de redes de plano (tabelas), normalizada uma vez para filtrar e ordenar. */
function prepararLinha(r, i) {
  const cidade = cidadeFromEndereco(r.endereco, r.cidade) || String(r.bairro || '')
  return {
    r,
    key: `${r.id || r.nome}-${i}`,
    nome: String(r.nome || '').trim(),
    tipo: displayCategory(r),
    cidade,
    contato: unifyContato(r.telefone, r.whatsapp),
    credenciada: r.credenciada === true,
    busca: semAcento([r.nome, r.endereco, cidade, r.bairro, unifyContato(r.telefone, r.whatsapp)].join(' ')),
  }
}

const COLUNAS_PLANO = [
  { id: 'nome', rotulo: 'Nome' },
  { id: 'tipo', rotulo: 'Tipo' },
  { id: 'cidade', rotulo: 'Cidade / bairro' },
  { id: 'credenciada', rotulo: 'Credenciada' },
  { id: 'contato', rotulo: 'Contato' },
]

function comparar(a, b, col) {
  const va = a[col]
  const vb = b[col]
  const vazioA = va == null || va === ''
  const vazioB = vb == null || vb === ''
  if (vazioA && vazioB) return 0
  if (vazioA) return 1 // vazios sempre no fim, em qualquer direção
  if (vazioB) return -1
  if (typeof va === 'boolean' && typeof vb === 'boolean') return Number(va) - Number(vb)
  return String(va).localeCompare(String(vb), 'pt-BR', { sensitivity: 'base' })
}

/** Busca no catálogo as linhas já salvas deste run (para liberar Kanban/Remover e mostrar o status). */
async function lerSalvos(mapsIds) {
  const salvos = []
  for (let i = 0; i < mapsIds.length; i += 150) {
    const { data, error } = await supabase
      .from('cred_prospectos_maps')
      .select('*')
      .in('maps_id', mapsIds.slice(i, i + 150))
    if (error) throw new Error(error.message)
    salvos.push(...(data || []))
  }
  return salvos
}

/**
 * Resultados de uma execução do pipeline, em página própria (nova aba).
 * Google Maps: os mesmos cartões do catálogo (fachada, horários, mapa, Kanban). Redes de plano: tabelas.
 */
export default function EmerRadarExecucaoPage() {
  const { runId } = useParams()
  const [busca, setBusca] = useSearchParams()
  const [estado, setEstado] = useState({ carregando: true, erro: '', data: null })
  const [salvos, setSalvos] = useState([])
  const [catalogando, setCatalogando] = useState(false)

  const aba = busca.get('aba') || 'maps'
  const q = busca.get('q') || ''
  const fCidade = busca.get('cidade') || ''
  const fTipo = busca.get('tipo') || ''
  const fSituacao = busca.get('situacao') || ''
  const soContato = busca.get('contato') === '1'
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

  const carregar = useCallback(() => {
    setEstado({ carregando: true, erro: '', data: null })
    emerRadarCarregarExecucao(runId)
      .then(async (data) => {
        const maps = (data.results || []).filter((r) => !isSomenteRede(r))
        let jaSalvos = []
        try {
          jaSalvos = await lerSalvos(maps.map((r) => String(r.id || '')).filter(Boolean))
        } catch {
          /* sem leitura do catálogo: os cartões ficam só para consulta */
        }
        setSalvos(jaSalvos)
        setEstado({ carregando: false, erro: '', data })
      })
      .catch((e) => setEstado({ carregando: false, erro: e?.message || 'Não foi possível abrir a execução.', data: null }))
  }, [runId])
  useEffect(carregar, [carregar])

  const todos = useMemo(() => estado.data?.results || [], [estado.data])

  /** Registros do Maps como cartões, já cruzados com o catálogo (status, id salvo, fachada). */
  const cartoes = useMemo(
    () => enriquecerResultadosComSalvos(todos.filter((r) => !isSomenteRede(r)), salvos),
    [todos, salvos],
  )
  const naoSalvos = cartoes.filter((c) => !c._salvo).length

  const abas = useMemo(() => {
    const porFonte = new Map()
    todos.forEach((r, i) => {
      if (!isSomenteRede(r)) return
      const f = planoPrincipal(r)
      if (!porFonte.has(f)) porFonte.set(f, [])
      porFonte.get(f).push(prepararLinha(r, i))
    })
    const fontes = [
      ...PLANO_ORDER.filter((f) => porFonte.has(f)),
      ...[...porFonte.keys()].filter((f) => !PLANO_ORDER.includes(f)).sort(),
    ]
    return [
      { id: 'maps', rotulo: 'Google Maps', total: cartoes.length },
      ...fontes.map((f) => ({ id: f, rotulo: planoLabel(f), total: porFonte.get(f).length, linhas: porFonte.get(f) })),
    ]
  }, [todos, cartoes.length])

  const atual = abas.find((a) => a.id === aba) || abas[0]
  const ehMaps = atual?.id === 'maps'
  const baseRede = useMemo(() => atual?.linhas || [], [atual])

  const opcoes = useMemo(() => {
    const contar = (campo) => {
      const m = new Map()
      for (const l of baseRede) if (l[campo]) m.set(l[campo], (m.get(l[campo]) || 0) + 1)
      return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
    }
    return { cidades: contar('cidade'), tipos: contar('tipo') }
  }, [baseRede])

  const filtradas = useMemo(() => {
    const termo = semAcento(q).trim()
    const col = COLUNAS_PLANO.some((c) => c.id === ordem) ? ordem : 'nome'
    const lista = baseRede.filter((l) => {
      if (termo && !l.busca.includes(termo)) return false
      if (fCidade && l.cidade !== fCidade) return false
      if (fTipo && l.tipo !== fTipo) return false
      if (soContato && !l.contato) return false
      if (fSituacao === 'credenciada' && !l.credenciada) return false
      if (fSituacao === 'nao_credenciada' && l.credenciada) return false
      return true
    })
    const sinal = dir === 'desc' ? -1 : 1
    return [...lista].sort((a, b) => sinal * comparar(a, b, col) || a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [baseRede, q, fCidade, fTipo, soContato, fSituacao, ordem, dir])

  const temFiltro = Boolean(q || fCidade || fTipo || soContato || fSituacao)
  const visiveis = filtradas.slice(0, limite)
  const limpar = () => atualizar({ q: '', cidade: '', tipo: '', situacao: '', contato: '' })

  const ordenarPor = (id) => atualizar({ ordem: id, dir: ordem === id && dir === 'asc' ? 'desc' : 'asc' })

  const baixar = async () => {
    try {
      const lista = ehMaps ? todos.filter((r) => !isSomenteRede(r)) : filtradas.map((l) => l.r)
      const res = await exportarExecucaoEmerRadarParaExcel(lista, `${runId}${ehMaps ? '-maps' : `-${atual.id}`}`)
      if (!res.ok) avisar({ titulo: 'Nada para exportar', mensagem: res.erro })
    } catch (e) {
      avisar({ titulo: 'Falha ao gerar o Excel', mensagem: e?.message || 'Erro desconhecido.' })
    }
  }

  const adicionarAoCatalogo = async () => {
    setCatalogando(true)
    try {
      const r = await emerRadarCatalogar({ runId })
      avisar({
        titulo: 'Catálogo atualizado',
        mensagem: `${r.novos} novo${r.novos === 1 ? '' : 's'} no catálogo. Os que já estavam lá mantêm status e dados editados (só campos vazios são completados).`,
      })
      carregar()
    } catch (e) {
      avisar({ titulo: 'Não foi possível adicionar ao catálogo', mensagem: e?.message || 'Erro desconhecido.' })
    } finally {
      setCatalogando(false)
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
          <Button variant="secondary" onClick={() => void baixar()}>
            Baixar Excel
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
            onClick={() => atualizar({ aba: a.id === 'maps' ? '' : a.id, ordem: '', dir: '', cidade: '', tipo: '', situacao: '', contato: '' })}
          >
            {a.rotulo}
            <Badge tone={a.id === atual?.id ? 'info' : 'neutral'}>{a.total}</Badge>
          </button>
        ))}
      </nav>

      {abas.every((a) => a.total === 0) ? (
        <EmptyState title="Esta execução não tem registros" description="O pipeline terminou sem resultados." />
      ) : ehMaps ? (
        <>
          {naoSalvos > 0 ? (
            <p className="er-exec__alerta er-exec__alerta--warn" role="status">
              {naoSalvos} de {cartoes.length} registros ainda não estão no catálogo. Enquanto isso, Kanban e Remover ficam
              indisponíveis para eles.
            </p>
          ) : null}
          <EmerRadarProspectResults
            results={cartoes}
            titulo="Google Maps"
            mostrarExport={false}
            exigirSalvo
            acoes={
              naoSalvos > 0 ? (
                <Button onClick={() => void adicionarAoCatalogo()} disabled={catalogando}>
                  {catalogando ? 'Adicionando…' : `Adicionar ${naoSalvos} ao catálogo`}
                </Button>
              ) : null
            }
          />
        </>
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
            <Select label="Situação" value={fSituacao} onChange={(e) => atualizar({ situacao: e.target.value })}>
              <option value="">Todas</option>
              <option value="credenciada">Credenciada</option>
              <option value="nao_credenciada">Não credenciada</option>
            </Select>
            <div className="ek-toolbar__actions">
              <label className="ek-check">
                <input type="checkbox" checked={soContato} onChange={(e) => atualizar({ contato: e.target.checked })} />
                Só com contato
              </label>
              {temFiltro ? (
                <Button variant="secondary" onClick={limpar}>
                  Limpar filtros
                </Button>
              ) : null}
            </div>
          </Toolbar>

          <p className="er-run__contagem" role="status">
            {filtradas.length === baseRede.length ? `${filtradas.length} registros` : `${filtradas.length} de ${baseRede.length} registros`}
          </p>

          {filtradas.length === 0 ? (
            <EmptyState
              title="Nenhum registro com esses filtros"
              action={
                <Button variant="secondary" onClick={limpar}>
                  Limpar filtros
                </Button>
              }
            />
          ) : (
            <ResponsiveTable stack>
              <thead>
                <tr>
                  {COLUNAS_PLANO.map((c) => {
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
                {visiveis.map((l) => (
                  <tr key={l.key}>
                    <td data-label="Nome">
                      <strong>{l.nome || '—'}</strong>
                    </td>
                    <td data-label="Tipo">{l.tipo || '—'}</td>
                    <td data-label="Cidade / bairro">{l.cidade || '—'}</td>
                    <td data-label="Credenciada">
                      {l.r.credenciada === true ? (
                        <Badge tone="ok">Credenciada</Badge>
                      ) : l.r.credenciada === false ? (
                        <Badge>Não</Badge>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td data-label="Contato" className="whitespace-nowrap">
                      {l.contato || '—'}
                    </td>
                  </tr>
                ))}
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
