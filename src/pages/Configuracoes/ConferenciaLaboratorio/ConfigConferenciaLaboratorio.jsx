import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
    PERMISSION_KEYS,
    getStoredAccessProfile,
    hasPermission,
    usuarioPodeEditarFerramenta,
} from '../../../lib/accessControl'
import {
    CARDS_POR_PAGINA,
    CAMPOS_CONFERENCIA,
    aliasesPessoaDePareamento,
    alinharExamesLabAoCodigoDoPlano,
    autoAprovarPareamentosPerfeitos,
    carregarAliasesPessoaLaboratorio,
    carregarMapeamentosLaboratorio,
    camposFaltantesMapeamento,
    chaveAliasExame,
    chaveMarcacaoPosRelatorio,
    exportarPosRelatorioConferenciaExcel,
    listarAliasesDoExameAlvo,
    listarNomesExameUnicos,
    mapearIndicesColunasConferencia,
    mesclarAliasesPessoa,
    montarCardsConferencia,
    montarListaAliasesExames,
    montarMapasAliasesPessoa,
    combinarOrfaosNosCards,
    agruparCardsComparacaoPorAtendimento,
    agruparLinhasPorAtendimento,
    enriquecerLinhaEmerdog,
    montarFilaPareamentoOrfaos,
    montarFilaExamesIndividuais,
    montarLinhasPosRelatorio,
    normalizarNomeExame,
    arredondarValorLab,
    valorLabDeMapeamentoSalvo,
    ordenarExamesPorCodigo,
    ordenarLinhasPorAtendimento,
    prepararOrdenacaoEFilaAliases,
    resumirTotaisConferencia,
    salvarAliasesPessoaEmLote,
    salvarMapeamentoExame,
    salvarSessaoConferencia,
    carregarSessaoConferencia,
    nomeCorrespondeFoco,
} from '../../../lib/configuracoes/conferenciaLaboratorio.js'
import { parsearExcelConferenciaViaWorker } from '../../../lib/configuracoes/conferenciaExcelWorkerClient.js'
import {
    carregarPrecosNegociacaoLaboratorio,
    filtrarCatalogoNegociacao,
    formatarDataConferencia,
    formatarValorConferencia,
} from '../../../lib/configuracoes/conferenciaLaboratorioPrecos.js'
import {
    idsEspecialidadeLaboratorio,
    normalizarTextoBusca,
    prestadorEhLaboratorio,
} from '../../../lib/prestadorCadastroHelpers.js'
import { buscarTodosPaginado, supabase } from '../../../lib/supabase'
import CredenciamentoMainAlert from '../../../components/Toast/CredenciamentoMainAlert.jsx'
import EtapaExamesIndividuais from './EtapaExamesIndividuais.jsx'
import EtapaAliasesExames from './EtapaAliasesExames.jsx'
import '../../Credenciamento/Credenciamento_main/Credenciamento_main.css'
import './ConfigConferenciaLaboratorio.css'

const ROTULO_CAMPO = {
    tutor: 'Tutor',
    pet: 'Animal',
    data: 'Data',
    exame: 'Exame',
}

function BandeiraPosRelatorio({ marcado, onToggle }) {
    return (
        <button
            type="button"
            className={`conf_lab_bandeira${marcado ? ' is-on' : ''}`}
            title={marcado ? 'Remover do pós-relatório' : 'Marcar para pós-relatório'}
            aria-label={marcado ? 'Remover do pós-relatório' : 'Marcar para pós-relatório'}
            aria-pressed={marcado}
            onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onToggle()
            }}
        >
            <svg viewBox="0 0 24 24" aria-hidden>
                <path
                    d="M6 3v18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                />
                <path
                    d="M6 4.5h9.5l-1.8 3.2 1.8 3.3H6V4.5z"
                    fill={marcado ? 'currentColor' : 'none'}
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinejoin="round"
                />
            </svg>
        </button>
    )
}

function chaveExamePosRelatorio(ex, lado) {
    if (lado === 'lab') {
        if (ex?.idLocal && ex?.idParEm) return `par:${ex.idLocal}|${ex.idParEm}`
        if (ex?.idLocal) return `lab:${ex.idLocal}`
    } else {
        if (ex?.idParLab && ex?.idLocal) return `par:${ex.idParLab}|${ex.idLocal}`
        if (ex?.idLocal) return `em:${ex.idLocal}`
    }
    return ''
}

function dicaStatusExameOrfao(ex, lado, examesOposto) {
    if (ex?.semPar) {
        return 'Sem correspondente no outro lado nesta comparação (amarelo ≠ já pareado em outro atendimento).'
    }
    if (ex?.valoresDiferem) {
        return 'Exame pareado, mas o valor diverge entre lab e plano.'
    }
    const idPar = lado === 'lab' ? ex?.idParEm : ex?.idParLab
    if (idPar && examesOposto?.length) {
        const par = examesOposto.find((e) => e.idLocal === idPar)
        if (par) {
            const txt = [par.codigo, par.nome].filter(Boolean).join(' — ')
            return txt ? `Pareado nesta tela com: ${txt}` : 'Pareado nesta tela com exame do outro lado.'
        }
    }
    return undefined
}

function periodoAtualYm() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const UploadZone = ({ titulo, dica, arquivo, onFile, disabled }) => {
    const [arrastando, setArrastando] = useState(false)
    const id = `conf-lab-up-${titulo.replace(/\s+/g, '-').toLowerCase()}`

    return (
        <div
            className={`conf_lab_drop${arrastando ? ' is-drag' : ''}${disabled ? ' is-busy' : ''}${arquivo ? ' has-file' : ''}`}
            onDragEnter={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (!disabled) setArrastando(true)
            }}
            onDragOver={(e) => {
                e.preventDefault()
                e.stopPropagation()
            }}
            onDragLeave={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (e.currentTarget === e.target) setArrastando(false)
            }}
            onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setArrastando(false)
                if (disabled) return
                const file = e.dataTransfer?.files?.[0]
                if (file) onFile(file)
            }}
        >
            <div className="conf_lab_drop_icon" aria-hidden>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                    <path
                        d="M12 3v10m0 0l3.5-3.5M12 13L8.5 9.5M4 17.5V19a2 2 0 002 2h12a2 2 0 002-2v-1.5"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </div>
            <div className="conf_lab_drop_copy">
                <strong>{titulo}</strong>
                <span>{dica}</span>
            </div>
            <label htmlFor={id} className="conf_lab_drop_btn">
                {arquivo ? 'Trocar arquivo' : 'Selecionar .xlsx'}
                <input
                    id={id}
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    disabled={disabled}
                    onChange={(e) => onFile(e.target.files?.[0] || null)}
                />
            </label>
            {arquivo ? (
                <p className="conf_lab_drop_nome" title={arquivo.name}>
                    {arquivo.name}
                </p>
            ) : (
                <p className="conf_lab_drop_hint">Arraste o Excel aqui</p>
            )}
        </div>
    )
}

const ConfigConferenciaLaboratorio = () => {
    const profile = getStoredAccessProfile()
    const userId = profile?.id || ''
    const podeEditar = useMemo(() => {
        if (!profile) return false
        if (usuarioPodeEditarFerramenta(profile.permissions, 'configuracoes.conferencia_laboratorio')) {
            return true
        }
        return hasPermission(profile, PERMISSION_KEYS.CREDENCIAMENTO_EDIT)
    }, [profile])

    const [passo, setPasso] = useState('setup')
    const [loading, setLoading] = useState(true)
    const [processando, setProcessando] = useState(false)
    const [erro, setErro] = useState('')
    const [aviso, setAviso] = useState('')
    const [feedback, setFeedback] = useState('')

    const [laboratorios, setLaboratorios] = useState([])
    const [laboratorioId, setLaboratorioId] = useState('')
    const [buscaLab, setBuscaLab] = useState('')
    const [periodoYm, setPeriodoYm] = useState(periodoAtualYm)

    const [arquivoLab, setArquivoLab] = useState(null)
    const [arquivoEmerdog, setArquivoEmerdog] = useState(null)
    const [headersLab, setHeadersLab] = useState([])
    const [headersEmerdog, setHeadersEmerdog] = useState([])
    const [mapColsLab, setMapColsLab] = useState({})
    const [mapColsEmerdog, setMapColsEmerdog] = useState({})
    const [linhasLab, setLinhasLab] = useState([])
    const [linhasEmerdog, setLinhasEmerdog] = useState([])
    const [precisaMapearCols, setPrecisaMapearCols] = useState(false)

    const [filaMapeamento, setFilaMapeamento] = useState([])
    const [indiceFila, setIndiceFila] = useState(0)
    const [resolvidos, setResolvidos] = useState(() => new Map())
    const [mapeamentosSalvos, setMapeamentosSalvos] = useState([])
    const [escolhaEmerdog, setEscolhaEmerdog] = useState('')
    /** true = revisando aliases após já ter gerado comparação (não força nova comparação ao salvar). */
    const [modoRevisaoAliases, setModoRevisaoAliases] = useState(false)

    const [cards, setCards] = useState([])
    const [paresManuais, setParesManuais] = useState([])
    const [filaOrfaos, setFilaOrfaos] = useState([])
    const [indiceOrfao, setIndiceOrfao] = useState(0)
    const [escolhaOrfaoEm, setEscolhaOrfaoEm] = useState('')
    /** idItem → idEmerdogLocal escolhido no select */
    const [escolhasExames, setEscolhasExames] = useState({})
    /** chaveLab/idItem → { status, chaveEm/idEm } */
    const [decisoesOrfaos, setDecisoesOrfaos] = useState(() => new Map())
    const [orfaosDisponiveisEm, setOrfaosDisponiveisEm] = useState([])
    const [gruposEmDisponiveis, setGruposEmDisponiveis] = useState([])
    const [filtroCards, setFiltroCards] = useState('diferencas')
    const [buscaComparacao, setBuscaComparacao] = useState('')
    const [tutorFoco, setTutorFoco] = useState(null) // { norm, label, petNorm, petLabel }
    const [pagina, setPagina] = useState(1)
    const paginaAntesTutorFocoRef = useRef(1)
    /** Seleção para mesclar órfãos lab ↔ plano na comparação. */
    const [mesclaLabId, setMesclaLabId] = useState(null)
    const [mesclaEmId, setMesclaEmId] = useState(null)
    const comparacaoTopoRef = useRef(null)
    const [obsAuditoria, setObsAuditoria] = useState({})
    const [mapaResolvidosAtual, setMapaResolvidosAtual] = useState(() => new Map())
    /** Aliases tutor/pet: nome do plano → canônico do lab (persistidos por laboratório). */
    const [aliasesPessoa, setAliasesPessoa] = useState([])
    const [catalogoNegociacao, setCatalogoNegociacao] = useState([])
    const [precosPorNomeNorm, setPrecosPorNomeNorm] = useState(() => new Map())
    const [codigoPorNomeNorm, setCodigoPorNomeNorm] = useState(() => new Map())
    const [nomeSistemaPorNorm, setNomeSistemaPorNorm] = useState(() => new Map())
    const [normalizarCardId, setNormalizarCardId] = useState('')
    const [buscaCatalogo, setBuscaCatalogo] = useState('')
    const [escolhaCatalogo, setEscolhaCatalogo] = useState('')
    const [marcadosPosRelatorio, setMarcadosPosRelatorio] = useState(() => new Set())
    const [headerCompacto, setHeaderCompacto] = useState(false)
    const [sessaoSalvaMeta, setSessaoSalvaMeta] = useState(null)
    const [salvandoSessao, setSalvandoSessao] = useState(false)
    const [sessaoPersistenciaOk, setSessaoPersistenciaOk] = useState(true)
    const sujoRef = useRef(false)

    useEffect(() => {
        let compacto = false
        const onScroll = () => {
            const y = window.scrollY || 0
            // Histerese: evita flicker quando o sticky muda altura/blur no limiar
            if (!compacto && y > 56) {
                compacto = true
                setHeaderCompacto(true)
            } else if (compacto && y < 16) {
                compacto = false
                setHeaderCompacto(false)
            }
        }
        onScroll()
        window.addEventListener('scroll', onScroll, { passive: true })
        return () => window.removeEventListener('scroll', onScroll)
    }, [])

    useEffect(() => {
        sujoRef.current = Boolean(linhasLab.length || linhasEmerdog.length || cards.length)
    }, [linhasLab.length, linhasEmerdog.length, cards.length])

    useEffect(() => {
        const onBeforeUnload = (e) => {
            if (!sujoRef.current) return
            e.preventDefault()
            e.returnValue = ''
        }
        window.addEventListener('beforeunload', onBeforeUnload)
        return () => window.removeEventListener('beforeunload', onBeforeUnload)
    }, [])

    const carregarLaboratorios = useCallback(async () => {
        setLoading(true)
        setErro('')
        try {
            const [{ data: especialidades, error: errEsp }, { data: prestadores, error: errP }] =
                await Promise.all([
                    supabase.from('especialidades').select('id, nome').order('nome'),
                    buscarTodosPaginado(() =>
                        supabase
                            .from('prestadores')
                            .select('id, nome, especialidade_id, ativo')
                            .eq('ativo', true)
                            .order('nome', { ascending: true }),
                    ),
                ])
            if (errEsp) throw new Error(errEsp.message)
            if (errP) throw new Error(errP.message)

            const idsLab = new Set(idsEspecialidadeLaboratorio(especialidades || []))
            const labs = (prestadores || []).filter((p) => {
                if (idsLab.has(Number(p.especialidade_id))) return true
                return prestadorEhLaboratorio(p.especialidade_id, especialidades || [])
            })
            setLaboratorios(labs)
            if (!laboratorioId && labs[0]?.id) setLaboratorioId(String(labs[0].id))
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setLoading(false)
        }
    }, [laboratorioId])

    useEffect(() => {
        void carregarLaboratorios()
    }, [carregarLaboratorios])

    useEffect(() => {
        setSessaoPersistenciaOk(true)
        let cancelado = false
        const checar = async () => {
            if (!laboratorioId || !periodoYm) {
                setSessaoSalvaMeta(null)
                return
            }
            try {
                const sessao = await carregarSessaoConferencia({
                    laboratorioId,
                    periodoYm,
                })
                if (!cancelado) {
                    setSessaoSalvaMeta(
                        sessao
                            ? {
                                  id: sessao.id,
                                  passo: sessao.passo || sessao.estado?.passo,
                                  atualizadoEm: sessao.atualizadoEm,
                                  temLinhas: Boolean(
                                      sessao.estado?.linhasLab?.length ||
                                          sessao.estado?.linhasEmerdog?.length,
                                  ),
                              }
                            : null,
                    )
                }
            } catch {
                if (!cancelado) setSessaoSalvaMeta(null)
            }
        }
        void checar()
        return () => {
            cancelado = true
        }
    }, [laboratorioId, periodoYm])

    const montarEstadoParaSessao = useCallback(
        () => ({
            passo,
            periodoYm,
            laboratorioId,
            mapColsLab,
            mapColsEmerdog,
            linhasLab,
            linhasEmerdog,
            paresManuais,
            resolvidos,
            mapaResolvidosAtual,
            decisoesOrfaos,
            escolhasExames,
            marcadosPosRelatorio,
            cards,
            filaOrfaos,
            obsAuditoria,
            aliasesPessoa,
        }),
        [
            passo,
            periodoYm,
            laboratorioId,
            mapColsLab,
            mapColsEmerdog,
            linhasLab,
            linhasEmerdog,
            paresManuais,
            resolvidos,
            mapaResolvidosAtual,
            decisoesOrfaos,
            escolhasExames,
            marcadosPosRelatorio,
            cards,
            filaOrfaos,
            obsAuditoria,
            aliasesPessoa,
        ],
    )

    const persistirSessaoAgora = useCallback(async () => {
        if (!podeEditar || !laboratorioId || !periodoYm) return null
        if (!linhasLab.length && !linhasEmerdog.length && !cards.length) return null
        if (!sessaoPersistenciaOk) return null
        setSalvandoSessao(true)
        try {
            const resultado = await salvarSessaoConferencia({
                laboratorioId,
                periodoYm,
                passo,
                estado: montarEstadoParaSessao(),
            })
            if (!resultado?.ok) {
                setSessaoPersistenciaOk(false)
                return null
            }
            const data = resultado.data
            setSessaoSalvaMeta({
                id: data?.id,
                passo,
                atualizadoEm: data?.atualizado_em || new Date().toISOString(),
                temLinhas: true,
            })
            return data
        } catch {
            setSessaoPersistenciaOk(false)
            return null
        } finally {
            setSalvandoSessao(false)
        }
    }, [
        podeEditar,
        laboratorioId,
        periodoYm,
        passo,
        linhasLab.length,
        linhasEmerdog.length,
        cards.length,
        montarEstadoParaSessao,
        sessaoPersistenciaOk,
    ])

    useEffect(() => {
        if (!podeEditar) return undefined
        if (!linhasLab.length && !linhasEmerdog.length && !cards.length) return undefined
        const t = window.setTimeout(() => {
            void persistirSessaoAgora().catch(() => {})
        }, 2500)
        return () => window.clearTimeout(t)
    }, [
        podeEditar,
        linhasLab,
        linhasEmerdog,
        cards,
        paresManuais,
        decisoesOrfaos,
        resolvidos,
        passo,
        persistirSessaoAgora,
    ])

    const restaurarSessaoSalva = async () => {
        if (!laboratorioId || !periodoYm) return
        setProcessando(true)
        setErro('')
        try {
            const sessao = await carregarSessaoConferencia({ laboratorioId, periodoYm })
            if (!sessao?.estado) {
                setFeedback('Nenhuma sessão salva para este lab/período.')
                return
            }
            const e = sessao.estado
            setMapColsLab(e.mapColsLab || {})
            setMapColsEmerdog(e.mapColsEmerdog || {})
            setLinhasLab(e.linhasLab || [])
            setLinhasEmerdog(e.linhasEmerdog || [])
            setParesManuais(e.paresManuais || [])
            setResolvidos(e.resolvidos || new Map())
            setMapaResolvidosAtual(e.mapaResolvidosAtual || new Map())
            setDecisoesOrfaos(e.decisoesOrfaos || new Map())
            setEscolhasExames(e.escolhasExames || {})
            setMarcadosPosRelatorio(e.marcadosPosRelatorio || new Set())
            setCards(e.cards || [])
            const filaRest =
                e.filaOrfaos?.length
                    ? e.filaOrfaos
                    : e.cards?.length
                      ? montarFilaExamesIndividuais(e.cards, {
                            mapasAliasesPessoa: montarMapasAliasesPessoa(
                                e.aliasesPessoa || [],
                            ),
                        }).fila
                      : []
            setFilaOrfaos(filaRest)
            setObsAuditoria(e.obsAuditoria || {})
            setAliasesPessoa(e.aliasesPessoa || [])
            setArquivoLab(null)
            setArquivoEmerdog(null)

            const {
                catalogo,
                precosPorNomeNorm: precos,
                codigoPorNomeNorm: codigos,
                nomeSistemaPorNorm: nomesSis,
            } = await carregarPrecosNegociacaoLaboratorio(laboratorioId)
            setCatalogoNegociacao(catalogo || [])
            setPrecosPorNomeNorm(precos || new Map())
            setCodigoPorNomeNorm(codigos || new Map())
            setNomeSistemaPorNorm(nomesSis || new Map())

            // Completa aliases de pessoa do banco (além da sessão)
            const doBanco = await carregarAliasesPessoaLaboratorio(laboratorioId)
            const aliasesMesclados = mesclarAliasesPessoa(e.aliasesPessoa || [], doBanco)
            setAliasesPessoa(aliasesMesclados)
            if (e.cards?.length && (!e.filaOrfaos || !e.filaOrfaos.length)) {
                setFilaOrfaos(
                    montarFilaExamesIndividuais(e.cards, {
                        mapasAliasesPessoa: montarMapasAliasesPessoa(aliasesMesclados),
                    }).fila,
                )
            }

            const passoRest = e.passo || sessao.passo || 'comparacao'
            setPasso(passoRest)
            setFeedback(
                `Sessão restaurada (${e.cards?.length || 0} exames · passo ${passoRest}).`,
            )
            setSessaoSalvaMeta({
                id: sessao.id,
                passo: passoRest,
                atualizadoEm: sessao.atualizadoEm,
                temLinhas: true,
            })
        } catch (err) {
            setErro(err?.message || String(err))
        } finally {
            setProcessando(false)
        }
    }

    const labsFiltrados = useMemo(() => {
        const termo = normalizarTextoBusca(buscaLab)
        if (!termo) return laboratorios
        return laboratorios.filter((l) => normalizarTextoBusca(l.nome).includes(termo))
    }, [laboratorios, buscaLab])

    const itemFilaAtual = filaMapeamento[indiceFila] || null

    useEffect(() => {
        if (!itemFilaAtual) {
            setEscolhaEmerdog('')
            return
        }
        const salvo =
            resolvidos.get(itemFilaAtual.nomeLabNorm) ||
            mapaResolvidosAtual.get(itemFilaAtual.nomeLabNorm)
        setEscolhaEmerdog(
            salvo?.nomeEmerdog ||
                itemFilaAtual.sugestoes?.[0] ||
                itemFilaAtual.sugestao ||
                itemFilaAtual.itensCatalogo?.[0]?.nome ||
                itemFilaAtual.nomesCatalogo?.[0] ||
                (typeof itemFilaAtual.nomesEmerdog?.[0] === 'string'
                    ? itemFilaAtual.nomesEmerdog[0]
                    : itemFilaAtual.nomesEmerdog?.[0]?.nome) ||
                '',
        )
        // eslint-disable-next-line react-hooks/exhaustive-deps -- só ao trocar o item da fila
    }, [itemFilaAtual])

    const opcoesCatalogoAlias = useMemo(() => {
        const daFila = itemFilaAtual?.itensCatalogo
        if (daFila?.length) return daFila
        return [...(catalogoNegociacao || [])]
            .map((item) => {
                const nome = String(item.nome || '').trim()
                const codigo = String(item.codigo || '').trim()
                const nomeAlternativo = String(item.nomeAlternativo || '').trim()
                const valor = Number.isFinite(Number(item.valor)) ? Number(item.valor) : null
                if (!nome) return null
                const nomeExibicao = nomeAlternativo || item.nomeExibicao || nome
                const partes = [codigo || null, nomeExibicao || null]
                if (valor != null) {
                    partes.push(formatarValorConferencia(valor))
                }
                return {
                    nome,
                    codigo,
                    valor,
                    nomeAlternativo: nomeAlternativo || null,
                    nomeExibicao,
                    rotulo: item.rotulo || partes.filter(Boolean).join(' - '),
                }
            })
            .filter(Boolean)
            .sort((a, b) => {
                const ca = String(a.codigo || '')
                const cb = String(b.codigo || '')
                if (ca && cb) return ca.localeCompare(cb, 'pt-BR', { numeric: true })
                if (ca) return -1
                if (cb) return 1
                return String(a.nomeExibicao || a.nome).localeCompare(
                    String(b.nomeExibicao || b.nome),
                    'pt-BR',
                )
            })
    }, [itemFilaAtual, catalogoNegociacao])

    const examePlanoEscolhido = useMemo(() => {
        if (!escolhaEmerdog) return null
        const norm = normalizarNomeExame(escolhaEmerdog)
        return (
            opcoesCatalogoAlias.find((i) => normalizarNomeExame(i.nome) === norm) || {
                nome: escolhaEmerdog,
                codigo: '',
                valor: null,
                nomeAlternativo: null,
                nomeExibicao: escolhaEmerdog,
            }
        )
    }, [escolhaEmerdog, opcoesCatalogoAlias])

    const aliasesDoExameEscolhido = useMemo(() => {
        if (!escolhaEmerdog) return []
        const deResolvidos = listarAliasesDoExameAlvo(resolvidos, escolhaEmerdog)
        // Inclui o nome lab atual só se já estiver resolvido para este alvo
        return deResolvidos.filter(
            (a) => normalizarNomeExame(a) !== normalizarNomeExame(itemFilaAtual?.nomeLab),
        )
    }, [escolhaEmerdog, resolvidos, itemFilaAtual])

    const parseArquivo = async (file, mapeamentoManual, origem) => {
        const nome = String(file.name || '').toLowerCase()
        if (nome.endsWith('.xls') && !nome.endsWith('.xlsx')) {
            throw new Error('Arquivos .xls antigos não são suportados. Salve como .xlsx e envie de novo.')
        }
        const buffer = await file.arrayBuffer()
        return parsearExcelConferenciaViaWorker(buffer, { mapeamentoManual, origem })
    }

    const onEscolherArquivo = (tipo, file) => {
        if (!file) return
        const nome = String(file.name || '').toLowerCase()
        if (!nome.endsWith('.xlsx')) {
            setErro('Use um arquivo Excel .xlsx (formato atual).')
            return
        }
        setErro('')
        if (tipo === 'lab') setArquivoLab(file)
        else setArquivoEmerdog(file)
    }

    const iniciarConferencia = async () => {
        if (!podeEditar) {
            setErro('Sem permissão para iniciar conferência.')
            return
        }
        if (!laboratorioId) {
            setErro('Selecione o laboratório.')
            return
        }
        if (!periodoYm) {
            setErro('Informe o período (AAAA-MM).')
            return
        }
        if (!arquivoLab || !arquivoEmerdog) {
            setErro('Envie os dois relatórios antes de iniciar.')
            return
        }

        setProcessando(true)
        setErro('')
        setAviso('')
        setFeedback('')
        try {
            const labFresh = await parseArquivo(arquivoLab, mapColsLab, 'lab')
            const emFresh = await parseArquivo(arquivoEmerdog, mapColsEmerdog, 'emerdog')

            setHeadersLab(labFresh.headers || [])
            setHeadersEmerdog(emFresh.headers || [])

            const autoLab = mapearIndicesColunasConferencia(labFresh.headers || [], mapColsLab)
            const autoEm = mapearIndicesColunasConferencia(emFresh.headers || [], mapColsEmerdog)
            const nextLab = { ...mapColsLab }
            const nextEm = { ...mapColsEmerdog }
            for (const campo of CAMPOS_CONFERENCIA) {
                if (nextLab[campo] == null && autoLab.idx[campo] >= 0) nextLab[campo] = autoLab.idx[campo]
                if (nextEm[campo] == null && autoEm.idx[campo] >= 0) nextEm[campo] = autoEm.idx[campo]
            }
            if (nextLab.valor == null && autoLab.idx.valor >= 0) nextLab.valor = autoLab.idx.valor
            setMapColsLab(nextLab)
            setMapColsEmerdog(nextEm)

            const faltLab = camposFaltantesMapeamento(labFresh.idx)
            const faltEm = camposFaltantesMapeamento(emFresh.idx)
            if (labFresh.erro || emFresh.erro || faltLab.length || faltEm.length) {
                setPrecisaMapearCols(true)
                setErro(
                    labFresh.erro ||
                        emFresh.erro ||
                        'Ajuste o mapeamento das colunas obrigatórias.',
                )
                return
            }

            setPrecisaMapearCols(false)
            setParesManuais([])
            setMarcadosPosRelatorio(new Set())

            const {
                catalogo,
                precosPorNomeNorm: precos,
                codigoPorNomeNorm: codigos,
                nomeSistemaPorNorm: nomesSis,
                aviso: avisoPrecos,
            } = await carregarPrecosNegociacaoLaboratorio(laboratorioId)
            if (avisoPrecos) setAviso(avisoPrecos)
            setCatalogoNegociacao(catalogo || [])
            setPrecosPorNomeNorm(precos || new Map())
            setCodigoPorNomeNorm(codigos || new Map())
            setNomeSistemaPorNorm(nomesSis || new Map())

            const mapeamentos = await carregarMapeamentosLaboratorio(laboratorioId)
            const aliasesPessoaDb = await carregarAliasesPessoaLaboratorio(laboratorioId)
            setAliasesPessoa(aliasesPessoaDb)
            setMapeamentosSalvos(mapeamentos || [])

            // 1) Ordena data → tutor → pet e une atendimentos iguais
            // 2) Detecta exames sem correspondência para aliases
            // 3) Só depois (ao fim dos aliases) roda a comparação
            const preparado = prepararOrdenacaoEFilaAliases({
                linhasLab: labFresh.linhas,
                linhasEmerdog: emFresh.linhas,
                mapeamentosSalvos: mapeamentos,
                catalogoNegociacao: catalogo || [],
            })

            setLinhasLab(preparado.linhasLab)
            setLinhasEmerdog(preparado.linhasEmerdog)
            setResolvidos(preparado.resolvidos)
            setFilaMapeamento(preparado.fila)
            setIndiceFila(0)

            const msgOrg = `Atendimentos organizados: ${preparado.totalAtendimentosLab} lab · ${preparado.totalAtendimentosEm} plano (data → tutor → animal).`
            const packLista = montarListaAliasesExames({
                linhasLab: preparado.linhasLab,
                catalogoNegociacao: catalogo || [],
                mapeamentosSalvos: mapeamentos,
                resolvidos: preparado.resolvidos,
            })
            setFeedback(
                `${msgOrg} ${packLista.total} exame(s) no lab · ${packLista.pendentes} pendente(s)` +
                    (packLista.comValorDiff
                        ? ` · ${packLista.comValorDiff} com valor diferente.`
                        : '.'),
            )
            setPasso('mapeamento')
            setModoRevisaoAliases(false)
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setProcessando(false)
        }
    }

    const gerarComparacao = async (
        mapaResolvidos,
        labRows = linhasLab,
        emRows = linhasEmerdog,
        pares = paresManuais,
        {
            pularOrfaos = false,
            manterTutorFoco = false,
            manterFilaExames = false,
            aliasesPessoaOverride = null,
        } = {},
    ) => {
        setProcessando(true)
        setErro('')
        try {
            const {
                precosPorNomeNorm: precos,
                catalogo,
                codigoPorNomeNorm: codigos,
                nomeSistemaPorNorm: nomesSis,
                aviso: avisoPrecos,
            } = await carregarPrecosNegociacaoLaboratorio(laboratorioId)
            if (avisoPrecos) setAviso(avisoPrecos)
            setCatalogoNegociacao(catalogo || [])
            setPrecosPorNomeNorm(precos || new Map())
            setCodigoPorNomeNorm(codigos || new Map())
            setNomeSistemaPorNorm(nomesSis || new Map())

            // Garante ordenação data → tutor → pet antes de comparar
            const labSorted = ordenarLinhasPorAtendimento(labRows)
            const emSorted = ordenarLinhasPorAtendimento(emRows)
            setLinhasLab(labSorted)
            setLinhasEmerdog(emSorted)

            const mapasPessoa = montarMapasAliasesPessoa(
                aliasesPessoaOverride ?? aliasesPessoa,
            )

            const cardsGerados = montarCardsConferencia({
                linhasLab: labSorted,
                linhasEmerdog: emSorted,
                resolvidosMapeamento: mapaResolvidos,
                precosPorNomeNorm: precos,
                codigoPorNomeNorm: codigos || new Map(),
                nomeSistemaPorNorm: nomesSis || new Map(),
                paresManuais: pares,
                mapasAliasesPessoa: mapasPessoa,
            })

            const optsCombine = {
                precosPorNomeNorm: precos,
                codigoPorNomeNorm: codigos || new Map(),
                nomeSistemaPorNorm: nomesSis || new Map(),
                resolvidosMapeamento: mapaResolvidos,
                mapasAliasesPessoa: mapasPessoa,
            }
            const auto = autoAprovarPareamentosPerfeitos(cardsGerados, optsCombine)
            const paresComAuto = [...(pares || [])]
            for (const p of auto.paresAuto) {
                if (
                    paresComAuto.some(
                        (x) =>
                            String(x.idLabLocal) === String(p.idLabLocal) &&
                            String(x.idEmerdogLocal) === String(p.idEmerdogLocal),
                    )
                ) {
                    continue
                }
                paresComAuto.push(p)
            }
            if (auto.qtdAuto > 0) setParesManuais(paresComAuto)

            const cardsComId = auto.cards.map((c, i) => ({
                ...c,
                idLocal: c.idLocal || `${Date.now()}-${i}`,
            }))
            setCards(cardsComId)
            setMapaResolvidosAtual(mapaResolvidos)
            if (!manterFilaExames) setPagina(1)
            if (!manterFilaExames) setFiltroCards('diferencas')
            if (!manterTutorFoco && !manterFilaExames) {
                setTutorFoco(null)
            }

            const nOrfaos = cardsComId.filter(
                (c) => c.tipo === 'orfao_lab' || c.tipo === 'orfao_emerdog',
            ).length
            const nPareados = cardsComId.filter((c) => c.tipo === 'pareado').length
            const nDiff = cardsComId.filter((c) => c.valoresDiferem).length
            const msgAuto =
                auto.qtdAuto > 0
                    ? ` ${auto.qtdAuto} aprovado(s) automático(s) (100%).`
                    : ''

            if (manterFilaExames) {
                const fila = montarFilaExamesIndividuais(cardsComId, {
                    mapasAliasesPessoa: mapasPessoa,
                })
                setFilaOrfaos(fila.fila)
                setOrfaosDisponiveisEm(fila.orfaosEm)
                setPasso('orfaos')
                setFeedback(
                    `Exame pareado.${msgAuto} Restam ${fila.totalPendentes} pendente(s) · ${nPareados} pareado(s).`,
                )
            } else if (!pularOrfaos) {
                const fila = montarFilaPareamentoOrfaos(cardsComId, {
                    codigoPorNomeNorm: codigos || new Map(),
                    mapasAliasesPessoa: mapasPessoa,
                })
                if (fila.fila.length) {
                    setFilaOrfaos(fila.fila)
                    setOrfaosDisponiveisEm(fila.orfaosEm)
                    setGruposEmDisponiveis(fila.gruposEm || [])
                    setDecisoesOrfaos(new Map())
                    setEscolhasExames({})
                    setIndiceOrfao(0)
                    setEscolhaOrfaoEm(fila.fila[0]?.idEmSugerido || fila.fila[0]?.chaveEm || '')
                    setPasso('orfaos')
                    setFeedback(
                        `${fila.totalPendentes || fila.fila.length} exame(s) para revisão individual` +
                            (nOrfaos || nDiff
                                ? ` (${nOrfaos} órfão(s), ${nDiff} diff de valor). Pareados auto: ${nPareados}.`
                                : '.') +
                            msgAuto,
                    )
                } else {
                    setFilaOrfaos([])
                    setPasso('comparacao')
                    setFeedback(
                        `Conferência gerada: ${nPareados} pareado(s)` +
                            (nOrfaos ? `, ${nOrfaos} órfão(s)` : '') +
                            ' — sem fila de revisão.' +
                            msgAuto,
                    )
                }
            } else {
                setFilaOrfaos([])
                setPasso('comparacao')
                setFeedback(
                    `Conferência gerada: ${nPareados} pareado(s)` +
                        (nOrfaos ? `, ${nOrfaos} órfão(s) restante(s).` : '.') +
                        msgAuto,
                )
            }
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setProcessando(false)
        }
    }

    const confirmarMapeamentoAtual = async (aceitar) => {
        if (!itemFilaAtual) return
        if (!podeEditar) {
            setErro('Sem permissão para salvar mapeamento.')
            return
        }
        setProcessando(true)
        setErro('')
        try {
            if (aceitar) {
                if (!escolhaEmerdog) throw new Error('Escolha o exame correspondente da Emerdog.')
                await salvarMapeamentoExame({
                    laboratorioId,
                    nomeLab: itemFilaAtual.nomeLab,
                    nomeEmerdog: escolhaEmerdog,
                    status: 'confirmado',
                    userId,
                    valorLab: itemFilaAtual.valorLab,
                })
                setResolvidos((prev) => {
                    const next = new Map(prev)
                    next.set(
                        chaveAliasExame(itemFilaAtual.nomeLabNorm, itemFilaAtual.valorLab),
                        {
                            nomeLab: itemFilaAtual.nomeLab,
                            nomeEmerdog: escolhaEmerdog,
                            status: 'mapeado_manualmente_confirmado',
                            valorLab: itemFilaAtual.valorLab ?? null,
                        },
                    )
                    return next
                })
                setMapaResolvidosAtual((prev) => {
                    const next = new Map(prev.size ? prev : resolvidos)
                    next.set(
                        chaveAliasExame(itemFilaAtual.nomeLabNorm, itemFilaAtual.valorLab),
                        {
                            nomeLab: itemFilaAtual.nomeLab,
                            nomeEmerdog: escolhaEmerdog,
                            status: 'mapeado_manualmente_confirmado',
                            valorLab: itemFilaAtual.valorLab ?? null,
                        },
                    )
                    return next
                })
            } else {
                await salvarMapeamentoExame({
                    laboratorioId,
                    nomeLab: itemFilaAtual.nomeLab,
                    nomeEmerdog: null,
                    status: 'pendente_auditoria',
                    userId,
                    valorLab: itemFilaAtual.valorLab,
                })
                const chaveAud = chaveAliasExame(
                    itemFilaAtual.nomeLabNorm,
                    itemFilaAtual.valorLab,
                )
                setResolvidos((prev) => {
                    const next = new Map(prev)
                    next.set(chaveAud, {
                        nomeLab: itemFilaAtual.nomeLab,
                        nomeEmerdog: null,
                        status: 'pendente_auditoria',
                        valorLab: itemFilaAtual.valorLab ?? null,
                    })
                    return next
                })
                setMapaResolvidosAtual((prev) => {
                    const next = new Map(prev.size ? prev : resolvidos)
                    next.set(chaveAud, {
                        nomeLab: itemFilaAtual.nomeLab,
                        nomeEmerdog: null,
                        status: 'pendente_auditoria',
                        valorLab: itemFilaAtual.valorLab ?? null,
                    })
                    return next
                })
            }

            const proximo = indiceFila + 1
            if (proximo < filaMapeamento.length) {
                setIndiceFila(proximo)
            } else if (modoRevisaoAliases || cards.length > 0) {
                setFeedback(
                    'Aliases atualizados. Use «Recalcular conferência» para aplicar, ou volte à etapa desejada.',
                )
                setIndiceFila(Math.max(0, filaMapeamento.length - 1))
            } else {
                const mapaFinal = new Map(resolvidos)
                const chaveFinal = chaveAliasExame(
                    itemFilaAtual.nomeLabNorm,
                    itemFilaAtual.valorLab,
                )
                if (aceitar) {
                    mapaFinal.set(chaveFinal, {
                        nomeLab: itemFilaAtual.nomeLab,
                        nomeEmerdog: escolhaEmerdog,
                        status: 'mapeado_manualmente_confirmado',
                        valorLab: itemFilaAtual.valorLab ?? null,
                    })
                } else {
                    mapaFinal.set(chaveFinal, {
                        nomeLab: itemFilaAtual.nomeLab,
                        nomeEmerdog: null,
                        status: 'pendente_auditoria',
                        valorLab: itemFilaAtual.valorLab ?? null,
                    })
                }
                setMapaResolvidosAtual(mapaFinal)
                await gerarComparacao(mapaFinal)
            }
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setProcessando(false)
        }
    }

    const orfaosLab = useMemo(
        () => cards.filter((c) => c.tipo === 'orfao_lab'),
        [cards],
    )
    const orfaosEm = useMemo(
        () => cards.filter((c) => c.tipo === 'orfao_emerdog'),
        [cards],
    )

    const itemOrfaoAtual = filaOrfaos[indiceOrfao] || null

    useEffect(() => {
        if (!itemOrfaoAtual) {
            setEscolhaOrfaoEm('')
            return
        }
        const dec = decisoesOrfaos.get(itemOrfaoAtual.chaveLab)
        const chave =
            (dec?.chaveEm && String(dec.chaveEm)) ||
            itemOrfaoAtual.chaveEm ||
            itemOrfaoAtual.grupoEm?.chave ||
            itemOrfaoAtual.candidatos?.[0]?.chaveEm ||
            ''
        setEscolhaOrfaoEm(chave)
        // Só reage à troca do card; decisões são lidas no momento da troca
        // eslint-disable-next-line react-hooks/exhaustive-deps -- intencional
    }, [itemOrfaoAtual])

    const desfazerDecisaoOrfao = (item) => {
        if (!item?.grupoLab) return
        const idsLab = new Set((item.grupoLab.ids || []).map(String))
        if (!idsLab.size) return
        setParesManuais((prev) =>
            (prev || []).filter((p) => !idsLab.has(String(p.idLabLocal))),
        )
        setDecisoesOrfaos((prev) => {
            const next = new Map(prev)
            const antiga = next.get(item.chaveLab)
            if (antiga) {
                next.set(item.chaveLab, {
                    status: 'pendente',
                    chaveEm: antiga.chaveEm || '',
                })
            }
            return next
        })
    }

    const irParaCardOrfao = (novoIndice) => {
        if (!filaOrfaos.length) return
        const idx = Math.max(0, Math.min(novoIndice, filaOrfaos.length))
        if (idx < filaOrfaos.length) {
            desfazerDecisaoOrfao(filaOrfaos[idx])
        }
        setIndiceOrfao(idx)
        setErro('')
        if (idx < filaOrfaos.length) {
            const item = filaOrfaos[idx]
            const dec = decisoesOrfaos.get(item.chaveLab)
            setEscolhaOrfaoEm(dec?.chaveEm || item.chaveEm || '')
            setFeedback(
                dec?.status === 'aprovado' || dec?.status === 'rejeitado'
                    ? `Revisando card ${idx + 1} — decisão anterior desfeita até confirmar de novo.`
                    : `Card ${idx + 1} de ${filaOrfaos.length}.`,
            )
        } else {
            setEscolhaOrfaoEm('')
            setFeedback('Fila percorrida. Volte a um card ou vá para a comparação.')
        }
    }

    const voltarCardOrfao = () => {
        if (indiceOrfao <= 0) return
        irParaCardOrfao(indiceOrfao - 1)
    }

    const cardsFiltrados = useMemo(() => {
        let grupos = agruparCardsComparacaoPorAtendimento(cards)

        if (tutorFoco?.norm) {
            grupos = grupos.filter(
                (g) =>
                    nomeCorrespondeFoco(g.tutor, tutorFoco.norm, tutorFoco.label) &&
                    (!tutorFoco.petNorm ||
                        nomeCorrespondeFoco(g.pet, tutorFoco.petNorm, tutorFoco.petLabel)),
            )
            // Mais antigo → mais novo (data ASC); desempate pet
            return [...grupos].sort((a, b) => {
                const d = String(a.data || '').localeCompare(String(b.data || ''))
                if (d !== 0) return d
                return String(a.pet || '').localeCompare(String(b.pet || ''), 'pt-BR')
            })
        }

        if (filtroCards === 'pendentes') {
            grupos = grupos.filter((g) => g.status !== 'verde' && g.status !== 'conferido_manual')
        } else if (filtroCards === 'diferencas') {
            grupos = grupos.filter((g) => g.temOrfao || g.temDiff)
        } else if (filtroCards === 'verdes') {
            grupos = grupos.filter((g) => g.status === 'verde' || g.status === 'conferido_manual')
        } else if (filtroCards === 'orfaos') {
            grupos = grupos.filter((g) => g.temOrfao)
        } else if (filtroCards === 'pareados') {
            grupos = grupos.filter((g) => g.qtdPareados > 0 && !g.temOrfao)
        } else if (filtroCards === 'marcados') {
            grupos = grupos.filter((g) =>
                g.cardsExame.some((c) => marcadosPosRelatorio.has(chaveMarcacaoPosRelatorio(c))),
            )
        }

        const termo = normalizarTextoBusca(buscaComparacao)
        if (termo) {
            grupos = grupos.filter((g) => {
                const tutor = normalizarTextoBusca(g.tutor)
                const pet = normalizarTextoBusca(g.pet)
                return tutor.includes(termo) || pet.includes(termo)
            })
        }

        return grupos
    }, [cards, filtroCards, marcadosPosRelatorio, tutorFoco, buscaComparacao])

    const totalAtendimentos = useMemo(
        () => agruparCardsComparacaoPorAtendimento(cards).length,
        [cards],
    )

    const resumoTotais = useMemo(() => resumirTotaisConferencia(cards), [cards])

    const totalTutorFoco = tutorFoco ? cardsFiltrados.length : 0

    const linhasPosRelatorio = useMemo(
        () => montarLinhasPosRelatorio(cards, marcadosPosRelatorio),
        [cards, marcadosPosRelatorio],
    )

    const totalMarcados = linhasPosRelatorio.length

    // No foco do tutor, lista todos de uma vez (sem paginar)
    const porPagina = tutorFoco ? Math.max(cardsFiltrados.length, 1) : CARDS_POR_PAGINA
    const totalPaginas = Math.max(1, Math.ceil(cardsFiltrados.length / porPagina))
    const paginaSafe = Math.min(pagina, totalPaginas)
    const cardsPagina = useMemo(() => {
        const inicio = (paginaSafe - 1) * porPagina
        return cardsFiltrados.slice(inicio, inicio + porPagina)
    }, [cardsFiltrados, paginaSafe, porPagina])

    const totalComDiferenca = useMemo(() => {
        return agruparCardsComparacaoPorAtendimento(cards).filter(
            (g) => g.temOrfao || g.temDiff,
        ).length
    }, [cards])

    useEffect(() => {
        if (passo !== 'comparacao') return
        const el = comparacaoTopoRef.current
        if (el?.scrollIntoView) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        } else {
            window.scrollTo({ top: 0, behavior: 'smooth' })
        }
    }, [pagina, passo])

    const selecionarOrfaoMescla = (lado, id) => {
        if (!podeEditar || !id) return
        if (lado === 'lab') {
            setMesclaLabId((prev) => (String(prev) === String(id) ? null : id))
        } else {
            setMesclaEmId((prev) => (String(prev) === String(id) ? null : id))
        }
    }

    const limparSelecaoMescla = () => {
        setMesclaLabId(null)
        setMesclaEmId(null)
    }

    const mesclarOrfaosNaComparacao = () => {
        if (!podeEditar) {
            setErro('Sem permissão para mesclar exames.')
            return
        }
        if (!mesclaLabId || !mesclaEmId) {
            setErro('Selecione um exame órfão do laboratório e um do plano.')
            return
        }
        const labCard = cards.find(
            (c) =>
                c.tipo === 'orfao_lab' && String(c.idLabLocal) === String(mesclaLabId),
        )
        const emCard = cards.find(
            (c) =>
                c.tipo === 'orfao_emerdog' &&
                String(c.idEmerdogLocal) === String(mesclaEmId),
        )
        if (!labCard || !emCard) {
            setErro('Não foi possível localizar os exames selecionados.')
            limparSelecaoMescla()
            return
        }
        if (
            (paresManuais || []).some(
                (p) => String(p.idEmerdogLocal) === String(mesclaEmId),
            )
        ) {
            setErro('Este exame do plano já foi pareado.')
            return
        }

        try {
            let listaAliases = aliasesPessoa
            const novosAliases = aliasesPessoaDePareamento({
                tutorLab: labCard.tutor,
                tutorPlano: emCard.tutor,
                petLab: labCard.pet,
                petPlano: emCard.pet,
            })
            if (novosAliases.length) {
                listaAliases = mesclarAliasesPessoa(aliasesPessoa, novosAliases)
                setAliasesPessoa(listaAliases)
                if (laboratorioId) {
                    void salvarAliasesPessoaEmLote({
                        laboratorioId,
                        aliases: novosAliases,
                    })
                }
            }
            const mapasPessoa = montarMapasAliasesPessoa(listaAliases)
            const optsCombine = {
                precosPorNomeNorm,
                codigoPorNomeNorm,
                nomeSistemaPorNorm,
                resolvidosMapeamento: mapaResolvidosAtual.size
                    ? mapaResolvidosAtual
                    : resolvidos,
                mapasAliasesPessoa: mapasPessoa,
            }
            let cardsNovos = combinarOrfaosNosCards(
                cards,
                mesclaLabId,
                mesclaEmId,
                optsCombine,
            )
            const auto = autoAprovarPareamentosPerfeitos(cardsNovos, optsCombine)
            cardsNovos = auto.cards

            const novosPares = [
                ...(paresManuais || []).filter(
                    (p) => String(p.idLabLocal) !== String(mesclaLabId),
                ),
                { idLabLocal: mesclaLabId, idEmerdogLocal: mesclaEmId },
                ...auto.paresAuto.filter(
                    (p) =>
                        String(p.idLabLocal) !== String(mesclaLabId) ||
                        String(p.idEmerdogLocal) !== String(mesclaEmId),
                ),
            ]
            // dedupe
            const vistos = new Set()
            const paresUnicos = []
            for (const p of novosPares) {
                const k = `${p.idLabLocal}|${p.idEmerdogLocal}`
                if (vistos.has(k)) continue
                vistos.add(k)
                paresUnicos.push(p)
            }
            setParesManuais(paresUnicos)
            setCards(cardsNovos)
            limparSelecaoMescla()
            setErro('')
            setFeedback(
                auto.qtdAuto > 0
                    ? `Exames mesclados. +${auto.qtdAuto} auto (100%).`
                    : 'Exames mesclados na comparação.',
            )
        } catch (e) {
            setErro(e?.message || String(e))
        }
    }

    const mostrarTodosDoTutor = (tutor, pet = '') => {
        const label = String(tutor || '').trim() || '—'
        const petLabel = String(pet || '').trim()
        const norm = normalizarTextoBusca(label)
        const petNorm = normalizarTextoBusca(petLabel)
        if (!norm) return

        const bateTutorPet = (g) =>
            nomeCorrespondeFoco(g.tutor, norm, label) &&
            (!petNorm || nomeCorrespondeFoco(g.pet, petNorm, petLabel))

        const gruposRel = [
            ...agruparLinhasPorAtendimento(linhasLab),
            ...agruparLinhasPorAtendimento(linhasEmerdogEnriquecidas),
        ].filter(bateTutorPet)

        const nomesTutor = [
            ...new Set(gruposRel.map((g) => String(g.tutor || '').trim()).filter(Boolean)),
        ].sort((a, b) => b.length - a.length)
        const nomesPet = [
            ...new Set(gruposRel.map((g) => String(g.pet || '').trim()).filter(Boolean)),
        ].sort((a, b) => b.length - a.length)

        const labelExib = nomesTutor[0] || label
        const petExib = nomesPet[0] || petLabel

        // Não muda a página da comparação — só abre o painel do tutor/pet
        if (passo === 'comparacao') {
            paginaAntesTutorFocoRef.current = pagina
        }
        setTutorFoco({
            norm: normalizarTextoBusca(labelExib) || norm,
            label: labelExib,
            petNorm: normalizarTextoBusca(petExib) || petNorm,
            petLabel: petExib,
        })
        setFeedback(
            petExib
                ? `Atendimentos de «${labelExib}» · «${petExib}» (lab + plano) — mais antigo → mais novo.`
                : `Atendimentos do tutor «${labelExib}» (lab + plano) — mais antigo → mais novo.`,
        )
    }

    const limparTutorFoco = () => {
        setTutorFoco(null)
        if (passo === 'comparacao') {
            setPagina(paginaAntesTutorFocoRef.current || 1)
        }
    }

    const toggleMarcadoPosRelatorio = (card) => {
        toggleMarcadoPorChave(chaveMarcacaoPosRelatorio(card))
    }

    const toggleMarcadoPorChave = (chave) => {
        if (!chave) return
        setMarcadosPosRelatorio((prev) => {
            const next = new Set(prev)
            if (next.has(chave)) next.delete(chave)
            else next.add(chave)
            return next
        })
    }

    const cardEstaMarcado = (card) => marcadosPosRelatorio.has(chaveMarcacaoPosRelatorio(card))
    const chaveEstaMarcada = (chave) => Boolean(chave) && marcadosPosRelatorio.has(chave)

    const baixarPosRelatorio = async () => {
        if (!linhasPosRelatorio.length) {
            setErro('Nenhum exame marcado para o pós-relatório.')
            return
        }
        setProcessando(true)
        setErro('')
        try {
            const { total } = await exportarPosRelatorioConferenciaExcel(linhasPosRelatorio, {
                laboratorioNome: labNome,
                periodoYm,
            })
            setFeedback(`Pós-relatório exportado com ${total} exame(s).`)
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setProcessando(false)
        }
    }

    const avancarFilaOrfaos = (proximoIndice) => {
        if (proximoIndice < filaOrfaos.length) {
            setIndiceOrfao(proximoIndice)
            const next = filaOrfaos[proximoIndice]
            const dec = decisoesOrfaos.get(next?.chaveLab)
            setEscolhaOrfaoEm(dec?.chaveEm || next?.chaveEm || '')
            return
        }
        // Não força comparação: permite voltar aos cards já decididos
        setIndiceOrfao(filaOrfaos.length)
        setEscolhaOrfaoEm('')
        setFeedback('Fila de órfãos concluída. Volte a um card ou vá para a comparação.')
    }

    const aprovarExameIndividual = (item, idEmEscolhido) => {
        if (!podeEditar) {
            setErro('Sem permissão para parear exames.')
            return
        }
        if (!item) return

        if (item.tipo === 'diff_valor') {
            setDecisoesOrfaos((prev) => {
                const next = new Map(prev)
                next.set(item.idItem, {
                    status: 'aprovado',
                    idEm: item.idEmerdogLocal,
                })
                return next
            })
            setCards((prev) =>
                prev.map((c) =>
                    c.idLabLocal === item.idLabLocal && c.idEmerdogLocal === item.idEmerdogLocal
                        ? { ...c, status: 'conferido_manual', valoresDiferem: false }
                        : c,
                ),
            )
            setFeedback('Par com diff aceito.')
            setErro('')
            return
        }

        const idEm = idEmEscolhido || escolhasExames[item.idItem] || item.idEmSugerido
        if (!idEm || !item.idLabLocal) {
            setErro('Selecione o exame do plano para parear.')
            return
        }

        const candEscolhido =
            (item.candidatos || []).find((c) => String(c.idLocal) === String(idEm)) ||
            null
        const cardPlano = candEscolhido?.card || null
        const novosAliases = aliasesPessoaDePareamento({
            tutorLab: item.tutor || item.cardLab?.tutor,
            tutorPlano: cardPlano?.tutor,
            petLab: item.pet || item.cardLab?.pet,
            petPlano: cardPlano?.pet,
        })
        let listaAliases = aliasesPessoa
        if (novosAliases.length) {
            listaAliases = mesclarAliasesPessoa(aliasesPessoa, novosAliases)
            setAliasesPessoa(listaAliases)
            if (laboratorioId) {
                void salvarAliasesPessoaEmLote({
                    laboratorioId,
                    aliases: novosAliases,
                })
            }
        }
        const mapasPessoa = montarMapasAliasesPessoa(listaAliases)

        const idsLab = new Set([String(item.idLabLocal)])
        const paresSemEste = (paresManuais || []).filter(
            (p) => !idsLab.has(String(p.idLabLocal)),
        )
        if (paresSemEste.some((p) => String(p.idEmerdogLocal) === String(idEm))) {
            setErro('Este exame do plano já foi pareado com outro do laboratório.')
            return
        }

        // 1) Esconde o item na hora (antes de qualquer remount)
        setDecisoesOrfaos((prev) => {
            const next = new Map(prev)
            next.set(item.idItem, { status: 'aprovado', idEm })
            next.set(`em:${idEm}`, { status: 'aprovado', idEm })
            return next
        })
        // Mantém flag do pós-relatório ao virar par
        setMarcadosPosRelatorio((prev) => {
            const next = new Set(prev)
            const chavePar = `par:${item.idLabLocal}|${idEm}`
            const chaveLab = `lab:${item.idLabLocal}`
            const chaveEm = `em:${idEm}`
            if (next.has(chaveLab) || next.has(chaveEm) || next.has(chavePar)) {
                next.add(chavePar)
                next.delete(chaveLab)
                next.delete(chaveEm)
            }
            return next
        })
        setErro('')
        const msgAlias =
            novosAliases.length > 0
                ? ` Alias: ${novosAliases
                      .map((a) =>
                          a.tipo === 'pet'
                              ? `animal «${a.nomePlano}»→«${a.nomeLab}»`
                              : `tutor «${a.nomePlano}»→«${a.nomeLab}»`,
                      )
                      .join('; ')}.`
                : ''
        setFeedback(`Exame aprovado e pareado.${msgAlias}`)

        const novosPares = [
            ...paresSemEste,
            { idLabLocal: item.idLabLocal, idEmerdogLocal: idEm },
        ]
        setParesManuais(novosPares)

        // 2) Atualiza cards + fila em memória (sem rede / sem gerarComparacao)
        try {
            const optsCombine = {
                precosPorNomeNorm,
                codigoPorNomeNorm,
                nomeSistemaPorNorm,
                resolvidosMapeamento: mapaResolvidosAtual.size
                    ? mapaResolvidosAtual
                    : resolvidos,
                mapasAliasesPessoa: mapasPessoa,
            }
            let cardsNovos = combinarOrfaosNosCards(
                cards,
                item.idLabLocal,
                idEm,
                optsCombine,
            )
            // Após alias, outros exames 100% iguais saem da fila sozinhos
            const auto = autoAprovarPareamentosPerfeitos(cardsNovos, optsCombine)
            cardsNovos = auto.cards
            if (auto.qtdAuto > 0) {
                const extra = auto.paresAuto.filter(
                    (p) =>
                        !novosPares.some(
                            (x) =>
                                String(x.idLabLocal) === String(p.idLabLocal) &&
                                String(x.idEmerdogLocal) === String(p.idEmerdogLocal),
                        ),
                )
                if (extra.length) setParesManuais([...novosPares, ...extra])
            }
            setCards(cardsNovos)
            const fila = montarFilaExamesIndividuais(cardsNovos, {
                mapasAliasesPessoa: mapasPessoa,
            })
            setFilaOrfaos(fila.fila)
            setOrfaosDisponiveisEm(fila.orfaosEm || [])
            const msgAuto =
                auto.qtdAuto > 0
                    ? ` +${auto.qtdAuto} auto (100%).`
                    : ''
            setFeedback(
                `Exame aprovado. Restam ${fila.totalPendentes} pendente(s).${msgAlias}${msgAuto}`,
            )
        } catch (e) {
            // Fallback: só marca decisão; cards serão coerentes na próxima comparação
            setErro('')
            setFeedback(
                e?.message
                    ? `Pareado na fila (atualização local parcial: ${e.message}).`
                    : `Exame aprovado e pareado.${msgAlias}`,
            )
        }
    }

    const rejeitarExameIndividual = (item) => {
        if (!item) return
        setDecisoesOrfaos((prev) => {
            const next = new Map(prev)
            next.set(item.idItem, {
                status: 'rejeitado',
                idEm: escolhasExames[item.idItem] || item.idEmSugerido || '',
            })
            return next
        })
        if (item.idLabLocal) {
            setParesManuais((prev) =>
                (prev || []).filter((p) => String(p.idLabLocal) !== String(item.idLabLocal)),
            )
        }
        setFeedback(
            item.tipo === 'diff_valor'
                ? 'Diff mantido para pós-relatório.'
                : 'Exame mantido como órfão.',
        )
        setErro('')
    }

    const confirmarPareamentoOrfao = () => {
        if (itemOrfaoAtual?.idItem) {
            aprovarExameIndividual(
                itemOrfaoAtual,
                escolhasExames[itemOrfaoAtual.idItem] || itemOrfaoAtual.idEmSugerido,
            )
        }
    }

    const rejeitarPareamentoOrfao = () => {
        if (itemOrfaoAtual) rejeitarExameIndividual(itemOrfaoAtual)
    }

    const concluirOrfaos = () => {
        setTutorFoco(null)
        void gerarComparacao(mapaResolvidosAtual, linhasLab, linhasEmerdog, paresManuais, {
            pularOrfaos: true,
        })
    }

    const voltarParaOrfaos = () => {
        const mapasPessoa = montarMapasAliasesPessoa(aliasesPessoa)
        const optsCombine = {
            precosPorNomeNorm,
            codigoPorNomeNorm,
            nomeSistemaPorNorm,
            resolvidosMapeamento: mapaResolvidosAtual.size
                ? mapaResolvidosAtual
                : resolvidos,
            mapasAliasesPessoa: mapasPessoa,
        }
        const auto = autoAprovarPareamentosPerfeitos(cards, optsCombine)
        const cardsBase = auto.cards
        if (auto.qtdAuto > 0) {
            setCards(cardsBase)
            setParesManuais((prev) => {
                const next = [...(prev || [])]
                for (const p of auto.paresAuto) {
                    if (
                        next.some(
                            (x) =>
                                String(x.idLabLocal) === String(p.idLabLocal) &&
                                String(x.idEmerdogLocal) === String(p.idEmerdogLocal),
                        )
                    ) {
                        continue
                    }
                    next.push(p)
                }
                return next
            })
        }
        const fila = montarFilaExamesIndividuais(cardsBase, {
            mapasAliasesPessoa: mapasPessoa,
        })
        if (!fila.fila.length) {
            setFilaOrfaos([])
            setFeedback(
                auto.qtdAuto > 0
                    ? `${auto.qtdAuto} exame(s) 100% aprovado(s) automaticamente. Nada pendente.`
                    : 'Não há exames pendentes para revisar.',
            )
            if (auto.qtdAuto > 0) setPasso('comparacao')
            return
        }
        setFilaOrfaos(fila.fila)
        setOrfaosDisponiveisEm(fila.orfaosEm)
        setGruposEmDisponiveis([])
        setDecisoesOrfaos(new Map())
        setEscolhasExames({})
        setIndiceOrfao(0)
        setPasso('orfaos')
        if (auto.qtdAuto > 0) {
            setFeedback(
                `${auto.qtdAuto} aprovado(s) automático(s). ${fila.totalPendentes} restante(s).`,
            )
        }
    }

    const marcarCardConferido = (card) => {
        if (!podeEditar) {
            setErro('Sem permissão para auditar.')
            return
        }
        const obs = obsAuditoria[card.idLocal] || ''
        setCards((prev) =>
            prev.map((c) =>
                c.idLocal === card.idLocal || c.chave === card.chave
                    ? {
                          ...c,
                          status: 'conferido_manual',
                          observacaoAuditoria: obs,
                      }
                    : c,
            ),
        )
        setFeedback('Card marcado como conferido manualmente.')
    }

    const abrirNormalizacao = (card) => {
        setNormalizarCardId(card.idLocal)
        setBuscaCatalogo('')
        setEscolhaCatalogo('')
        setErro('')
    }

    const salvarNormalizacaoNegociacao = async (card) => {
        if (!podeEditar) {
            setErro('Sem permissão para normalizar exame.')
            return
        }
        const nomeOrigem = String(card.exameParaNormalizar || card.exameEmerdog || card.exameLaboratorio || '').trim()
        const nomeCatalogo = String(escolhaCatalogo || '').trim()
        if (!nomeOrigem) {
            setErro('Não há exame para normalizar neste card.')
            return
        }
        if (!nomeCatalogo) {
            setErro('Selecione o procedimento na tabela de negociação do laboratório.')
            return
        }

        setProcessando(true)
        setErro('')
        try {
            await salvarMapeamentoExame({
                laboratorioId,
                nomeLab: nomeOrigem,
                nomeEmerdog: nomeCatalogo,
                status: 'confirmado',
                userId,
                valorLab: card.valorLaboratorio ?? card.valorLab ?? null,
            })

            const nextMapa = new Map(mapaResolvidosAtual.size ? mapaResolvidosAtual : resolvidos)
            const valorCard = arredondarValorLab(
                card.valorLaboratorio ?? card.valorLab ?? null,
            )
            const chave = chaveAliasExame(normalizarNomeExame(nomeOrigem), valorCard)
            nextMapa.set(chave, {
                nomeLab: nomeOrigem,
                nomeEmerdog: nomeCatalogo,
                status: 'mapeado_manualmente_confirmado',
                valorLab: valorCard,
            })
            if (card.exameLaboratorio && card.exameLaboratorio !== nomeOrigem) {
                nextMapa.set(
                    chaveAliasExame(normalizarNomeExame(card.exameLaboratorio), valorCard),
                    {
                        nomeLab: card.exameLaboratorio,
                        nomeEmerdog: nomeCatalogo,
                        status: 'mapeado_manualmente_confirmado',
                        valorLab: valorCard,
                    },
                )
            }

            setResolvidos(nextMapa)
            setMapaResolvidosAtual(nextMapa)
            setNormalizarCardId('')
            setEscolhaCatalogo('')
            setBuscaCatalogo('')
            setFeedback(`Exame «${nomeOrigem}» vinculado a «${nomeCatalogo}» na negociação.`)

            await gerarComparacao(nextMapa, linhasLab, linhasEmerdog, paresManuais, {
                pularOrfaos: true,
            })
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setProcessando(false)
        }
    }

    const reiniciar = () => {
        setPasso('setup')
        setArquivoLab(null)
        setArquivoEmerdog(null)
        setLinhasLab([])
        setLinhasEmerdog([])
        setFilaMapeamento([])
        setIndiceFila(0)
        setResolvidos(new Map())
        setMapeamentosSalvos([])
        setMapaResolvidosAtual(new Map())
        setAliasesPessoa([])
        setCards([])
        setParesManuais([])
        setFilaOrfaos([])
        setIndiceOrfao(0)
        setEscolhaOrfaoEm('')
        setDecisoesOrfaos(new Map())
        setEscolhasExames({})
        setOrfaosDisponiveisEm([])
        setGruposEmDisponiveis([])
        setCatalogoNegociacao([])
        setPrecosPorNomeNorm(new Map())
        setCodigoPorNomeNorm(new Map())
        setNomeSistemaPorNorm(new Map())
        setNormalizarCardId('')
        setEscolhaCatalogo('')
        setBuscaCatalogo('')
        setMarcadosPosRelatorio(new Set())
        setTutorFoco(null)
        setMesclaLabId(null)
        setMesclaEmId(null)
        setBuscaComparacao('')
        setPagina(1)
        setFiltroCards('diferencas')
        setModoRevisaoAliases(false)
        setFeedback('')
        setAviso('')
        setErro('')
        setPrecisaMapearCols(false)
        setSessaoSalvaMeta(null)
    }

    const valorLabPorNomeNorm = useCallback(
        (nomeOuNorm) => {
            const norm = normalizarNomeExame(nomeOuNorm)
            if (!norm) return null
            for (const l of linhasLab || []) {
                if ((l.exameNorm || normalizarNomeExame(l.exame)) === norm) {
                    const v = Number(l.valorRelatorio)
                    return Number.isFinite(v) ? v : null
                }
            }
            return null
        },
        [linhasLab],
    )

    const montarFilaRevisaoAliases = useCallback(() => {
        const mapa = new Map([
            ...(resolvidos || new Map()),
            ...(mapaResolvidosAtual || new Map()),
        ])
        const nomesEm = listarNomesExameUnicos(linhasEmerdog).map((n) => n.nome)
        const vistos = new Set()
        const fila = []

        for (const [chave, info] of mapa) {
            if (!chave || vistos.has(chave)) continue
            vistos.add(chave)
            const nomeLabNorm =
                info?.nomeLabNorm ||
                (String(chave).includes('|') ? String(chave).split('|')[0] : chave)
            const nomeLab = info?.nomeLab || nomeLabNorm
            const valorLab =
                info?.valorLab != null
                    ? info.valorLab
                    : String(chave).includes('|')
                      ? Number(String(chave).split('|')[1])
                      : valorLabPorNomeNorm(nomeLab)
            fila.push({
                nomeLab,
                nomeLabNorm,
                valorLab: Number.isFinite(Number(valorLab)) ? Number(valorLab) : null,
                chave,
                nomesEmerdog: nomesEm,
                sugestoes: info?.nomeEmerdog ? [info.nomeEmerdog] : [],
                atendimentosSemPar: 0,
                statusPrevio: info?.status || '',
                revisao: true,
            })
        }

        // Pendentes ainda na fila original
        for (const item of filaMapeamento || []) {
            const chave =
                item.chave ||
                chaveAliasExame(
                    item.nomeLabNorm || normalizarNomeExame(item.nomeLab),
                    item.valorLab,
                )
            if (!chave || vistos.has(chave)) continue
            vistos.add(chave)
            fila.push({ ...item, chave, revisao: true })
        }

        fila.sort((a, b) =>
            String(a.nomeLab || '').localeCompare(String(b.nomeLab || ''), 'pt-BR'),
        )
        return fila
    }, [
        resolvidos,
        mapaResolvidosAtual,
        linhasEmerdog,
        filaMapeamento,
        valorLabPorNomeNorm,
    ])

    const etapasConferencia = useMemo(
        () => [
            { id: 'setup', label: '1. Setup', liberada: true },
            {
                id: 'mapeamento',
                label: '2. Aliases',
                liberada: Boolean(linhasLab.length && linhasEmerdog.length),
            },
            {
                id: 'orfaos',
                label: '3. Exames',
                liberada: Boolean(cards.length || filaOrfaos.length),
            },
            {
                id: 'comparacao',
                label: '4. Comparação',
                liberada: Boolean(cards.length),
            },
            {
                id: 'pos-relatorio',
                label: '5. Pós-relatório',
                liberada: Boolean(cards.length),
            },
        ],
        [linhasLab.length, linhasEmerdog.length, cards.length, filaOrfaos.length],
    )

    const irParaEtapa = (id) => {
        const etapa = etapasConferencia.find((e) => e.id === id)
        if (!etapa?.liberada || id === passo) return

        if (id === 'mapeamento') {
            setModoRevisaoAliases(cards.length > 0)
            setTutorFoco(null)
            setPasso('mapeamento')
            return
        }

        if (id === 'orfaos') {
            if (!filaOrfaos.length && cards.length) {
                const fila = montarFilaPareamentoOrfaos(cards, { codigoPorNomeNorm })
                setFilaOrfaos(fila.fila)
                setOrfaosDisponiveisEm(fila.orfaosEm)
                setGruposEmDisponiveis(fila.gruposEm || [])
                setDecisoesOrfaos(new Map())
                setIndiceOrfao(0)
                setEscolhaOrfaoEm(fila.fila[0]?.chaveEm || '')
                if (!fila.fila.length) {
                    setFeedback('Nenhum atendimento com discrepância para revisar.')
                    setPasso('comparacao')
                    return
                }
            }
            setTutorFoco(null)
            setPasso('orfaos')
            return
        }

        setTutorFoco(null)
        setPasso(id)
    }

    const voltarAliasAnterior = () => {
        if (indiceFila <= 0) return
        const prevIdx = indiceFila - 1
        setIndiceFila(prevIdx)
        const item = filaMapeamento[prevIdx]
        const prev =
            resolvidos.get(item?.nomeLabNorm) || mapaResolvidosAtual.get(item?.nomeLabNorm)
        setEscolhaEmerdog(prev?.nomeEmerdog || item?.sugestoes?.[0] || '')
    }

    const recalcularAposAliases = () => {
        const mapa = new Map([
            ...(resolvidos || new Map()),
            ...(mapaResolvidosAtual || new Map()),
        ])
        setMapaResolvidosAtual(mapa)
        void gerarComparacao(mapa, linhasLab, linhasEmerdog, paresManuais, {
            pularOrfaos: false,
        })
    }

    const aplicarVinculoAlias = async (itens, nomeEmerdog) => {
        if (!podeEditar) {
            setErro('Sem permissão para salvar mapeamento.')
            return
        }
        const alvo = String(nomeEmerdog || '').trim()
        const rows = (itens || []).filter((r) => r?.nomeLab && r?.nomeLabNorm)
        if (!alvo || !rows.length) {
            setErro('Selecione o exame da negociação e ao menos um do laboratório.')
            return
        }
        setProcessando(true)
        setErro('')
        try {
            for (const row of rows) {
                await salvarMapeamentoExame({
                    laboratorioId,
                    nomeLab: row.nomeLab,
                    nomeEmerdog: alvo,
                    status: 'confirmado',
                    userId,
                    valorLab: row.valorLab,
                })
            }
            const patch = (prev) => {
                const next = new Map(prev.size ? prev : resolvidos)
                for (const row of rows) {
                    const chave =
                        row.chave || chaveAliasExame(row.nomeLabNorm, row.valorLab)
                    next.set(chave, {
                        nomeLab: row.nomeLab,
                        nomeEmerdog: alvo,
                        status: 'mapeado_manualmente_confirmado',
                        valorLab: row.valorLab ?? null,
                    })
                }
                return next
            }
            setResolvidos(patch)
            setMapaResolvidosAtual(patch)
            setMapeamentosSalvos((prev) => {
                const out = [...(prev || [])]
                for (const row of rows) {
                    const valorPersist = arredondarValorLab(row.valorLab)
                    const idx = out.findIndex((m) => {
                        if (String(m.nome_lab_normalizado) !== String(row.nomeLabNorm))
                            return false
                        return valorLabDeMapeamentoSalvo(m) === valorPersist
                    })
                    const entry = {
                        laboratorio_id: Number(laboratorioId),
                        nome_lab: row.nomeLab,
                        nome_lab_normalizado: row.nomeLabNorm,
                        valor_lab:
                            valorPersist == null ? -1 : valorPersist,
                        nome_emerdog: alvo,
                        nome_emerdog_normalizado: normalizarNomeExame(alvo),
                        status: 'confirmado',
                    }
                    if (idx >= 0) out[idx] = { ...out[idx], ...entry }
                    else out.push(entry)
                }
                return out
            })
            setFeedback(
                rows.length === 1
                    ? `Alias salvo: «${rows[0].nomeLab}»${
                          rows[0].valorLab != null
                              ? ` (${formatarValorConferencia(rows[0].valorLab)})`
                              : ''
                      } → «${alvo}».`
                    : `${rows.length} aliases vinculados a «${alvo}».`,
            )
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setProcessando(false)
        }
    }

    const auditarAliasLinha = async (row) => {
        if (!row?.nomeLab) return
        if (!podeEditar) {
            setErro('Sem permissão para salvar mapeamento.')
            return
        }
        setProcessando(true)
        setErro('')
        try {
            await salvarMapeamentoExame({
                laboratorioId,
                nomeLab: row.nomeLab,
                nomeEmerdog: null,
                status: 'pendente_auditoria',
                userId,
                valorLab: row.valorLab,
            })
            const patch = (prev) => {
                const next = new Map(prev.size ? prev : resolvidos)
                const chave = row.chave || chaveAliasExame(row.nomeLabNorm, row.valorLab)
                next.set(chave, {
                    nomeLab: row.nomeLab,
                    nomeEmerdog: null,
                    status: 'pendente_auditoria',
                    valorLab: row.valorLab ?? null,
                })
                return next
            }
            setResolvidos(patch)
            setMapaResolvidosAtual(patch)
            setFeedback(
                `«${row.nomeLab}»${
                    row.valorLab != null
                        ? ` (${formatarValorConferencia(row.valorLab)})`
                        : ''
                } marcado para auditoria.`,
            )
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setProcessando(false)
        }
    }

    const continuarAposAliases = () => {
        const mapa = new Map([
            ...(resolvidos || new Map()),
            ...(mapaResolvidosAtual || new Map()),
        ])
        setMapaResolvidosAtual(mapa)
        if (modoRevisaoAliases || cards.length > 0) {
            void gerarComparacao(mapa, linhasLab, linhasEmerdog, paresManuais, {
                pularOrfaos: false,
            })
        } else {
            void gerarComparacao(mapa, linhasLab, linhasEmerdog, [], {
                pularOrfaos: false,
                aliasesPessoaOverride: aliasesPessoa,
            })
        }
    }

    const podeIniciar = Boolean(laboratorioId && periodoYm && arquivoLab && arquivoEmerdog && !processando)
    const progressoOrfaos =
        filaOrfaos.length > 0
            ? Math.round(
                  ([...decisoesOrfaos.values()].filter(
                      (d) => d.status === 'aprovado' || d.status === 'rejeitado',
                  ).length /
                      filaOrfaos.length) *
                      100,
              )
            : 100

    const indicesOrfaosDoTutor = useMemo(() => {
        if (!tutorFoco?.norm || passo !== 'orfaos') return []
        return filaOrfaos
            .map((item, i) => ({ item, i }))
            .filter(({ item }) => {
                const g = item.grupoLab
                if (!nomeCorrespondeFoco(g?.tutor, tutorFoco.norm, tutorFoco.label)) return false
                if (
                    tutorFoco.petNorm &&
                    !nomeCorrespondeFoco(g?.pet, tutorFoco.petNorm, tutorFoco.petLabel)
                ) {
                    return false
                }
                return true
            })
            .sort((a, b) => {
                const d = String(a.item.grupoLab?.data || '').localeCompare(
                    String(b.item.grupoLab?.data || ''),
                )
                if (d !== 0) return d
                return String(a.item.grupoLab?.pet || '').localeCompare(
                    String(b.item.grupoLab?.pet || ''),
                    'pt-BR',
                )
            })
    }, [tutorFoco, filaOrfaos, passo])

    const mapaAliasesAtivo = useMemo(() => {
        return mapaResolvidosAtual.size > 0 ? mapaResolvidosAtual : resolvidos
    }, [mapaResolvidosAtual, resolvidos])

    const packAliases = useMemo(
        () =>
            montarListaAliasesExames({
                linhasLab,
                catalogoNegociacao,
                mapeamentosSalvos,
                resolvidos: mapaAliasesAtivo,
            }),
        [linhasLab, catalogoNegociacao, mapeamentosSalvos, mapaAliasesAtivo],
    )
    const progressoMap = packAliases.progressoPct

    const mapasAliasesPessoa = useMemo(
        () => montarMapasAliasesPessoa(aliasesPessoa),
        [aliasesPessoa],
    )

    /** Linhas do plano com preço de negociacoes_vet (mesma base do «Todos do tutor»). */
    const linhasEmerdogEnriquecidas = useMemo(() => {
        return (linhasEmerdog || []).map((l) =>
            enriquecerLinhaEmerdog(
                l,
                precosPorNomeNorm,
                mapaAliasesAtivo,
                nomeSistemaPorNorm,
            ),
        )
    }, [linhasEmerdog, precosPorNomeNorm, mapaAliasesAtivo, nomeSistemaPorNorm])

    /** Todos os atendimentos do tutor (lab + plano) a partir das planilhas. */
    const atendimentosTutorAmbosLados = useMemo(() => {
        if (!tutorFoco?.norm || passo !== 'orfaos') {
            return { lab: [], plano: [] }
        }
        const ordenar = (lista) =>
            [...lista].sort((a, b) => {
                const d = String(a.data || '').localeCompare(String(b.data || ''))
                if (d !== 0) return d
                return String(a.pet || '').localeCompare(String(b.pet || ''), 'pt-BR')
            })

        const bateFoco = (g) =>
            nomeCorrespondeFoco(g.tutor, tutorFoco.norm, tutorFoco.label) &&
            (!tutorFoco.petNorm ||
                nomeCorrespondeFoco(g.pet, tutorFoco.petNorm, tutorFoco.petLabel))

        const lab = ordenar(agruparLinhasPorAtendimento(linhasLab).filter(bateFoco))
        const plano = ordenar(
            agruparLinhasPorAtendimento(linhasEmerdogEnriquecidas).filter(bateFoco),
        )
        return { lab, plano }
    }, [tutorFoco, passo, linhasLab, linhasEmerdogEnriquecidas])

    /** Pares Lab | Plano (mais antigo → mais novo), um versus por linha. */
    const paresTutorVersus = useMemo(() => {
        const labs = atendimentosTutorAmbosLados.lab
        const planos = atendimentosTutorAmbosLados.plano
        if (!labs.length && !planos.length) return []

        const usadosEm = new Set()
        const pares = []

        const scorePar = (lab, em) => {
            const petOk =
                normalizarTextoBusca(lab.pet) === normalizarTextoBusca(em.pet) ? 1000 : 0
            const da = String(lab.data || '')
            const db = String(em.data || '')
            if (da && db && da === db) return petOk + 500
            if (da && db) {
                const ta = Date.parse(da)
                const tb = Date.parse(db)
                if (Number.isFinite(ta) && Number.isFinite(tb)) {
                    const dias = Math.abs(ta - tb) / 86400000
                    return petOk + Math.max(0, 200 - dias * 10)
                }
            }
            return petOk
        }

        for (const lab of labs) {
            let melhor = null
            let melhorScore = -1
            for (const em of planos) {
                if (usadosEm.has(em.chave)) continue
                const s = scorePar(lab, em)
                if (s > melhorScore) {
                    melhorScore = s
                    melhor = em
                }
            }
            if (melhor) {
                usadosEm.add(melhor.chave)
                pares.push({ lab, plano: melhor })
            } else {
                pares.push({ lab, plano: null })
            }
        }
        for (const em of planos) {
            if (!usadosEm.has(em.chave)) pares.push({ lab: null, plano: em })
        }
        return pares
    }, [atendimentosTutorAmbosLados])

    const qtdExamesPlanoPorChave = useMemo(() => {
        const map = new Map()
        for (const g of agruparLinhasPorAtendimento(linhasEmerdog)) {
            map.set(g.chave, g.linhas?.length || 0)
        }
        return map
    }, [linhasEmerdog])

    const qtdExamesLabPorChave = useMemo(() => {
        const map = new Map()
        for (const g of agruparLinhasPorAtendimento(linhasLab)) {
            map.set(g.chave, g.linhas?.length || 0)
        }
        return map
    }, [linhasLab])

    const labNome = laboratorios.find((l) => String(l.id) === String(laboratorioId))?.nome || ''

    const idsEmJaPareados = useMemo(
        () => new Set(paresManuais.map((p) => String(p.idEmerdogLocal))),
        [paresManuais],
    )

    const opcoesEmOrfao = useMemo(() => {
        const doItem = itemOrfaoAtual?.candidatos || []
        const chavePref =
            escolhaOrfaoEm ||
            itemOrfaoAtual?.chaveEm ||
            itemOrfaoAtual?.grupoEm?.chave ||
            doItem[0]?.chaveEm ||
            ''
        const ehChaveAtual = (chave) => Boolean(chavePref && chave === chavePref)

        const grupoUsado = (g) => {
            if (!g) return true
            // Não esconde o atendimento já sugerido/selecionado neste card
            if (ehChaveAtual(g.chave)) return false
            return (g.ids || []).some((id) => idsEmJaPareados.has(String(id)))
        }

        let sugeridos = doItem.filter((c) => c.grupoEm && !grupoUsado(c.grupoEm))

        // Garante opção para a chave pré-selecionada (evita select em branco com exames/motivos)
        if (chavePref && !sugeridos.some((c) => c.chaveEm === chavePref)) {
            const doCand = doItem.find((c) => c.chaveEm === chavePref)
            const doDisp = (gruposEmDisponiveis || []).find((g) => g.chave === chavePref)
            const doAtual =
                itemOrfaoAtual?.chaveEm === chavePref ||
                itemOrfaoAtual?.grupoEm?.chave === chavePref
                    ? itemOrfaoAtual.grupoEm
                    : null
            const grupoEm = doCand?.grupoEm || doAtual || doDisp || null
            if (grupoEm) {
                sugeridos = [
                    {
                        chaveEm: chavePref,
                        grupoEm,
                        total: doCand?.total ?? itemOrfaoAtual?.total ?? 0,
                        motivos: doCand?.motivos || itemOrfaoAtual?.motivos || [],
                    },
                    ...sugeridos,
                ]
            }
        }

        const chavesSugeridas = new Set(sugeridos.map((c) => c.chaveEm))
        const extras = (gruposEmDisponiveis || []).filter(
            (g) => !chavesSugeridas.has(g.chave) && !grupoUsado(g),
        )

        return { sugeridos, extras, chavePref }
    }, [itemOrfaoAtual, gruposEmDisponiveis, idsEmJaPareados, escolhaOrfaoEm])

    const grupoLinhasParaOrfao = useCallback(
        (g, lado) => {
            if (!g) return null
            const mapa = mapaAliasesAtivo
            const exames = ordenarExamesPorCodigo(
                (g.linhas || []).map((l) => {
                    const nome = l.exame
                    const nomeNorm = l.exameNorm || normalizarNomeExame(nome)
                    const map = mapa.get(nomeNorm)
                    const nomeMatch =
                        lado === 'lab'
                            ? map?.nomeEmerdog || l.nomeNegociacao || nome
                            : l.nomeNegociacao ||
                              l.nomeSistemaNegociacao ||
                              map?.nomeEmerdog ||
                              nome
                    const nomeNormMatch = normalizarNomeExame(nomeMatch) || nomeNorm
                    let codigo = String(l.codigo || '').trim()
                    if (!codigo) {
                        codigo = String(codigoPorNomeNorm.get(nomeNormMatch) || '')
                    }
                    if (!codigo) {
                        codigo = String(codigoPorNomeNorm.get(nomeNorm) || '')
                    }
                    if (!codigo && map?.nomeEmerdog) {
                        codigo = String(
                            codigoPorNomeNorm.get(normalizarNomeExame(map.nomeEmerdog)) ||
                                '',
                        )
                    }

                    let valor = null
                    if (lado === 'lab') {
                        const vLab = Number(l.valorRelatorio)
                        valor = Number.isFinite(vLab) ? vLab : null
                    } else {
                        const vNeg = Number(l.valorNegociacao)
                        if (Number.isFinite(vNeg) && vNeg !== 0) {
                            valor = vNeg
                        } else {
                            const vPreco =
                                precosPorNomeNorm.get(nomeNormMatch) ??
                                precosPorNomeNorm.get(nomeNorm)
                            if (Number.isFinite(Number(vPreco)) && Number(vPreco) !== 0) {
                                valor = Number(vPreco)
                            } else if (Number.isFinite(vNeg)) {
                                valor = vNeg
                            } else {
                                const vRel = Number(l.valorRelatorio)
                                if (Number.isFinite(vRel) && vRel !== 0) valor = vRel
                            }
                        }
                    }

                    return {
                        idLocal: l.idLocal,
                        nome,
                        nomeNorm: nomeNormMatch,
                        codigo,
                        valor,
                    }
                }),
            )
            const subtotal = Number(
                exames
                    .map((e) => Number(e.valor))
                    .filter((n) => Number.isFinite(n))
                    .reduce((a, n) => a + n, 0)
                    .toFixed(2),
            )
            return {
                chave: g.chave,
                tutor: g.tutor,
                pet: g.pet,
                data: g.data,
                lado,
                exames,
                subtotal,
                ids: exames.map((e) => e.idLocal).filter(Boolean),
            }
        },
        [codigoPorNomeNorm, mapaAliasesAtivo, precosPorNomeNorm],
    )

    const enriquecerGrupoEmOrfao = useCallback(
        (grupo) => {
            if (!grupo?.exames?.length) return grupo
            const exames = ordenarExamesPorCodigo(
                (grupo.exames || []).map((ex) => {
                    const nomeNorm = ex.nomeNorm || normalizarNomeExame(ex.nome)
                    let valor = Number(ex.valor)
                    if (!Number.isFinite(valor) || valor === 0) {
                        const vPreco =
                            precosPorNomeNorm.get(nomeNorm) ??
                            (ex.codigo
                                ? precosPorNomeNorm.get(normalizarNomeExame(ex.codigo))
                                : null)
                        if (Number.isFinite(Number(vPreco)) && Number(vPreco) !== 0) {
                            valor = Number(vPreco)
                        }
                    }
                    let codigo = String(ex.codigo || '').trim()
                    if (!codigo) {
                        codigo = String(codigoPorNomeNorm.get(nomeNorm) || '')
                    }
                    return {
                        ...ex,
                        codigo,
                        valor: Number.isFinite(valor) ? valor : null,
                    }
                }),
            )
            const subtotal = Number(
                exames
                    .map((e) => Number(e.valor))
                    .filter((n) => Number.isFinite(n))
                    .reduce((a, n) => a + n, 0)
                    .toFixed(2),
            )
            return { ...grupo, exames, subtotal }
        },
        [precosPorNomeNorm, codigoPorNomeNorm],
    )

    const grupoEmSelecionado = useMemo(() => {
        const chave =
            escolhaOrfaoEm ||
            opcoesEmOrfao.chavePref ||
            itemOrfaoAtual?.chaveEm ||
            ''
        if (!chave) return null
        const deOpcoes =
            opcoesEmOrfao.sugeridos.find((c) => c.chaveEm === chave)?.grupoEm ||
            opcoesEmOrfao.extras.find((g) => g.chave === chave) ||
            (itemOrfaoAtual?.chaveEm === chave ? itemOrfaoAtual.grupoEm : null) ||
            null
        // Sempre preferir planilha enriquecida com negociacoes_vet
        const gLinhas = atendimentosTutorAmbosLados.plano.find((g) => g.chave === chave)
        if (gLinhas) return grupoLinhasParaOrfao(gLinhas, 'emerdog')
        const gTodos = agruparLinhasPorAtendimento(linhasEmerdogEnriquecidas).find(
            (g) => g.chave === chave,
        )
        if (gTodos) return grupoLinhasParaOrfao(gTodos, 'emerdog')
        return deOpcoes ? enriquecerGrupoEmOrfao(deOpcoes) : null
    }, [
        escolhaOrfaoEm,
        opcoesEmOrfao,
        itemOrfaoAtual,
        atendimentosTutorAmbosLados.plano,
        linhasEmerdogEnriquecidas,
        grupoLinhasParaOrfao,
        enriquecerGrupoEmOrfao,
    ])

    const grupoLabCompletoOrfao = useMemo(() => {
        if (!itemOrfaoAtual?.grupoLab) return null
        const chave = itemOrfaoAtual.grupoLab.chave
        const tutor = itemOrfaoAtual.grupoLab.tutor
        const pet = itemOrfaoAtual.grupoLab.pet
        const data = itemOrfaoAtual.grupoLab.data
        const gLinhas =
            agruparLinhasPorAtendimento(linhasLab).find((g) => g.chave === chave) ||
            agruparLinhasPorAtendimento(linhasLab).find(
                (g) =>
                    normalizarTextoBusca(g.tutor) === normalizarTextoBusca(tutor) &&
                    normalizarTextoBusca(g.pet) === normalizarTextoBusca(pet) &&
                    g.data === data,
            )
        if (gLinhas) return grupoLinhasParaOrfao(gLinhas, 'lab')
        return itemOrfaoAtual.grupoLab
    }, [itemOrfaoAtual, linhasLab, grupoLinhasParaOrfao])

    const examesOrfaosAlinhados = useMemo(() => {
        const lab = grupoLabCompletoOrfao?.exames || itemOrfaoAtual?.grupoLab?.exames || []
        const em = grupoEmSelecionado?.exames || []
        if (!grupoEmSelecionado) {
            return {
                examesLab: ordenarExamesPorCodigo(lab.map((e) => ({ ...e }))),
                examesEm: [],
            }
        }
        return alinharExamesLabAoCodigoDoPlano(
            lab.map((e) => ({ ...e })),
            em.map((e) => ({ ...e })),
        )
    }, [itemOrfaoAtual, grupoLabCompletoOrfao, grupoEmSelecionado])

    /** Exames aprovados manualmente na fila de órfãos (rótulo para tooltip). */
    const rotuloParAprovadoPorId = useMemo(() => {
        const idx = new Map()
        for (const l of linhasLab || []) {
            idx.set(String(l.idLocal), {
                nome: l.exame,
                codigo: l.codigo,
            })
        }
        for (const l of linhasEmerdogEnriquecidas || []) {
            idx.set(String(l.idLocal), {
                nome: l.exame,
                codigo: l.codigo,
            })
        }
        const rot = new Map()
        for (const p of paresManuais || []) {
            const lab = idx.get(String(p.idLabLocal))
            const em = idx.get(String(p.idEmerdogLocal))
            const fmt = (x) =>
                [x?.codigo, x?.nome].filter(Boolean).join(' — ') || 'exame'
            if (lab && em) {
                rot.set(
                    String(p.idLabLocal),
                    `Aprovado nesta conferência com plano: ${fmt(em)}`,
                )
                rot.set(
                    String(p.idEmerdogLocal),
                    `Aprovado nesta conferência com lab: ${fmt(lab)}`,
                )
            }
        }
        return rot
    }, [paresManuais, linhasLab, linhasEmerdogEnriquecidas])

    const dicaLinhaExameOrfao = useCallback(
        (ex, lado, examesOposto) => {
            const manual = rotuloParAprovadoPorId.get(String(ex?.idLocal))
            if (manual) return manual
            return dicaStatusExameOrfao(ex, lado, examesOposto)
        },
        [rotuloParAprovadoPorId],
    )

    /** Pares do tutor com alinhamento/código/diff iguais ao card padrão da fila. */
    const paresTutorAlinhados = useMemo(() => {
        return paresTutorVersus.map((par) => {
            const gLab = par.lab ? grupoLinhasParaOrfao(par.lab, 'lab') : null
            const gEm = par.plano ? grupoLinhasParaOrfao(par.plano, 'emerdog') : null
            let examesLab = []
            let examesEm = []
            if (gLab?.exames?.length && gEm?.exames?.length) {
                const al = alinharExamesLabAoCodigoDoPlano(
                    gLab.exames.map((e) => ({ ...e })),
                    gEm.exames.map((e) => ({ ...e })),
                )
                examesLab = al.examesLab
                examesEm = al.examesEm
            } else if (gLab?.exames?.length) {
                examesLab = ordenarExamesPorCodigo(gLab.exames).map((e) => ({
                    ...e,
                    valoresDiferem: false,
                    semPar: true,
                    idParEm: null,
                }))
            } else if (gEm?.exames?.length) {
                examesEm = ordenarExamesPorCodigo(gEm.exames).map((e) => ({
                    ...e,
                    valoresDiferem: false,
                    semPar: true,
                    idParLab: null,
                }))
            }
            return {
                lab: par.lab,
                plano: par.plano,
                gLab,
                gEm,
                examesLab,
                examesEm,
                subLab: gLab?.subtotal ?? 0,
                subEm: gEm?.subtotal ?? 0,
            }
        })
    }, [paresTutorVersus, grupoLinhasParaOrfao])

    return (
        <main className="credenciamento_main conf_lab_page">
            <header
                className={`credenciamento_main_header conf_lab_header${headerCompacto ? ' is-compact' : ''}`}
            >
                <div>
                    <p className="conf_lab_kicker">Configurações</p>
                    <h1>Conferência Laboratório</h1>
                    <p className="conf_lab_lead">
                        Compare relatórios de laboratórios com o plano.
                    </p>
                </div>
            </header>

            {erro ? (
                <CredenciamentoMainAlert
                    className="is-erro"
                    message={erro}
                    onClose={() => setErro('')}
                />
            ) : null}
            {aviso ? (
                <CredenciamentoMainAlert
                    className="is-aviso"
                    message={aviso}
                    onClose={() => setAviso('')}
                />
            ) : null}
            {feedback ? (
                <CredenciamentoMainAlert
                    className="is-sucesso"
                    message={feedback}
                    onClose={() => setFeedback('')}
                />
            ) : null}

            <nav className="conf_lab_steps" aria-label="Etapas da conferência">
                {etapasConferencia.map((etapa) => (
                    <button
                        key={etapa.id}
                        type="button"
                        className={`conf_lab_step_btn${passo === etapa.id ? ' is-active' : ''}${etapa.liberada ? '' : ' is-disabled'}`}
                        disabled={!etapa.liberada}
                        title={
                            etapa.liberada
                                ? `Ir para ${etapa.label}`
                                : 'Etapa ainda não disponível'
                        }
                        onClick={() => irParaEtapa(etapa.id)}
                    >
                        {etapa.label}
                    </button>
                ))}
            </nav>

            {passo === 'setup' ? (
                <section className="conf_lab_card">
                    <h2>Configuração da conferência</h2>
                    {loading ? <p className="conf_lab_muted">Carregando laboratórios…</p> : null}

                    <div className="conf_lab_grid_setup">
                        <label>
                            Buscar laboratório
                            <input
                                type="search"
                                value={buscaLab}
                                onChange={(e) => setBuscaLab(e.target.value)}
                                placeholder="Nome do laboratório…"
                            />
                        </label>
                        <label>
                            Laboratório
                            <select
                                value={laboratorioId}
                                onChange={(e) => setLaboratorioId(e.target.value)}
                            >
                                <option value="">Selecione…</option>
                                {labsFiltrados.map((lab) => (
                                    <option key={lab.id} value={lab.id}>
                                        {lab.nome}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            Período
                            <input
                                type="month"
                                value={periodoYm}
                                onChange={(e) => setPeriodoYm(e.target.value)}
                            />
                        </label>
                    </div>

                    <div className="conf_lab_uploads">
                        <UploadZone
                            titulo="Relatório do laboratório"
                            dica="Colunas: Data, Clínica, Tutor, Animal, Veterinário, Valor, Exame…"
                            arquivo={arquivoLab}
                            disabled={processando}
                            onFile={(f) => onEscolherArquivo('lab', f)}
                        />
                        <UploadZone
                            titulo="Relatório do plano (Emerdog)"
                            dica="Colunas: Prontuário, Tutor, Animal, Data, Exame, Repasse, Diferença…"
                            arquivo={arquivoEmerdog}
                            disabled={processando}
                            onFile={(f) => onEscolherArquivo('emerdog', f)}
                        />
                    </div>

                    {precisaMapearCols ? (
                        <div className="conf_lab_map_cols">
                            <h3>Mapeamento de colunas</h3>
                            <p className="conf_lab_muted">
                                Associe cada campo à coluna da planilha (Animal-proprietario é
                                ignorado automaticamente).
                            </p>
                            <div className="conf_lab_map_cols_grid">
                                <div>
                                    <h4>Laboratório</h4>
                                    {CAMPOS_CONFERENCIA.map((campo) => (
                                        <label key={`lab-${campo}`}>
                                            {ROTULO_CAMPO[campo]}
                                            <select
                                                value={mapColsLab[campo] ?? ''}
                                                onChange={(e) =>
                                                    setMapColsLab((prev) => ({
                                                        ...prev,
                                                        [campo]: Number(e.target.value),
                                                    }))
                                                }
                                            >
                                                <option value="">—</option>
                                                {(headersLab || []).map((h, i) => (
                                                    <option key={`lab-h-${i}`} value={i}>
                                                        {h || `Coluna ${i + 1}`}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                    ))}
                                    <label>
                                        Valor (relatório)
                                        <select
                                            value={mapColsLab.valor ?? ''}
                                            onChange={(e) =>
                                                setMapColsLab((prev) => ({
                                                    ...prev,
                                                    valor: Number(e.target.value),
                                                }))
                                            }
                                        >
                                            <option value="">—</option>
                                            {(headersLab || []).map((h, i) => (
                                                <option key={`lab-v-${i}`} value={i}>
                                                    {h || `Coluna ${i + 1}`}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                </div>
                                <div>
                                    <h4>Plano (Emerdog)</h4>
                                    {CAMPOS_CONFERENCIA.map((campo) => (
                                        <label key={`em-${campo}`}>
                                            {ROTULO_CAMPO[campo]}
                                            <select
                                                value={mapColsEmerdog[campo] ?? ''}
                                                onChange={(e) =>
                                                    setMapColsEmerdog((prev) => ({
                                                        ...prev,
                                                        [campo]: Number(e.target.value),
                                                    }))
                                                }
                                            >
                                                <option value="">—</option>
                                                {(headersEmerdog || []).map((h, i) => (
                                                    <option key={`em-h-${i}`} value={i}>
                                                        {h || `Coluna ${i + 1}`}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : null}

                    <div className="conf_lab_actions">
                        <button
                            type="button"
                            className="credenciamento_main_action_btn"
                            disabled={!podeIniciar || !podeEditar}
                            onClick={() => void iniciarConferencia()}
                        >
                            {processando ? 'Processando…' : 'Iniciar Conferência'}
                        </button>
                        {sessaoSalvaMeta?.temLinhas ? (
                            <button
                                type="button"
                                className="credenciamento_main_action_btn secondary"
                                disabled={processando || !podeEditar}
                                onClick={() => void restaurarSessaoSalva()}
                            >
                                Restaurar sessão salva
                            </button>
                        ) : null}
                        {(linhasLab.length || cards.length) && podeEditar ? (
                            <button
                                type="button"
                                className="credenciamento_main_action_btn secondary"
                                disabled={processando || salvandoSessao || !sessaoPersistenciaOk}
                                onClick={() =>
                                    void persistirSessaoAgora().then((data) => {
                                        if (data) {
                                            setFeedback('Sessão salva no Supabase.')
                                            setAviso('')
                                        } else {
                                            setAviso(
                                                'Não foi possível salvar a sessão (tabela ausente ou erro no Supabase). O pareamento continua funcionando em memória — execute scripts/sql/conferencia_laboratorio.sql se quiser persistir.',
                                            )
                                        }
                                    })
                                }
                            >
                                {salvandoSessao ? 'Salvando…' : 'Salvar sessão'}
                            </button>
                        ) : null}
                    </div>
                    {sessaoSalvaMeta?.temLinhas ? (
                        <p className="conf_lab_muted">
                            Há uma sessão salva para este lab/período
                            {sessaoSalvaMeta.atualizadoEm
                                ? ` (atualizada em ${new Date(sessaoSalvaMeta.atualizadoEm).toLocaleString('pt-BR')})`
                                : ''}
                            . Restaure para continuar sem reenviar os Excel.
                        </p>
                    ) : null}
                </section>
            ) : null}

            {passo === 'mapeamento' ? (
                <EtapaAliasesExames
                    labNome={labNome}
                    lista={packAliases.lista}
                    itensCatalogo={packAliases.itensCatalogo}
                    total={packAliases.total}
                    vinculados={packAliases.vinculados}
                    restantes={packAliases.restantes}
                    comValorDiff={packAliases.comValorDiff}
                    progressoPct={packAliases.progressoPct}
                    modoRevisao={modoRevisaoAliases}
                    podeEditar={podeEditar}
                    processando={processando}
                    onVincular={(itens, nome) => void aplicarVinculoAlias(itens, nome)}
                    onAuditar={(row) => void auditarAliasLinha(row)}
                    onContinuar={continuarAposAliases}
                    onRecalcular={recalcularAposAliases}
                />
            ) : null}

            {passo === 'orfaos' ? (
                <EtapaExamesIndividuais
                    fila={filaOrfaos}
                    decisoes={decisoesOrfaos}
                    escolhas={escolhasExames}
                    mapasAliasesPessoa={mapasAliasesPessoa}
                    marcados={marcadosPosRelatorio}
                    onToggleFlag={toggleMarcadoPorChave}
                    onEscolha={(idItem, valor) =>
                        setEscolhasExames((prev) => ({ ...prev, [idItem]: valor }))
                    }
                    onAprovar={aprovarExameIndividual}
                    onRejeitar={rejeitarExameIndividual}
                    onConcluir={concluirOrfaos}
                    podeEditar={podeEditar}
                    processando={processando}
                    progressoPct={progressoOrfaos}
                    feedbackResumo={
                        filaOrfaos.length
                            ? String(filaOrfaos.length) + ' exame(s) na fila'
                            : ''
                    }
                />
            ) : null}

            {passo === 'comparacao' ? (
                <section className="conf_lab_card" ref={comparacaoTopoRef}>
                    <div className="conf_lab_compare_head">
                        <div>
                            <h2>Comparação e auditoria</h2>
                            <p className="conf_lab_muted">
                                Atendimentos unificados por tutor · animal · data
                                {labNome ? ` · ${labNome}` : ''} · {periodoYm} ·{' '}
                                {totalAtendimentos} atendimento(s) · {cards.length} exame(s)
                                {podeEditar && (orfaosLab.length || orfaosEm.length)
                                    ? ' · Clique em dois órfãos (lab + plano) para mesclar'
                                    : ''}
                            </p>
                        </div>
                        <div className="conf_lab_actions">
                            {(orfaosLab.length > 0 || orfaosEm.length > 0) && podeEditar ? (
                                <button
                                    type="button"
                                    className="credenciamento_main_action_btn secondary"
                                    onClick={voltarParaOrfaos}
                                >
                                    Revisar exames ({orfaosLab.length + orfaosEm.length})
                                </button>
                            ) : null}
                            <button
                                type="button"
                                className="credenciamento_main_action_btn secondary"
                                disabled={!totalMarcados}
                                onClick={() => setPasso('pos-relatorio')}
                            >
                                Pós-relatório ({totalMarcados})
                            </button>
                            <button
                                type="button"
                                className="credenciamento_main_action_btn secondary"
                                onClick={reiniciar}
                            >
                                Nova conferência
                            </button>
                        </div>
                    </div>

                    <div className="conf_lab_resumo_totais" role="status">
                        <span>
                            Lab <strong>{formatarValorConferencia(resumoTotais.totalLab)}</strong>
                        </span>
                        <span>
                            Plano <strong>{formatarValorConferencia(resumoTotais.totalEm)}</strong>
                        </span>
                        <span>
                            Δ <strong>{formatarValorConferencia(resumoTotais.diferenca)}</strong>
                        </span>
                        <span>
                            Pareados <strong>{resumoTotais.qtdPareados}</strong>
                            {resumoTotais.qtdDiff ? ` · ${resumoTotais.qtdDiff} com diff` : ''}
                        </span>
                        <span>
                            Órfãos lab <strong>{resumoTotais.qtdOrfaoLab}</strong> · só plano{' '}
                            <strong>{resumoTotais.qtdOrfaoEm}</strong>
                        </span>
                    </div>

                    <div className="conf_lab_filtros" role="tablist">
                        {[
                            {
                                id: 'diferencas',
                                label: `Com diferença (${totalComDiferenca})`,
                            },
                            { id: 'todos', label: `Todos (${totalAtendimentos})` },
                            { id: 'orfaos', label: 'Com órfãos' },
                            { id: 'pareados', label: 'Pareados' },
                            { id: 'pendentes', label: 'Pendentes' },
                            { id: 'verdes', label: 'Conferidos' },
                            { id: 'marcados', label: `Marcados (${totalMarcados})` },
                        ].map((f) => (
                            <button
                                key={f.id}
                                type="button"
                                className={filtroCards === f.id && !tutorFoco ? 'is-active' : ''}
                                onClick={() => {
                                    setTutorFoco(null)
                                    setFiltroCards(f.id)
                                    setPagina(1)
                                }}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>

                    {podeEditar && (mesclaLabId || mesclaEmId) ? (
                        <div className="conf_lab_mescla_bar" role="status">
                            <p>
                                Mesclar órfãos:{' '}
                                <strong>
                                    {mesclaLabId ? '1 lab' : 'lab?'}
                                </strong>
                                {' + '}
                                <strong>
                                    {mesclaEmId ? '1 plano' : 'plano?'}
                                </strong>
                            </p>
                            <div className="conf_lab_mescla_bar_acoes">
                                <button
                                    type="button"
                                    className="credenciamento_main_action_btn secondary"
                                    onClick={limparSelecaoMescla}
                                >
                                    Limpar
                                </button>
                                <button
                                    type="button"
                                    className="credenciamento_main_action_btn"
                                    disabled={!mesclaLabId || !mesclaEmId}
                                    onClick={mesclarOrfaosNaComparacao}
                                >
                                    Mesclar exames
                                </button>
                            </div>
                        </div>
                    ) : null}

                    {!tutorFoco ? (
                        <label className="conf_lab_busca_comparacao">
                            <span className="conf_lab_sr">Buscar tutor ou animal</span>
                            <input
                                type="search"
                                value={buscaComparacao}
                                onChange={(e) => setBuscaComparacao(e.target.value)}
                                placeholder="Buscar por tutor ou animal…"
                                autoComplete="off"
                            />
                            {buscaComparacao ? (
                                <button
                                    type="button"
                                    className="conf_lab_busca_limpar"
                                    onClick={() => setBuscaComparacao('')}
                                >
                                    Limpar
                                </button>
                            ) : null}
                        </label>
                    ) : null}

                    {tutorFoco ? (
                        <div className="conf_lab_tutor_foco_bar">
                            <div className="conf_lab_tutor_foco_copy">
                                <p>
                                    Tutor <strong>{tutorFoco.label}</strong>
                                    {tutorFoco.petLabel ? (
                                        <>
                                            {' '}
                                            · Animal <strong>{tutorFoco.petLabel}</strong>
                                        </>
                                    ) : null}{' '}
                                    · {totalTutorFoco}{' '}
                                    atendimento(s) · mais antigo → mais novo
                                </p>
                            </div>
                            <div className="conf_lab_tutor_foco_actions">
                                <button
                                    type="button"
                                    className="credenciamento_main_action_btn secondary"
                                    onClick={limparTutorFoco}
                                >
                                    Voltar à lista geral
                                </button>
                            </div>
                        </div>
                    ) : null}

                    {!cardsFiltrados.length ? (
                        <p className="conf_lab_muted">
                            {tutorFoco
                                ? 'Nenhum atendimento deste tutor na conferência.'
                                : buscaComparacao.trim()
                                  ? 'Nenhum atendimento encontrado para essa busca.'
                                  : filtroCards === 'diferencas'
                                    ? 'Nenhum atendimento com diferença (órfão ou valor divergente).'
                                    : 'Nenhum atendimento neste filtro.'}
                        </p>
                    ) : (
                        <div className="conf_lab_cards_lista">
                            {cardsPagina.map((grupo) => {
                                const algumMarcado = grupo.cardsExame.some((c) =>
                                    cardEstaMarcado(c),
                                )
                                return (
                                <article
                                    key={grupo.chave}
                                    className={`conf_lab_pair_card conf_lab_atendimento status-${grupo.status}${grupo.temOrfao ? ' has-orfao' : ''}${algumMarcado ? ' is-flagged' : ''}`}
                                >
                                    <header>
                                        <div className="conf_lab_atendimento_titulo">
                                            <div>
                                                <strong>
                                                    {grupo.tutor} ·{' '}
                                                    <span className="conf_lab_card_pet">
                                                        {grupo.pet}
                                                    </span>
                                                </strong>
                                                <span>
                                                    {formatarDataConferencia(grupo.data)} ·{' '}
                                                    {grupo.qtdExames} exame(s)
                                                    {grupo.qtdOrfaos
                                                        ? ` · ${grupo.qtdOrfaos} sem par`
                                                        : ''}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="conf_lab_header_right">
                                            <BandeiraPosRelatorio
                                                marcado={algumMarcado}
                                                onToggle={() => {
                                                    const chaves = (grupo.cardsExame || [])
                                                        .map((c) => chaveMarcacaoPosRelatorio(c))
                                                        .filter(Boolean)
                                                    if (!chaves.length) return
                                                    const todosOn = chaves.every((k) =>
                                                        marcadosPosRelatorio.has(k),
                                                    )
                                                    setMarcadosPosRelatorio((prev) => {
                                                        const next = new Set(prev)
                                                        for (const k of chaves) {
                                                            if (todosOn) next.delete(k)
                                                            else next.add(k)
                                                        }
                                                        return next
                                                    })
                                                }}
                                            />
                                            {!tutorFoco ? (
                                                <button
                                                    type="button"
                                                    className="credenciamento_main_action_btn secondary conf_lab_btn_tutor_main"
                                                    onClick={() =>
                                                        mostrarTodosDoTutor(grupo.tutor, grupo.pet)
                                                    }
                                                >
                                                    Todos do tutor
                                                </button>
                                            ) : null}
                                            <span className={`conf_lab_status_pill status-${grupo.status}`}>
                                                {grupo.temOrfao
                                                    ? 'Com órfãos'
                                                    : grupo.status === 'verde'
                                                      ? 'Conferido'
                                                      : grupo.status === 'conferido_manual'
                                                        ? 'Auditado'
                                                        : 'Pendente'}
                                            </span>
                                        </div>
                                    </header>
                                    <div className="conf_lab_pair_grid conf_lab_atendimento_grid">
                                        <div>
                                            <h4>Laboratório</h4>
                                            <ul className="conf_lab_orfao_exames">
                                                {grupo.examesLab.map((ex) => {
                                                    const card = ex.card
                                                    const showFlag = Boolean(card)
                                                    const idLab = card?.idLabLocal
                                                    const mesclavel =
                                                        podeEditar &&
                                                        card?.tipo === 'orfao_lab' &&
                                                        idLab
                                                    const selecionado =
                                                        mesclavel &&
                                                        String(mesclaLabId) === String(idLab)
                                                    return (
                                                    <li
                                                        key={`lab-${ex.linhaId}`}
                                                        className={[
                                                            ex.valoresDiferem
                                                                ? 'is-diff'
                                                                : ex.semPar
                                                                  ? 'is-sem-par'
                                                                  : '',
                                                            mesclavel ? 'is-mesclavel' : '',
                                                            selecionado ? 'is-mescla-sel' : '',
                                                        ]
                                                            .filter(Boolean)
                                                            .join(' ')}
                                                        title={
                                                            mesclavel
                                                                ? selecionado
                                                                    ? 'Clique para desmarcar'
                                                                    : 'Clique para mesclar com um órfão do plano'
                                                                : undefined
                                                        }
                                                        onClick={
                                                            mesclavel
                                                                ? () =>
                                                                      selecionarOrfaoMescla(
                                                                          'lab',
                                                                          idLab,
                                                                      )
                                                                : undefined
                                                        }
                                                    >
                                                        <span className="conf_lab_exame_linha">
                                                            {showFlag ? (
                                                                <BandeiraPosRelatorio
                                                                    marcado={cardEstaMarcado(card)}
                                                                    onToggle={() =>
                                                                        toggleMarcadoPosRelatorio(card)
                                                                    }
                                                                />
                                                            ) : null}
                                                            <span className="conf_lab_exame_txt">
                                                                {ex.vazio
                                                                    ? '—'
                                                                    : `${ex.codigo ? `${ex.codigo} — ` : ''}${ex.nome || '—'}`}
                                                            </span>
                                                        </span>
                                                        <em>
                                                            {ex.vazio
                                                                ? '—'
                                                                : formatarValorConferencia(ex.valor)}
                                                        </em>
                                                    </li>
                                                    )
                                                })}
                                            </ul>
                                            <p className="conf_lab_subtotal">
                                                <span>Total do atendimento</span>
                                                <strong>
                                                    {formatarValorConferencia(grupo.subtotalLab)}
                                                </strong>
                                            </p>
                                        </div>
                                        <div>
                                            <h4>Plano (negociação)</h4>
                                            <ul className="conf_lab_orfao_exames">
                                                {grupo.examesEm.map((ex) => {
                                                    const card = ex.card
                                                    const showFlag = Boolean(card)
                                                    const idEm = card?.idEmerdogLocal
                                                    const mesclavel =
                                                        podeEditar &&
                                                        card?.tipo === 'orfao_emerdog' &&
                                                        idEm
                                                    const selecionado =
                                                        mesclavel &&
                                                        String(mesclaEmId) === String(idEm)
                                                    return (
                                                    <li
                                                        key={`em-${ex.linhaId}`}
                                                        className={[
                                                            ex.valoresDiferem
                                                                ? 'is-diff'
                                                                : ex.semPar
                                                                  ? 'is-sem-par'
                                                                  : '',
                                                            mesclavel ? 'is-mesclavel' : '',
                                                            selecionado ? 'is-mescla-sel' : '',
                                                        ]
                                                            .filter(Boolean)
                                                            .join(' ')}
                                                        title={
                                                            mesclavel
                                                                ? selecionado
                                                                    ? 'Clique para desmarcar'
                                                                    : 'Clique para mesclar com um órfão do lab'
                                                                : undefined
                                                        }
                                                        onClick={
                                                            mesclavel
                                                                ? () =>
                                                                      selecionarOrfaoMescla(
                                                                          'em',
                                                                          idEm,
                                                                      )
                                                                : undefined
                                                        }
                                                    >
                                                        <span className="conf_lab_exame_linha">
                                                            {showFlag ? (
                                                                <BandeiraPosRelatorio
                                                                    marcado={cardEstaMarcado(card)}
                                                                    onToggle={() =>
                                                                        toggleMarcadoPosRelatorio(card)
                                                                    }
                                                                />
                                                            ) : null}
                                                            <span className="conf_lab_exame_txt">
                                                                {ex.vazio
                                                                    ? '—'
                                                                    : `${ex.codigo ? `${ex.codigo} — ` : ''}${ex.nome || '—'}`}
                                                            </span>
                                                        </span>
                                                        <em>
                                                            {ex.vazio
                                                                ? '—'
                                                                : formatarValorConferencia(ex.valor)}
                                                        </em>
                                                    </li>
                                                    )
                                                })}
                                            </ul>
                                            <p className="conf_lab_subtotal">
                                                <span>Total do atendimento</span>
                                                <strong>
                                                    {formatarValorConferencia(grupo.subtotalEm)}
                                                </strong>
                                            </p>
                                        </div>
                                    </div>
                                    <footer className="conf_lab_atendimento_footer">
                                        {grupo.linhas
                                            .filter((l) => l.semParNegociacao && podeEditar)
                                            .map((l) => (
                                                <div
                                                    key={`norm-${l.idLocal}`}
                                                    className="conf_lab_norm_box"
                                                >
                                                    {normalizarCardId === l.card.idLocal ? (
                                                        <>
                                                            <p className="conf_lab_norm_titulo">
                                                                Vincular «
                                                                {l.card.exameParaNormalizar ||
                                                                    l.card.exameEmerdog ||
                                                                    l.card.exameLaboratorio}
                                                                » a um procedimento da negociação
                                                            </p>
                                                            <input
                                                                type="search"
                                                                placeholder="Buscar no catálogo da negociação…"
                                                                value={buscaCatalogo}
                                                                onChange={(e) =>
                                                                    setBuscaCatalogo(e.target.value)
                                                                }
                                                            />
                                                            <select
                                                                value={escolhaCatalogo}
                                                                onChange={(e) =>
                                                                    setEscolhaCatalogo(e.target.value)
                                                                }
                                                            >
                                                                <option value="">Selecione…</option>
                                                                {filtrarCatalogoNegociacao(
                                                                    catalogoNegociacao,
                                                                    buscaCatalogo,
                                                                )
                                                                    .slice(0, 80)
                                                                    .map((item) => (
                                                                        <option
                                                                            key={item.id}
                                                                            value={item.nome}
                                                                        >
                                                                            {item.rotulo ||
                                                                                [
                                                                                    item.codigo || null,
                                                                                    item.nomeAlternativo ||
                                                                                        item.nome,
                                                                                    formatarValorConferencia(
                                                                                        item.valor,
                                                                                    ),
                                                                                ]
                                                                                    .filter(Boolean)
                                                                                    .join(' - ')}
                                                                        </option>
                                                                    ))}
                                                            </select>
                                                            <div className="conf_lab_audit_row">
                                                                <button
                                                                    type="button"
                                                                    className="credenciamento_main_action_btn secondary"
                                                                    onClick={() => {
                                                                        setNormalizarCardId('')
                                                                        setEscolhaCatalogo('')
                                                                        setBuscaCatalogo('')
                                                                    }}
                                                                >
                                                                    Cancelar
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="credenciamento_main_action_btn"
                                                                    disabled={
                                                                        !escolhaCatalogo || processando
                                                                    }
                                                                    onClick={() =>
                                                                        void salvarNormalizacaoNegociacao(
                                                                            l.card,
                                                                        )
                                                                    }
                                                                >
                                                                    Salvar vínculo
                                                                </button>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            className="credenciamento_main_action_btn secondary"
                                                            onClick={() => abrirNormalizacao(l.card)}
                                                        >
                                                            Normalizar «
                                                            {l.card.exameParaNormalizar ||
                                                                l.card.exameLaboratorio ||
                                                                l.card.exameEmerdog}
                                                            »
                                                        </button>
                                                    )}
                                                </div>
                                            ))}

                                        {grupo.linhas
                                            .filter(
                                                (l) =>
                                                    l.status !== 'verde' &&
                                                    l.tipo === 'pareado' &&
                                                    !l.semParNegociacao &&
                                                    l.valoresDiferem,
                                            )
                                            .map((l) => (
                                                <div
                                                    key={`audit-${l.idLocal}`}
                                                    className="conf_lab_audit_row"
                                                >
                                                    <span className="conf_lab_exame_txt is-diff">
                                                        {l.codigo ? `${l.codigo} — ` : ''}
                                                        {l.lab?.nome || l.em?.nome}
                                                        {l.diferenca != null
                                                            ? ` · diff ${formatarValorConferencia(l.diferenca)}`
                                                            : ''}
                                                    </span>
                                                    <input
                                                        type="text"
                                                        placeholder="Observação da auditoria…"
                                                        value={obsAuditoria[l.card.idLocal] || ''}
                                                        onChange={(e) =>
                                                            setObsAuditoria((prev) => ({
                                                                ...prev,
                                                                [l.card.idLocal]: e.target.value,
                                                            }))
                                                        }
                                                    />
                                                    <button
                                                        type="button"
                                                        className="credenciamento_main_action_btn secondary"
                                                        disabled={!podeEditar}
                                                        onClick={() => marcarCardConferido(l.card)}
                                                    >
                                                        Marcar conferido
                                                    </button>
                                                </div>
                                            ))}
                                    </footer>
                                </article>
                                )
                            })}
                        </div>
                    )}

                    {cardsFiltrados.length > porPagina ? (
                        <div className="conf_lab_paginacao">
                            <button
                                type="button"
                                className="credenciamento_main_action_btn secondary"
                                disabled={paginaSafe <= 1}
                                onClick={() => setPagina((p) => Math.max(1, p - 1))}
                            >
                                Anterior
                            </button>
                            <span>
                                Página {paginaSafe} de {totalPaginas}
                            </span>
                            <button
                                type="button"
                                className="credenciamento_main_action_btn secondary"
                                disabled={paginaSafe >= totalPaginas}
                                onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                            >
                                Próxima
                            </button>
                        </div>
                    ) : null}
                </section>
            ) : null}

            {passo === 'pos-relatorio' ? (
                <section className="conf_lab_card conf_lab_pos_relatorio">
                    <div className="conf_lab_compare_head">
                        <div>
                            <h2>Pós-relatório da conferência</h2>
                            <p className="conf_lab_muted">
                                Exames flagados com pares de ambos os relatórios
                                {labNome ? ` · ${labNome}` : ''} · {periodoYm} · {totalMarcados}{' '}
                                item(ns)
                            </p>
                        </div>
                        <div className="conf_lab_actions">
                            <button
                                type="button"
                                className="credenciamento_main_action_btn secondary"
                                onClick={() => setPasso('comparacao')}
                            >
                                Voltar à comparação
                            </button>
                            <button
                                type="button"
                                className="credenciamento_main_action_btn"
                                disabled={!totalMarcados || processando}
                                onClick={() => void baixarPosRelatorio()}
                            >
                                {processando ? 'Gerando…' : 'Baixar Excel'}
                            </button>
                        </div>
                    </div>

                    {!linhasPosRelatorio.length ? (
                        <p className="conf_lab_muted">
                            Nenhum exame marcado. Clique na bandeirinha ao lado dos exames em
                            vermelho (ou use «Pós-relatório» no card) para incluí-los aqui.
                        </p>
                    ) : (
                        <div className="conf_lab_pos_lista">
                            {linhasPosRelatorio.map((linha) => (
                                <article
                                    key={linha.chave}
                                    className={`conf_lab_pos_item${linha.valoresDiferem ? ' is-diff' : ''}`}
                                >
                                    <header>
                                        <div>
                                            <strong>
                                                {linha.tutor} ·{' '}
                                                <span className="conf_lab_card_pet">{linha.pet}</span>
                                            </strong>
                                            <span>{formatarDataConferencia(linha.data)}</span>
                                        </div>
                                        {linha.codigo ? (
                                            <span className="conf_lab_pos_codigo">{linha.codigo}</span>
                                        ) : null}
                                    </header>
                                    <div className="conf_lab_pair_grid">
                                        <div>
                                            <h4>Laboratório</h4>
                                            <ul>
                                                <li className={linha.valoresDiferem ? 'is-diff' : ''}>
                                                    <span>{linha.exameLaboratorio}</span>
                                                    <em>
                                                        {formatarValorConferencia(linha.valorLab)}
                                                    </em>
                                                </li>
                                            </ul>
                                        </div>
                                        <div>
                                            <h4>Plano</h4>
                                            <ul>
                                                <li className={linha.valoresDiferem ? 'is-diff' : ''}>
                                                    <span>{linha.exameEmerdog}</span>
                                                    <em>
                                                        {formatarValorConferencia(linha.valorEmerdog)}
                                                    </em>
                                                </li>
                                            </ul>
                                        </div>
                                    </div>
                                    {linha.diferenca != null ? (
                                        <footer>
                                            <span className={linha.valoresDiferem ? 'is-diff' : ''}>
                                                Diferença:{' '}
                                                <strong>
                                                    {formatarValorConferencia(linha.diferenca)}
                                                </strong>
                                            </span>
                                        </footer>
                                    ) : null}
                                </article>
                            ))}
                        </div>
                    )}
                </section>
            ) : null}
        </main>
    )
}

export default ConfigConferenciaLaboratorio
