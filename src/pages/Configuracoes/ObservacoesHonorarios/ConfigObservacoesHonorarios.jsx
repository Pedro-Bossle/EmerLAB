import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    PERMISSION_KEYS,
    getStoredAccessProfile,
    hasPermission,
    usuarioPodeEditarFerramenta,
} from '../../../lib/accessControl'
import { getReadOnlyFlag } from '../../../lib/supabase'
import {
    excluirHonorariosObservacao,
    listarHonorariosObservacoes,
    listarProcedimentosParaObservacoes,
    normalizarCodigoProcedimento,
    salvarHonorariosObservacao,
} from '../../../lib/impressaoHonorarios/honorariosObservacoes.js'
import CampoBuscaComLimpar from '../../../components/CampoBuscaComLimpar/CampoBuscaComLimpar.jsx'
import CredenciamentoMainAlert from '../../../components/Toast/CredenciamentoMainAlert.jsx'
import { PageHeader } from '../../../components/ui'
import '../../Credenciamento/Credenciamento_main/Credenciamento_main.css'
import './ConfigObservacoesHonorarios.css'

const FORM_VAZIO = {
    id: null,
    titulo: '',
    mensagem: '',
    ativa: true,
    ordem: 0,
    codigosSelecionados: [],
}

const CHIPS_LIMITE = 15
const CHIPS_LIMITE_MOBILE = 5

function usarLimiteChipsMobile() {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(max-width: 720px)').matches
}

function useLimiteChips() {
    const [limite, setLimite] = useState(() =>
        usarLimiteChipsMobile() ? CHIPS_LIMITE_MOBILE : CHIPS_LIMITE,
    )
    useEffect(() => {
        if (typeof window === 'undefined') return undefined
        const mq = window.matchMedia('(max-width: 720px)')
        const sync = () => setLimite(mq.matches ? CHIPS_LIMITE_MOBILE : CHIPS_LIMITE)
        sync()
        if (mq.addEventListener) mq.addEventListener('change', sync)
        else mq.addListener(sync)
        return () => {
            if (mq.removeEventListener) mq.removeEventListener('change', sync)
            else mq.removeListener(sync)
        }
    }, [])
    return limite
}

function ChipsProcedimentos({
    codigos,
    rotuloProc,
    limite: limiteProp,
    removivel = false,
    disabled = false,
    onRemove,
}) {
    const limitePadrao = useLimiteChips()
    const limite = limiteProp ?? limitePadrao
    const [expandido, setExpandido] = useState(false)
    const lista = codigos || []
    const ocultos = lista.length > limite
    const visiveis = expandido || !ocultos ? lista : lista.slice(0, limite)

    if (!lista.length) return null

    return (
        <div className="config_obs_honorarios_chips_wrap">
            <div className="config_obs_honorarios_chips">
                {visiveis.map((codigo) =>
                    removivel ? (
                        <button
                            key={codigo}
                            type="button"
                            className="config_obs_honorarios_chip"
                            disabled={disabled}
                            onClick={() => onRemove?.(codigo)}
                            title="Remover vínculo"
                        >
                            {rotuloProc(codigo)} ×
                        </button>
                    ) : (
                        <span key={codigo} className="config_obs_honorarios_chip is-static">
                            {rotuloProc(codigo)}
                        </span>
                    ),
                )}
            </div>
            {ocultos ? (
                <button
                    type="button"
                    className="config_obs_honorarios_chips_toggle"
                    onClick={() => setExpandido((v) => !v)}
                >
                    {expandido
                        ? 'Ocultar procedimentos'
                        : `Mostrar mais ${lista.length - limite} procedimento(s)`}
                </button>
            ) : null}
        </div>
    )
}

function normalizarBusca(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
}

const ConfigObservacoesHonorarios = () => {
    const profile = getStoredAccessProfile()
    const somenteLeitura = useMemo(() => {
        if (getReadOnlyFlag()) return true
        if (!profile) return true
        if (usuarioPodeEditarFerramenta(profile.permissions, 'configuracoes.observacoes_honorarios')) {
            return false
        }
        return !hasPermission(profile, PERMISSION_KEYS.CREDENCIAMENTO_EDIT)
    }, [profile])

    const formRef = useRef(null)
    const [loading, setLoading] = useState(true)
    const [salvando, setSalvando] = useState(false)
    const [erro, setErro] = useState('')
    const [feedback, setFeedback] = useState('')
    const [observacoes, setObservacoes] = useState([])
    const [procedimentos, setProcedimentos] = useState([])
    const [formAberto, setFormAberto] = useState(false)
    const [form, setForm] = useState(FORM_VAZIO)
    const [buscaObs, setBuscaObs] = useState('')
    const [buscaProc, setBuscaProc] = useState('')
    const [catsExpandidas, setCatsExpandidas] = useState(() => new Set())
    const limiteChips = useLimiteChips()

    const focarFormulario = useCallback(() => {
        requestAnimationFrame(() => {
            formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
    }, [])

    const mapaProcedimentos = useMemo(() => {
        const map = new Map()
        for (const p of procedimentos) {
            map.set(normalizarCodigoProcedimento(p.codigo), p)
        }
        return map
    }, [procedimentos])

    const categoriasProc = useMemo(() => {
        const termo = normalizarBusca(buscaProc)
        const mapa = new Map()
        for (const p of procedimentos) {
            if (termo && !normalizarBusca(`${p.codigo} ${p.nome} ${p.categoriaNome}`).includes(termo)) {
                continue
            }
            const key = p.categoriaId != null ? String(p.categoriaId) : 'none'
            if (!mapa.has(key)) {
                mapa.set(key, {
                    id: key,
                    nome: p.categoriaNome || 'Sem categoria',
                    procedimentos: [],
                })
            }
            mapa.get(key).procedimentos.push(p)
        }
        return [...mapa.values()].sort((a, b) =>
            String(a.nome).localeCompare(String(b.nome), 'pt-BR', { sensitivity: 'base' }),
        )
    }, [procedimentos, buscaProc])

    const carregar = useCallback(async () => {
        setLoading(true)
        setErro('')
        try {
            const [obsRes, procRes] = await Promise.all([
                listarHonorariosObservacoes(),
                listarProcedimentosParaObservacoes(),
            ])
            if (!obsRes.ok) {
                setErro(obsRes.erro || 'Erro ao carregar observações.')
                setObservacoes([])
            } else {
                setObservacoes(obsRes.itens || [])
            }
            if (!procRes.ok) {
                setErro((prev) => prev || procRes.erro || 'Erro ao carregar procedimentos.')
                setProcedimentos([])
            } else {
                setProcedimentos(procRes.itens || [])
            }
        } catch (e) {
            setErro(e?.message || String(e))
            setObservacoes([])
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void carregar()
    }, [carregar])

    const observacoesFiltradas = useMemo(() => {
        const termo = normalizarBusca(buscaObs)
        if (!termo) return observacoes
        return observacoes.filter((item) => {
            const procs = (item.codigosProcedimentos || [])
                .map((c) => {
                    const p = mapaProcedimentos.get(normalizarCodigoProcedimento(c))
                    return `${c} ${p?.nome || ''}`
                })
                .join(' ')
            const blob = normalizarBusca(`${item.titulo} ${item.mensagem} ${procs}`)
            return blob.includes(termo)
        })
    }, [observacoes, buscaObs, mapaProcedimentos])

    const abrirNova = () => {
        if (somenteLeitura) return
        const proximaOrdem =
            observacoes.reduce((max, o) => Math.max(max, Number(o.ordem) || 0), 0) + 10
        setForm({ ...FORM_VAZIO, ordem: proximaOrdem })
        setBuscaProc('')
        setCatsExpandidas(new Set())
        setFormAberto(true)
        setFeedback('')
        setErro('')
        focarFormulario()
    }

    const abrirEdicao = (item) => {
        if (somenteLeitura) return
        if (!item?.id) {
            setErro('Não foi possível abrir esta observação para edição.')
            return
        }
        setForm({
            id: Number(item.id),
            titulo: String(item.titulo || '').trim(),
            mensagem: String(item.mensagem || '').trim(),
            ativa: item.ativa !== false,
            ordem: Number(item.ordem) || 0,
            codigosSelecionados: [
                ...new Set(
                    (item.codigosProcedimentos || [])
                        .map(normalizarCodigoProcedimento)
                        .filter(Boolean),
                ),
            ].sort((a, b) => a.localeCompare(b, 'pt-BR')),
        })
        setBuscaProc('')
        setCatsExpandidas(new Set())
        setFormAberto(true)
        setFeedback('')
        setErro('')
        focarFormulario()
    }

    const fecharForm = () => {
        setFormAberto(false)
        setForm(FORM_VAZIO)
        setBuscaProc('')
        setCatsExpandidas(new Set())
    }

    const codigoMarcado = (codigo) =>
        form.codigosSelecionados.includes(normalizarCodigoProcedimento(codigo))

    const toggleCodigo = (codigo) => {
        if (somenteLeitura) return
        const c = normalizarCodigoProcedimento(codigo)
        if (!c) return
        setForm((prev) => {
            const set = new Set(
                (prev.codigosSelecionados || []).map(normalizarCodigoProcedimento),
            )
            if (set.has(c)) set.delete(c)
            else set.add(c)
            return {
                ...prev,
                codigosSelecionados: [...set].sort((a, b) => a.localeCompare(b, 'pt-BR')),
            }
        })
    }

    const marcarCategoria = (cat, marcar) => {
        if (somenteLeitura) return
        const codigosCat = (cat.procedimentos || []).map((p) =>
            normalizarCodigoProcedimento(p.codigo),
        )
        setForm((prev) => {
            const set = new Set(
                (prev.codigosSelecionados || []).map(normalizarCodigoProcedimento),
            )
            for (const c of codigosCat) {
                if (!c) continue
                if (marcar) set.add(c)
                else set.delete(c)
            }
            return {
                ...prev,
                codigosSelecionados: [...set].sort((a, b) => a.localeCompare(b, 'pt-BR')),
            }
        })
    }

    const toggleCatExpandida = (catId) => {
        setCatsExpandidas((prev) => {
            const next = new Set(prev)
            if (next.has(catId)) next.delete(catId)
            else next.add(catId)
            return next
        })
    }

    const salvar = async () => {
        if (somenteLeitura) return
        setSalvando(true)
        setErro('')
        setFeedback('')
        try {
            const editando = form.id != null && Number(form.id) > 0
            const res = await salvarHonorariosObservacao({
                id: editando ? Number(form.id) : null,
                titulo: form.titulo,
                mensagem: form.mensagem,
                ativa: form.ativa,
                ordem: form.ordem,
                codigosProcedimentos: form.codigosSelecionados,
            })
            if (!res.ok) {
                setErro(res.erro || 'Falha ao salvar.')
                focarFormulario()
                return
            }
            setFeedback(editando ? 'Observação atualizada.' : 'Observação criada.')
            fecharForm()
            await carregar()
        } catch (e) {
            setErro(e?.message || String(e))
            focarFormulario()
        } finally {
            setSalvando(false)
        }
    }

    const excluir = async (item) => {
        if (somenteLeitura) return
        const ok = window.confirm('Excluir esta observação?')
        if (!ok) return
        setSalvando(true)
        setErro('')
        setFeedback('')
        try {
            const res = await excluirHonorariosObservacao(item.id)
            if (!res.ok) {
                setErro(res.erro || 'Falha ao excluir.')
                return
            }
            setFeedback('Observação excluída.')
            if (Number(form.id) === Number(item.id)) fecharForm()
            await carregar()
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setSalvando(false)
        }
    }

    const rotuloProc = (codigo) => {
        const p = mapaProcedimentos.get(normalizarCodigoProcedimento(codigo))
        if (!p) return codigo
        return `${p.codigo} — ${p.nome}`
    }

    return (
        <div
            className={`el-page credenciamento_main config_obs_honorarios${
                formAberto ? ' is-editing' : ''
            }`}
        >
            <PageHeader
                kicker="Configurações"
                title="Observações (Honorários)"
                description="Mensagens no modelo do PDF de honorários (N) Título: texto). Só entram se os procedimentos vinculados estiverem no documento."
            />

            {erro ? (
                <CredenciamentoMainAlert message={erro} onClose={() => setErro('')} role="alert" />
            ) : null}
            {feedback ? (
                <CredenciamentoMainAlert
                    message={feedback}
                    onClose={() => setFeedback('')}
                    role="status"
                />
            ) : null}

            {!formAberto ? (
                <div className="config_obs_honorarios_toolbar">
                    <CampoBuscaComLimpar
                        className="credenciamento_main_input config_obs_honorarios_busca"
                        value={buscaObs}
                        onChange={(e) => setBuscaObs(e.target.value)}
                        placeholder="Buscar observação ou procedimento…"
                    />
                    <div className="config_obs_honorarios_toolbar_acoes">
                        {!somenteLeitura ? (
                            <button
                                type="button"
                                className="credenciamento_main_action_btn"
                                onClick={abrirNova}
                                disabled={salvando}
                            >
                                Nova observação
                            </button>
                        ) : (
                            <span className="config_obs_honorarios_muted">Somente leitura</span>
                        )}
                    </div>
                </div>
            ) : null}

            {formAberto ? (
                <section
                    ref={formRef}
                    className="config_obs_honorarios_form"
                    aria-label="Formulário de observação"
                >
                    <div className="config_obs_honorarios_form_head">
                        <h2>{form.id ? 'Editar observação' : 'Nova observação'}</h2>
                        <button
                            type="button"
                            className="credenciamento_main_action_btn secondary"
                            onClick={fecharForm}
                            disabled={salvando}
                        >
                            Cancelar
                        </button>
                    </div>

                    <label className="config_obs_honorarios_campo">
                        <span>Título (negrito no PDF)</span>
                        <input
                            type="text"
                            className="credenciamento_main_input"
                            value={form.titulo}
                            disabled={somenteLeitura || salvando}
                            onChange={(e) =>
                                setForm((prev) => ({ ...prev, titulo: e.target.value }))
                            }
                            placeholder="Ex.: Atendimentos Domiciliares"
                            autoFocus
                        />
                    </label>

                    <label className="config_obs_honorarios_campo">
                        <span>Texto</span>
                        <textarea
                            className="credenciamento_main_input config_obs_honorarios_textarea"
                            rows={5}
                            value={form.mensagem}
                            disabled={somenteLeitura || salvando}
                            onChange={(e) =>
                                setForm((prev) => ({ ...prev, mensagem: e.target.value }))
                            }
                            placeholder={
                                'Texto após o título. Use linhas com "- " para subitens (ex.: portes).\nNegrito com **assim**.'
                            }
                        />
                    </label>

                    <p className="config_obs_honorarios_preview_label">Prévia no PDF</p>
                    <div className="config_obs_honorarios_preview" aria-hidden>
                        <p>
                            <strong>
                                1) {form.titulo.trim() || 'Título'}
                                {form.titulo.trim() ? ':' : ''}
                            </strong>{' '}
                            <span>{form.mensagem.trim() || 'Texto da observação…'}</span>
                        </p>
                    </div>

                    <div className="config_obs_honorarios_form_meta">
                        <label className="config_obs_honorarios_campo config_obs_honorarios_campo_curto">
                            <span>Ordem</span>
                            <input
                                type="number"
                                className="credenciamento_main_input"
                                value={form.ordem}
                                disabled={somenteLeitura || salvando}
                                onChange={(e) =>
                                    setForm((prev) => ({
                                        ...prev,
                                        ordem: Number(e.target.value) || 0,
                                    }))
                                }
                            />
                        </label>
                        <label className="config_obs_honorarios_check_ativa">
                            <input
                                type="checkbox"
                                checked={form.ativa}
                                disabled={somenteLeitura || salvando}
                                onChange={(e) =>
                                    setForm((prev) => ({ ...prev, ativa: e.target.checked }))
                                }
                            />
                            Ativa (pode disparar na impressão)
                        </label>
                    </div>

                    <div className="config_obs_honorarios_procs">
                        <div className="config_obs_honorarios_procs_head">
                            <h3>Procedimentos que disparam</h3>
                            <span>
                                {form.codigosSelecionados.length} selecionado
                                {form.codigosSelecionados.length === 1 ? '' : 's'}
                            </span>
                        </div>

                        {form.codigosSelecionados.length ? (
                            <ChipsProcedimentos
                                codigos={form.codigosSelecionados}
                                rotuloProc={rotuloProc}
                                removivel={!somenteLeitura}
                                disabled={somenteLeitura || salvando}
                                onRemove={toggleCodigo}
                            />
                        ) : (
                            <p className="config_obs_honorarios_muted">
                                Selecione ao menos um procedimento abaixo.
                            </p>
                        )}

                        <CampoBuscaComLimpar
                            className="credenciamento_main_input config_obs_honorarios_busca"
                            value={buscaProc}
                            onChange={(e) => setBuscaProc(e.target.value)}
                            placeholder="Filtrar procedimentos por código, nome ou categoria…"
                        />

                        <div className="config_obs_honorarios_procs_lista">
                            {categoriasProc.map((cat) => {
                                const codigosCat = cat.procedimentos.map((p) =>
                                    normalizarCodigoProcedimento(p.codigo),
                                )
                                const marcados = codigosCat.filter((c) =>
                                    form.codigosSelecionados.includes(c),
                                ).length
                                const expandida =
                                    catsExpandidas.has(cat.id) || Boolean(buscaProc.trim())
                                const limite = limiteChips
                                const ocultarRestante =
                                    !expandida && cat.procedimentos.length > limite
                                const procsVisiveis = ocultarRestante
                                    ? cat.procedimentos.slice(0, limite)
                                    : cat.procedimentos

                                return (
                                    <section key={cat.id} className="config_obs_honorarios_cat">
                                        <div className="config_obs_honorarios_cat_head">
                                            <h4>
                                                {cat.nome}
                                                <em>
                                                    {' '}
                                                    ({marcados}/{cat.procedimentos.length})
                                                </em>
                                            </h4>
                                            <div className="config_obs_honorarios_cat_acoes">
                                                <button
                                                    type="button"
                                                    className="config_obs_honorarios_link"
                                                    disabled={somenteLeitura || salvando}
                                                    onClick={() => marcarCategoria(cat, true)}
                                                >
                                                    todos
                                                </button>
                                                <span aria-hidden>/</span>
                                                <button
                                                    type="button"
                                                    className="config_obs_honorarios_link"
                                                    disabled={somenteLeitura || salvando}
                                                    onClick={() => marcarCategoria(cat, false)}
                                                >
                                                    nenhum
                                                </button>
                                            </div>
                                        </div>
                                        {procsVisiveis.map((p) => {
                                            const marcado = codigoMarcado(p.codigo)
                                            return (
                                                <label
                                                    key={p.codigo}
                                                    className="config_obs_honorarios_proc_item"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={marcado}
                                                        disabled={somenteLeitura || salvando}
                                                        onChange={() => toggleCodigo(p.codigo)}
                                                    />
                                                    <span>
                                                        <strong>{p.codigo}</strong> — {p.nome}
                                                    </span>
                                                </label>
                                            )
                                        })}
                                        {ocultarRestante ||
                                        (expandida &&
                                            cat.procedimentos.length > limite &&
                                            !buscaProc.trim()) ? (
                                            <button
                                                type="button"
                                                className="config_obs_honorarios_chips_toggle"
                                                onClick={() => toggleCatExpandida(cat.id)}
                                            >
                                                {expandida
                                                    ? 'Mostrar menos'
                                                    : `Mostrar mais ${cat.procedimentos.length - limite} procedimento(s)`}
                                            </button>
                                        ) : null}
                                    </section>
                                )
                            })}
                            {!categoriasProc.length ? (
                                <p className="config_obs_honorarios_muted">
                                    Nenhum procedimento encontrado.
                                </p>
                            ) : null}
                        </div>
                    </div>

                    {!somenteLeitura ? (
                        <div className="config_obs_honorarios_form_acoes">
                            <button
                                type="button"
                                className="credenciamento_main_action_btn secondary"
                                disabled={salvando}
                                onClick={fecharForm}
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                className="credenciamento_main_action_btn"
                                disabled={salvando}
                                onClick={() => void salvar()}
                            >
                                {salvando
                                    ? 'Salvando…'
                                    : form.id
                                      ? 'Salvar alterações'
                                      : 'Salvar observação'}
                            </button>
                        </div>
                    ) : null}
                </section>
            ) : null}

            {!formAberto && loading ? (
                <p className="config_obs_honorarios_muted">A carregar…</p>
            ) : null}

            {!formAberto && !loading ? (
                <div className="config_obs_honorarios_lista">
                    {observacoesFiltradas.map((item) => (
                        <article
                            key={item.id}
                            className={`config_obs_honorarios_card ${item.ativa ? '' : 'is-inativa'}`}
                        >
                            <div className="config_obs_honorarios_card_top">
                                <span className="config_obs_honorarios_card_ordem">#{item.ordem}</span>
                                {!item.ativa ? (
                                    <span className="config_obs_honorarios_badge">Inativa</span>
                                ) : (
                                    <span className="config_obs_honorarios_badge is-ativa">Ativa</span>
                                )}
                            </div>
                            <p className="config_obs_honorarios_card_msg">
                                <strong>
                                    {item.titulo ? `${item.titulo}:` : 'Sem título'}
                                </strong>{' '}
                                {item.mensagem}
                            </p>
                            <ChipsProcedimentos
                                codigos={item.codigosProcedimentos || []}
                                rotuloProc={rotuloProc}
                            />
                            {!somenteLeitura ? (
                                <div className="config_obs_honorarios_card_acoes">
                                    <button
                                        type="button"
                                        className="credenciamento_main_action_btn"
                                        disabled={salvando}
                                        onClick={() => abrirEdicao(item)}
                                    >
                                        Editar
                                    </button>
                                    <button
                                        type="button"
                                        className="credenciamento_main_action_btn secondary"
                                        disabled={salvando}
                                        onClick={() => void excluir(item)}
                                    >
                                        Excluir
                                    </button>
                                </div>
                            ) : null}
                        </article>
                    ))}
                    {!observacoesFiltradas.length ? (
                        <p className="config_obs_honorarios_muted">
                            Nenhuma observação cadastrada
                            {buscaObs ? ' para esta busca' : ''}.
                        </p>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}

export default ConfigObservacoesHonorarios
