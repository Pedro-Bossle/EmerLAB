import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import {
    gruposDoCatalogo,
    nomeGrupoBeneficioVisivel,
} from '../../../lib/credenciamento/prestadorBeneficios.js'
import { partesTextoValoresParaBusca } from '../../../lib/supertabelaBuscaValores.js'

const normCod = (c) => String(c || '').trim().toUpperCase()

const rascunhoVazio = (ordem = 1) => ({
    codigo: '',
    nome: '',
    ordem: String(ordem),
})

async function carregarCatalogoCompleto() {
    const { data, error } = await supabase
        .from('beneficios_catalogo')
        .select('id, codigo, nome, grupo_codigo, grupo_nome, ordem, ativo')
        .order('grupo_codigo', { ascending: true })
        .order('ordem', { ascending: true })
    if (error) throw new Error(error.message)
    return data || []
}

/**
 * CRUD do catálogo beneficios_catalogo na Supertabela — Procedimentos (modo Descontos).
 */
export default function SupertabelaBeneficiosCatalogo({
    somenteLeitura,
    edicaoAtiva,
    adicionarNovoAtivo,
    termoBusca,
    onErro,
}) {
    const [linhas, setLinhas] = useState([])
    const [loading, setLoading] = useState(false)
    /** @type {Record<string, { codigo: string, nome: string, ordem: string }>} */
    const [rascunhosGrupo, setRascunhosGrupo] = useState({})
    const [novoGrupo, setNovoGrupo] = useState({
        grupoCodigo: '',
        grupoNome: '',
        codigo: '',
        nome: '',
        ordem: '1',
    })

    const podeIncluir = !somenteLeitura && (edicaoAtiva || adicionarNovoAtivo)

    const carregar = useCallback(async () => {
        setLoading(true)
        try {
            const data = await carregarCatalogoCompleto()
            setLinhas(data)
            setRascunhosGrupo((prev) => {
                const next = { ...prev }
                const porGrupo = new Map()
                for (const row of data) {
                    const g = row.grupo_codigo || ''
                    const ord = Number(row.ordem) || 0
                    if (!porGrupo.has(g) || ord > porGrupo.get(g)) porGrupo.set(g, ord)
                }
                for (const [g, maxOrd] of porGrupo) {
                    if (!next[g] || (!next[g].codigo && !next[g].nome)) {
                        next[g] = rascunhoVazio(maxOrd + 1)
                    }
                }
                return next
            })
        } catch (e) {
            onErro?.(e?.message || String(e))
            setLinhas([])
        } finally {
            setLoading(false)
        }
    }, [onErro])

    useEffect(() => {
        void carregar()
    }, [carregar])

    const grupos = useMemo(() => gruposDoCatalogo(linhas.filter((l) => l.ativo !== false)), [linhas])

    const filtradas = useMemo(() => {
        const q = String(termoBusca || '')
            .normalize('NFD')
            .replace(/\p{M}/gu, '')
            .toLowerCase()
            .trim()
        if (!q) return linhas
        const tokens = q.split(/\s+/).filter(Boolean)
        return linhas.filter((l) => {
            const blob = [l.codigo, l.nome, l.grupo_codigo, l.grupo_nome, ...partesTextoValoresParaBusca(l.ordem)]
                .map((x) =>
                    String(x || '')
                        .normalize('NFD')
                        .replace(/\p{M}/gu, '')
                        .toLowerCase(),
                )
                .join(' ')
            return tokens.every((t) => blob.includes(t))
        })
    }, [linhas, termoBusca])

    const secoes = useMemo(() => {
        const mapa = new Map()
        for (const item of filtradas) {
            const chave = item.grupo_codigo || '—'
            if (!mapa.has(chave)) {
                mapa.set(chave, {
                    codigo: chave,
                    nome: nomeGrupoBeneficioVisivel(item.grupo_nome) || item.grupo_nome || chave,
                    grupoNomeRaw: item.grupo_nome || chave,
                    itens: [],
                })
            }
            mapa.get(chave).itens.push(item)
        }
        return [...mapa.values()]
    }, [filtradas])

    const atualizarCampoLocal = (id, patch) => {
        setLinhas((prev) => prev.map((row) => (Number(row.id) === Number(id) ? { ...row, ...patch } : row)))
    }

    const salvarLinha = async (row) => {
        if (somenteLeitura || !edicaoAtiva) return
        const codigo = normCod(row.codigo)
        const nome = String(row.nome || '').trim()
        const grupo_codigo = normCod(row.grupo_codigo)
        const grupo_nome = String(row.grupo_nome || '').trim() || grupo_codigo
        if (!codigo || !nome || !grupo_codigo) {
            onErro?.('Código, nome e grupo são obrigatórios.')
            return
        }
        const { error } = await supabase
            .from('beneficios_catalogo')
            .update({
                codigo,
                nome,
                grupo_codigo,
                grupo_nome,
                ordem: Number(row.ordem) || 0,
                ativo: row.ativo !== false,
            })
            .eq('id', row.id)
        if (error) {
            onErro?.(error.message)
            await carregar()
            return
        }
        atualizarCampoLocal(row.id, { codigo, nome, grupo_codigo, grupo_nome })
    }

    const alternarAtivo = async (row) => {
        if (somenteLeitura || !edicaoAtiva) return
        const ativo = !(row.ativo !== false)
        const { error } = await supabase.from('beneficios_catalogo').update({ ativo }).eq('id', row.id)
        if (error) {
            onErro?.(error.message)
            return
        }
        atualizarCampoLocal(row.id, { ativo })
    }

    const rascunhoDoGrupo = (grupoCodigo, itens) => {
        const atual = rascunhosGrupo[grupoCodigo]
        if (atual) return atual
        const maxOrd = itens.reduce((m, i) => Math.max(m, Number(i.ordem) || 0), 0)
        return rascunhoVazio(maxOrd + 1)
    }

    const setRascunhoCampo = (grupoCodigo, patch, itens) => {
        setRascunhosGrupo((prev) => ({
            ...prev,
            [grupoCodigo]: { ...rascunhoDoGrupo(grupoCodigo, itens), ...patch },
        }))
    }

    const inserirNoGrupo = async (secao) => {
        if (!podeIncluir) return
        const rascunho = rascunhoDoGrupo(secao.codigo, secao.itens)
        const codigo = normCod(rascunho.codigo)
        const nome = String(rascunho.nome || '').trim()
        const ordem = Number(rascunho.ordem) || secao.itens.length + 1
        if (!codigo || !nome) {
            onErro?.('Informe código e tipo na última linha do grupo.')
            return
        }
        const { error } = await supabase.from('beneficios_catalogo').insert({
            codigo,
            nome,
            grupo_codigo: secao.codigo,
            grupo_nome: secao.grupoNomeRaw || secao.nome,
            ordem,
            ativo: true,
        })
        if (error) {
            onErro?.(error.message)
            return
        }
        setRascunhosGrupo((prev) => ({
            ...prev,
            [secao.codigo]: rascunhoVazio(ordem + 1),
        }))
        await carregar()
    }

    const criarNovoGrupo = async () => {
        if (somenteLeitura || !adicionarNovoAtivo) return
        const grupo_codigo = normCod(novoGrupo.grupoCodigo)
        const grupo_nome = String(novoGrupo.grupoNome || '').trim() || grupo_codigo
        const codigo = normCod(novoGrupo.codigo)
        const nome = String(novoGrupo.nome || '').trim()
        const ordem = Number(novoGrupo.ordem) || 1
        if (!grupo_codigo) {
            onErro?.('Informe o código do novo grupo (ex.: PS).')
            return
        }
        if (grupos.some((g) => g.codigo === grupo_codigo)) {
            onErro?.('Já existe um grupo com este código.')
            return
        }
        if (!codigo || !nome) {
            onErro?.('Inclua o primeiro tipo (código e nome) do novo grupo.')
            return
        }
        const { error } = await supabase.from('beneficios_catalogo').insert({
            codigo,
            nome,
            grupo_codigo,
            grupo_nome,
            ordem,
            ativo: true,
        })
        if (error) {
            onErro?.(error.message)
            return
        }
        setNovoGrupo({ grupoCodigo: '', grupoNome: '', codigo: '', nome: '', ordem: '1' })
        await carregar()
    }

    if (loading && !linhas.length) return <p>Carregando descontos…</p>

    return (
        <div className="supertabela_beneficios">
            {adicionarNovoAtivo && !somenteLeitura ? (
                <div className="supertabelaprocedimentos_massa_wrap">
                    <p>Novo grupo de descontos</p>
                    <div className="supertabelaprocedimentos_massa_form">
                        <div className="supertabelaprocedimentos_novo_grid supertabela_beneficios_novo_grid">
                            <input
                                type="text"
                                className="supertabelaprocedimentos_input"
                                placeholder="Código do grupo (ex.: PS)"
                                value={novoGrupo.grupoCodigo}
                                onChange={(e) =>
                                    setNovoGrupo((p) => ({
                                        ...p,
                                        grupoCodigo: normCod(e.target.value),
                                    }))
                                }
                            />
                            <input
                                type="text"
                                className="supertabelaprocedimentos_input"
                                placeholder="Nome do grupo"
                                value={novoGrupo.grupoNome}
                                onChange={(e) => setNovoGrupo((p) => ({ ...p, grupoNome: e.target.value }))}
                            />
                            <input
                                type="text"
                                className="supertabelaprocedimentos_input"
                                placeholder="1º código (ex.: PS-01)"
                                value={novoGrupo.codigo}
                                onChange={(e) =>
                                    setNovoGrupo((p) => ({ ...p, codigo: normCod(e.target.value) }))
                                }
                            />
                            <input
                                type="text"
                                className="supertabelaprocedimentos_input"
                                placeholder="1º tipo"
                                value={novoGrupo.nome}
                                onChange={(e) => setNovoGrupo((p) => ({ ...p, nome: e.target.value }))}
                            />
                            <input
                                type="number"
                                className="supertabelaprocedimentos_input"
                                placeholder="Ordem"
                                min={0}
                                value={novoGrupo.ordem}
                                onChange={(e) => setNovoGrupo((p) => ({ ...p, ordem: e.target.value }))}
                            />
                        </div>
                        <button
                            type="button"
                            className="supertabelaprocedimentos_massa_btn"
                            onClick={() => void criarNovoGrupo()}
                            disabled={loading}
                        >
                            Criar grupo
                        </button>
                    </div>
                </div>
            ) : null}

            {secoes.length === 0 && !adicionarNovoAtivo ? (
                <p>Nenhum desconto no catálogo com os filtros atuais.</p>
            ) : null}

            <div className="supertabela_beneficios_grupos">
                {secoes.map((secao) => {
                    const rascunho = rascunhoDoGrupo(secao.codigo, secao.itens)
                    return (
                        <section key={secao.codigo} className="categoria_secao supertabela_beneficios_secao">
                            <h2 className="categoria_titulo">{secao.nome}</h2>
                            <table
                                className={`table_main supertabela_beneficios_table ${
                                    edicaoAtiva ? 'is-editing' : ''
                                }`}
                            >
                                <colgroup>
                                    <col style={{ width: '14%' }} />
                                    <col style={{ width: '36%' }} />
                                    <col style={{ width: '26%' }} />
                                    <col style={{ width: '10%' }} />
                                    <col style={{ width: '14%' }} />
                                </colgroup>
                                <thead>
                                    <tr>
                                        <th className="table_header">Código</th>
                                        <th className="table_header">Tipo</th>
                                        <th className="table_header">Grupo</th>
                                        <th className="table_header">Ordem</th>
                                        <th className="table_header">Ativo</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {secao.itens.map((row) => (
                                        <tr
                                            key={row.id}
                                            className={row.ativo === false ? 'is-inativo' : undefined}
                                        >
                                            <td className="table_text_left">
                                                {edicaoAtiva && !somenteLeitura ? (
                                                    <input
                                                        type="text"
                                                        className="supertabelaprocedimentos_cell_input"
                                                        value={row.codigo || ''}
                                                        onChange={(e) =>
                                                            atualizarCampoLocal(row.id, {
                                                                codigo: normCod(e.target.value),
                                                            })
                                                        }
                                                        onBlur={(e) =>
                                                            void salvarLinha({
                                                                ...row,
                                                                codigo: normCod(e.target.value),
                                                            })
                                                        }
                                                    />
                                                ) : (
                                                    row.codigo
                                                )}
                                            </td>
                                            <td className="table_text_left">
                                                {edicaoAtiva && !somenteLeitura ? (
                                                    <input
                                                        type="text"
                                                        className="supertabelaprocedimentos_cell_input"
                                                        value={row.nome || ''}
                                                        onChange={(e) =>
                                                            atualizarCampoLocal(row.id, {
                                                                nome: e.target.value,
                                                            })
                                                        }
                                                        onBlur={(e) =>
                                                            void salvarLinha({
                                                                ...row,
                                                                nome: e.target.value,
                                                            })
                                                        }
                                                    />
                                                ) : (
                                                    row.nome
                                                )}
                                            </td>
                                            <td className="table_text_left">
                                                {edicaoAtiva && !somenteLeitura ? (
                                                    <input
                                                        type="text"
                                                        className="supertabelaprocedimentos_cell_input"
                                                        value={
                                                            nomeGrupoBeneficioVisivel(row.grupo_nome) ||
                                                            row.grupo_nome ||
                                                            ''
                                                        }
                                                        onChange={(e) =>
                                                            atualizarCampoLocal(row.id, {
                                                                grupo_nome: e.target.value,
                                                            })
                                                        }
                                                        onBlur={(e) =>
                                                            void salvarLinha({
                                                                ...row,
                                                                grupo_nome: e.target.value,
                                                            })
                                                        }
                                                        title={`Código do grupo: ${row.grupo_codigo}`}
                                                    />
                                                ) : (
                                                    nomeGrupoBeneficioVisivel(row.grupo_nome) ||
                                                    row.grupo_nome
                                                )}
                                            </td>
                                            <td>
                                                {edicaoAtiva && !somenteLeitura ? (
                                                    <input
                                                        type="number"
                                                        className="supertabelaprocedimentos_cell_input supertabela_beneficios_input_ordem"
                                                        value={row.ordem ?? 0}
                                                        onChange={(e) =>
                                                            atualizarCampoLocal(row.id, {
                                                                ordem: Number(e.target.value) || 0,
                                                            })
                                                        }
                                                        onBlur={(e) =>
                                                            void salvarLinha({
                                                                ...row,
                                                                ordem: Number(e.target.value) || 0,
                                                            })
                                                        }
                                                    />
                                                ) : (
                                                    row.ordem
                                                )}
                                            </td>
                                            <td>
                                                {edicaoAtiva && !somenteLeitura ? (
                                                    <button
                                                        type="button"
                                                        role="switch"
                                                        aria-checked={row.ativo !== false}
                                                        className={`supertabelaprocedimentos_form_switch ${
                                                            row.ativo !== false ? 'is-on' : 'is-off'
                                                        }`}
                                                        onClick={() => void alternarAtivo(row)}
                                                    >
                                                        <span className="supertabelaprocedimentos_form_switch_track">
                                                            <span className="supertabelaprocedimentos_form_switch_knob" />
                                                        </span>
                                                        <span className="supertabelaprocedimentos_form_switch_label">
                                                            {row.ativo !== false ? 'Sim' : 'Não'}
                                                        </span>
                                                    </button>
                                                ) : row.ativo !== false ? (
                                                    'Sim'
                                                ) : (
                                                    'Não'
                                                )}
                                            </td>
                                        </tr>
                                    ))}

                                    {podeIncluir ? (
                                        <tr className="supertabela_beneficios_row_nova">
                                            <td className="table_text_left">
                                                <input
                                                    type="text"
                                                    className="supertabelaprocedimentos_cell_input"
                                                    placeholder="Novo código"
                                                    value={rascunho.codigo}
                                                    onChange={(e) =>
                                                        setRascunhoCampo(
                                                            secao.codigo,
                                                            { codigo: normCod(e.target.value) },
                                                            secao.itens,
                                                        )
                                                    }
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault()
                                                            void inserirNoGrupo(secao)
                                                        }
                                                    }}
                                                />
                                            </td>
                                            <td className="table_text_left">
                                                <input
                                                    type="text"
                                                    className="supertabelaprocedimentos_cell_input"
                                                    placeholder="Novo tipo"
                                                    value={rascunho.nome}
                                                    onChange={(e) =>
                                                        setRascunhoCampo(
                                                            secao.codigo,
                                                            { nome: e.target.value },
                                                            secao.itens,
                                                        )
                                                    }
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault()
                                                            void inserirNoGrupo(secao)
                                                        }
                                                    }}
                                                />
                                            </td>
                                            <td className="table_text_left supertabela_beneficios_grupo_fix">
                                                {secao.nome}
                                            </td>
                                            <td>
                                                <input
                                                    type="number"
                                                    className="supertabelaprocedimentos_cell_input supertabela_beneficios_input_ordem"
                                                    value={rascunho.ordem}
                                                    onChange={(e) =>
                                                        setRascunhoCampo(
                                                            secao.codigo,
                                                            { ordem: e.target.value },
                                                            secao.itens,
                                                        )
                                                    }
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault()
                                                            void inserirNoGrupo(secao)
                                                        }
                                                    }}
                                                />
                                            </td>
                                            <td>
                                                <button
                                                    type="button"
                                                    className="supertabelaprocedimentos_massa_btn secondary supertabela_beneficios_add_btn"
                                                    title="Incluir neste grupo"
                                                    disabled={
                                                        loading || !rascunho.codigo.trim() || !rascunho.nome.trim()
                                                    }
                                                    onClick={() => void inserirNoGrupo(secao)}
                                                >
                                                    +
                                                </button>
                                            </td>
                                        </tr>
                                    ) : null}
                                </tbody>
                            </table>
                        </section>
                    )
                })}
            </div>
        </div>
    )
}
