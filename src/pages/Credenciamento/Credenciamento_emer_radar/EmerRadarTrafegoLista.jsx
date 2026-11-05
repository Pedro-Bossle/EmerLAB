import React, { useMemo, useState } from 'react'
import { Badge, Button, EmptyState, Input, ResponsiveTable, Select } from '../../../components/ui'
import { formatDateBR } from '../../../lib/credenciamento/emerRadarUi.js'
import { LIMIAR_MARCADORES_CRON } from '../../../lib/credenciamento/trafegoCidades.js'

const POR_PAGINA = 10

const semAcento = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** Estado de uma cidade acompanhada: pronta (bateu o limiar), enfileirada (contador zerado) ou acumulando. */
function estadoDe(row) {
  const m = Number(row.marcadores) || 0
  if (m >= LIMIAR_MARCADORES_CRON) return 'pronta'
  if (row.enfileirado_em && m === 0) return 'enfileirada'
  return 'acumulando'
}

const ROTULO = { pronta: 'Pronta p/ cron', enfileirada: 'Já enfileirada', acumulando: 'Acumulando' }
const TOM = { pronta: 'ok', enfileirada: 'info', acumulando: 'neutral' }

function Medidor({ valor }) {
  const m = Number(valor) || 0
  const pct = Math.min(100, Math.round((m / LIMIAR_MARCADORES_CRON) * 100))
  return (
    <div className="emer-radar-meter" title={`${m} de ${LIMIAR_MARCADORES_CRON} marcadores`}>
      <div className="emer-radar-meter__track" aria-hidden>
        <div className={`emer-radar-meter__fill${m >= LIMIAR_MARCADORES_CRON ? ' is-ready' : ''}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="emer-radar-meter__label tabular-nums">
        {m}/{LIMIAR_MARCADORES_CRON}
      </span>
    </div>
  )
}

/**
 * Cidades do tráfego em acompanhamento. Resumo no topo + "quase lá"; a lista completa fica
 * recolhida e filtrável (busca, UF, estado, ordenação, paginação) para não poluir a tela.
 */
export default function EmerRadarTrafegoLista({ contadores = [] }) {
  const [aberta, setAberta] = useState(false)
  const [filtro, setFiltro] = useState('acumulando')
  const [busca, setBusca] = useState('')
  const [uf, setUf] = useState('')
  const [ordem, setOrdem] = useState('marcadores')
  const [limite, setLimite] = useState(POR_PAGINA)

  const linhas = useMemo(() => contadores.map((r) => ({ ...r, estado: estadoDe(r) })), [contadores])

  const total = useMemo(() => {
    const t = { pronta: 0, enfileirada: 0, acumulando: 0 }
    for (const l of linhas) t[l.estado] += 1
    return t
  }, [linhas])

  const quaseLa = useMemo(
    () =>
      linhas
        .filter((l) => l.estado === 'acumulando' && Number(l.marcadores) >= LIMIAR_MARCADORES_CRON - 1)
        .slice(0, 6),
    [linhas],
  )

  const ufs = useMemo(() => [...new Set(linhas.map((l) => l.uf).filter(Boolean))].sort(), [linhas])

  const lista = useMemo(() => {
    const termo = semAcento(busca).trim()
    const filtradas = linhas.filter((l) => {
      if (filtro && l.estado !== filtro) return false
      if (uf && l.uf !== uf) return false
      if (termo && !semAcento(l.cidade).includes(termo)) return false
      return true
    })
    const cmp = {
      marcadores: (a, b) => Number(b.marcadores) - Number(a.marcadores) || a.cidade.localeCompare(b.cidade, 'pt-BR'),
      cidade: (a, b) => a.cidade.localeCompare(b.cidade, 'pt-BR'),
      recente: (a, b) => String(b.ultima_aparicao_em || '').localeCompare(String(a.ultima_aparicao_em || '')),
    }[ordem]
    return [...filtradas].sort(cmp)
  }, [linhas, filtro, uf, busca, ordem])

  if (!linhas.length) return null

  const escolher = (f) => {
    setFiltro(f)
    setLimite(POR_PAGINA)
    setAberta(true)
  }

  return (
    <div className="er-trafego">
      <div className="er-trafego__resumo" role="group" aria-label="Resumo das cidades acompanhadas">
        {[
          ['pronta', 'Prontas p/ cron'],
          ['acumulando', 'Acumulando'],
          ['enfileirada', 'Já enfileiradas'],
        ].map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            className={`er-trafego__chip${aberta && filtro === id ? ' is-active' : ''}`}
            onClick={() => escolher(id)}
          >
            <span className="er-trafego__chip-n">{total[id]}</span>
            <span>{rotulo}</span>
          </button>
        ))}
      </div>

      {quaseLa.length > 0 ? (
        <p className="er-trafego__quase">
          <strong>Mais perto do limiar:</strong>{' '}
          {quaseLa.map((l, i) => (
            <span key={l.id || `${l.cidade}-${l.uf}`}>
              {i ? ' · ' : ''}
              {l.cidade}/{l.uf} ({l.marcadores}/{LIMIAR_MARCADORES_CRON})
            </span>
          ))}
        </p>
      ) : null}

      <Button variant="secondary" onClick={() => setAberta((v) => !v)} aria-expanded={aberta}>
        {aberta ? 'Ocultar lista' : `Ver cidades acompanhadas (${linhas.length})`}
      </Button>

      {aberta ? (
        <div className="er-trafego__lista">
          <div className="er-trafego__filtros">
            <Input
              label="Buscar cidade"
              type="search"
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value)
                setLimite(POR_PAGINA)
              }}
            />
            <Select label="Situação" value={filtro} onChange={(e) => { setFiltro(e.target.value); setLimite(POR_PAGINA) }}>
              <option value="">Todas ({linhas.length})</option>
              <option value="pronta">Prontas p/ cron ({total.pronta})</option>
              <option value="acumulando">Acumulando ({total.acumulando})</option>
              <option value="enfileirada">Já enfileiradas ({total.enfileirada})</option>
            </Select>
            <Select label="UF" value={uf} onChange={(e) => { setUf(e.target.value); setLimite(POR_PAGINA) }}>
              <option value="">Todas</option>
              {ufs.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
            <Select label="Ordenar por" value={ordem} onChange={(e) => setOrdem(e.target.value)}>
              <option value="marcadores">Mais marcadores</option>
              <option value="recente">Aparição mais recente</option>
              <option value="cidade">Cidade (A–Z)</option>
            </Select>
          </div>

          {lista.length === 0 ? (
            <EmptyState title="Nenhuma cidade com esses filtros" />
          ) : (
            <ResponsiveTable stack>
              <thead>
                <tr>
                  <th>Cidade</th>
                  <th>Progresso</th>
                  <th>Última aparição</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {lista.slice(0, limite).map((l) => (
                  <tr key={l.id || `${l.cidade}-${l.uf}`}>
                    <td data-label="Cidade">
                      <strong>{l.cidade}</strong> <span className="er-trafego__uf">{l.uf}</span>
                    </td>
                    <td data-label="Progresso">
                      <Medidor valor={l.marcadores} />
                    </td>
                    <td data-label="Última aparição">{formatDateBR(l.ultima_aparicao_em) || '—'}</td>
                    <td data-label="Situação">
                      <Badge tone={TOM[l.estado]}>{ROTULO[l.estado]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveTable>
          )}

          {lista.length > limite ? (
            <Button variant="secondary" onClick={() => setLimite((n) => n + POR_PAGINA)}>
              Mostrar mais ({limite} de {lista.length})
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
