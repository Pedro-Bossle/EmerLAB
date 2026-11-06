import { describe, expect, it } from 'vitest'
import { visaoAgenda } from './OutlookAgendaCard.jsx'

const dia = (key, eventos, isHoje = false) => ({ key, eventos, isHoje })
const SEMANA = (hojeEventos, quarta = [{ id: 'q' }]) => [
  dia('seg', [], false),
  dia('ter', hojeEventos, true),
  dia('qua', quarta, false),
  dia('qui', [], false),
]

describe('visaoAgenda', () => {
  it('com compromissos hoje abre em «Hoje» e permite alternar para a semana', () => {
    expect(visaoAgenda(SEMANA([{ id: 'h' }]), 'hoje', null).modoEfetivo).toBe('hoje')
    expect(visaoAgenda(SEMANA([{ id: 'h' }]), 'semana', null).modoEfetivo).toBe('semana')
  })

  it('com hoje vazio só existe a semana, mesmo que «Hoje» esteja escolhido', () => {
    const v = visaoAgenda(SEMANA([]), 'hoje', null)
    expect(v.hojeVazio).toBe(true)
    expect(v.modoEfetivo).toBe('semana')
  })

  it('na semana, só abre o dia clicado se ele tiver compromisso', () => {
    expect(visaoAgenda(SEMANA([]), 'semana', 'qua').diaAberto?.key).toBe('qua')
    expect(visaoAgenda(SEMANA([]), 'semana', 'qui').diaAberto).toBeNull()
    expect(visaoAgenda(SEMANA([{ id: 'h' }]), 'hoje', 'qua').diaAberto).toBeNull()
  })
})
