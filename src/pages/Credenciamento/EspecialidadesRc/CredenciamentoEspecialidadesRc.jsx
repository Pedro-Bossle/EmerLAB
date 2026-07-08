import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    PERMISSION_KEYS,
    hasStoredPermission,
} from '../../../lib/accessControl'
import { getReadOnlyFlag, supabase } from '../../../lib/supabase'
import {
    calcularOrdemRcPadrao,
    isMissingOrdemRcColumnError,
    ordemGrupoEspecialidadeLegado,
} from '../../../lib/rc/ordenarCardsRc.js'
import CampoBuscaComLimpar from '../../../components/CampoBuscaComLimpar/CampoBuscaComLimpar.jsx'
import '../Credenciamento_main/Credenciamento_main.css'
import './CredenciamentoEspecialidadesRc.css'

function reorderList(lista, fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex == null || toIndex == null) return lista
    const copia = [...lista]
    const [item] = copia.splice(fromIndex, 1)
    copia.splice(toIndex, 0, item)
    return copia
}

const TIPOS_SUGERIDOS = ['LOCAL', 'ESPECIALIDADE', 'COMERCIO', 'LABORATORIO']

const CredenciamentoEspecialidadesRc = () => {
    const somenteLeitura = getReadOnlyFlag() || !hasStoredPermission(PERMISSION_KEYS.CREDENCIAMENTO_EDIT)
    const [lista, setLista] = useState([])
    const [loading, setLoading] = useState(true)
    const [salvando, setSalvando] = useState(false)
    const [erro, setErro] = useState('')
    const [sucesso, setSucesso] = useState('')
    const [busca, setBusca] = useState('')
    const [dragIdx, setDragIdx] = useState(null)
    const [ordemDirty, setOrdemDirty] = useState(false)
    const [novoAtivo, setNovoAtivo] = useState(false)
    const [novoNome, setNovoNome] = useState('')
    const [novoTipo, setNovoTipo] = useState('ESPECIALIDADE')

    const carregar = useCallback(async () => {
        setLoading(true)
        setErro('')
        const { data, error } = await supabase
            .from('especialidades')
            .select('id, nome, tipo, ordem_rc')
            .order('ordem_rc', { ascending: true, nullsFirst: false })
            .order('nome', { ascending: true })
        if (error) {
            if (isMissingOrdemRcColumnError(error)) {
                setErro(
                    'A coluna ordem_rc ainda não existe em especialidades. Execute o script scripts/sql/especialidades_ordem_rc.sql no Supabase.'
                )
            } else {
                setErro(error.message || 'Erro ao carregar especialidades.')
            }
            setLista([])
            setLoading(false)
            return
        }
        const ordenadas = [...(data || [])].sort((a, b) => {
            const oa = a.ordem_rc != null ? Number(a.ordem_rc) : Number.POSITIVE_INFINITY
            const ob = b.ordem_rc != null ? Number(b.ordem_rc) : Number.POSITIVE_INFINITY
            if (oa !== ob) return oa - ob
            return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { sensitivity: 'base' })
        })
        setLista(ordenadas)
        setOrdemDirty(false)
        setLoading(false)
    }, [])

    useEffect(() => {
        carregar()
    }, [carregar])

    const listaFiltrada = useMemo(() => {
        const termo = String(busca || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase()
        if (!termo) return lista
        return lista.filter((item) => {
            const blob = `${item.nome || ''} ${item.tipo || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
            return blob.includes(termo)
        })
    }, [lista, busca])

    const aplicarOrdemNaLista = (novaOrdem) => {
        setLista(novaOrdem)
        setOrdemDirty(true)
        setSucesso('')
    }

    const onDrop = (toIndex) => {
        if (somenteLeitura || dragIdx == null) return
        const fromGlobal = lista.findIndex((x) => x.id === listaFiltrada[dragIdx]?.id)
        const toGlobal = lista.findIndex((x) => x.id === listaFiltrada[toIndex]?.id)
        if (fromGlobal < 0 || toGlobal < 0) return
        aplicarOrdemNaLista(reorderList(lista, fromGlobal, toGlobal))
        setDragIdx(null)
    }

    const mover = (id, delta) => {
        if (somenteLeitura) return
        const idx = lista.findIndex((x) => Number(x.id) === Number(id))
        const novo = idx + delta
        if (idx < 0 || novo < 0 || novo >= lista.length) return
        aplicarOrdemNaLista(reorderList(lista, idx, novo))
    }

    const salvarOrdem = async () => {
        if (somenteLeitura) return
        setSalvando(true)
        setErro('')
        setSucesso('')
        try {
            const updates = lista.map((item, index) =>
                supabase.from('especialidades').update({ ordem_rc: (index + 1) * 10 }).eq('id', item.id)
            )
            const results = await Promise.all(updates)
            const falha = results.find((r) => r.error)
            if (falha?.error) throw falha.error
            setOrdemDirty(false)
            setSucesso('Ordem da RC salva com sucesso.')
            await carregar()
        } catch (e) {
            setErro(e?.message || 'Falha ao salvar ordem.')
        } finally {
            setSalvando(false)
        }
    }

    const aplicarOrdemPadraoGrupos = async () => {
        if (somenteLeitura) return
        const padrao = calcularOrdemRcPadrao(lista)
        const mapa = new Map(padrao.map((p) => [p.id, p.ordem_rc]))
        const reordenada = [...lista].sort((a, b) => (mapa.get(a.id) || 0) - (mapa.get(b.id) || 0))
        setLista(reordenada)
        setOrdemDirty(true)
        setSucesso('Ordem padrão (grupos RC) aplicada na lista. Clique em «Salvar ordem» para gravar.')
    }

    const atualizarCampo = async (id, patch) => {
        if (somenteLeitura) return
        setErro('')
        const { error } = await supabase.from('especialidades').update(patch).eq('id', id)
        if (error) {
            setErro(error.message || 'Falha ao atualizar especialidade.')
            return
        }
        setLista((prev) => prev.map((item) => (Number(item.id) === Number(id) ? { ...item, ...patch } : item)))
    }

    const inserirNovaEspecialidade = async () => {
        if (somenteLeitura) return
        const nome = String(novoNome || '').trim()
        if (!nome) {
            setErro('Informe o nome da nova especialidade.')
            return
        }
        const tipo = String(novoTipo || '').trim() || 'ESPECIALIDADE'
        setSalvando(true)
        setErro('')
        setSucesso('')
        try {
            const { data: ultima, error: errUltima } = await supabase
                .from('especialidades')
                .select('id')
                .order('id', { ascending: false })
                .limit(1)
                .maybeSingle()
            if (errUltima) throw errUltima

            const proximoId = (ultima?.id ? Number(ultima.id) : 0) + 1
            const maiorOrdem = lista.reduce((max, item) => {
                const o = item.ordem_rc != null ? Number(item.ordem_rc) : 0
                return Math.max(max, o)
            }, 0)
            const ordem_rc = maiorOrdem > 0 ? maiorOrdem + 10 : (lista.length + 1) * 10

            const payload = { id: proximoId, nome, tipo, ordem_rc }
            const { error: errInsert } = await supabase.from('especialidades').insert(payload)
            if (errInsert) {
                const { error: errSemOrdem } = await supabase
                    .from('especialidades')
                    .insert({ id: proximoId, nome, tipo })
                if (errSemOrdem) throw errSemOrdem
            }

            setNovoNome('')
            setNovoTipo('ESPECIALIDADE')
            setNovoAtivo(false)
            setSucesso('Especialidade criada com sucesso.')
            await carregar()
        } catch (e) {
            setErro(e?.message || 'Falha ao criar especialidade.')
        } finally {
            setSalvando(false)
        }
    }

    return (
        <div className="credenciamento_main especialidades_rc">
            <h1>Credenciamento — Especialidades (RC)</h1>
            <hr />
            <p className="especialidades_rc_intro">
                Defina o nome, o tipo e a ordem em que cada especialidade aparece no PDF da Rede Credenciada.
                Arraste as linhas ou use as setas. A ordem vale para todos os prestadores com essa especialidade principal.
            </p>

            {erro ? (
                <p className="credenciamento_main_alert especialidades_rc_erro" role="alert">
                    {erro}
                </p>
            ) : null}
            {sucesso ? <p className="especialidades_rc_sucesso">{sucesso}</p> : null}

            <header className="especialidades_rc_toolbar">
                <CampoBuscaComLimpar
                    className="credenciamento_main_input especialidades_rc_busca"
                    placeholder="Buscar especialidade ou tipo"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                />
                <div className="especialidades_rc_toolbar_acoes">
                    {!somenteLeitura ? (
                        <button
                            type="button"
                            className="credenciamento_main_action_btn especialidades_rc_btn_novo"
                            disabled={loading || salvando}
                            onClick={() => {
                                setNovoAtivo((ativo) => !ativo)
                                setErro('')
                            }}
                        >
                            {novoAtivo ? 'Cancelar' : '＋ Novo'}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="credenciamento_main_action_btn secondary"
                        disabled={somenteLeitura || loading}
                        onClick={aplicarOrdemPadraoGrupos}
                    >
                        Ordem padrão (grupos)
                    </button>
                    <button
                        type="button"
                        className="credenciamento_main_action_btn"
                        disabled={somenteLeitura || salvando || !ordemDirty}
                        onClick={salvarOrdem}
                    >
                        {salvando ? 'Salvando…' : 'Salvar ordem'}
                    </button>
                </div>
            </header>

            {novoAtivo && !somenteLeitura ? (
                <section className="especialidades_rc_novo_painel">
                    <p className="especialidades_rc_novo_titulo">Nova especialidade</p>
                    <div className="especialidades_rc_novo_grid">
                        <label className="especialidades_rc_novo_campo">
                            <span>Nome</span>
                            <input
                                type="text"
                                className="credenciamento_main_input"
                                placeholder="Nome da especialidade"
                                value={novoNome}
                                onChange={(e) => setNovoNome(e.target.value)}
                            />
                        </label>
                        <label className="especialidades_rc_novo_campo">
                            <span>Tipo</span>
                            <input
                                type="text"
                                className="credenciamento_main_input"
                                list="especialidades_rc_tipos_novo"
                                placeholder="Tipo"
                                value={novoTipo}
                                onChange={(e) => setNovoTipo(e.target.value)}
                            />
                            <datalist id="especialidades_rc_tipos_novo">
                                {TIPOS_SUGERIDOS.map((t) => (
                                    <option key={t} value={t} />
                                ))}
                            </datalist>
                        </label>
                        <button
                            type="button"
                            className="credenciamento_main_action_btn"
                            disabled={salvando}
                            onClick={inserirNovaEspecialidade}
                        >
                            {salvando ? 'Salvando…' : 'Criar especialidade'}
                        </button>
                    </div>
                </section>
            ) : null}

            {loading ? (
                <p className="especialidades_rc_muted">A carregar…</p>
            ) : (
                <div className="especialidades_rc_table_wrap">
                    <table className="table_main especialidades_rc_table">
                        <thead>
                            <tr>
                                <th className="especialidades_rc_col_ordem">#</th>
                                <th className="especialidades_rc_col_drag" aria-label="Arrastar" />
                                <th>Nome</th>
                                <th>Tipo</th>
                                <th className="especialidades_rc_col_grupo">Grupo RC</th>
                                <th className="especialidades_rc_col_acoes">Ordem</th>
                            </tr>
                        </thead>
                        <tbody>
                            {listaFiltrada.map((item, idx) => {
                                const ordemLista = lista.findIndex((x) => x.id === item.id) + 1
                                const grupo = ordemGrupoEspecialidadeLegado(item.nome)
                                return (
                                    <tr
                                        key={item.id}
                                        className={`especialidades_rc_row ${dragIdx === idx ? 'is-dragging' : ''}`}
                                        draggable={!somenteLeitura && !busca}
                                        onDragStart={() => !busca && setDragIdx(idx)}
                                        onDragOver={(e) => e.preventDefault()}
                                        onDrop={() => onDrop(idx)}
                                    >
                                        <td className="especialidades_rc_col_ordem">{ordemLista}</td>
                                        <td className="especialidades_rc_col_drag" title="Arrastar">
                                            <span className="especialidades_rc_grip" aria-hidden>
                                                ⋮⋮
                                            </span>
                                        </td>
                                        <td>
                                            <input
                                                className="credenciamento_main_input especialidades_rc_input"
                                                value={item.nome || ''}
                                                disabled={somenteLeitura}
                                                onChange={(e) =>
                                                    setLista((prev) =>
                                                        prev.map((row) =>
                                                            row.id === item.id ? { ...row, nome: e.target.value } : row
                                                        )
                                                    )
                                                }
                                                onBlur={() => {
                                                    const atual = lista.find((r) => r.id === item.id)
                                                    if (atual && String(atual.nome || '').trim()) {
                                                        atualizarCampo(item.id, { nome: String(atual.nome).trim() })
                                                    }
                                                }}
                                            />
                                        </td>
                                        <td>
                                            <input
                                                className="credenciamento_main_input especialidades_rc_input"
                                                list={`especialidades_rc_tipos_${item.id}`}
                                                value={item.tipo || ''}
                                                disabled={somenteLeitura}
                                                placeholder="Tipo"
                                                onChange={(e) =>
                                                    setLista((prev) =>
                                                        prev.map((row) =>
                                                            row.id === item.id ? { ...row, tipo: e.target.value } : row
                                                        )
                                                    )
                                                }
                                                onBlur={() => {
                                                    const atual = lista.find((r) => r.id === item.id)
                                                    atualizarCampo(item.id, { tipo: String(atual?.tipo || '').trim() })
                                                }}
                                            />
                                            <datalist id={`especialidades_rc_tipos_${item.id}`}>
                                                {TIPOS_SUGERIDOS.map((t) => (
                                                    <option key={t} value={t} />
                                                ))}
                                            </datalist>
                                        </td>
                                        <td className="especialidades_rc_col_grupo">{grupo}</td>
                                        <td className="especialidades_rc_col_acoes">
                                            <button
                                                type="button"
                                                className="credenciamento_main_action_btn secondary especialidades_rc_btn_mini"
                                                disabled={somenteLeitura || ordemLista <= 1}
                                                onClick={() => mover(item.id, -1)}
                                                title="Subir"
                                            >
                                                ↑
                                            </button>
                                            <button
                                                type="button"
                                                className="credenciamento_main_action_btn secondary especialidades_rc_btn_mini"
                                                disabled={somenteLeitura || ordemLista >= lista.length}
                                                onClick={() => mover(item.id, 1)}
                                                title="Descer"
                                            >
                                                ↓
                                            </button>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                    {!listaFiltrada.length && !loading ? (
                        <p className="especialidades_rc_muted">Nenhuma especialidade encontrada.</p>
                    ) : null}
                </div>
            )}

            {somenteLeitura ? (
                <p className="especialidades_rc_muted">Modo somente leitura — é necessária permissão de editar credenciamento.</p>
            ) : null}
        </div>
    )
}

export default CredenciamentoEspecialidadesRc
