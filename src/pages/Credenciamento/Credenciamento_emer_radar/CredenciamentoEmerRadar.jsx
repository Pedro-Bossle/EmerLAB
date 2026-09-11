import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader, buttonClassName } from '../../../components/ui'
import SelectUfBusca from '../../../components/SelectUfBusca/SelectUfBusca.jsx'
import {
  emerRadarHealth,
  getDefaultSearchTerms,
  getEmerRadarApiBase,
  openPipelineStream,
  openScrapeStream,
  pipelineEnqueue,
  pipelineExportUrl,
  pipelineGetRun,
  pipelineListRuns,
  pipelinePreviewCities,
  pipelineResults,
  pipelineStart,
  pipelineStatus,
  pipelineStop,
  scrapeExportExcelUrl,
  scrapeResults,
  scrapeStart,
  scrapeStatus,
  scrapeStop,
} from '../../../lib/credenciamento/emerRadarApi.js'
import EmerRadarLoader from './EmerRadarLoader.jsx'
import './CredenciamentoEmerRadar.css'

const FONTES = [
  { id: 'maps', label: 'Google Maps' },
  { id: 'petlove', label: 'Petlove' },
  { id: 'petlife', label: 'Petlife' },
  { id: 'doglife', label: 'Doglife' },
  { id: 'emerdog', label: 'Emerdog' },
]

const PLANO_CLASS = {
  petlove: 'emer-radar-pill--petlove',
  petlife: 'emer-radar-pill--petlife',
  doglife: 'emer-radar-pill--doglife',
  emerdog: 'emer-radar-pill--emerdog',
}

function dash(v) {
  const s = String(v || '').trim()
  return s || '—'
}

function PlanoPills({ row }) {
  const planos = Array.isArray(row?.planos) ? row.planos : []
  if (!planos.length) return null
  return (
    <span>
      {planos.map((p) => (
        <span key={p} className={`emer-radar-pill ${PLANO_CLASS[p] || ''}`} title={p}>
          {p}
        </span>
      ))}
    </span>
  )
}

export default function CredenciamentoEmerRadar() {
  const [tab, setTab] = useState('pipeline')
  const [apiOk, setApiOk] = useState(null)
  const [apiError, setApiError] = useState('')

  useEffect(() => {
    let cancelled = false
    emerRadarHealth()
      .then((h) => {
        if (!cancelled) {
          setApiOk(true)
          setApiError('')
        }
        return h
      })
      .catch((e) => {
        if (!cancelled) {
          setApiOk(false)
          setApiError(e?.message || 'Worker Emer-Radar inacessível')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="el-page emer-radar-page">
      <PageHeader
        kicker="Credenciamento"
        title="Emer-Radar"
        description="Prospecção Maps + planos (Petlove, Petlife, Doglife, Emerdog). Substitui a coleta OSM."
        actions={
          <div className="emer-radar-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              className={tab === 'pipeline' ? 'is-active' : ''}
              onClick={() => setTab('pipeline')}
            >
              Pipeline
            </button>
            <button
              type="button"
              role="tab"
              className={tab === 'prospect' ? 'is-active' : ''}
              onClick={() => setTab('prospect')}
            >
              Prospect Maps
            </button>
          </div>
        }
      />

      <div className="el-stage mb-4 text-sm">
        <p className="m-0 text-ink-soft dark:text-[#9eb4c8]">
          API:{' '}
          <code className="text-xs">{getEmerRadarApiBase()}</code>
          {' · '}
          {apiOk === null && 'verificando…'}
          {apiOk === true && <span className="text-status-ok font-semibold">online</span>}
          {apiOk === false && (
            <span className="text-status-erro font-semibold">offline — {apiError}</span>
          )}
        </p>
        {apiOk === false && (
          <p className="mt-2 mb-0 text-xs text-ink-muted">
            Suba o worker: na pasta <code>teste-emeradar</code>, rode{' '}
            <code>python backend/main.py</code>. Em dev o EmerLAB faz proxy de{' '}
            <code>/emeradar</code> → porta 8000.
          </p>
        )}
      </div>

      {tab === 'pipeline' ? <PipelinePanel /> : <ProspectPanel />}
    </div>
  )
}

function PipelinePanel() {
  const [uf, setUf] = useState('RS')
  const [cidade, setCidade] = useState('')
  const [rows, setRows] = useState([])
  const [preview, setPreview] = useState([])
  const [fontes, setFontes] = useState({
    maps: true,
    petlove: true,
    petlife: true,
    doglife: true,
    emerdog: true,
  })
  const [maxPorTermo, setMaxPorTermo] = useState(80)
  const [sendEmail, setSendEmail] = useState(false)
  const [snap, setSnap] = useState(null)
  const [results, setResults] = useState([])
  const [pastRuns, setPastRuns] = useState([])
  const [selectedPastRun, setSelectedPastRun] = useState('')
  const [error, setError] = useState('')
  const [cooldownDays, setCooldownDays] = useState(70)

  const isRunning = snap?.status === 'RODANDO'

  const refreshRuns = useCallback(() => {
    pipelineListRuns()
      .then((r) => setPastRuns(r.runs || []))
      .catch(() => setPastRuns([]))
  }, [])

  useEffect(() => {
    refreshRuns()
    pipelineStatus()
      .then(setSnap)
      .catch(() => undefined)
  }, [refreshRuns])

  useEffect(() => {
    if (!isRunning) return undefined
    const es = openPipelineStream(0)
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data)
        if (data?.type === 'snapshot' || data?.status) {
          setSnap((prev) => ({ ...(prev || {}), ...data }))
        }
        if (data?.status === 'CONCLUIDO' || data?.type === 'done') {
          pipelineResults()
            .then((r) => setResults(r.results || []))
            .catch(() => undefined)
          refreshRuns()
        }
      } catch {
        /* ignore */
      }
    }
    es.onerror = () => {
      /* reconecta via polling abaixo */
    }
    const poll = setInterval(() => {
      pipelineStatus()
        .then(async (s) => {
          setSnap(s)
          if (s?.status === 'CONCLUIDO') {
            const r = await pipelineResults()
            setResults(r.results || [])
            refreshRuns()
          }
        })
        .catch(() => undefined)
    }, 4000)
    return () => {
      es.close()
      clearInterval(poll)
    }
  }, [isRunning, refreshRuns])

  const addCity = async () => {
    setError('')
    const c = cidade.trim()
    if (!c) {
      setError('Informe a cidade.')
      return
    }
    const next = [...rows, { cidade: c, uf }]
    setRows(next)
    setCidade('')
    try {
      const prev = await pipelinePreviewCities(next)
      setPreview(prev.cities || [])
      setCooldownDays(prev.cooldown_days || 70)
    } catch (e) {
      setError(e.message)
    }
  }

  const liberadas = useMemo(
    () => (preview.length ? preview : rows.map((r) => ({ ...r, bloqueada: false }))).filter((c) => !c.bloqueada),
    [preview, rows],
  )
  const bloqueadas = useMemo(
    () => (preview.length ? preview : []).filter((c) => c.bloqueada),
    [preview],
  )

  const handleStart = async () => {
    setError('')
    if (!rows.length) {
      setError('Adicione ao menos uma cidade.')
      return
    }
    const redes = FONTES.filter((f) => f.id !== 'maps' && fontes[f.id]).map((f) => f.id)
    try {
      const s = await pipelineStart({
        cidades: rows,
        fontes_maps: !!fontes.maps,
        fontes_rede: redes,
        max_por_termo: maxPorTermo,
        send_email: sendEmail,
      })
      setSnap(s)
      setResults([])
    } catch (e) {
      setError(e.message)
    }
  }

  const mapsRows = results.filter((r) => (r.origens || []).includes('maps') || !r.match_status)
  const onlyRede = results.filter((r) => r.match_status === 'somente_rede')

  return (
    <div className="space-y-4">
      <section className="el-stage">
        <h2 className="mt-0 mb-1 text-lg font-bold text-[#123e59] dark:text-[#e8f1f8]">
          Pipeline diário
        </h2>
        <p className="mt-0 mb-4 text-sm text-ink-muted">
          Informe cidades manualmente. Cooldown de {cooldownDays} dias após pesquisa bem-sucedida.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-semibold">UF</span>
            <SelectUfBusca value={uf} onChange={setUf} />
          </label>
          <label className="min-w-[200px] flex-1 text-sm">
            <span className="mb-1 block font-semibold">Cidade</span>
            <input
              className="w-full rounded-xl border border-line bg-white px-3 py-2 dark:border-white/15 dark:bg-[#152433]"
              value={cidade}
              onChange={(e) => setCidade(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCity()}
              placeholder="Ex.: Novo Hamburgo"
            />
          </label>
          <button type="button" className={buttonClassName()} onClick={addCity}>
            Adicionar
          </button>
        </div>

        {(preview.length > 0 || rows.length > 0) && (
          <div className="emer-radar-chip-row mt-3">
            {(preview.length ? preview : rows).map((c) => (
              <span
                key={`${c.cidade}-${c.uf}`}
                className={`emer-radar-chip ${c.bloqueada ? '' : 'is-on'}`}
              >
                {c.cidade}/{c.uf}
                {c.bloqueada ? ' · cooldown' : ''}
                <button
                  type="button"
                  className="ml-1 border-0 bg-transparent text-status-erro cursor-pointer"
                  onClick={() => {
                    const next = rows.filter(
                      (r) => !(r.cidade === c.cidade && r.uf === c.uf),
                    )
                    setRows(next)
                    if (next.length) {
                      pipelinePreviewCities(next)
                        .then((p) => setPreview(p.cities || []))
                        .catch(() => setPreview([]))
                    } else setPreview([])
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold">Fontes</p>
          <div className="emer-radar-chip-row">
            {FONTES.map((f) => (
              <label key={f.id} className={`emer-radar-chip ${fontes[f.id] ? 'is-on' : ''}`}>
                <input
                  type="checkbox"
                  checked={!!fontes[f.id]}
                  onChange={(e) => setFontes((prev) => ({ ...prev, [f.id]: e.target.checked }))}
                />
                {f.label}
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <label className="text-sm">
            Máx. por termo
            <input
              type="number"
              min={10}
              max={200}
              className="ml-2 w-20 rounded-lg border border-line px-2 py-1 dark:border-white/15 dark:bg-[#152433]"
              value={maxPorTermo}
              onChange={(e) => setMaxPorTermo(Number(e.target.value) || 80)}
            />
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sendEmail}
              onChange={(e) => setSendEmail(e.target.checked)}
            />
            Enviar e-mail (SMTP)
          </label>
          <div className="flex-1" />
          {isRunning ? (
            <button
              type="button"
              className={buttonClassName({ variant: 'danger' })}
              onClick={() => pipelineStop().then(setSnap)}
            >
              Parar
            </button>
          ) : (
            <>
              <button type="button" className={buttonClassName()} onClick={handleStart}>
                Iniciar pipeline ({liberadas.length} liberada
                {liberadas.length === 1 ? '' : 's'}
                {bloqueadas.length ? ` · ${bloqueadas.length} cooldown` : ''})
              </button>
              <button
                type="button"
                className={buttonClassName({ variant: 'secondary' })}
                onClick={async () => {
                  setError('')
                  try {
                    const res = await pipelineEnqueue(rows)
                    alert(`${res.enqueued} cidade(s) enfileirada(s) para o cron.`)
                  } catch (e) {
                    setError(e.message)
                  }
                }}
              >
                Enfileirar p/ cron
              </button>
            </>
          )}
        </div>

        {error && (
          <p className="mt-3 mb-0 rounded-xl border border-status-erro/30 bg-status-erro-bg px-3 py-2 text-sm text-status-erro">
            {error}
          </p>
        )}
      </section>

      {snap && (
        <section className="el-stage">
          {isRunning && (
            <EmerRadarLoader
              size="md"
              label="Pipeline Emer-Radar em varredura…"
              detail={[
                snap.progress?.cidade_atual,
                snap.progress?.fase,
                snap.progress?.total
                  ? `cidade ${snap.progress.index || 0}/${snap.progress.total}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          )}
          <h3 className="mt-0 font-bold">
            Status: {snap.status}
            {snap.run_id ? ` · ${snap.run_id}` : ''}
          </h3>
          <p className="text-sm text-ink-muted">
            {snap.progress?.cidade_atual || '—'} · {snap.progress?.index || 0}/
            {snap.progress?.total || 0} · {snap.encontrados ?? results.length} registros
          </p>
          <PipelineBar snap={snap} />
          {snap.error_message && (
            <p className="text-sm text-status-erro">{snap.error_message}</p>
          )}
          <pre className="mt-3 max-h-40 overflow-auto rounded-xl bg-[#0d1520] p-3 text-xs text-[#cfe8f8]">
            {(snap.logs || []).slice(-40).join('\n') || 'Sem logs ainda.'}
          </pre>
          {snap.status === 'CONCLUIDO' && (
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <a
                className="text-brand font-semibold underline"
                href={pipelineExportUrl('xlsx', snap.run_id)}
                target="_blank"
                rel="noreferrer"
              >
                Exportar Excel
              </a>
              <a
                className="text-brand font-semibold underline"
                href={pipelineExportUrl('html', snap.run_id)}
                target="_blank"
                rel="noreferrer"
              >
                Relatório HTML
              </a>
            </div>
          )}
        </section>
      )}

      <section className="el-stage">
        <h3 className="mt-0 font-bold">Pipelines anteriores</h3>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="min-w-[240px] flex-1 text-sm">
            <span className="mb-1 block font-semibold">Run</span>
            <select
              className="w-full rounded-xl border border-line px-3 py-2 dark:border-white/15 dark:bg-[#152433]"
              value={selectedPastRun}
              onChange={(e) => setSelectedPastRun(e.target.value)}
            >
              <option value="">Selecione…</option>
              {pastRuns.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label || r.id}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={buttonClassName()}
            disabled={!selectedPastRun || isRunning}
            onClick={async () => {
              try {
                const data = await pipelineGetRun(selectedPastRun)
                setResults(data.results || [])
                setSnap({
                  status: data.run?.status || 'CONCLUIDO',
                  run_id: data.run_id,
                  encontrados: data.total,
                  progress: data.run?.progress,
                  logs: data.run?.logs || [],
                })
              } catch (e) {
                setError(e.message)
              }
            }}
          >
            Carregar
          </button>
          <button type="button" className={buttonClassName({ variant: 'secondary' })} onClick={refreshRuns}>
            Atualizar lista
          </button>
        </div>
      </section>

      {results.length > 0 && (
        <>
          <section className="el-stage">
            <h3 className="mt-0 font-bold">
              Google Maps ({mapsRows.length})
            </h3>
            <ResultsTable rows={mapsRows} mode="maps" />
          </section>
          {onlyRede.length > 0 && (
            <section className="el-stage">
              <h3 className="mt-0 font-bold">Só planos ({onlyRede.length})</h3>
              <ResultsTable rows={onlyRede} mode="rede" />
            </section>
          )}
        </>
      )}
    </div>
  )
}

function PipelineBar({ snap }) {
  const total = snap.progress?.total || 0
  const index = snap.progress?.index || 0
  let percent = snap.progress?.percent
  if (percent == null) {
    if (snap.status === 'CONCLUIDO') percent = 100
    else if (total > 0) percent = Math.min(99, Math.round((index / total) * 100))
    else percent = snap.status === 'RODANDO' ? 5 : 0
  }
  if (snap.status === 'CONCLUIDO') percent = 100

  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-xs text-ink-muted">
        <span>{snap.progress?.fase || 'Progresso'}</span>
        <span className="font-semibold tabular-nums">{percent}%</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-line dark:bg-white/10">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${
            snap.status === 'ERRO'
              ? 'bg-status-erro'
              : snap.status === 'CONCLUIDO'
                ? 'bg-status-ok'
                : 'bg-brand'
          }`}
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
    </div>
  )
}

function ResultsTable({ rows, mode }) {
  if (!rows?.length) {
    return <p className="text-sm text-ink-muted">Nenhum registro.</p>
  }
  return (
    <div className="emer-radar-table-wrap mt-3">
      <table className="emer-radar-table">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Tipo</th>
            <th>Endereço</th>
            <th>Telefone</th>
            <th>Cidade</th>
            {mode === 'maps' ? <th>Planos</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id || `${r.nome}-${r.endereco}`}>
              <td className="font-semibold">{dash(r.nome)}</td>
              <td>{dash(r.categoria || r.tipo)}</td>
              <td>{dash(r.endereco)}</td>
              <td className="whitespace-nowrap">{dash(r.telefone || r.whatsapp)}</td>
              <td>{dash(r.cidade)}</td>
              {mode === 'maps' ? (
                <td>
                  <PlanoPills row={r} />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ProspectPanel() {
  const terms = getDefaultSearchTerms()
  const [uf, setUf] = useState('RS')
  const [cidade, setCidade] = useState('')
  const [maxResults, setMaxResults] = useState(80)
  const [termos, setTermos] = useState([...terms])
  const [snap, setSnap] = useState(null)
  const [results, setResults] = useState([])
  const [error, setError] = useState('')

  const status = snap?.status || 'IDLE'
  const isRunning = status === 'BUSCANDO' || status === 'FINALIZANDO'

  useEffect(() => {
    scrapeStatus()
      .then(setSnap)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!isRunning) return undefined
    const es = openScrapeStream(0)
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data)
        setSnap((prev) => ({ ...(prev || {}), ...data, status: data.status || prev?.status }))
        if (data.status === 'CONCLUIDO') {
          scrapeResults()
            .then((r) => setResults(r.results || []))
            .catch(() => undefined)
        }
      } catch {
        /* ignore */
      }
    }
    const poll = setInterval(() => {
      scrapeStatus()
        .then(async (s) => {
          setSnap(s)
          if (s?.status === 'CONCLUIDO') {
            const r = await scrapeResults()
            setResults(r.results || [])
          }
        })
        .catch(() => undefined)
    }, 4000)
    return () => {
      es.close()
      clearInterval(poll)
    }
  }, [isRunning])

  const handleStart = async () => {
    setError('')
    if (!cidade.trim()) {
      setError('Informe a cidade.')
      return
    }
    if (!termos.length) {
      setError('Selecione ao menos um termo.')
      return
    }
    try {
      const s = await scrapeStart({
        uf,
        cidade: cidade.trim(),
        max_results: maxResults,
        termos,
      })
      setSnap(s)
      setResults([])
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-4">
      <section className="el-stage">
        <h2 className="mt-0 mb-1 text-lg font-bold text-[#123e59] dark:text-[#e8f1f8]">
          Prospect Maps
        </h2>
        <p className="mt-0 mb-4 text-sm text-ink-muted">
          Busca rápida só no Google Maps (sem matching de planos).
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block font-semibold">UF</span>
            <SelectUfBusca value={uf} onChange={setUf} disabled={isRunning} />
          </label>
          <label className="text-sm sm:col-span-1">
            <span className="mb-1 block font-semibold">Cidade</span>
            <input
              className="w-full rounded-xl border border-line px-3 py-2 dark:border-white/15 dark:bg-[#152433]"
              value={cidade}
              disabled={isRunning}
              onChange={(e) => setCidade(e.target.value)}
              placeholder="Ex.: Caxias do Sul"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold">Máx. por termo</span>
            <input
              type="number"
              min={1}
              max={500}
              className="w-full rounded-xl border border-line px-3 py-2 dark:border-white/15 dark:bg-[#152433]"
              value={maxResults}
              disabled={isRunning}
              onChange={(e) => setMaxResults(Number(e.target.value) || 0)}
            />
          </label>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold">Termos</p>
          <div className="emer-radar-chip-row">
            {terms.map((t) => {
              const on = termos.includes(t)
              return (
                <label key={t} className={`emer-radar-chip ${on ? 'is-on' : ''}`}>
                  <input
                    type="checkbox"
                    disabled={isRunning}
                    checked={on}
                    onChange={() =>
                      setTermos((prev) =>
                        on ? prev.filter((x) => x !== t) : [...prev, t],
                      )
                    }
                  />
                  {t}
                </label>
              )
            })}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          {!isRunning ? (
            <button type="button" className={buttonClassName()} onClick={handleStart}>
              Iniciar busca
            </button>
          ) : (
            <button
              type="button"
              className={buttonClassName({ variant: 'danger' })}
              onClick={() => scrapeStop().then(setSnap)}
            >
              Parar busca
            </button>
          )}
          {results.length > 0 && (
            <a
              className={buttonClassName({ variant: 'secondary' })}
              href={scrapeExportExcelUrl()}
              target="_blank"
              rel="noreferrer"
            >
              Exportar Excel
            </a>
          )}
        </div>

        {error && (
          <p className="mt-3 mb-0 rounded-xl border border-status-erro/30 bg-status-erro-bg px-3 py-2 text-sm text-status-erro">
            {error}
          </p>
        )}
      </section>

      {(isRunning || status === 'CONCLUIDO' || status === 'ERRO') && (
        <section className="el-stage">
          {isRunning && (
            <EmerRadarLoader
              size="md"
              label="Emer-Radar em busca…"
              detail={
                snap?.progress?.termo_atual
                  ? `${snap.progress.termo_atual} · ${snap.progress.index || 0}/${snap.progress.total || 0}`
                  : status
              }
            />
          )}
          <p className="text-sm font-semibold">
            Status: {status}
            {status === 'CONCLUIDO'
              ? ` — ${snap?.progress?.encontrados ?? results.length} encontrados`
              : ''}
          </p>
          {snap?.error && (
            <p className="text-sm text-status-erro">{snap.error}</p>
          )}
        </section>
      )}

      {results.length > 0 && (
        <section className="el-stage">
          <h3 className="mt-0 font-bold">Resultados ({results.length})</h3>
          <ResultsTable rows={results} mode="rede" />
        </section>
      )}
    </div>
  )
}
