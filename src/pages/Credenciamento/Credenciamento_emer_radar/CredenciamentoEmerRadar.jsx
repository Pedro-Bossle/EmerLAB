import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader, buttonClassName } from '../../../components/ui'
import SelectMunicipioBusca from '../../../components/SelectMunicipioBusca/SelectMunicipioBusca.jsx'
import SelectUfBusca from '../../../components/SelectUfBusca/SelectUfBusca.jsx'
import {
  deleteCity,
  emerRadarHealth,
  emerRadarGetSettings,
  emerRadarSaveSettings,
  getDefaultSearchTerms,
  getEmerRadarApiBase,
  listCities,
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
  scrapeExportPdfUrl,
  scrapeResults,
  scrapeStart,
  scrapeStatus,
  scrapeStop,
} from '../../../lib/credenciamento/emerRadarApi.js'
import {
  FASE_PIPELINE_LABEL,
  PLANO_ORDER,
  STATUS_SCRAPE_LABEL,
  cidadeDisponivel,
  cidadeEmCooldown,
  cidadeFromEndereco,
  formatDateBR,
  isSomenteRede,
  isVinculado,
  planoLabel,
  planoPrincipal,
  unifyContato,
} from '../../../lib/credenciamento/emerRadarUi.js'
import {
  LIMIAR_MARCADORES_CRON,
  enfileirarCidadesQueBateramLimiar,
  listarContadoresTrafego,
  processarTrafegoDoDia,
} from '../../../lib/credenciamento/trafegoCidades.js'
import { listarUsuariosParaAtribuicao } from '../../../lib/homeTarefas.js'
import {
  STATUS_PROSPECCAO_MAPS_OPCOES,
  enriquecerResultadosComSalvos,
  listarCidadesUfProspectosMaps,
  listarProspectosMaps,
  mapsIdDeEstabelecimento,
  montarFilaAtualizacaoCatalogo,
  rowMapsParaCardUi,
  upsertProspectosMapsDeColeta,
} from '../../../lib/credenciamento/prospectosMapsRepo.js'
import { buscarMunicipiosPorUf, mesclarMunicipiosComExtras } from '../../../lib/ibgeLocalidades.js'
import EmerRadarLoader from './EmerRadarLoader.jsx'
import EmerRadarProspectResults from './EmerRadarProspectResults.jsx'
import './CredenciamentoEmerRadar.css'

const SELECT_CIDADE_INPUT =
  'w-full rounded-xl border border-line px-3 py-2 dark:border-white/15 dark:bg-[#152433]'

/** Municípios IBGE por UF (cache no lib). */
function useMunicipiosPorUf(uf) {
  const [municipios, setMunicipios] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const sigla = String(uf || '').trim().toUpperCase()
    if (!sigla) {
      setMunicipios([])
      setLoading(false)
      return undefined
    }
    let cancelled = false
    setLoading(true)
    buscarMunicipiosPorUf(sigla)
      .then((lista) => {
        if (!cancelled) setMunicipios(lista || [])
      })
      .catch(() => {
        if (!cancelled) setMunicipios([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [uf])

  return { municipios, loading }
}

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

  const statusLabel =
    apiOk === null ? 'Verificando API…' : apiOk ? 'API online' : `API offline${apiError ? ` — ${apiError}` : ''}`
  const statusTone = apiOk === null ? 'checking' : apiOk ? 'ok' : 'erro'

  return (
    <div className="el-page emer-radar-page">
      <PageHeader
        kicker="Credenciamento"
        title={
          <span className="emer-radar-title-with-status">
            Emer-Radar
            <span
              className={`emer-radar-status-dot emer-radar-status-dot--${statusTone}`}
              title={statusLabel}
              aria-label={statusLabel}
              role="status"
            />
          </span>
        }
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

      {apiOk === false ? (
        <div className="el-stage mb-4 text-sm">
          <p className="m-0 text-status-erro">
            Worker inacessível (<code className="text-xs">{getEmerRadarApiBase()}</code>
            {apiError ? ` — ${apiError}` : ''}).
          </p>
          <p className="mt-2 mb-0 text-xs text-ink-muted">
            Suba o worker: na pasta <code>teste-emeradar</code>, rode{' '}
            <code>python backend/main.py</code>. Em dev o EmerLAB faz proxy de{' '}
            <code>/emeradar</code> → porta 8000.
          </p>
        </div>
      ) : null}

      {tab === 'pipeline' ? <PipelinePanel /> : <ProspectPanel />}
    </div>
  )
}

function PipelinePanel() {
  const [uf, setUf] = useState('RS')
  const [cidade, setCidade] = useState('')
  const { municipios, loading: loadingMun } = useMunicipiosPorUf(uf)
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
  const [usuarios, setUsuarios] = useState([])
  const [destinatarios, setDestinatarios] = useState([])
  const [settingsMsg, setSettingsMsg] = useState('')
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [registry, setRegistry] = useState([])
  const [trafegoTexto, setTrafegoTexto] = useState('')
  const [trafegoUf, setTrafegoUf] = useState('RS')
  const [trafegoContadores, setTrafegoContadores] = useState([])
  const [trafegoBusy, setTrafegoBusy] = useState(false)
  const [trafegoMsg, setTrafegoMsg] = useState('')
  const [trafegoErro, setTrafegoErro] = useState('')

  const isRunning = snap?.status === 'RODANDO'

  const refreshRuns = useCallback(() => {
    pipelineListRuns()
      .then((r) => setPastRuns(r.runs || []))
      .catch(() => setPastRuns([]))
  }, [])

  const refreshRegistry = useCallback(() => {
    listCities()
      .then((r) => {
        setRegistry(r.cities || [])
        if (r.cooldown_days) setCooldownDays(r.cooldown_days)
      })
      .catch(() => setRegistry([]))
  }, [])

  const refreshTrafego = useCallback(() => {
    listarContadoresTrafego()
      .then(setTrafegoContadores)
      .catch(() => setTrafegoContadores([]))
  }, [])

  useEffect(() => {
    refreshRuns()
    refreshRegistry()
    refreshTrafego()
    pipelineStatus()
      .then(setSnap)
      .catch(() => undefined)
    emerRadarGetSettings()
      .then((s) => setDestinatarios(s.tarefa_destinatarios || []))
      .catch(() => undefined)
    listarUsuariosParaAtribuicao()
      .then(setUsuarios)
      .catch(() => setUsuarios([]))
  }, [refreshRuns, refreshRegistry, refreshTrafego])

  useEffect(() => {
    if (!rows.length) {
      setPreview([])
      return undefined
    }
    const t = setTimeout(() => {
      pipelinePreviewCities(rows)
        .then((p) => {
          setPreview(p.cities || [])
          if (p.cooldown_days) setCooldownDays(p.cooldown_days)
        })
        .catch(() => undefined)
    }, 250)
    return () => clearTimeout(t)
  }, [rows])

  useEffect(() => {
    if (!isRunning) return undefined
    const es = openPipelineStream(0)
    const refreshStatus = () => {
      pipelineStatus().then(setSnap).catch(() => undefined)
    }
    ;['status', 'city_started', 'city_finished', 'message'].forEach((name) => {
      es.addEventListener(name, refreshStatus)
    })
    es.addEventListener('done', async () => {
      try {
        const s = await pipelineStatus()
        setSnap(s)
        const r = await pipelineResults()
        setResults(r.results || [])
        refreshRuns()
        refreshRegistry()
      } catch {
        /* ignore */
      }
      es.close()
    })
    const poll = setInterval(() => {
      pipelineStatus()
        .then(async (s) => {
          setSnap(s)
          if (s?.status === 'CONCLUIDO') {
            const r = await pipelineResults()
            setResults(r.results || [])
            refreshRuns()
            refreshRegistry()
          }
        })
        .catch(() => undefined)
    }, 4000)
    return () => {
      es.close()
      clearInterval(poll)
    }
  }, [isRunning, refreshRuns, refreshRegistry])

  const addCity = () => {
    setError('')
    const c = cidade.trim()
    if (!c) {
      setError('Informe a cidade.')
      return
    }
    setRows((prev) => {
      if (prev.some((r) => r.cidade.toLowerCase() === c.toLowerCase() && r.uf === uf)) return prev
      return [...prev, { cidade: c, uf }]
    })
    setCidade('')
  }

  const liberadas = useMemo(
    () => (preview.length ? preview : rows).filter((c) => cidadeDisponivel(c)),
    [preview, rows],
  )
  const bloqueadas = useMemo(
    () => (preview.length ? preview : []).filter((c) => cidadeEmCooldown(c)),
    [preview],
  )

  const handleStart = async () => {
    setError('')
    if (!rows.length) {
      setError('Adicione ao menos uma cidade.')
      return
    }
    const redes = FONTES.filter((f) => f.id !== 'maps' && fontes[f.id]).map((f) => f.id)
    if (!fontes.maps && redes.length === 0) {
      setError('Selecione ao menos uma fonte.')
      return
    }
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

  const handleRegistarTrafego = async () => {
    setTrafegoErro('')
    setTrafegoMsg('')
    setTrafegoBusy(true)
    try {
      const res = await processarTrafegoDoDia(trafegoTexto, trafegoUf)
      if (res.aviso) {
        setTrafegoErro(res.aviso)
        return
      }
      const partes = [
        `${res.novas} nova(s)`,
        `${res.jaTinhamDia} já tinham o dia`,
        `${res.enfileiradas} enfileirada(s) no cron`,
      ]
      if (res.emCooldown) partes.push(`${res.emCooldown} em cooldown (aguardam)`)
      setTrafegoMsg(partes.join(' · '))
      if (res.novas || res.enfileiradas) setTrafegoTexto('')
      refreshTrafego()
      refreshRegistry()
    } catch (e) {
      setTrafegoErro(e?.message || String(e))
    } finally {
      setTrafegoBusy(false)
    }
  }

  const handleReenfileirarLimiar = async () => {
    setTrafegoErro('')
    setTrafegoMsg('')
    setTrafegoBusy(true)
    try {
      const enq = await enfileirarCidadesQueBateramLimiar()
      setTrafegoMsg(
        `${enq.enfileiradas} enfileirada(s) · ${enq.emCooldown} em cooldown · ${enq.candidatas} no limiar`,
      )
      refreshTrafego()
      refreshRegistry()
    } catch (e) {
      setTrafegoErro(e?.message || String(e))
    } finally {
      setTrafegoBusy(false)
    }
  }

  const { mapsRows, planosPorFonte } = useMemo(() => {
    const maps = results.filter((r) => !isSomenteRede(r))
    const only = results.filter(isSomenteRede)
    const groups = new Map()
    for (const r of only) {
      const key = planoPrincipal(r)
      const list = groups.get(key) || []
      list.push(r)
      groups.set(key, list)
    }
    const orderedKeys = [
      ...PLANO_ORDER.filter((k) => groups.has(k)),
      ...[...groups.keys()].filter((k) => !PLANO_ORDER.includes(k)).sort(),
    ]
    return {
      mapsRows: maps,
      planosPorFonte: orderedKeys.map((k) => ({ fonte: k, items: groups.get(k) || [] })),
    }
  }, [results])

  return (
    <div className="space-y-4">
      <section className="el-stage">
        <h2 className="mt-0 mb-1 text-lg font-bold text-[#123e59] dark:text-[#e8f1f8]">
          Cidades do tráfego
        </h2>
        <p className="mt-0 mb-4 text-sm text-ink-muted">
          Modalidade padrão: cole as cidades do dia. Cada aparição diária conta 1 marcador; ao
          bater {LIMIAR_MARCADORES_CRON}, a cidade entra automaticamente na fila do cron.
        </p>

        <div className="flex flex-wrap items-end gap-3 mb-3">
          <label className="text-sm">
            <span className="mb-1 block font-semibold">UF padrão</span>
            <SelectUfBusca value={trafegoUf} onChange={setTrafegoUf} />
          </label>
          <p className="text-xs text-ink-soft dark:text-[#9eb4c8] pb-2">
            Linhas «Cidade/UF» ou «Cidade - UF» sobrescrevem a UF padrão.
          </p>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-semibold">Colar cidades do dia</span>
          <textarea
            className="w-full min-h-[120px] rounded-xl border border-line px-3 py-2 font-mono text-sm dark:border-white/15 dark:bg-[#152433]"
            placeholder={'Pato Branco\nCascavel/PR\nJoinville - SC'}
            value={trafegoTexto}
            onChange={(e) => setTrafegoTexto(e.target.value)}
            disabled={trafegoBusy}
          />
        </label>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClassName()}
            disabled={trafegoBusy || !trafegoTexto.trim()}
            onClick={() => void handleRegistarTrafego()}
          >
            {trafegoBusy ? 'A registar…' : 'Registar hoje'}
          </button>
          <button
            type="button"
            className={buttonClassName({ variant: 'secondary' })}
            disabled={trafegoBusy}
            onClick={() => void handleReenfileirarLimiar()}
          >
            Reprocessar limiar {LIMIAR_MARCADORES_CRON}
          </button>
        </div>

        {trafegoMsg && (
          <p className="mt-3 mb-0 rounded-xl border border-emerald-300/40 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
            {trafegoMsg}
          </p>
        )}
        {trafegoErro && (
          <p className="mt-3 mb-0 rounded-xl border border-status-erro/30 bg-status-erro-bg px-3 py-2 text-sm text-status-erro">
            {trafegoErro}
          </p>
        )}

        {trafegoContadores.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-xl border border-line dark:border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left dark:border-white/10">
                  <th className="px-3 py-2">Cidade</th>
                  <th className="px-3 py-2">UF</th>
                  <th className="px-3 py-2">Marcadores</th>
                  <th className="px-3 py-2">Última aparição</th>
                  <th className="px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {trafegoContadores.map((row) => {
                  const m = Number(row.marcadores) || 0
                  let estado = 'A acumular'
                  if (m >= LIMIAR_MARCADORES_CRON) estado = 'Pronta p/ cron'
                  else if (row.enfileirado_em && m === 0) estado = 'Enfileirada (ciclo zerado)'
                  return (
                    <tr
                      key={row.id || `${row.cidade}-${row.uf}`}
                      className="border-b border-line/60 dark:border-white/5"
                    >
                      <td className="px-3 py-2">{row.cidade}</td>
                      <td className="px-3 py-2">{row.uf}</td>
                      <td className="px-3 py-2 font-semibold">
                        {m}/{LIMIAR_MARCADORES_CRON}
                      </td>
                      <td className="px-3 py-2">{formatDateBR(row.ultima_aparicao_em) || '—'}</td>
                      <td className="px-3 py-2">{estado}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="el-stage">
        <h2 className="mt-0 mb-1 text-lg font-bold text-[#123e59] dark:text-[#e8f1f8]">
          Pipeline diário
        </h2>
        <p className="mt-0 mb-4 text-sm text-ink-muted">
          Preferência: tráfego acima (auto-fila ao bater {LIMIAR_MARCADORES_CRON} marcadores).
          Abaixo: adicionar cidades e enfileirar manualmente. Cooldown de {cooldownDays} dias após
          pesquisa bem-sucedida.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-semibold">UF</span>
            <SelectUfBusca
              value={uf}
              onChange={(u) => {
                setUf(u)
                setCidade('')
              }}
            />
          </label>
          <label className="min-w-[220px] flex-1 text-sm">
            <span className="mb-1 block font-semibold">Cidade</span>
            <SelectMunicipioBusca
              value={cidade}
              valueKey="nome"
              options={municipios}
              disabled={!uf || loadingMun}
              loading={loadingMun}
              inputClassName={SELECT_CIDADE_INPUT}
              placeholder={!uf ? 'Selecione a UF' : 'Buscar cidade…'}
              creatable
              createLabel={(q) => `Usar «${q}»`}
              onChange={setCidade}
            />
          </label>
          <button type="button" className={buttonClassName()} onClick={addCity}>
            Adicionar
          </button>
        </div>

        {(preview.length > 0 || rows.length > 0) && (
          <div className="emer-radar-chip-row mt-3">
            {(preview.length ? preview : rows).map((c) => {
              const cool = cidadeEmCooldown(c)
              const title = cool
                ? `Cooldown · libera em ${formatDateBR(c.liberada_em)} (${c.dias_restantes ?? '?'}d) · ${c.vezes_requisitada || 0}x`
                : `Disponível · ${c.vezes_requisitada || 0}x requisitada`
              return (
                <span
                  key={`${c.cidade}-${c.uf}`}
                  className={`emer-radar-chip ${cool ? 'is-cooldown' : 'is-on'}`}
                  title={title}
                >
                  {c.cidade}/{c.uf}
                  {cool && c.dias_restantes != null ? ` · ${c.dias_restantes}d` : ''}
                  {c.vezes_requisitada ? ` · ${c.vezes_requisitada}×` : ''}
                  <button
                    type="button"
                    className="ml-1 border-0 bg-transparent text-status-erro cursor-pointer"
                    onClick={() => {
                      setRows((prev) =>
                        prev.filter((r) => !(r.cidade === c.cidade && r.uf === c.uf)),
                      )
                    }}
                  >
                    ×
                  </button>
                </span>
              )
            })}
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
                {bloqueadas.length ? ` · ${bloqueadas.length} em cooldown` : ''})
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

      <section className="el-stage">
        <h3 className="mt-0 font-bold">Configurações — destinatários das tarefas</h3>
        <p className="text-sm text-ink-soft dark:text-[#9eb4c8]">
          Ao finalizar o pipeline, cria uma tarefa no Home para cada usuário marcado (Excel +
          HTML anexados).
        </p>
        {settingsMsg && (
          <p className="rounded-xl border border-amber-300/40 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            {settingsMsg}
          </p>
        )}
        <div className="mt-3 max-h-56 space-y-2 overflow-y-auto rounded-xl border border-line p-3 dark:border-white/10">
          {(usuarios.length
            ? usuarios
            : destinatarios.map((d) => ({ id: d.id, nome: d.nome }))
          ).map((u) => {
            const checked = destinatarios.some((d) => d.id === u.id && d.enabled)
            return (
              <label key={u.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const on = e.target.checked
                    setDestinatarios((prev) => {
                      const others = prev.filter((d) => d.id !== u.id)
                      if (!on) return others
                      return [...others, { id: u.id, nome: u.nome, enabled: true }]
                    })
                  }}
                />
                <span>{u.nome}</span>
              </label>
            )
          })}
          {!usuarios.length && !destinatarios.length && (
            <p className="m-0 text-sm text-ink-muted">Nenhum usuário carregado.</p>
          )}
        </div>
        <button
          type="button"
          className={`${buttonClassName({ variant: 'secondary' })} mt-3`}
          disabled={settingsBusy}
          onClick={async () => {
            setSettingsBusy(true)
            setSettingsMsg('')
            try {
              const saved = await emerRadarSaveSettings({
                tarefa_destinatarios: destinatarios,
              })
              setDestinatarios(saved.tarefa_destinatarios || [])
              setSettingsMsg('Destinatários salvos no worker Emer-Radar.')
            } catch (e) {
              setSettingsMsg(e.message || 'Falha ao salvar.')
            } finally {
              setSettingsBusy(false)
            }
          }}
        >
          {settingsBusy ? 'Salvando…' : 'Salvar destinatários'}
        </button>
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
          {selectedPastRun ? (
            <>
              <a
                className={buttonClassName({ variant: 'secondary' })}
                href={pipelineExportUrl('xlsx', selectedPastRun)}
                target="_blank"
                rel="noreferrer"
              >
                Excel
              </a>
              <a
                className={buttonClassName({ variant: 'secondary' })}
                href={pipelineExportUrl('html', selectedPastRun)}
                target="_blank"
                rel="noreferrer"
              >
                Relatório HTML
              </a>
            </>
          ) : null}
          <button type="button" className={buttonClassName({ variant: 'secondary' })} onClick={refreshRuns}>
            Atualizar lista
          </button>
        </div>
      </section>

      {results.length > 0 && (
        <>
          <section className="el-stage">
            <h3 className="mt-0 font-bold">Google Maps ({mapsRows.length})</h3>
            <p className="mt-0 mb-2 text-sm text-ink-muted">
              Estabelecimentos do Maps. Badges coloridos indicam vínculo com planos.
            </p>
            <MapsTable rows={mapsRows.slice(0, 250)} />
          </section>
          <section className="el-stage">
            <h3 className="mt-0 font-bold">
              Somente planos ({planosPorFonte.reduce((n, g) => n + g.items.length, 0)})
            </h3>
            <p className="mt-0 mb-2 text-sm text-ink-muted">
              Credenciados que aparecem só nas redes de plano (não encontrados no Maps).
            </p>
            {planosPorFonte.length === 0 ? (
              <p className="m-0 text-sm text-ink-muted">Nenhum registro exclusivo de planos.</p>
            ) : (
              <div className="mt-3 space-y-6">
                {planosPorFonte.map(({ fonte, items }) => (
                  <div key={fonte}>
                    <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                      <span className={`emer-radar-pill ${PLANO_CLASS[fonte] || ''}`}>
                        {planoLabel(fonte)}
                      </span>
                      <span>
                        {planoLabel(fonte)} ({items.length})
                      </span>
                    </h4>
                    <PlanoTable fonte={fonte} rows={items.slice(0, 200)} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {registry.length > 0 && (
        <section className="el-stage">
          <h3 className="mt-0 font-bold">Histórico de cidades ({registry.length})</h3>
          <p className="mt-0 mb-3 text-sm text-ink-muted">
            Registry do worker (cooldown). Remover libera a cidade imediatamente.
          </p>
          <div className="emer-radar-chip-row">
            {registry.map((c) => (
              <span
                key={c.key || `${c.cidade}|${c.uf}`}
                className={`emer-radar-chip ${cidadeEmCooldown(c) ? 'is-cooldown' : ''}`}
                title={
                  cidadeEmCooldown(c)
                    ? `Libera em ${formatDateBR(c.liberada_em)}`
                    : 'Disponível'
                }
              >
                {c.cidade}/{c.uf} · {c.vezes_requisitada || 0}×
                {cidadeEmCooldown(c) ? ` · libera ${formatDateBR(c.liberada_em)}` : ''}
                <button
                  type="button"
                  className="ml-1 border-0 bg-transparent cursor-pointer opacity-70"
                  title={`Remover ${c.cidade}/${c.uf} do histórico`}
                  onClick={async () => {
                    try {
                      const res = await deleteCity(c.cidade, c.uf)
                      setRegistry(res.cities || [])
                      if (rows.length) {
                        const prev = await pipelinePreviewCities(rows)
                        setPreview(prev.cities || [])
                      }
                    } catch (err) {
                      setError(err?.message || 'Não foi possível remover a cidade do histórico.')
                    }
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function PipelineBar({ snap }) {
  const total = snap.progress?.total || 0
  const index = snap.progress?.index || 0
  const fase = snap.progress?.fase || null
  let percent = snap.progress?.percent
  if (percent == null) {
    if (snap.status === 'CONCLUIDO') percent = 100
    else if (total > 0) percent = Math.min(99, Math.round((index / total) * 100))
    else percent = snap.status === 'RODANDO' ? 5 : 0
  }
  if (snap.status === 'CONCLUIDO') percent = 100

  return (
    <div className="mt-3">
      <div className="mb-1 flex flex-wrap justify-between gap-2 text-xs text-ink-muted">
        <span>
          {fase ? FASE_PIPELINE_LABEL[fase] || fase : 'Progresso'}
          {snap.progress?.cidade_atual ? ` · ${snap.progress.cidade_atual}` : ''}
        </span>
        <span className="font-semibold tabular-nums">
          {percent}%
          {total > 0 ? ` · cidade ${Math.min(index, total)}/${total}` : ''}
        </span>
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

function MapsTable({ rows }) {
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
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id || `${r.nome}-${r.endereco}`}>
              <td>
                <div className="font-semibold">{dash(r.nome)}</div>
                {isVinculado(r) ? <PlanoPills row={r} /> : null}
              </td>
              <td>{dash(r.tipo || r.especialidade || r.categoria)}</td>
              <td>{dash(r.endereco)}</td>
              <td className="whitespace-nowrap">{dash(unifyContato(r.telefone, r.whatsapp))}</td>
              <td>{dash(cidadeFromEndereco(r.endereco, r.cidade))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PlanoTable({ fonte, rows }) {
  if (!rows?.length) {
    return <p className="text-sm text-ink-muted">Nenhum registro.</p>
  }

  if (fonte === 'petlife' || fonte === 'doglife') {
    return (
      <div className="emer-radar-table-wrap">
        <table className="emer-radar-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Credenciada</th>
              <th>Bairro / cidade</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id || `${r.nome}-${r.bairro}`}>
                <td className="font-semibold">{dash(r.nome)}</td>
                <td>{dash(r.tipo || r.especialidade || r.categoria)}</td>
                <td>
                  {r.credenciada === true
                    ? 'Credenciada'
                    : r.credenciada === false
                      ? 'Não credenciada'
                      : '—'}
                </td>
                <td>{dash(r.bairro)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (fonte === 'emerdog') {
    return (
      <div className="emer-radar-table-wrap">
        <table className="emer-radar-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Endereço</th>
              <th>Telefone</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id || `${r.nome}-${r.endereco}`}>
                <td className="font-semibold">{dash(r.nome)}</td>
                <td>{dash(r.tipo || r.especialidade || r.categoria)}</td>
                <td>{dash(r.endereco)}</td>
                <td className="whitespace-nowrap">{dash(unifyContato(r.telefone, r.whatsapp))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="emer-radar-table-wrap">
      <table className="emer-radar-table">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Tipo</th>
            <th>Endereço</th>
            <th>Telefone</th>
            <th>WhatsApp</th>
            <th>Cidade</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id || `${r.nome}-${r.endereco}`}>
              <td className="font-semibold">{dash(r.nome)}</td>
              <td>{dash(r.tipo || r.especialidade || r.categoria)}</td>
              <td>{dash(r.endereco)}</td>
              <td className="whitespace-nowrap">{dash(r.telefone)}</td>
              <td className="whitespace-nowrap">{dash(r.whatsapp)}</td>
              <td>{dash(cidadeFromEndereco(r.endereco, r.cidade))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function mapsIdPrimeiro(lista) {
  const est = (lista || [])[0]
  return est ? mapsIdDeEstabelecimento(est) : ''
}

function ProspectPanel() {
  const terms = getDefaultSearchTerms()
  const [uf, setUf] = useState('RS')
  const [cidade, setCidade] = useState('')
  const { municipios, loading: loadingMun } = useMunicipiosPorUf(uf)
  const [maxResults, setMaxResults] = useState(80)
  const [termos, setTermos] = useState([...terms])
  const [snap, setSnap] = useState(null)
  const [results, setResults] = useState([])
  const [logs, setLogs] = useState([])
  const [progress, setProgress] = useState({
    termo_atual: null,
    index: 0,
    total: 0,
    termos_concluidos: [],
    encontrados: 0,
  })
  const [error, setError] = useState('')
  const [saveMsg, setSaveMsg] = useState('')
  const [salvando, setSalvando] = useState(false)
  const persistLockRef = useRef('')
  const lastEventIdRef = useRef(0)
  const scrapeCtxRef = useRef({ cidade: '', uf: '' })
  const filaAtualizacaoRef = useRef(null)
  const finishingJobRef = useRef(false)
  const expectConcluidoRef = useRef(false)

  const [aba, setAba] = useState('busca') // busca | catalogo
  const [filtroUf, setFiltroUf] = useState('')
  const [filtroCidade, setFiltroCidade] = useState('')
  const { municipios: municipiosFiltro, loading: loadingMunFiltro } = useMunicipiosPorUf(filtroUf)
  const [filtroStatus, setFiltroStatus] = useState('')
  const [filtroBusca, setFiltroBusca] = useState('')
  const [catalogo, setCatalogo] = useState([])
  const [catalogoLoading, setCatalogoLoading] = useState(false)
  const [catalogoErro, setCatalogoErro] = useState('')
  const [paresCidade, setParesCidade] = useState([])
  const [atualizandoCatalogo, setAtualizandoCatalogo] = useState(false)
  const [atualizacaoProgresso, setAtualizacaoProgresso] = useState('')

  const status = snap?.status || 'IDLE'
  const isRunning = status === 'BUSCANDO' || status === 'FINALIZANDO'

  const applySnap = useCallback((s) => {
    if (!s) return
    setSnap(s)
    if (s.progress) {
      setProgress((prev) => ({
        ...prev,
        ...s.progress,
        termos_concluidos: s.progress.termos_concluidos || prev.termos_concluidos || [],
      }))
    }
    if (Array.isArray(s.logs)) setLogs(s.logs)
    if (s.error_message || s.error) setError(s.error_message || s.error || '')
  }, [])

  const municipiosCatalogo = useMemo(() => {
    const extras = []
    const ufSel = String(filtroUf || '').trim().toUpperCase()
    for (const p of paresCidade) {
      if (ufSel && String(p.uf || '').toUpperCase() !== ufSel) continue
      if (p.cidade) extras.push(p.cidade)
    }
    if (!ufSel) {
      return [...new Set(extras)]
        .sort((a, b) => a.localeCompare(b, 'pt-BR'))
        .map((nome) => ({ id: nome, nome }))
    }
    return mesclarMunicipiosComExtras(municipiosFiltro, extras)
  }, [paresCidade, filtroUf, municipiosFiltro])

  const carregarParesCidade = useCallback(async () => {
    const r = await listarCidadesUfProspectosMaps()
    if (r.ok) setParesCidade(r.pares || [])
  }, [])

  const carregarCatalogo = useCallback(async (opts = {}) => {
    const silencioso = Boolean(opts.silencioso)
    if (!silencioso) {
      setCatalogoLoading(true)
      setCatalogoErro('')
    }
    try {
      const r = await listarProspectosMaps({
        uf: filtroUf,
        cidade: filtroCidade,
        status: filtroStatus,
        busca: filtroBusca,
        incluirDescartados: filtroStatus === 'descartado',
        limite: 800,
      })
      if (!r.ok) {
        if (!silencioso) {
          setCatalogoErro(r.erro || 'Falha ao carregar catálogo.')
          setCatalogo([])
        }
        return
      }
      setCatalogo((r.itens || []).map(rowMapsParaCardUi).filter(Boolean))
    } catch (e) {
      if (!silencioso) {
        setCatalogoErro(e?.message || String(e))
        setCatalogo([])
      }
    } finally {
      if (!silencioso) setCatalogoLoading(false)
    }
  }, [filtroUf, filtroCidade, filtroStatus, filtroBusca])

  const aplicarStatusCatalogoLocal = useCallback((est, status) => {
    const key = String(est?.maps_id || est?.id || '')
    const dbId = String(est?.maps_db_id || '')
    const match = (e) =>
      (dbId && String(e?.maps_db_id || '') === dbId) ||
      (key && String(e?.maps_id || e?.id || '') === key)
    setCatalogo((prev) =>
      (prev || []).map((e) => (match(e) ? { ...e, ...est, status_prospeccao: status || est.status_prospeccao } : e)),
    )
    setResults((prev) =>
      (prev || []).map((e) => (match(e) ? { ...e, status_prospeccao: status || est.status_prospeccao } : e)),
    )
  }, [])

  const removerDoCatalogoLocal = useCallback((est) => {
    const key = String(est?.maps_id || est?.id || '')
    const dbId = String(est?.maps_db_id || '')
    const match = (e) =>
      (dbId && String(e?.maps_db_id || '') === dbId) ||
      (key && String(e?.maps_id || e?.id || '') === key)
    setCatalogo((prev) => (prev || []).filter((e) => !match(e)))
    setResults((prev) => (prev || []).filter((e) => !match(e)))
  }, [])

  const persistirResultados = useCallback(
    async (lista, ctx) => {
      if (!lista?.length) return
      const preferirNovos = Boolean(ctx?.preferirNovos)
      const lock = `${ctx?.uf || ''}|${ctx?.cidade || ''}|${lista.length}|${mapsIdPrimeiro(lista)}|${preferirNovos ? 'u' : 'n'}`
      if (persistLockRef.current === lock) return
      persistLockRef.current = lock
      setSalvando(true)
      setSaveMsg('')
      try {
        const r = await upsertProspectosMapsDeColeta(lista, ctx)
        if (!r.ok) {
          persistLockRef.current = ''
          setSaveMsg(r.erro || 'Não foi possível salvar no catálogo.')
          return
        }
        const enriched = enriquecerResultadosComSalvos(lista, r.itens).filter(
          (e) => String(e.status_prospeccao || '') !== 'descartado',
        )
        setResults(enriched)
        setSaveMsg(
          preferirNovos
            ? `${r.salvos} registro${r.salvos === 1 ? '' : 's'} atualizado${r.salvos === 1 ? '' : 's'} no catálogo.`
            : `${r.salvos} prospecto${r.salvos === 1 ? '' : 's'} salvo${r.salvos === 1 ? '' : 's'} no catálogo (sem fotos de fachada).`,
        )
        void carregarParesCidade()
      } catch (e) {
        persistLockRef.current = ''
        setSaveMsg(e?.message || String(e))
      } finally {
        setSalvando(false)
      }
    },
    [carregarParesCidade],
  )

  const iniciarScrapeJob = useCallback(
    async (job) => {
      const cidadeJob = String(job.cidade || '').trim()
      const ufJob = String(job.uf || '')
        .trim()
        .toUpperCase()
        .slice(0, 2)
      const termosJob = Array.isArray(job.termos) && job.termos.length ? job.termos : [...terms]
      const maxJob = Math.min(Math.max(Number(job.max_results) || maxResults || 80, 20), 150)

      scrapeCtxRef.current = { cidade: cidadeJob, uf: ufJob }
      setUf(ufJob)
      setCidade(cidadeJob)
      setTermos(termosJob)
      lastEventIdRef.current = 0
      setLogs([])
      setError('')
      setProgress({
        termo_atual: null,
        index: 0,
        total: 0,
        termos_concluidos: [],
        encontrados: 0,
      })
      persistLockRef.current = ''
      finishingJobRef.current = false
      expectConcluidoRef.current = true

      const s = await scrapeStart({
        uf: ufJob,
        cidade: cidadeJob,
        max_results: maxJob,
        termos: termosJob,
      })
      applySnap(s)
      setResults([])
    },
    [applySnap, maxResults, terms],
  )

  const finalizarFilaAtualizacao = useCallback(async () => {
    const fila = filaAtualizacaoRef.current
    filaAtualizacaoRef.current = null
    setAtualizandoCatalogo(false)
    setAtualizacaoProgresso('')
    const n = fila?.jobs?.length || 0
    setSaveMsg(
      n
        ? `Atualização do catálogo concluída (${n} busca${n === 1 ? '' : 's'} no Maps).`
        : 'Atualização do catálogo concluída.',
    )
    setAba('catalogo')
    await carregarCatalogo({ silencioso: false })
  }, [carregarCatalogo])

  const avancarFilaAtualizacao = useCallback(async () => {
    const fila = filaAtualizacaoRef.current
    if (!fila) return
    if (fila.cancel) {
      await finalizarFilaAtualizacao()
      return
    }
    const next = fila.index + 1
    if (next >= fila.jobs.length) {
      await finalizarFilaAtualizacao()
      return
    }
    fila.index = next
    const job = fila.jobs[next]
    setAtualizacaoProgresso(
      `Atualizando ${next + 1}/${fila.jobs.length}: ${job.cidade} - ${job.uf} (${job.prospectos} no filtro)`,
    )
    try {
      await iniciarScrapeJob(job)
    } catch (e) {
      setError(e?.message || String(e))
      await finalizarFilaAtualizacao()
    }
  }, [finalizarFilaAtualizacao, iniciarScrapeJob])

  const onScrapeConcluido = useCallback(
    async (lista) => {
      if (!expectConcluidoRef.current) return
      if (finishingJobRef.current) return
      finishingJobRef.current = true
      expectConcluidoRef.current = false
      try {
        setResults(lista || [])
        const ctx = {
          cidade: scrapeCtxRef.current.cidade,
          uf: scrapeCtxRef.current.uf,
          preferirNovos: Boolean(filaAtualizacaoRef.current),
        }
        await persistirResultados(lista || [], ctx)
        if (filaAtualizacaoRef.current) {
          await avancarFilaAtualizacao()
        }
      } finally {
        finishingJobRef.current = false
      }
    },
    [persistirResultados, avancarFilaAtualizacao],
  )

  useEffect(() => {
    scrapeStatus()
      .then(applySnap)
      .catch(() => undefined)
    scrapeResults()
      .then((r) => setResults(r.results || []))
      .catch(() => undefined)
    void carregarParesCidade()
  }, [carregarParesCidade, applySnap])

  useEffect(() => {
    if (aba === 'catalogo') void carregarCatalogo()
  }, [aba, carregarCatalogo])

  useEffect(() => {
    if (!isRunning) return undefined
    const es = openScrapeStream(lastEventIdRef.current)
    const onPayload = (raw) => {
      try {
        const evt = JSON.parse(raw.data)
        if (typeof evt.id === 'number') lastEventIdRef.current = evt.id
        const type = evt.type || raw.type
        const payload = evt.payload || evt

        if (type === 'status' && payload.status) {
          setSnap((prev) => ({ ...(prev || {}), status: payload.status }))
          if (payload.message) setError(payload.message)
        }
        if (type === 'log' && payload.message) {
          setLogs((prev) => [...prev.slice(-199), payload.message])
        }
        if (type === 'term_started' || type === 'term_progress') {
          setProgress((prev) => ({
            ...prev,
            termo_atual: payload.termo ?? prev.termo_atual,
            index: payload.index ?? prev.index,
            total: payload.total ?? prev.total,
          }))
        }
        if (type === 'term_finished') {
          setProgress((prev) => ({
            ...prev,
            termos_concluidos: payload.termo
              ? Array.from(new Set([...(prev.termos_concluidos || []), payload.termo]))
              : prev.termos_concluidos,
          }))
        }
        if ((type === 'result' || type === 'result_update') && payload.establishment) {
          const est = payload.establishment
          setResults((prev) => {
            const idx = prev.findIndex((r) => r.id && est.id && r.id === est.id)
            if (idx === -1) {
              const next = [...prev, est]
              setProgress((p) => ({ ...p, encontrados: next.length }))
              return next
            }
            const next = [...prev]
            next[idx] = { ...next[idx], ...est }
            return next
          })
        }
        if (type === 'job_finished' || type === 'job_cancelled' || type === 'done') {
          setSnap((prev) => ({ ...(prev || {}), status: 'CONCLUIDO' }))
          if (type === 'job_cancelled' && filaAtualizacaoRef.current) {
            filaAtualizacaoRef.current.cancel = true
          }
          scrapeResults()
            .then((r) => void onScrapeConcluido(r.results || []))
            .catch(() => undefined)
          if (type === 'done') es.close()
        }
        if (type === 'job_error') {
          setSnap((prev) => ({ ...(prev || {}), status: 'ERRO' }))
          setError(payload.message || 'Erro inesperado')
          if (filaAtualizacaoRef.current) {
            filaAtualizacaoRef.current.cancel = true
            void avancarFilaAtualizacao()
          }
        }
      } catch {
        /* ignore */
      }
    }
    ;[
      'status',
      'log',
      'term_started',
      'term_progress',
      'term_finished',
      'result',
      'result_update',
      'job_finished',
      'job_cancelled',
      'job_error',
      'done',
      'message',
    ].forEach((name) => es.addEventListener(name, onPayload))

    const poll = setInterval(() => {
      scrapeStatus()
        .then(async (s) => {
          applySnap(s)
          if (s?.status === 'CONCLUIDO') {
            const r = await scrapeResults()
            void onScrapeConcluido(r.results || [])
          }
        })
        .catch(() => undefined)
    }, 4000)
    return () => {
      es.close()
      clearInterval(poll)
    }
  }, [isRunning, onScrapeConcluido, avancarFilaAtualizacao, applySnap])

  const handleStart = async () => {
    setError('')
    setSaveMsg('')
    if (atualizandoCatalogo || filaAtualizacaoRef.current) {
      setError('Aguarde a atualização do catálogo terminar (ou cancele).')
      return
    }
    if (!cidade.trim()) {
      setError('Informe a cidade.')
      return
    }
    if (!termos.length) {
      setError('Selecione ao menos um termo.')
      return
    }
    if (maxResults === 0) {
      setError('Não é possível rodar a busca para zero resultados.')
      return
    }
    try {
      filaAtualizacaoRef.current = null
      setAtualizandoCatalogo(false)
      setAtualizacaoProgresso('')
      await iniciarScrapeJob({
        cidade: cidade.trim(),
        uf,
        termos,
        max_results: maxResults,
      })
      setAba('busca')
    } catch (e) {
      setError(e.message)
    }
  }

  const handleAtualizarFiltrados = async (itensFiltrados) => {
    setError('')
    setSaveMsg('')
    if (isRunning || atualizandoCatalogo || filaAtualizacaoRef.current) {
      setError('Já há uma busca em andamento.')
      return
    }
    const fila = montarFilaAtualizacaoCatalogo(itensFiltrados, {
      termosPadrao: termos.length ? termos : terms,
      maxResultsPadrao: maxResults,
    })
    if (!fila.ok) {
      setError(fila.erro || 'Não foi possível montar a atualização.')
      return
    }
    const ok = window.confirm(
      `Rebuscar no Maps e atualizar o catálogo?\n\n` +
        `• ${fila.totalProspectos} prospecto(s) filtrado(s)\n` +
        `• ${fila.jobs.length} cidade(s): ${fila.jobs.map((j) => `${j.cidade}/${j.uf}`).join(', ')}\n\n` +
        `Dados novos (telefone, endereço, horário, etc.) substituem os salvos quando o scrape trouxer valor.`,
    )
    if (!ok) return

    filaAtualizacaoRef.current = { jobs: fila.jobs, index: 0, cancel: false }
    setAtualizandoCatalogo(true)
    const job0 = fila.jobs[0]
    setAtualizacaoProgresso(
      `Atualizando 1/${fila.jobs.length}: ${job0.cidade} - ${job0.uf} (${job0.prospectos} no filtro)`,
    )
    setAba('busca')
    try {
      await iniciarScrapeJob(job0)
    } catch (e) {
      filaAtualizacaoRef.current = null
      setAtualizandoCatalogo(false)
      setAtualizacaoProgresso('')
      setError(e?.message || String(e))
    }
  }

  const handleCancelarBusca = async () => {
    expectConcluidoRef.current = false
    if (filaAtualizacaoRef.current) {
      filaAtualizacaoRef.current.cancel = true
    }
    try {
      await scrapeStop()
    } catch {
      /* ignore */
    }
    if (filaAtualizacaoRef.current) {
      await finalizarFilaAtualizacao()
    }
  }

  const salvarManual = () => {
    persistLockRef.current = ''
    void persistirResultados(results, {
      cidade: scrapeCtxRef.current.cidade || cidade.trim(),
      uf: scrapeCtxRef.current.uf || uf,
    })
  }

  const showProgress =
    (aba === 'busca' || atualizandoCatalogo) &&
    (isRunning ||
      atualizandoCatalogo ||
      status === 'CONCLUIDO' ||
      status === 'ERRO' ||
      logs.length > 0)

  return (
    <div className="space-y-4">
      <section className="el-stage">
        <h2 className="mt-0 mb-1 text-lg font-bold text-[#123e59] dark:text-[#e8f1f8]">
          Prospect Maps
        </h2>
        <p className="mt-0 mb-4 text-sm text-ink-muted">
          Busca no Google Maps. Resultados são salvos no catálogo (sem fotos de fachada) para filtrar depois por
          cidade/UF.
        </p>

        <div className="emer-radar-view-toggle mb-4" role="tablist" aria-label="Prospect Maps">
          <button
            type="button"
            role="tab"
            aria-selected={aba === 'busca'}
            className={aba === 'busca' ? 'is-active' : ''}
            onClick={() => setAba('busca')}
          >
            Nova busca
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={aba === 'catalogo'}
            className={aba === 'catalogo' ? 'is-active' : ''}
            onClick={() => setAba('catalogo')}
          >
            Catálogo salvo
          </button>
        </div>

        {aba === 'busca' ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm">
                <span className="mb-1 block font-semibold">UF</span>
                <SelectUfBusca
                  value={uf}
                  disabled={isRunning}
                  onChange={(u) => {
                    setUf(u)
                    setCidade('')
                  }}
                />
              </label>
              <label className="text-sm sm:col-span-1">
                <span className="mb-1 block font-semibold">Cidade</span>
                <SelectMunicipioBusca
                  value={cidade}
                  valueKey="nome"
                  options={municipios}
                  disabled={!uf || loadingMun || isRunning}
                  loading={loadingMun}
                  inputClassName={SELECT_CIDADE_INPUT}
                  placeholder={!uf ? 'Selecione a UF' : 'Buscar cidade…'}
                  creatable
                  createLabel={(q) => `Usar «${q}»`}
                  onChange={setCidade}
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
                          setTermos((prev) => (on ? prev.filter((x) => x !== t) : [...prev, t]))
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
                <button
                  type="button"
                  className={buttonClassName()}
                  onClick={handleStart}
                  disabled={atualizandoCatalogo}
                >
                  Iniciar busca
                </button>
              ) : (
                <button
                  type="button"
                  className={buttonClassName({ variant: 'danger' })}
                  onClick={() => void handleCancelarBusca()}
                >
                  {atualizandoCatalogo ? 'Cancelar atualização' : 'Parar busca'}
                </button>
              )}
              {results.length > 0 && (
                <>
                  <button
                    type="button"
                    className={buttonClassName({ variant: 'secondary' })}
                    disabled={salvando || isRunning}
                    onClick={salvarManual}
                  >
                    {salvando ? 'Salvando…' : 'Salvar no catálogo'}
                  </button>
                  <a
                    className={buttonClassName({ variant: 'secondary' })}
                    href={scrapeExportExcelUrl()}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Excel
                  </a>
                  <a
                    className={buttonClassName({ variant: 'secondary' })}
                    href={scrapeExportPdfUrl()}
                    target="_blank"
                    rel="noreferrer"
                  >
                    PDF
                  </a>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-sm">
                <span className="mb-1 block font-semibold">UF</span>
                <SelectUfBusca
                  value={filtroUf}
                  onChange={(v) => {
                    setFiltroUf(v)
                    setFiltroCidade('')
                  }}
                  emptyLabel="Todas"
                  placeholder="Todas as UFs"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-semibold">Cidade</span>
                <SelectMunicipioBusca
                  value={filtroCidade}
                  valueKey="nome"
                  options={municipiosCatalogo}
                  disabled={loadingMunFiltro}
                  loading={Boolean(filtroUf) && loadingMunFiltro}
                  inputClassName={SELECT_CIDADE_INPUT}
                  placeholder={
                    filtroUf ? 'Buscar cidade…' : 'Selecione a UF (ou digite uma cidade salva)'
                  }
                  creatable
                  createLabel={(q) => `Usar «${q}»`}
                  onChange={setFiltroCidade}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-semibold">Status</span>
                <select
                  className="w-full rounded-xl border border-line px-3 py-2 dark:border-white/15 dark:bg-[#152433]"
                  value={filtroStatus}
                  onChange={(e) => setFiltroStatus(e.target.value)}
                >
                  <option value="">Ativos (sem descartados)</option>
                  {STATUS_PROSPECCAO_MAPS_OPCOES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-semibold">Busca</span>
                <input
                  className="w-full rounded-xl border border-line px-3 py-2 dark:border-white/15 dark:bg-[#152433]"
                  value={filtroBusca}
                  onChange={(e) => setFiltroBusca(e.target.value)}
                  placeholder="Nome, endereço, telefone…"
                />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                className={buttonClassName()}
                disabled={catalogoLoading || atualizandoCatalogo || isRunning}
                onClick={() => void carregarCatalogo()}
              >
                {catalogoLoading ? 'Carregando…' : 'Buscar no catálogo'}
              </button>
            </div>
            <p className="mt-3 mb-0 text-xs text-ink-muted">
              Depois de filtrar a lista, use «Atualizar filtrados» nos resultados para rebuscar no Maps e
              sobrescrever telefone, endereço, horário e categoria dos registros já salvos.
            </p>
          </>
        )}

        {error && (
          <p className="mt-3 mb-0 rounded-xl border border-status-erro/30 bg-status-erro-bg px-3 py-2 text-sm text-status-erro">
            {error}
          </p>
        )}
        {saveMsg && (
          <p
            className={`mt-3 mb-0 rounded-xl border px-3 py-2 text-sm ${
              /ausente|falha|não foi|erro/i.test(saveMsg)
                ? 'border-status-erro/30 bg-status-erro-bg text-status-erro'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
            }`}
          >
            {saveMsg}
          </p>
        )}
        {catalogoErro && aba === 'catalogo' && (
          <p className="mt-3 mb-0 rounded-xl border border-status-erro/30 bg-status-erro-bg px-3 py-2 text-sm text-status-erro">
            {catalogoErro}
          </p>
        )}
      </section>

      {showProgress && (
        <section className="el-stage">
          {atualizacaoProgresso ? (
            <p className="mt-0 mb-3 rounded-xl border border-[#123e59]/20 bg-[#123e59]/5 px-3 py-2 text-sm text-[#123e59] dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-100">
              {atualizacaoProgresso}
            </p>
          ) : null}
          {isRunning && (
            <EmerRadarLoader
              size="md"
              label={
                atualizandoCatalogo
                  ? 'Atualizando catálogo via Maps…'
                  : status === 'FINALIZANDO'
                    ? 'Finalizando varredura…'
                    : 'Emer-Radar em busca…'
              }
              detail={
                progress.termo_atual
                  ? `${progress.termo_atual}${
                      progress.total > 0 ? ` · ${progress.index}/${progress.total}` : ''
                    }`
                  : status
              }
            />
          )}
          <p className="mt-0 mb-3 text-sm font-semibold">
            {STATUS_SCRAPE_LABEL[status] || status}
            {status === 'CONCLUIDO'
              ? ` — ${progress.encontrados ?? results.length} estabelecimentos encontrados`
              : ''}
            {salvando ? ' · salvando catálogo…' : ''}
          </p>
          <ul className="emer-radar-term-list">
            {(termos.length ? termos : terms).map((t) => {
              const done = (progress.termos_concluidos || []).includes(t)
              const current = progress.termo_atual === t && !done
              return (
                <li key={t} className={done ? 'is-done' : current ? 'is-current' : ''}>
                  <span className="emer-radar-term-list__mark" aria-hidden />
                  <span className="capitalize">{t}</span>
                  {current && progress.total > 0 ? (
                    <span className="emer-radar-term-list__meta">
                      Processando {progress.index}/{progress.total}
                    </span>
                  ) : null}
                  {done ? <span className="emer-radar-term-list__meta">Concluído</span> : null}
                </li>
              )
            })}
          </ul>
          {(snap?.error_message || snap?.error || (status === 'ERRO' && error)) && (
            <p className="mt-3 mb-0 text-sm text-status-erro">
              {snap?.error_message || snap?.error || error}
            </p>
          )}
          {logs.length > 0 && (
            <pre className="mt-3 max-h-36 overflow-auto rounded-xl bg-[#0d1520] p-3 text-[11px] leading-relaxed text-[#cfe8f8]">
              {logs.slice(-30).join('\n')}
            </pre>
          )}
        </section>
      )}

      {aba === 'busca' ? (
        <EmerRadarProspectResults
          results={results}
          titulo="Última busca"
          onRemovido={(est) => {
            removerDoCatalogoLocal(est)
            void carregarParesCidade()
          }}
          onEnviadoKanbanOk={(est) => aplicarStatusCatalogoLocal(est, 'contactado')}
        />
      ) : catalogoLoading && !catalogo.length ? (
        <section className="el-stage">
          <p className="m-0 text-sm text-ink-muted">Carregando catálogo…</p>
        </section>
      ) : !catalogo.length ? (
        <section className="el-stage">
          <p className="m-0 text-sm text-ink-muted">
            Nenhum prospecto salvo para estes filtros. Rode uma busca em «Nova busca» — os resultados entram no
            catálogo automaticamente (sem fotos).
          </p>
        </section>
      ) : (
        <EmerRadarProspectResults
          results={catalogo}
          titulo="Catálogo salvo"
          mostrarExport={false}
          atualizandoCatalogo={atualizandoCatalogo || isRunning}
          onAtualizarFiltrados={(itens) => void handleAtualizarFiltrados(itens)}
          onRemovido={(est) => {
            removerDoCatalogoLocal(est)
            void carregarCatalogo({ silencioso: true })
          }}
          onEnviadoKanbanOk={(est) => aplicarStatusCatalogoLocal(est, 'contactado')}
        />
      )}
    </div>
  )
}
