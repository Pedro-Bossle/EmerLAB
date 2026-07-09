import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { PERMISSION_KEYS, getStoredAccessProfile, hasPermission } from '../../../lib/accessControl'
import {
    atualizarCoordenadasPrestadorImport,
    filtrarPrestadoresParaImportCoordenadas,
} from '../../../lib/credenciamento/prestadorEnderecoGeocode'
import {
    linhasProntasParaAplicar,
    montarLinhasRevisaoImportKmz,
    parsearKmzParaPlacemarks,
} from '../../../lib/credenciamento/prestadorImportKmz'
import PrestadorVinculoBusca from '../../Supertabela/Supertabela_negociacoes/PrestadorVinculoBusca.jsx'
import '../Credenciamento_main/Credenciamento_main.css'
import CredenciamentoMainAlert from '../../../components/Toast/CredenciamentoMainAlert.jsx'
import './CredenciamentoImportKmz.css'

const rotuloPrestador = (p) => (p?.nome ? String(p.nome) : `ID ${p?.id}`)

const rotuloTipo = (tipo) => {
    if (tipo === 'auto') return 'Match exato'
    if (tipo === 'revisar') return 'Revisar'
    return 'Inválido'
}

const CredenciamentoImportKmz = () => {
    const [loading, setLoading] = useState(true)
    const [erro, setErro] = useState('')
    const [feedback, setFeedback] = useState('')
    const [prestadoresBase, setPrestadoresBase] = useState([])
    const [prestadoresVinculo, setPrestadoresVinculo] = useState([])
    const [nomeArquivo, setNomeArquivo] = useState('')
    const [linhas, setLinhas] = useState([])
    const [resumo, setResumo] = useState(null)
    const [processandoArquivo, setProcessandoArquivo] = useState(false)
    const [aplicando, setAplicando] = useState(false)

    const somenteLeitura = useMemo(() => {
        const profile = getStoredAccessProfile()
        return profile ? !hasPermission(profile, PERMISSION_KEYS.CREDENCIAMENTO_EDIT) : true
    }, [])

    const carregarPrestadores = useCallback(async () => {
        setLoading(true)
        setErro('')
        try {
            const [{ data: prestadoresData, error: errP }, { data: especialidadesData, error: errE }, { data: situacoesData, error: errS }] =
                await Promise.all([
                    supabase
                        .from('prestadores')
                        .select(
                            'id, nome, especialidade_id, situacao_id, ativo, cep, endereco, endereco_logradouro, endereco_numero, endereco_bairro, endereco_cidade, endereco_uf, latitude, longitude',
                        )
                        .eq('ativo', true),
                    supabase.from('especialidades').select('id, nome, tipo').order('nome'),
                    supabase.from('situacoes').select('id, descricao, ativo').eq('ativo', true),
                ])
            if (errP) throw new Error(errP.message)
            if (errE) throw new Error(errE.message)
            if (errS) throw new Error(errS.message)
            const esp = especialidadesData || []
            const sit = situacoesData || []
            const lista = prestadoresData || []
            setPrestadoresBase(lista)
            setPrestadoresVinculo(filtrarPrestadoresParaImportCoordenadas(lista, esp, { situacoes: sit }))
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void carregarPrestadores()
    }, [carregarPrestadores])

    const prestadorPorId = useMemo(() => {
        const m = new Map()
        for (const p of prestadoresBase) m.set(Number(p.id), p)
        return m
    }, [prestadoresBase])

    const aplicaveis = useMemo(() => linhasProntasParaAplicar(linhas), [linhas])

    const resumoVivo = useMemo(() => {
        if (!linhas.length) return null
        let auto = 0
        let revisar = 0
        let invalido = 0
        for (const l of linhas) {
            if (l.tipo === 'auto') auto += 1
            else if (l.tipo === 'revisar') revisar += 1
            else invalido += 1
        }
        return {
            total: linhas.length,
            auto,
            revisar,
            invalido,
            aplicaveis: linhas.filter((l) => l.tipo !== 'invalido' && l.prestadorId).length,
        }
    }, [linhas])

    const resumoExibir = resumoVivo || resumo

    const onArquivo = async (e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (!file) return
        const ext = file.name.toLowerCase()
        if (!ext.endsWith('.kmz')) {
            setErro('Envie um arquivo .kmz (export do Google My Maps).')
            return
        }
        setProcessandoArquivo(true)
        setErro('')
        setFeedback('')
        setNomeArquivo(file.name)
        try {
            const buf = await file.arrayBuffer()
            const placemarks = await parsearKmzParaPlacemarks(buf)
            if (!placemarks.length) {
                throw new Error('Nenhum pin com coordenadas encontrado no KMZ.')
            }
            const { linhas: novas, resumo: r } = montarLinhasRevisaoImportKmz(placemarks, prestadoresVinculo)
            setLinhas(novas)
            setResumo(r)
            setFeedback(`${placemarks.length} pin(s) lidos de «${file.name}».`)
        } catch (err) {
            setLinhas([])
            setResumo(null)
            setErro(err?.message || String(err))
        } finally {
            setProcessandoArquivo(false)
        }
    }

    const atualizarPrestadorLinha = (key, prestadorId) => {
        setLinhas((prev) =>
            prev.map((l) => {
                if (l.key !== key) return l
                const id =
                    prestadorId == null || prestadorId === ''
                        ? null
                        : Number(prestadorId)
                return { ...l, prestadorId: Number.isFinite(id) ? id : null }
            }),
        )
    }

    const removerLinhaImport = (key) => {
        setLinhas((prev) => prev.filter((l) => l.key !== key))
    }

    const aplicarImport = async () => {
        if (somenteLeitura || !aplicaveis.length) return
        setAplicando(true)
        setErro('')
        setFeedback('')
        let ok = 0
        let falhas = 0
        try {
            for (const l of aplicaveis) {
                const prest = prestadorPorId.get(Number(l.prestadorId))
                try {
                    await atualizarCoordenadasPrestadorImport(
                        supabase,
                        l.prestadorId,
                        l.latitude,
                        l.longitude,
                        prest || {},
                    )
                    ok += 1
                } catch {
                    falhas += 1
                }
            }
            if (falhas) {
                setFeedback(`Importação parcial: ${ok} atualizado(s), ${falhas} falha(s).`)
            } else {
                setFeedback(`${ok} credenciado(s) atualizado(s) com coordenadas do KMZ.`)
            }
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setAplicando(false)
        }
    }

    const pendentesVinculo = useMemo(
        () => linhas.filter((l) => l.tipo === 'revisar' && !l.prestadorId).length,
        [linhas],
    )

    return (
        <div className="credenciamento_main cred_import_kmz">
            <div className="cred_import_kmz_header">
                <h1>Importar coordenadas (KMZ)</h1>
                <Link to="/credenciamento/mapa" className="credenciamento_main_action_btn secondary">
                    Voltar ao mapa
                </Link>
            </div>
            <p className="pcad_muted cred_import_kmz_lead">
                Exporte o mapa do Google My Maps como <strong>KMZ</strong>. Cada pin deve ter o{' '}
                <strong>nome</strong> igual ao cadastro do credenciado LOCAL. Sem match exato, escolha o
                credenciado entre as sugestões.
            </p>

            <CredenciamentoMainAlert message={erro} onClose={() => setErro('')} role="alert" />
            <CredenciamentoMainAlert message={feedback} onClose={() => setFeedback('')} role="status" />

            <div className="cred_import_kmz_upload">
                <label className="credenciamento_main_action_btn cred_import_kmz_file_label">
                    {processandoArquivo ? 'Lendo KMZ…' : 'Selecionar arquivo .kmz'}
                    <input
                        type="file"
                        accept=".kmz,application/vnd.google-earth.kmz"
                        disabled={loading || processandoArquivo || somenteLeitura}
                        onChange={(e) => void onArquivo(e)}
                        hidden
                    />
                </label>
                {nomeArquivo && <span className="pcad_muted">Último arquivo: {nomeArquivo}</span>}
                <span className="pcad_muted">
                    {prestadoresVinculo.length} credenciado(s) LOCAL elegíveis para vínculo.
                </span>
            </div>

            {resumoExibir && (
                <div className="cred_import_kmz_resumo">
                    <span className="cred_import_kmz_kpi">
                        Total: <strong>{resumoExibir.total}</strong>
                    </span>
                    <span className="cred_import_kmz_kpi cred_import_kmz_kpi_ok">
                        Match exato: <strong>{resumoExibir.auto}</strong>
                    </span>
                    <span className="cred_import_kmz_kpi cred_import_kmz_kpi_warn">
                        Revisar: <strong>{resumoExibir.revisar}</strong>
                    </span>
                    <span className="cred_import_kmz_kpi">
                        Inválidos: <strong>{resumoExibir.invalido}</strong>
                    </span>
                    <span className="cred_import_kmz_kpi">
                        Prontos para aplicar: <strong>{resumoExibir.aplicaveis}</strong>
                    </span>
                </div>
            )}

            {linhas.length > 0 && (
                <>
                    <div className="cred_import_kmz_table_wrap">
                        <table className="cred_import_kmz_table">
                            <thead>
                                <tr>
                                    <th className="cred_import_kmz_col_remover" aria-label="Remover" />
                                    <th>Nome no KMZ</th>
                                    <th>Status</th>
                                    <th>Credenciado</th>
                                    <th>Latitude</th>
                                    <th>Longitude</th>
                                </tr>
                            </thead>
                            <tbody>
                                {linhas.map((l) => (
                                    <tr
                                        key={l.key}
                                        className={
                                            l.tipo === 'invalido'
                                                ? 'is-invalido'
                                                : l.tipo === 'auto'
                                                  ? 'is-auto'
                                                  : 'is-revisar'
                                        }
                                    >
                                        <td className="cred_import_kmz_col_remover">
                                            <button
                                                type="button"
                                                className="cred_import_kmz_remover_btn"
                                                title="Remover esta linha da importação"
                                                aria-label={`Remover pin ${l.nomeArquivo}`}
                                                disabled={somenteLeitura || aplicando}
                                                onClick={() => removerLinhaImport(l.key)}
                                            >
                                                −
                                            </button>
                                        </td>
                                        <td>{l.nomeArquivo}</td>
                                        <td>
                                            <span className="cred_import_kmz_badge" data-tipo={l.tipo}>
                                                {rotuloTipo(l.tipo)}
                                            </span>
                                            {l.motivo ? (
                                                <span className="pcad_muted cred_import_kmz_motivo">{l.motivo}</span>
                                            ) : null}
                                        </td>
                                        <td className="cred_import_kmz_vinculo">
                                            {l.tipo === 'invalido' ? (
                                                <span className="pcad_muted">—</span>
                                            ) : (
                                                <>
                                                    {l.sugestoes?.length > 0 && l.tipo === 'revisar' ? (
                                                        <select
                                                            className="credenciamento_main_select cred_import_kmz_select"
                                                            value={l.prestadorId ? String(l.prestadorId) : ''}
                                                            disabled={somenteLeitura || aplicando}
                                                            onChange={(ev) =>
                                                                atualizarPrestadorLinha(l.key, ev.target.value)
                                                            }
                                                        >
                                                            <option value="">—</option>
                                                            {l.sugestoes.map((s) => (
                                                                <option key={s.id} value={s.id}>
                                                                    {s.nome}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    ) : null}
                                                    <PrestadorVinculoBusca
                                                        prestadores={prestadoresVinculo}
                                                        prestadorId={l.prestadorId ? String(l.prestadorId) : ''}
                                                        onChange={(p) =>
                                                            atualizarPrestadorLinha(l.key, p ? p.id : null)
                                                        }
                                                        disabled={somenteLeitura || aplicando}
                                                        rotuloFn={rotuloPrestador}
                                                        placeholder="Buscar credenciado…"
                                                        usePortal
                                                    />
                                                </>
                                            )}
                                        </td>
                                        <td>{Number.isFinite(l.latitude) ? l.latitude.toFixed(6) : '—'}</td>
                                        <td>{Number.isFinite(l.longitude) ? l.longitude.toFixed(6) : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="cred_import_kmz_acoes">
                        <button
                            type="button"
                            className="credenciamento_main_action_btn"
                            disabled={somenteLeitura || aplicando || aplicaveis.length === 0}
                            onClick={() => void aplicarImport()}
                        >
                            {aplicando
                                ? 'Aplicando…'
                                : `Aplicar ${aplicaveis.length} coordenada(s)`}
                        </button>
                        {pendentesVinculo > 0 ? (
                            <p className="pcad_muted">
                                {pendentesVinculo} linha(s) em revisão sem credenciado escolhido (não bloqueiam as
                                demais, mas reduzem o total aplicável).
                            </p>
                        ) : null}
                        {somenteLeitura ? (
                            <p className="pcad_muted">Sem permissão de edição no credenciamento.</p>
                        ) : null}
                    </div>
                </>
            )}

            {loading && !linhas.length ? <p>Carregando credenciados…</p> : null}
        </div>
    )
}

export default CredenciamentoImportKmz
