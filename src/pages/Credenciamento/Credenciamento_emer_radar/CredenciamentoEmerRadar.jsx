import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EmptyState, LoadingState, PageHeader, buttonClassName } from '../../../components/ui'
import SelectMunicipioBusca from '../../../components/SelectMunicipioBusca/SelectMunicipioBusca.jsx'
import SelectUfBusca from '../../../components/SelectUfBusca/SelectUfBusca.jsx'
import {
  deleteCity,
  emerRadarHealth,
  getDefaultSearchTerms,
  getEmerRadarApiBase,
  isEmerRadarAmbienteRemoto,
  listCities,
  openPipelineStream,
  openScrapeStream,
  pipelineEnqueue,
  pipelineListQueue,
  pipelineRemoveFromQueue,
  pipelineExportUrl,
  pipelinePreviewCities,
  pipelineStart,
  pipelineStatus,
  pipelineStop,
  triggerEmerRadarCron,
  scrapeResults,
  scrapeStart,
  scrapeStatus,
  scrapeStop,
} from '../../../lib/credenciamento/emerRadarApi.js'
import {
  FASE_PIPELINE_LABEL,
  STATUS_SCRAPE_LABEL,
  cidadeEmCooldown,
  formatDateBR,
} from '../../../lib/credenciamento/emerRadarUi.js'
import {
  LIMIAR_MARCADORES_CRON,
  enfileirarCidadesQueBateramLimiar,
  filtrarMunicipiosIbgeExistentes,
  listarContadoresTrafego,
  parseCidadesTrafego,
  processarTrafegoDoDia,
} from '../../../lib/credenciamento/trafegoCidades.js'
import {
  loadEmerRadarSettings,
  saveEmerRadarSettings,
} from '../../../lib/credenciamento/emerRadarSettings.js'
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
import EmerRadarExecucoes from './EmerRadarExecucoes.jsx'
import EmerRadarServidorModal from './EmerRadarServidorModal.jsx'
import EmerRadarTrafegoLista from './EmerRadarTrafegoLista.jsx'
import { abrirExecucaoEmerRadar } from '../../../lib/credenciamento/abrirExecucaoEmerRadar.js'
import EmerRadarProspectResults from './EmerRadarProspectResults.jsx'
import './CredenciamentoEmerRadar.css'
import { avisar, confirmarAcao } from '../../../lib/dialogos.js'
import { SelectDropdown } from '../../../components/ui/Dropdown.jsx'

const SELECT_CIDADE_INPUT =
  'w-full rounded-xl border border-line px-3 py-2 dark:border-white/15 dark:bg-[#152433]'

/** Secção numerada — um propósito por bloco (menos confusão). */
function PanelStep({ step, title, hint, actions, children, className = '' }) {
  return (
    <section className={`el-stage emer-radar-panel ${className}`.trim()}>
      <header className="emer-radar-panel__head">
        {step != null ? (
          <span className="emer-radar-panel__step" aria-hidden>
            {step}
          </span>
        ) : null}
        <div className="emer-radar-panel__intro min-w-0 flex-1">
          <h2 className="emer-radar-panel__title">{title}</h2>
          {hint ? <p className="emer-radar-panel__hint">{hint}</p> : null}
        </div>
        {actions ? <div className="emer-radar-panel__actions">{actions}</div> : null}
      </header>
      <div className="emer-radar-panel__body">{children}</div>
    </section>
  )
}

function StatusPill({ tone = 'neutral', children }) {
  return <span className={`emer-radar-status-pill emer-radar-status-pill--${tone}`}>{children}</span>
}

function MarkerMeter({ value, limiar = LIMIAR_MARCADORES_CRON }) {
  const m = Number(value) || 0
  const pct = Math.min(100, Math.round((m / limiar) * 100))
  const ready = m >= limiar
  return (
    <div className="emer-radar-meter" title={`${m} de ${limiar} marcadores`}>
      <div className="emer-radar-meter__track" aria-hidden>
        <div
          className={`emer-radar-meter__fill${ready ? ' is-ready' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="emer-radar-meter__label tabular-nums">
        {m}/{limiar}
      </span>
    </div>
  )
}

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

export default function CredenciamentoEmerRadar() {
  const [tab, setTab] = useState('catalogo') // catalogo | busca | coleta
  /** null | true | false | 'actions' (prod sem worker — cron via GitHub Actions) */
  const [apiOk, setApiOk] = useState(null)
  const [servidorAberto, setServidorAberto] = useState(false)
  const [apiError, setApiError] = useState('')
  const remoto = isEmerRadarAmbienteRemoto()
  // «Busca manual» exige o worker local: sem ele a aba nem aparece.
  const tabAtiva = tab === 'busca' && apiOk !== true ? 'catalogo' : tab

  useEffect(() => {
    let cancelled = false
    emerRadarHealth()
      .then((h) => {
        if (cancelled) return h
        if (h?.mode === 'actions-only' || h?.message === 'WORKER_AUSENTE_PROD') {
          setApiOk('actions')
          setApiError('')
          return h
        }
        setApiOk(true)
        setApiError('')
        return h
      })
      .catch((e) => {
        if (cancelled) return
        const msg = e?.message || 'Worker Emer-Radar inacessível'
        if (msg === 'WORKER_AUSENTE_PROD' || remoto) {
          setApiOk('actions')
          setApiError('')
          return
        }
        setApiOk(false)
        setApiError(msg)
      })
    return () => {
      cancelled = true
    }
  }, [remoto])

  const statusLabel =
    apiOk === null
      ? 'Verificando API…'
      : apiOk === true
        ? 'Worker online'
        : apiOk === 'actions'
          ? 'Cron via GitHub Actions (sem worker na Vercel)'
          : `Worker offline${apiError ? ` — ${apiError}` : ''}`
  const statusTone =
    apiOk === null ? 'checking' : apiOk === true ? 'ok' : apiOk === 'actions' ? 'checking' : 'erro'

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
            <button
              type="button"
              className="emer-radar-servidor-btn"
              title="Servidor de prospecção: baixar e instruções"
              aria-label="Baixar o servidor de prospecção (Windows)"
              onClick={() => setServidorAberto(true)}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v12" />
                <path d="m7 10 5 5 5-5" />
                <path d="M4 19h16" />
              </svg>
            </button>
          </span>
        }
        description="Coleta automática e busca manual no Google Maps, cruzadas com Petlove, Petlife, Doglife e Emerdog — num só catálogo."
        actions={
          <div className="emer-radar-tabs" role="tablist">
            {[
              ['catalogo', 'Catálogo'],
              ...(apiOk === true ? [['busca', 'Busca manual']] : []),
              ['coleta', 'Coleta automática'],
            ].map(([id, rotulo]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tabAtiva === id}
                className={tabAtiva === id ? 'is-active' : ''}
                onClick={() => setTab(id)}
              >
                {rotulo}
              </button>
            ))}
          </div>
        }
      />

      {tabAtiva === 'coleta' && apiOk === 'actions' ? (
        <div className="el-stage mb-4 text-sm border border-[#123e59]/15 bg-[#123e59]/5 dark:border-sky-400/25 dark:bg-sky-400/10">
          <p className="m-0 font-semibold text-[#123e59] dark:text-sky-100">
            Produção: a coleta roda no GitHub Actions — não há worker neste site.
          </p>
          <p className="mt-2 mb-0 text-xs text-ink-muted dark:text-sky-100/80">
            Use <strong>«Rodar cron (Actions)»</strong> para processar a fila e abra os resultados
            em <strong>Execuções e resultados</strong>. Prospect Maps interativo só funciona em
            local, com o worker.
          </p>
        </div>
      ) : null}

      {tabAtiva !== 'catalogo' && apiOk === false ? (
        <div className="el-stage mb-4 text-sm">
          <p className="m-0 text-status-erro">
            Worker local inacessível (<code className="text-xs">{getEmerRadarApiBase()}</code>
            {apiError ? ` — ${apiError}` : ''}).
          </p>
          <p className="mt-2 mb-0 text-xs text-ink-muted">
            Na pasta <code>teste-emeradar</code> rode{' '}
            <code>python backend/main.py</code> (porta 8000; o Vite faz proxy de{' '}
            <code>/emeradar</code>). Depois recarregue esta página.
          </p>
        </div>
      ) : null}

      {tabAtiva === 'coleta' ? (
        <PipelinePanel workerDisponivel={apiOk === true} />
      ) : (
        <ProspectPanel workerDisponivel={apiOk === true} modo={tabAtiva} onModo={setTab} />
      )}

      <EmerRadarServidorModal open={servidorAberto} onClose={() => setServidorAberto(false)} workerAtivo={apiOk === true} />
    </div>
  )
}

function PipelinePanel({ workerDisponivel = false }) {
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
  const [filaCron, setFilaCron] = useState([])
  const [filaCronErro, setFilaCronErro] = useState('')
  const [cronActionsBusy, setCronActionsBusy] = useState(false)
  const [cronActionsMsg, setCronActionsMsg] = useState('')
  const [avancadoAberto, setAvancadoAberto] = useState(false)

  const isRunning = snap?.status === 'RODANDO'

  const trafegoPreview = useMemo(
    () => parseCidadesTrafego(trafegoTexto, trafegoUf),
    [trafegoTexto, trafegoUf],
  )

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

  const refreshFilaCron = useCallback(() => {
    pipelineListQueue()
      .then((r) => {
        const items = Array.isArray(r?.queue) ? r.queue : []
        setFilaCron(
          items.filter((item) => item.status === 'pending' || item.status === 'running'),
        )
        setFilaCronErro('')
      })
      .catch((e) => {
        setFilaCron([])
        setFilaCronErro(e?.message || 'Não foi possível ler a fila do cron.')
      })
  }, [])

  useEffect(() => {
    // Contadores, utilizadores, destinatários, fila e registry: Supabase.
    refreshTrafego()
    refreshRegistry()
    refreshFilaCron()
    listarUsuariosParaAtribuicao()
      .then(setUsuarios)
      .catch(() => setUsuarios([]))
    loadEmerRadarSettings()
      .then((s) => setDestinatarios(s.tarefa_destinatarios || []))
      .catch(() => undefined)

    // Status HTTP em tempo real: só com worker (dev). As execuções vêm do servidor (EmerRadarExecucoes).
    if (!workerDisponivel) {
      setSnap(null)
      return undefined
    }

    pipelineStatus()
      .then(setSnap)
      .catch(() => undefined)
    return undefined
  }, [workerDisponivel, refreshRegistry, refreshTrafego, refreshFilaCron])

  // Situação (cooldown) das cidades coladas, para avisar antes de enfileirar ou rodar.
  useEffect(() => {
    if (!trafegoPreview.length) {
      setPreview([])
      return undefined
    }
    const t = setTimeout(() => {
      pipelinePreviewCities(trafegoPreview)
        .then((p) => {
          setPreview(p.cities || [])
          if (p.cooldown_days) setCooldownDays(p.cooldown_days)
        })
        .catch(() => undefined)
    }, 300)
    return () => clearTimeout(t)
  }, [trafegoPreview])

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
        refreshRegistry()
      } catch {
        /* ignore */
      }
      es.close()
    })
    const poll = setInterval(() => {
      if (document.hidden) return // aba oculta: o status atualiza na volta (próxima rodada em 4 s)
      pipelineStatus()
        .then(async (s) => {
          setSnap(s)
          if (s?.status === 'CONCLUIDO') refreshRegistry()
        })
        .catch(() => undefined)
    }, 4000)
    return () => {
      es.close()
      clearInterval(poll)
    }
  }, [isRunning, refreshRegistry])

  const cidadesColadas = preview.length ? preview : trafegoPreview
  const emCooldown = useMemo(() => cidadesColadas.filter((c) => cidadeEmCooldown(c)), [cidadesColadas])

  /** Valida no IBGE e separa o que está em cooldown. */
  const prepararColadas = async () => {
    const { validas, rejeitadas } = await filtrarMunicipiosIbgeExistentes(trafegoPreview)
    const chaves = new Set(emCooldown.map((c) => `${String(c.cidade).toLowerCase()}|${c.uf}`))
    const livres = validas.filter((c) => !chaves.has(`${String(c.cidade).toLowerCase()}|${c.uf}`))
    return { validas, livres, rejeitadas, bloqueadas: validas.length - livres.length }
  }

  const handleEnfileirar = async () => {
    setTrafegoErro('')
    setTrafegoMsg('')
    if (!trafegoPreview.length) {
      setTrafegoErro('Cole ao menos uma cidade válida.')
      return
    }
    setTrafegoBusy(true)
    try {
      const { livres, rejeitadas, bloqueadas } = await prepararColadas()
      if (!livres.length) {
        setTrafegoErro(
          rejeitadas.length
            ? 'Nenhuma das cidades existe na lista oficial do IBGE.'
            : 'Todas as cidades estão em cooldown — aguarde a liberação.',
        )
        return
      }
      const res = await pipelineEnqueue(livres)
      const partes = [`${res.enqueued} enfileirada(s) para o próximo cron`]
      if (bloqueadas) partes.push(`${bloqueadas} em cooldown (ignorada${bloqueadas === 1 ? '' : 's'})`)
      if (rejeitadas.length) partes.push(`${rejeitadas.length} inexistente(s) no IBGE ignorada(s)`)
      setTrafegoMsg(partes.join(' · '))
      setTrafegoTexto('')
      refreshFilaCron()
    } catch (e) {
      setTrafegoErro(e?.message || String(e))
    } finally {
      setTrafegoBusy(false)
    }
  }

  const handleRodarAgora = async () => {
    setTrafegoErro('')
    setTrafegoMsg('')
    const redes = FONTES.filter((f) => f.id !== 'maps' && fontes[f.id]).map((f) => f.id)
    if (!fontes.maps && redes.length === 0) {
      setTrafegoErro('Selecione ao menos uma fonte em «Opções da coleta».')
      return
    }
    if (!trafegoPreview.length) {
      setTrafegoErro('Cole ao menos uma cidade válida.')
      return
    }
    setTrafegoBusy(true)
    try {
      const { livres, rejeitadas, bloqueadas } = await prepararColadas()
      if (!livres.length) {
        setTrafegoErro(
          rejeitadas.length
            ? 'Nenhuma das cidades existe na lista oficial do IBGE.'
            : 'Todas as cidades estão em cooldown — aguarde a liberação.',
        )
        return
      }
      const s2 = await pipelineStart({
        cidades: livres,
        fontes_maps: !!fontes.maps,
        fontes_rede: redes,
        max_por_termo: maxPorTermo,
        send_email: sendEmail,
      })
      setSnap(s2)
      const partes = [`Coleta iniciada para ${livres.length} cidade(s)`]
      if (bloqueadas) partes.push(`${bloqueadas} em cooldown (ignorada${bloqueadas === 1 ? '' : 's'})`)
      setTrafegoMsg(partes.join(' · '))
      setTrafegoTexto('')
    } catch (e) {
      setTrafegoErro(e?.message || String(e))
    } finally {
      setTrafegoBusy(false)
    }
  }

  const handleRegistarTrafego = async () => {
    setTrafegoErro('')
    setTrafegoMsg('')
    setTrafegoBusy(true)
    try {
      const res = await processarTrafegoDoDia(trafegoTexto, trafegoUf)
      if (!res.parsed && res.aviso) {
        setTrafegoErro(res.aviso)
        return
      }
      const partes = [
        `${res.novas} nova(s)`,
        `${res.jaTinhamDia} já tinham o dia`,
        `${res.enfileiradas} enfileirada(s) no cron`,
      ]
      if (res.emCooldown) partes.push(`${res.emCooldown} em cooldown (aguardam)`)
      if (res.rejeitadas?.length) {
        partes.push(`${res.rejeitadas.length} inexistente(s) no IBGE ignorada(s)`)
      }
      setTrafegoMsg(partes.join(' · '))
      if (res.aviso && res.rejeitadas?.length) setTrafegoErro(res.aviso)
      if (res.novas || res.enfileiradas) setTrafegoTexto('')
      refreshTrafego()
      refreshRegistry()
      refreshFilaCron()
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
      refreshFilaCron()
    } catch (e) {
      setTrafegoErro(e?.message || String(e))
    } finally {
      setTrafegoBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <PanelStep
        title="Adicionar cidades"
        hint="Cole uma cidade por linha. Depois escolha o que fazer: contar no tráfego, enfileirar para o cron ou (com o worker local) rodar agora."
      >
        <div className="emer-radar-form-grid emer-radar-form-grid--trafego">
          <label className="ek-field">
            <span className="ek-label">UF padrão</span>
            <SelectUfBusca value={trafegoUf} onChange={setTrafegoUf} />
            <span className="ek-hint">Usada quando a linha não traz UF (ex.: só «Gramado»).</span>
          </label>
          <label className="ek-field emer-radar-form-grid__wide">
            <span className="ek-label">Cidades (uma por linha)</span>
            <textarea
              className="ek-textarea font-mono"
              rows={5}
              placeholder={'Gramado\nCascavel/PR\nJoinville - SC'}
              value={trafegoTexto}
              onChange={(e) => setTrafegoTexto(e.target.value)}
              disabled={trafegoBusy}
              aria-describedby="trafego-format-hint"
            />
            <span id="trafego-format-hint" className="ek-hint">
              Formatos: <code>Cidade</code>, <code>Cidade/UF</code>, <code>Cidade - UF</code>.
            </span>
          </label>
        </div>

        {trafegoTexto.trim() ? (
          <div className="emer-radar-preview mt-4" aria-live="polite">
            <p className="emer-radar-preview__title">
              {trafegoPreview.length} cidade{trafegoPreview.length === 1 ? '' : 's'} reconhecida
              {trafegoPreview.length === 1 ? '' : 's'}
              {emCooldown.length ? ` · ${emCooldown.length} em cooldown` : ''}
            </p>
            {trafegoPreview.length === 0 ? (
              <p className="m-0 text-sm text-status-erro">
                Nenhuma linha válida. Confira a UF padrão ou use «Cidade/UF».
              </p>
            ) : (
              <div className="emer-radar-chip-row">
                {cidadesColadas.map((c) => {
                  const cool = cidadeEmCooldown(c)
                  return (
                    <span
                      key={`${c.cidade}|${c.uf}`}
                      className={`emer-radar-chip ${cool ? 'is-cooldown' : 'is-on'}`}
                      title={
                        cool
                          ? `Cooldown · libera em ${formatDateBR(c.liberada_em)} (${c.dias_restantes ?? '?'}d)`
                          : c.vezes_requisitada
                            ? `Disponível · ${c.vezes_requisitada}x requisitada`
                            : 'Disponível'
                      }
                    >
                      {c.cidade}
                      <span className="emer-radar-chip__uf">{c.uf}</span>
                      {cool && c.dias_restantes != null ? ` · ${c.dias_restantes}d` : ''}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={buttonClassName()}
            disabled={trafegoBusy || trafegoPreview.length === 0}
            onClick={() => void handleRegistarTrafego()}
            title={`Soma 1 marcador por dia; ao chegar a ${LIMIAR_MARCADORES_CRON} a cidade entra na fila`}
          >
            {trafegoBusy ? 'Aguarde…' : `Contar no tráfego (${trafegoPreview.length})`}
          </button>
          <button
            type="button"
            className={buttonClassName({ variant: 'secondary' })}
            disabled={trafegoBusy || trafegoPreview.length === 0}
            onClick={() => void handleEnfileirar()}
            title="Entra na fila do cron sem esperar o limiar de marcadores"
          >
            Enfileirar para o cron
          </button>
          {workerDisponivel ? (
            isRunning ? (
              <button type="button" className={buttonClassName({ variant: 'danger' })} onClick={() => pipelineStop().then(setSnap)}>
                Parar coleta
              </button>
            ) : (
              <button
                type="button"
                className={buttonClassName({ variant: 'secondary' })}
                disabled={trafegoBusy || trafegoPreview.length === 0}
                onClick={() => void handleRodarAgora()}
                title="Roda no worker local, agora"
              >
                Rodar agora
              </button>
            )
          ) : null}
          <button
            type="button"
            className="border-0 bg-transparent cursor-pointer text-sm font-semibold text-brand"
            disabled={trafegoBusy}
            onClick={() => void handleReenfileirarLimiar()}
          >
            Enfileirar quem já tem {LIMIAR_MARCADORES_CRON} marcadores
          </button>
        </div>
        <p className="ek-hint mt-2">
          <strong>Contar no tráfego:</strong> cada dia vale 1 marcador; com {LIMIAR_MARCADORES_CRON} a cidade entra na fila.{' '}
          <strong>Enfileirar:</strong> entra direto. Cooldown de {cooldownDays} dias após cada pesquisa.
        </p>

        {workerDisponivel ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-semibold">Opções da coleta (rodar agora)</summary>
            <div className="mt-3">
              <p className="ek-label mb-2">Fontes</p>
              <div className="emer-radar-chip-row" role="group" aria-label="Fontes do pipeline">
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
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <label className="text-sm">
                  Máx. por termo
                  <input
                    type="number"
                    min={10}
                    max={200}
                    className="ek-input ml-2 w-24"
                    value={maxPorTermo}
                    onChange={(e) => setMaxPorTermo(Number(e.target.value) || 80)}
                    onBlur={() => setMaxPorTermo((v) => Math.min(Math.max(Number(v) || 80, 10), 200))}
                  />
                </label>
                <label className="ek-check">
                  <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
                  Enviar e-mail ao terminar
                </label>
              </div>
            </div>
          </details>
        ) : null}

        {trafegoMsg ? (
          <p className="er-exec__alerta er-exec__alerta--ok mt-3" role="status">
            {trafegoMsg}
          </p>
        ) : null}
        {trafegoErro || error ? (
          <p className="er-exec__alerta er-exec__alerta--erro mt-3" role="alert">
            {trafegoErro || error}
          </p>
        ) : null}

        <EmerRadarTrafegoLista contadores={trafegoContadores} />
      </PanelStep>

      <PanelStep
        title="Fila do cron"
        hint="Em produção a fila é processada pelo GitHub Actions (seg–sex ~18h BRT). Em local precisa do worker na porta 8000."
        actions={
          <button
            type="button"
            className={buttonClassName({ variant: 'secondary' })}
            disabled={cronActionsBusy}
            onClick={async () => {
              setCronActionsMsg('')
              setCronActionsBusy(true)
              try {
                const res = await triggerEmerRadarCron()
                setCronActionsMsg(
                  res?.message ||
                    'Cron disparado no GitHub Actions. Acompanhe o run no repositório teste-emeradar.',
                )
              } catch (e) {
                setCronActionsMsg(e?.message || 'Falha ao disparar o cron.')
              } finally {
                setCronActionsBusy(false)
              }
            }}
          >
            {cronActionsBusy ? 'A disparar…' : 'Rodar cron (Actions)'}
          </button>
        }
      >
        {cronActionsMsg ? (
          <p className="mt-0 mb-3 text-sm text-ink-muted">{cronActionsMsg}</p>
        ) : null}
        {filaCronErro ? (
          <p className="mt-0 mb-3 text-sm text-status-erro">{filaCronErro}</p>
        ) : null}
        {filaCron.length === 0 && !filaCronErro ? (
          <p className="m-0 text-sm text-ink-muted">
            Fila vazia. Use o tráfego do dia ou «Enfileirar p/ cron» no modo manual. Em produção,
            dispare o cron com «Rodar cron (Actions)».
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {filaCron.map((item) => {
              const pendente = item.status === 'pending'
              return (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-sm dark:border-white/10"
                >
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <strong>
                      {item.cidade}/{item.uf}
                    </strong>
                    <StatusPill tone={pendente ? 'info' : 'ok'}>
                      {pendente ? 'Na fila' : 'A processar'}
                    </StatusPill>
                  </span>
                  {pendente ? (
                    <button
                      type="button"
                      className="border-0 bg-transparent text-status-erro cursor-pointer text-sm font-semibold"
                      onClick={async () => {
                        setFilaCronErro('')
                        try {
                          await pipelineRemoveFromQueue(item.id)
                          refreshFilaCron()
                        } catch (e) {
                          setFilaCronErro(e?.message || 'Não foi possível remover da fila.')
                        }
                      }}
                    >
                      Remover
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </PanelStep>

      <PanelStep
        title="Execuções e resultados"
        hint="Estado do cron e todas as coletas já feitas. «Ver resultados» abre a execução em uma nova aba, com filtros e ordenação."
      >
        <EmerRadarExecucoes
          workerDisponivel={workerDisponivel}
          executando={isRunning}
        />
      </PanelStep>

      <details
        className="el-stage emer-radar-details"
        open={avancadoAberto}
        onToggle={(e) => setAvancadoAberto(e.currentTarget.open)}
      >
        <summary className="emer-radar-details__summary">
          Opções avançadas (destinatários e histórico de cidades)
        </summary>
        <div className="emer-radar-details__body space-y-5 pt-3">
      <section>
        <h3 className="mt-0 font-bold">Destinatários das tarefas</h3>
        <p className="text-sm text-ink-soft dark:text-[#9eb4c8]">
          Ao finalizar o pipeline (cron), cria uma tarefa no Home para cada usuário marcado
          (Excel + HTML anexados). Salvo no Supabase — vale na Vercel e no GitHub Actions.
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
              const saved = await saveEmerRadarSettings({
                tarefa_destinatarios: destinatarios,
              })
              setDestinatarios(saved.tarefa_destinatarios || [])
              setSettingsMsg('Destinatários salvos (usados pelo cron no GitHub Actions).')
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

      {registry.length > 0 && (
        <section>
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
                      if (trafegoPreview.length) {
                        const prev = await pipelinePreviewCities(trafegoPreview)
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
      </details>

      <div id="emer-radar-resultados" />
      {snap && snap.status && snap.status !== 'IDLE' && (
        <PanelStep
          title="Estado da execução"
          hint={
            isRunning
              ? 'Pipeline a correr — pode acompanhar o progresso abaixo.'
              : 'Última execução carregada ou em curso.'
          }
        >
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
            {snap.progress?.total || 0} · {snap.encontrados ?? 0} registros
          </p>
          <PipelineBar snap={snap} />
          {snap.error_message && (
            <p className="text-sm text-status-erro">{snap.error_message}</p>
          )}
          <pre className="mt-3 max-h-40 overflow-auto rounded-xl bg-[#0d1520] p-3 text-xs text-[#cfe8f8]">
            {(snap.logs || []).slice(-40).join('\n') || 'Sem logs ainda.'}
          </pre>
          {snap.status === 'CONCLUIDO' && snap.run_id ? (
            <div className="mt-3">
              <button
                type="button"
                className={buttonClassName()}
                onClick={() => {
                  if (!abrirExecucaoEmerRadar(snap.run_id)) {
                    avisar({ titulo: 'Pop-up bloqueado', mensagem: 'Permita pop-ups para este site e tente de novo.' })
                  }
                }}
              >
                Abrir resultados desta execução ↗
              </button>
            </div>
          ) : null}
          {snap.status === 'CONCLUIDO' && workerDisponivel && (
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
        </PanelStep>
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

function mapsIdPrimeiro(lista) {
  const est = (lista || [])[0]
  return est ? mapsIdDeEstabelecimento(est) : ''
}

function ProspectPanel({ workerDisponivel = false, modo = 'catalogo', onModo }) {
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

  const aba = modo // busca | catalogo — escolhido nas abas do topo
  const setAba = useCallback((v) => onModo?.(v), [onModo])
  const [filtroUf, setFiltroUf] = useState('')
  const [filtroCidade, setFiltroCidade] = useState('')
  const { municipios: municipiosFiltro, loading: loadingMunFiltro } = useMunicipiosPorUf(filtroUf)
  const [filtroStatus, setFiltroStatus] = useState('')
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
  }, [filtroUf, filtroCidade, filtroStatus])

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
  }, [carregarCatalogo, setAba])

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
    void carregarParesCidade()
    if (!workerDisponivel) {
      setSnap(null)
      setResults([])
      return undefined
    }
    scrapeStatus()
      .then(applySnap)
      .catch(() => undefined)
    scrapeResults()
      .then((r) => setResults(r.results || []))
      .catch(() => undefined)
    return undefined
  }, [workerDisponivel, carregarParesCidade, applySnap])

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
      if (document.hidden) return // aba oculta: o status atualiza na volta (próxima rodada em 4 s)
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

  const cidadeIbgeOk = useMemo(() => {
    const nome = String(cidade || '').trim().toLowerCase()
    if (!nome || !uf) return false
    return (municipios || []).some((m) => String(m?.nome || '').trim().toLowerCase() === nome)
  }, [cidade, uf, municipios])

  const buscaPronta = Boolean(uf && cidadeIbgeOk && termos.length > 0 && maxResults >= 20)

  const handleStart = async () => {
    setError('')
    setSaveMsg('')
    if (atualizandoCatalogo || filaAtualizacaoRef.current) {
      setError('Aguarde a atualização do catálogo terminar (ou cancele).')
      return
    }
    if (!uf) {
      setError('Selecione a UF.')
      return
    }
    if (!cidade.trim()) {
      setError('Selecione a cidade na lista IBGE.')
      return
    }
    if (!cidadeIbgeOk) {
      setError('Cidade inválida. Escolha um município da lista IBGE (sem digitar à mão).')
      return
    }
    if (!termos.length) {
      setError('Marque ao menos um termo de busca.')
      return
    }
    const maxOk = Math.min(Math.max(Number(maxResults) || 80, 20), 150)
    if (maxOk !== maxResults) setMaxResults(maxOk)
    try {
      filaAtualizacaoRef.current = null
      setAtualizandoCatalogo(false)
      setAtualizacaoProgresso('')
      await iniciarScrapeJob({
        cidade: cidade.trim(),
        uf,
        termos,
        max_results: maxOk,
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
    const ok = await confirmarAcao({
      titulo: 'Rebuscar no Maps e atualizar o catálogo?',
      confirmar: 'Atualizar catálogo',
      mensagem:
        `• ${fila.totalProspectos} prospecto(s) filtrado(s)\n` +
        `• ${fila.jobs.length} cidade(s): ${fila.jobs.map((j) => `${j.cidade}/${j.uf}`).join(', ')}\n\n` +
        `Dados novos (telefone, endereço, horário, etc.) substituem os salvos quando o scrape trouxer valor.`,
    })
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
      {!workerDisponivel && aba === 'busca' ? (
        <p className="er-exec__alerta er-exec__alerta--warn" role="status">
          Nova busca no Maps precisa do worker local (Playwright). Em produção use o{' '}
          <strong>catálogo salvo</strong>; para prospectar ao vivo, rode o worker em localhost.
        </p>
      ) : null}

      {aba === 'busca' ? (
        <PanelStep
          title="Busca manual no Google Maps"
          hint="Cidade só pela lista IBGE (evita nomes errados). Os resultados entram no mesmo catálogo da coleta automática."
        >
          <div className="emer-radar-form-grid emer-radar-form-grid--prospect">
            <label className="ek-field">
              <span className="ek-label">
                UF <span className="text-status-erro">*</span>
              </span>
              <SelectUfBusca
                value={uf}
                disabled={isRunning}
                onChange={(u) => {
                  setUf(u)
                  setCidade('')
                }}
              />
            </label>
            <label className="ek-field emer-radar-form-grid__wide">
              <span className="ek-label">
                Cidade (IBGE) <span className="text-status-erro">*</span>
              </span>
              <SelectMunicipioBusca
                value={cidade}
                valueKey="nome"
                options={municipios}
                disabled={!uf || loadingMun || isRunning}
                loading={loadingMun}
                inputClassName={SELECT_CIDADE_INPUT}
                placeholder={!uf ? 'Selecione a UF primeiro' : 'Buscar município…'}
                onChange={setCidade}
              />
              <span className="ek-hint">
                Só municípios oficiais — não é possível criar cidade livre.
              </span>
            </label>
            <label className="ek-field">
              <span className="ek-label">Máx. por termo</span>
              <input
                type="number"
                min={20}
                max={150}
                step={10}
                className="ek-input"
                value={maxResults}
                disabled={isRunning}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  setMaxResults(Number.isFinite(n) ? n : 80)
                }}
                onBlur={() =>
                  setMaxResults((v) => Math.min(Math.max(Number(v) || 80, 20), 150))
                }
              />
              <span className="ek-hint">Entre 20 e 150.</span>
            </label>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="m-0 text-sm font-semibold">
                Termos <span className="text-status-erro">*</span>
              </p>
              <div className="flex gap-3 text-xs">
                <button
                  type="button"
                  className="border-0 bg-transparent cursor-pointer font-semibold text-brand"
                  disabled={isRunning}
                  onClick={() => setTermos([...terms])}
                >
                  Todos
                </button>
                <button
                  type="button"
                  className="border-0 bg-transparent cursor-pointer font-semibold text-ink-muted"
                  disabled={isRunning}
                  onClick={() => setTermos([])}
                >
                  Limpar
                </button>
              </div>
            </div>
            <div className="emer-radar-chip-row" role="group" aria-label="Termos de busca">
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

          {(uf || cidade || termos.length > 0) && (
            <div className="emer-radar-preview mt-4" aria-live="polite">
              <p className="emer-radar-preview__title">Resumo antes de iniciar</p>
              <ul className="emer-radar-checklist">
                <li className={uf ? 'is-ok' : 'is-miss'}>
                  <span aria-hidden>{uf ? '✓' : '○'}</span>
                  UF: {uf || 'em falta'}
                </li>
                <li className={cidadeIbgeOk ? 'is-ok' : 'is-miss'}>
                  <span aria-hidden>{cidadeIbgeOk ? '✓' : '○'}</span>
                  Cidade IBGE: {cidadeIbgeOk ? cidade : cidade ? 'não está na lista' : 'em falta'}
                </li>
                <li className={termos.length ? 'is-ok' : 'is-miss'}>
                  <span aria-hidden>{termos.length ? '✓' : '○'}</span>
                  {termos.length
                    ? `${termos.length} termo${termos.length === 1 ? '' : 's'} · até ${maxResults} resultados cada`
                    : 'Selecione ao menos 1 termo'}
                </li>
              </ul>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            {!isRunning ? (
              <button
                type="button"
                className={buttonClassName()}
                onClick={handleStart}
                disabled={atualizandoCatalogo || !buscaPronta || !workerDisponivel}
                title={
                  !workerDisponivel
                    ? 'Worker indisponível na Vercel — use o catálogo ou rode o worker em local'
                    : !buscaPronta
                      ? 'Preencha UF, cidade IBGE e ao menos um termo'
                      : 'Iniciar busca no Google Maps'
                }
              >
                Iniciar busca
                {buscaPronta && cidade ? ` · ${cidade}/${uf}` : ''}
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
              </>
            )}
          </div>
        </PanelStep>
      ) : (
        <PanelStep
          title="Catálogo de prospectos"
          hint="Tudo o que o Emer-Radar já coletou, num só lugar. Filtre por UF, cidade e status; a busca e os demais filtros ficam acima dos cartões."
        >
          <div className="emer-radar-form-grid emer-radar-form-grid--catalog">
            <label className="ek-field">
              <span className="ek-label">UF</span>
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
            <label className="ek-field">
              <span className="ek-label">Cidade</span>
              <SelectMunicipioBusca
                value={filtroCidade}
                valueKey="nome"
                options={municipiosCatalogo}
                disabled={loadingMunFiltro}
                loading={Boolean(filtroUf) && loadingMunFiltro}
                inputClassName={SELECT_CIDADE_INPUT}
                placeholder={
                  filtroUf ? 'Buscar cidade…' : 'Todas · ou selecione UF para filtrar'
                }
                onChange={setFiltroCidade}
              />
            </label>
            <label className="ek-field">
              <span className="ek-label">Status</span>
              <SelectDropdown
                className="ek-input"
                value={filtroStatus}
                onChange={(e) => setFiltroStatus(e.target.value)}
              >
                <option value="">Ativos (sem descartados)</option>
                {STATUS_PROSPECCAO_MAPS_OPCOES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </SelectDropdown>
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={buttonClassName({ variant: 'secondary' })}
              disabled={!filtroUf && !filtroCidade && !filtroStatus}
              onClick={() => {
                setFiltroUf('')
                setFiltroCidade('')
                setFiltroStatus('')
              }}
            >
              Limpar filtros
            </button>
            <span className="ek-hint" role="status">
              {catalogoLoading ? 'Carregando…' : `${catalogo.length} prospecto${catalogo.length === 1 ? '' : 's'} no filtro atual`}
            </span>
          </div>
        </PanelStep>
      )}

      {error && (
        <p className="er-exec__alerta er-exec__alerta--erro" role="alert">
          {error}
        </p>
      )}
      {saveMsg && (
        <p
          className={`er-exec__alerta ${
            /ausente|falha|não foi|erro/i.test(saveMsg) ? 'er-exec__alerta--erro' : 'er-exec__alerta--ok'
          }`}
          role="status"
        >
          {saveMsg}
        </p>
      )}
      {catalogoErro && aba === 'catalogo' && (
        <p className="er-exec__alerta er-exec__alerta--erro" role="alert">
          {catalogoErro}
        </p>
      )}

      {showProgress && (
        <PanelStep
          title="Progresso da busca"
          hint={
            isRunning
              ? 'Acompanhe termo a termo. Pode parar a qualquer momento.'
              : 'Última execução — logs e estado final.'
          }
        >
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
            <pre className="mt-3 max-h-36 overflow-auto rounded-xl bg-[#0d1520] p-3 text-xs leading-relaxed text-[#cfe8f8]">
              {logs.slice(-30).join('\n')}
            </pre>
          )}
        </PanelStep>
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
        <PanelStep title="Catálogo">
          <LoadingState label="Carregando catálogo…" />
        </PanelStep>
      ) : !catalogo.length ? (
        <PanelStep title="Catálogo">
          <EmptyState
            title="Nenhum prospecto para estes filtros"
            description={
              workerDisponivel
                ? 'Rode uma busca em «Nova busca» — os resultados entram no catálogo automaticamente (sem fotos).'
                : 'Ajuste os filtros acima. Novas buscas no Maps exigem o worker local.'
            }
          />
        </PanelStep>
      ) : (
        <EmerRadarProspectResults
          results={catalogo}
          titulo="Prospectos"
          mostrarExport={false}
          atualizandoCatalogo={atualizandoCatalogo || isRunning}
          onAtualizarFiltrados={workerDisponivel ? (itens) => void handleAtualizarFiltrados(itens) : undefined}
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
