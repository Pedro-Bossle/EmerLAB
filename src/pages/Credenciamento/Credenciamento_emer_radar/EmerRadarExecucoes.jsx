import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, EmptyState, ErrorState, LoadingState, ResponsiveTable } from '../../../components/ui'
import {
  emerRadarCarregarExecucao,
  emerRadarListarExecucoes,
  emerRadarStatusCron,
  pipelineGetRun,
  pipelineListRuns,
} from '../../../lib/credenciamento/emerRadarApi.js'
import { exportarExecucaoEmerRadarParaExcel } from '../../../lib/credenciamento/exportEmerRadarRun.js'
import { LIMIAR_MARCADORES_CRON } from '../../../lib/credenciamento/trafegoCidades.js'
import { avisar } from '../../../lib/dialogos.js'

const fmtDataHora = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

const diasDesde = (iso) => {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86400000)
}

/** Resultado do último disparo no GitHub Actions, em linguagem simples. */
function resumoGithub(gh) {
  const ultimo = gh?.runs?.[0]
  if (!ultimo) return { tone: 'neutral', titulo: gh?.erro ? 'Indisponível' : 'Sem execuções', detalhe: gh?.erro || '' }
  if (ultimo.status !== 'completed') return { tone: 'info', titulo: 'Em andamento', detalhe: fmtDataHora(ultimo.created_at) }
  if (ultimo.conclusion === 'success') return { tone: 'ok', titulo: 'Executou sem erro', detalhe: fmtDataHora(ultimo.created_at) }
  return { tone: 'erro', titulo: 'Falhou', detalhe: fmtDataHora(ultimo.created_at) }
}

function Estatistica({ rotulo, valor, detalhe, tone }) {
  return (
    <div className="er-stat">
      <span className="er-stat__label">{rotulo}</span>
      <span className="er-stat__value">{tone ? <Badge tone={tone}>{valor}</Badge> : valor}</span>
      {detalhe ? <span className="er-stat__hint">{detalhe}</span> : null}
    </div>
  )
}

/**
 * Estado do cron + lista de execuções selecionáveis.
 * Lê pelo servidor (service role): em produção as tabelas do pipeline não são legíveis pelo navegador
 * e o worker HTTP não existe.
 */
export default function EmerRadarExecucoes({ workerDisponivel = false, executando = false, onCarregar }) {
  const [status, setStatus] = useState(null)
  const [statusErro, setStatusErro] = useState('')
  const [runs, setRuns] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [abrindo, setAbrindo] = useState('')
  const [selecionado, setSelecionado] = useState('')

  const atualizar = useCallback(async () => {
    setCarregando(true)
    setErro('')
    setStatusErro('')
    const [st, lista] = await Promise.allSettled([emerRadarStatusCron(), emerRadarListarExecucoes()])
    if (st.status === 'fulfilled') setStatus(st.value)
    else setStatusErro(st.reason?.message || 'Não foi possível ler o estado do cron.')

    if (lista.status === 'fulfilled') {
      setRuns(lista.value.runs || [])
    } else if (workerDisponivel) {
      try {
        const r = await pipelineListRuns()
        setRuns(r.runs || [])
      } catch (e) {
        setRuns([])
        setErro(e?.message || 'Não foi possível listar as execuções.')
      }
    } else {
      setRuns([])
      setErro(lista.reason?.message || 'Não foi possível listar as execuções.')
    }
    setCarregando(false)
  }, [workerDisponivel])

  useEffect(() => {
    void atualizar()
  }, [atualizar])

  // Ao terminar uma execução local, a lista precisa refletir a nova linha.
  const estavaExecutando = useRef(false)
  useEffect(() => {
    if (estavaExecutando.current && !executando) void atualizar()
    estavaExecutando.current = executando
  }, [executando, atualizar])

  const abrir = async (run) => {
    setAbrindo(run.id)
    try {
      let data
      try {
        data = await emerRadarCarregarExecucao(run.id)
      } catch (e) {
        if (!workerDisponivel) throw e
        data = await pipelineGetRun(run.id)
      }
      setSelecionado(run.id)
      onCarregar?.(data)
    } catch (e) {
      avisar({ titulo: 'Não foi possível abrir a execução', mensagem: e?.message || 'Erro desconhecido.' })
    } finally {
      setAbrindo('')
    }
  }

  const baixarExcel = async (run) => {
    setAbrindo(`xlsx:${run.id}`)
    try {
      const data = await emerRadarCarregarExecucao(run.id)
      const res = await exportarExecucaoEmerRadarParaExcel(data.results, run.id)
      if (!res.ok) avisar({ titulo: 'Nada para exportar', mensagem: res.erro })
    } catch (e) {
      avisar({ titulo: 'Falha ao gerar o Excel', mensagem: e?.message || 'Erro desconhecido.' })
    } finally {
      setAbrindo('')
    }
  }

  const gh = useMemo(() => resumoGithub(status?.github), [status])
  const ultima = status?.ultimaExecucao
  const fila = status?.fila
  const quase = status?.trafego?.marcadores?.[LIMIAR_MARCADORES_CRON - 1] || 0
  const diasSemColeta = diasDesde(ultima?.finished_at || ultima?.started_at)

  const alertas = []
  if (status?.github?.runs?.[0]?.conclusion === 'failure') {
    alertas.push({ tone: 'erro', texto: 'O último disparo do cron no GitHub Actions falhou. Abra o log pelo link abaixo.' })
  }
  if (fila && fila.pending === 0 && fila.running === 0 && (diasSemColeta ?? 0) >= 3) {
    alertas.push({
      tone: 'warn',
      texto: `Fila vazia: o cron roda, mas não há cidade para processar. Última coleta há ${diasSemColeta} dias${
        quase ? ` · ${quase} cidade${quase === 1 ? '' : 's'} a 1 marcador de entrar na fila` : ''
      }.`,
    })
  }
  if (ultima && ultima.total === 0) {
    alertas.push({ tone: 'warn', texto: 'A última execução terminou com 0 registros. Pode ser mudança no Google Maps ou bloqueio do scraper.' })
  }

  const emailRun = ultima?.email
  if (emailRun && emailRun.ok === false) {
    alertas.push({
      tone: 'warn',
      texto: `O e-mail da última execução não foi enviado${emailRun.skipped ? ' (envio não configurado no cron)' : ''}. Configure EMAIL_INTERNAL_SECRET no GitHub Actions do teste-emeradar.`,
    })
  }
  if (ultima?.tarefas && ultima.tarefas.ok === false) {
    alertas.push({
      tone: 'warn',
      texto: 'As tarefas da Home não foram criadas na última execução. Configure EMERDOG_SUPABASE_URL, EMERDOG_SUPABASE_SERVICE_ROLE_KEY e EMERDOG_TAREFA_CRIADOR_ID no GitHub Actions.',
    })
  }

  return (
    <div className="er-exec">
      {statusErro ? <p className="er-exec__aviso">{statusErro}</p> : null}

      <div className="er-stats" aria-live="polite">
        <Estatistica
          rotulo="Próxima execução automática"
          valor={status ? fmtDataHora(status.proximaExecucao) : '—'}
          detalhe="Seg–sex, 18h (Brasília)"
        />
        <Estatistica rotulo="Último disparo do cron" valor={gh.titulo} tone={gh.tone} detalhe={gh.detalhe} />
        <Estatistica
          rotulo="Fila"
          valor={fila ? `${fila.pending + fila.running} cidade${fila.pending + fila.running === 1 ? '' : 's'}` : '—'}
          detalhe={fila?.running ? `${fila.running} em processamento` : 'aguardando o próximo cron'}
        />
        <Estatistica
          rotulo="Última coleta"
          valor={ultima ? fmtDataHora(ultima.finished_at || ultima.started_at) : '—'}
          detalhe={ultima ? `${ultima.total ?? '?'} registros` : 'nenhuma ainda'}
        />
      </div>

      {alertas.map((a) => (
        <p key={a.texto} className={`er-exec__alerta er-exec__alerta--${a.tone}`} role="status">
          {a.texto}
        </p>
      ))}

      {status?.github?.workflowUrl ? (
        <p className="er-exec__links">
          <a href={status.github.workflowUrl} target="_blank" rel="noreferrer">
            Ver execuções do cron no GitHub
          </a>
        </p>
      ) : null}

      <div className="er-exec__bar">
        <h3 className="er-exec__title">Execuções ({runs.length})</h3>
        <Button variant="secondary" onClick={() => void atualizar()} disabled={carregando}>
          {carregando ? 'Atualizando…' : 'Atualizar'}
        </Button>
      </div>

      {carregando && runs.length === 0 ? (
        <LoadingState label="Carregando execuções…" />
      ) : erro ? (
        <ErrorState title="Não foi possível listar as execuções" description={erro} onRetry={() => void atualizar()} />
      ) : runs.length === 0 ? (
        <EmptyState
          title="Nenhuma execução ainda"
          description="Quando o cron processar a fila, cada coleta aparece aqui para você abrir os resultados."
        />
      ) : (
        <ResponsiveTable stack>
          <thead>
            <tr>
              <th>Data</th>
              <th>Cidades</th>
              <th>Registros</th>
              <th>Status</th>
              <th aria-label="Ações" />
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const concluido = r.status === 'concluido' || r.status === 'CONCLUIDO'
              const vazio = concluido && !r.total
              const cidades = (r.cidades || []).map((c) => `${c.cidade}/${c.uf}`)
              const ativo = selecionado === r.id
              return (
                <tr key={r.id} className={ativo ? 'is-selected' : undefined}>
                  <td data-label="Data">{fmtDataHora(r.started_at)}</td>
                  <td data-label="Cidades">
                    {cidades.length ? (
                      <span title={cidades.join(', ')}>
                        {cidades.slice(0, 3).join(', ')}
                        {cidades.length > 3 ? ` +${cidades.length - 3}` : ''}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td data-label="Registros" className="tabular-nums">
                    {r.total ?? '—'}
                  </td>
                  <td data-label="Status">
                    {vazio ? (
                      <Badge tone="warn">0 resultados</Badge>
                    ) : concluido ? (
                      <Badge tone="ok">Concluída</Badge>
                    ) : r.status === 'running' ? (
                      <Badge tone="info">Sem finalizar</Badge>
                    ) : (
                      <Badge>{r.status || '—'}</Badge>
                    )}
                  </td>
                  <td data-label="">
                    <div className="er-exec__acoes">
                      <Button disabled={abrindo === r.id} onClick={() => void abrir(r)}>
                        {abrindo === r.id ? 'Abrindo…' : ativo ? 'Aberta' : 'Ver resultados'}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={!r.total || abrindo === `xlsx:${r.id}`}
                        onClick={() => void baixarExcel(r)}
                      >
                        Excel
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </ResponsiveTable>
      )}
    </div>
  )
}
