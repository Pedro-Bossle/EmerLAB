import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
    PERMISSION_KEYS,
    getStoredAccessProfile,
    hasPermission,
    usuarioPodeEditarFerramenta,
} from '../../../lib/accessControl'
import {
    CAMPOS_PLANO,
    CAMPOS_LABORATORIO,
    CAMPOS_VALORES_BASE,
    camposFaltantesMapeamento,
    mapearIndicesColunasConferencia,
} from '../../../lib/configuracoes/conferenciaLaboratorioExcel.js'
import { parsearExcelConferenciaViaWorker } from '../../../lib/configuracoes/conferenciaExcelWorkerClient.js'
import {
    montarParManual,
    resumirConferencia,
    runConferencia,
    statusEhDivergencia,
    statusEhOk,
    rotuloStatusConferencia,
} from '../../../lib/configuracoes/conferencia/index.js'
import { aplicarValoresBase, examesPendentesVinculo } from '../../../lib/configuracoes/conferencia/lookupBase.js'
import { exportarConferenciaHonorariosExcel } from '../../../lib/configuracoes/conferencia/export.js'
import {
    carregarSessaoLocal,
    excluirSessaoLocal,
    formatarQuandoSessao,
    listarSessoesConferencia,
    salvarSessaoLocal,
    sessaoTemConteudo,
} from '../../../lib/configuracoes/conferencia/sessaoLocal.js'
import {
    formatarDataConferencia,
    formatarValorConferencia,
} from '../../../lib/configuracoes/conferenciaLaboratorioPrecos.js'
import CredenciamentoMainAlert from '../../../components/Toast/CredenciamentoMainAlert.jsx'
import PainelDetalheConferencia from './PainelDetalheConferencia.jsx'
import CadastroRegrasConferencia from './CadastroRegrasConferencia.jsx'
import ComboExame from './ComboExame.jsx'
import logoE from '../../../assets/logo_E.png'
import '../../Credenciamento/Credenciamento_main/Credenciamento_main.css'
import './ConfigConferenciaLaboratorio.css'

const ROTULO_CAMPO = {
    codigo: 'Código',
    prontuario: 'Prontuário',
    tutor: 'Tutor',
    pet: 'Pet',
    data: 'Data',
    exame: 'Exame',
    valor: 'Valor',
}

const FILTROS_RAPIDOS = [
    { id: 'todos', label: 'Todos' },
    { id: 'divergencias', label: 'Somente divergências' },
    { id: 'valores', label: 'Somente valores divergentes' },
    { id: 'orfaos', label: 'Somente órfãos' },
    { id: 'revisao', label: 'Somente revisão manual' },
    { id: 'ok', label: 'Somente OK' },
]

function UploadZone({ titulo, dica, arquivo, nomeArquivo, onFile, disabled }) {
    const [arrastando, setArrastando] = useState(false)
    const id = `conf-lab-up-${titulo.replace(/\s+/g, '-').toLowerCase()}`
    const nome = arquivo?.name || nomeArquivo || ''
    return (
        <div
            className={`conf_lab_drop${arrastando ? ' is-drag' : ''}${disabled ? ' is-busy' : ''}${nome ? ' has-file' : ''}`}
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
                {nome ? 'Trocar arquivo' : 'Selecionar arquivo'}
                <input
                    id={id}
                    type="file"
                    accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                    disabled={disabled}
                    onChange={(e) => onFile(e.target.files?.[0] || null)}
                />
            </label>
            {nome ? (
                <p className="conf_lab_drop_nome" title={nome}>
                    {nome}
                </p>
            ) : (
                <p className="conf_lab_drop_hint">Arraste .xlsx ou .csv aqui</p>
            )}
        </div>
    )
}

function MapaColunas({ titulo, headers, mapCols, setMapCols, campos, rotulos = {} }) {
    return (
        <div>
            <h4>{titulo}</h4>
            {campos.map((campo) => (
                <label key={`${titulo}-${campo}`}>
                    {rotulos[campo] || ROTULO_CAMPO[campo] || campo}
                    <select
                        value={mapCols[campo] ?? ''}
                        onChange={(e) =>
                            setMapCols((prev) => ({
                                ...prev,
                                [campo]: e.target.value === '' ? undefined : Number(e.target.value),
                            }))
                        }
                    >
                        <option value="">—</option>
                        {(headers || []).map((h, i) => (
                            <option key={`${titulo}-h-${campo}-${i}`} value={i}>
                                {h || `Coluna ${i + 1}`}
                            </option>
                        ))}
                    </select>
                </label>
            ))}
        </div>
    )
}

function PreviewTabela({ titulo, linhas, colunas }) {
    const cols = colunas || [
        { key: 'tutor', label: 'Tutor' },
        { key: 'pet', label: 'Pet' },
        { key: 'data', label: 'Data', tipo: 'data' },
        { key: 'exame', label: 'Exame' },
        { key: 'valor', label: 'Valor', tipo: 'valor' },
    ]
    const amostra = (linhas || []).slice(0, 8)
    const celula = (l, col) => {
        const v = l[col.key]
        if (col.tipo === 'data') return formatarDataConferencia(v)
        if (col.tipo === 'valor') return formatarValorConferencia(v ?? l.valorRelatorio ?? l.valor_base)
        return v || '—'
    }
    if (!amostra.length) {
        return (
            <div>
                <h4>{titulo}</h4>
                <p className="conf_lab_muted">Nenhuma linha válida ainda.</p>
            </div>
        )
    }
    return (
        <div className="conf_lab_preview_bloco">
            <h4>
                {titulo} ({linhas.length} linha{linhas.length === 1 ? '' : 's'})
            </h4>
            <div className="conf_lab_table_wrap">
                <table className="conf_lab_table">
                    <thead>
                        <tr>
                            {cols.map((c) => (
                                <th key={c.key}>{c.label}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {amostra.map((l) => (
                            <tr key={l.id || l.idLocal}>
                                {cols.map((c) => (
                                    <td key={c.key}>{celula(l, c)}</td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

function DashCard({ label, valor, destaque }) {
    return (
        <div className={`conf_lab_dash_card${destaque ? ` is-${destaque}` : ''}`}>
            <span>{label}</span>
            <strong>{valor}</strong>
        </div>
    )
}

function classeStatus(status) {
    if (statusEhOk(status)) return 'is-ok'
    if (status === 'REVISAO_MANUAL') return 'is-rev'
    if (String(status || '').startsWith('ORFAO')) return 'is-orf'
    return 'is-div'
}

function ehOrfaoStatus(status) {
    return status === 'ORFAO_MELLISLAB' || status === 'ORFAO_HONORARIOS'
}

function ehOrfaoPendente(r) {
    return Boolean(r) && ehOrfaoStatus(r.status) && !r.revisao?.ignorar
}

function proximoOrfaoApos(lista, idAtual, idsExcluir = []) {
    const excluir = new Set([idAtual, ...idsExcluir].filter(Boolean))
    const list = lista || []
    const idx = list.findIndex((r) => r.id === idAtual)
    const depois = idx >= 0 ? list.slice(idx + 1) : list
    const antes = idx >= 0 ? list.slice(0, idx) : []
    return [...depois, ...antes].find((r) => ehOrfaoPendente(r) && !excluir.has(r.id)) || null
}

function itemAceitaAcao(r, acao) {
    if (!r) return false
    if (acao === 'ignorar') return true
    const temPar = Boolean(r.honorarios && r.mellis)
    if (acao === 'nao_corresponde') return temPar
    if (
        acao === 'confirmar' ||
        acao === 'tutor_alternativo' ||
        acao === 'exame_equivalente' ||
        acao === 'perfil_equivalente'
    ) {
        return temPar && !ehOrfaoStatus(r.status)
    }
    return false
}

function aplicarAcaoNoResultado(r, acao, extra, revisao) {
    if (acao === 'nao_corresponde') {
        return {
            ...r,
            status: r.mellis ? 'ORFAO_MELLISLAB' : 'ORFAO_HONORARIOS',
            revisao,
            acao: 'Não corresponde',
        }
    }
    if (acao === 'confirmar') {
        const hon =
            extra.honorariosId && r.candidatos?.length
                ? r.candidatos.find((c) => c.id === extra.honorariosId) || r.honorarios
                : r.honorarios
        return {
            ...r,
            honorarios: hon,
            status: 'OK',
            motivo: 'Correspondência confirmada manualmente.',
            acao: 'Confirmado',
            revisao,
        }
    }
    if (acao === 'tutor_alternativo') {
        return {
            ...r,
            status: 'OK_COM_TUTOR_ALTERNATIVO',
            motivo: 'Tutor alternativo autorizado.',
            acao: 'Tutor alternativo',
            revisao,
        }
    }
    if (acao === 'exame_equivalente') {
        return {
            ...r,
            status: 'OK_COM_EXAME_EQUIVALENTE',
            motivo: 'Exame equivalente confirmado.',
            acao: 'Exame equivalente',
            revisao,
        }
    }
    if (acao === 'perfil_equivalente') {
        return {
            ...r,
            status: 'PERFIL_EQUIVALENTE',
            motivo: 'Perfil equivalente confirmado.',
            acao: 'Perfil equivalente',
            revisao,
        }
    }
    return { ...r, acao: 'Ignorado', revisao }
}

function cliqueAbreDetalhe(e) {
    return !e.target.closest('input, button, label, a')
}

function CheckboxIndeterminado({ checked, indeterminate, onChange, label }) {
    const ref = useRef(null)
    useEffect(() => {
        if (ref.current) ref.current.indeterminate = Boolean(indeterminate)
    }, [indeterminate])
    return (
        <input
            ref={ref}
            type="checkbox"
            checked={checked}
            onChange={onChange}
            onClick={(e) => e.stopPropagation()}
            aria-label={label}
        />
    )
}

const ACOES_MASSA = [
    { id: 'confirmar', label: 'Confirmar' },
    { id: 'nao_corresponde', label: 'Não corresponde' },
    { id: 'tutor_alternativo', label: 'Tutor alternativo' },
    { id: 'exame_equivalente', label: 'Exame equivalente' },
    { id: 'perfil_equivalente', label: 'Perfil equivalente' },
    { id: 'ignorar', label: 'Ignorar' },
]

function textoDiferencaValor(r) {
    const dv = r.diferenca_valor
    if (dv == null || dv === '') return '—'
    const sinal = Number(dv) > 0 ? '+' : ''
    return `${sinal}${formatarValorConferencia(Math.abs(dv)).replace('R$', '').trim()}`
}

function filtrarResultados(resultados, filtro, busca) {
    let list = resultados || []
    if (filtro === 'divergencias') list = list.filter((r) => statusEhDivergencia(r.status) || !statusEhOk(r.status))
    if (filtro === 'valores') list = list.filter((r) => r.status === 'VALOR_DIVERGENTE')
    if (filtro === 'orfaos') {
        list = list.filter((r) => r.status === 'ORFAO_MELLISLAB' || r.status === 'ORFAO_HONORARIOS')
    }
    if (filtro === 'revisao') list = list.filter((r) => r.status === 'REVISAO_MANUAL')
    if (filtro === 'ok') list = list.filter((r) => statusEhOk(r.status))
    const t = String(busca || '')
        .trim()
        .toLowerCase()
    if (!t) return list
    return list.filter((r) =>
        [
            r.status,
            r.tutor_honorarios,
            r.tutor_mellislab,
            r.pet_honorarios,
            r.pet_mellislab,
            r.exame_honorarios,
            r.exame_mellislab,
            r.motivo,
            r.prontuario_honorarios,
            r.prontuario_mellislab,
        ]
            .join(' ')
            .toLowerCase()
            .includes(t),
    )
}

function valorOrdenacao(r, chave) {
    if (chave === 'status') return rotuloStatusConferencia(r.status)
    if (chave === 'tutor') return r.tutor_honorarios || r.tutor_mellislab || ''
    if (chave === 'animal') return r.pet_honorarios || r.pet_mellislab || ''
    if (chave === 'data') return r.data_honorarios || r.data_mellislab || ''
    if (chave === 'exame') return r.exame_honorarios || r.exame_mellislab || ''
    if (chave === 'valor') return Number(r.valor_honorarios ?? r.valor_mellislab)
    if (chave === 'difdias') return Number(r.diferenca_dias)
    if (chave === 'difvalor') return Number(r.diferenca_valor)
    if (chave === 'confianca') {
        const mapa = { BAIXA: 1, MEDIA: 2, ALTA: 3 }
        return mapa[String(r.confianca || '').toUpperCase()] ?? 0
    }
    if (chave === 'resultado') return r.motivo || r.acao || ''
    return ''
}

function compararOrdenacao(a, b) {
    const aVazio =
        a == null || a === '' || (typeof a === 'number' && !Number.isFinite(a))
    const bVazio =
        b == null || b === '' || (typeof b === 'number' && !Number.isFinite(b))
    if (aVazio && bVazio) return 0
    if (aVazio) return 1
    if (bVazio) return -1
    if (typeof a === 'number' && typeof b === 'number') return a - b
    return String(a).localeCompare(String(b), 'pt-BR', { numeric: true, sensitivity: 'base' })
}

function ThOrdenavel({ coluna, ordem, onOrdenar, className, children }) {
    const ativo = ordem.chave === coluna
    return (
        <th
            className={className}
            aria-sort={ativo ? (ordem.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        >
            <button
                type="button"
                className={`conf_lab_th_sort${ativo ? ' is-on' : ''}`}
                onClick={() => onOrdenar(coluna)}
            >
                {children}
                <span className="conf_lab_th_seta" aria-hidden>
                    {ativo ? (ordem.dir === 'asc' ? '▲' : '▼') : '↕'}
                </span>
            </button>
        </th>
    )
}

function passoEfetivoSessao(e) {
    let passoRest = e?.passo || 'setup'
    if (passoRest === 'resultado' && !(e?.resultados || []).length) {
        passoRest =
            (e?.linhasHonorarios || []).length ||
            (e?.linhasMellis || []).length ||
            (e?.linhasBase || []).length
                ? 'preview'
                : 'setup'
    }
    return passoRest
}

function IconeHistoricoSessao() {
    return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
                d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
                stroke="currentColor"
                strokeWidth="1.85"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M3 3v5h5"
                stroke="currentColor"
                strokeWidth="1.85"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M12 7v5l4 2"
                stroke="currentColor"
                strokeWidth="1.85"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
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
    const [processando, setProcessando] = useState(false)
    const [erro, setErro] = useState('')
    const [aviso, setAviso] = useState('')
    const [feedback, setFeedback] = useState('')

    const [arquivoHonorarios, setArquivoHonorarios] = useState(null)
    const [arquivoMellis, setArquivoMellis] = useState(null)
    const [arquivoBase, setArquivoBase] = useState(null)
    const [headersHonorarios, setHeadersHonorarios] = useState([])
    const [headersMellis, setHeadersMellis] = useState([])
    const [headersBase, setHeadersBase] = useState([])
    const [mapColsHonorarios, setMapColsHonorarios] = useState({})
    const [mapColsMellis, setMapColsMellis] = useState({})
    const [mapColsBase, setMapColsBase] = useState({})
    const [linhasHonorarios, setLinhasHonorarios] = useState([])
    const [linhasMellis, setLinhasMellis] = useState([])
    const [linhasBase, setLinhasBase] = useState([])
    const [vinculosBase, setVinculosBase] = useState({})
    const [faltHonorarios, setFaltHonorarios] = useState([])
    const [faltMellis, setFaltMellis] = useState([])
    const [faltBase, setFaltBase] = useState([])

    const [resultados, setResultados] = useState([])
    const [resumo, setResumo] = useState(null)
    const [revisoes, setRevisoes] = useState([])
    const [itemAberto, setItemAberto] = useState(null)
    const [filtro, setFiltro] = useState('todos')
    const [busca, setBusca] = useState('')
    const [ordem, setOrdem] = useState({ chave: '', dir: 'asc' })
    const [regrasAberto, setRegrasAberto] = useState(false)
    const [equivalencias, setEquivalencias] = useState([])
    const [perfis, setPerfis] = useState([])
    const [aliasesPessoa, setAliasesPessoa] = useState([])
    const [selecionados, setSelecionados] = useState(() => new Set())
    const [nomesArquivosSalvos, setNomesArquivosSalvos] = useState({
        base: '',
        plano: '',
        lab: '',
    })
    const [sessoes, setSessoes] = useState([])
    const [histAberto, setHistAberto] = useState(false)
    const sujoRef = useRef(false)
    const sessaoIdRef = useRef(null)
    const ignorarSaveRef = useRef(false)
    const histRef = useRef(null)
    const estadoSessaoRef = useRef(null)

    const mapeamentoOk = !faltHonorarios.length && !faltMellis.length && !faltBase.length
    const planoComBase = useMemo(
        () => aplicarValoresBase(linhasHonorarios, linhasBase, vinculosBase),
        [linhasHonorarios, linhasBase, vinculosBase],
    )
    const pendentesVinculo = useMemo(
        () => examesPendentesVinculo(planoComBase),
        [planoComBase],
    )
    const itensExameBase = useMemo(
        () =>
            (linhasBase || []).map((b) => ({
                id: b.id,
                rotulo: [b.codigo, b.nome || b.exame, formatarValorConferencia(b.valor)]
                    .filter(Boolean)
                    .join(' · '),
                busca: [b.codigo, b.nome || b.exame].filter(Boolean).join(' '),
            })),
        [linhasBase],
    )
    const nomesExameOpcoes = useMemo(() => {
        const mapa = new Map()
        for (const l of [...linhasBase, ...linhasHonorarios, ...linhasMellis]) {
            const nome = String(l.nome || l.exame || '').trim()
            if (!nome) continue
            const id = nome
            if (!mapa.has(id)) {
                mapa.set(id, {
                    id,
                    rotulo: [l.codigo || l.codigo_base, nome].filter(Boolean).join(' · '),
                    busca: [l.codigo, nome].filter(Boolean).join(' '),
                })
            }
        }
        return [...mapa.values()]
    }, [linhasBase, linhasHonorarios, linhasMellis])
    const podeComparar =
        podeEditar &&
        linhasHonorarios.length &&
        linhasMellis.length &&
        linhasBase.length &&
        mapeamentoOk &&
        !pendentesVinculo.length

    const visiveis = useMemo(() => {
        const list = filtrarResultados(resultados, filtro, busca)
        if (!ordem.chave) return list
        return [...list].sort((x, y) => {
            const c = compararOrdenacao(valorOrdenacao(x, ordem.chave), valorOrdenacao(y, ordem.chave))
            return ordem.dir === 'asc' ? c : -c
        })
    }, [resultados, filtro, busca, ordem])

    const alternarOrdem = (chave) => {
        setOrdem((prev) => {
            if (prev.chave !== chave) return { chave, dir: 'asc' }
            return { chave, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        })
    }
    const idsVisiveis = useMemo(() => visiveis.map((r) => r.id), [visiveis])
    const todosVisiveisMarcados =
        idsVisiveis.length > 0 && idsVisiveis.every((id) => selecionados.has(id))
    const algunsVisiveisMarcados = idsVisiveis.some((id) => selecionados.has(id))
    const orfaosMellis = useMemo(
        () => resultados.filter((r) => r.status === 'ORFAO_MELLISLAB' && !r.revisao?.ignorar),
        [resultados],
    )
    const orfaosHonorarios = useMemo(
        () => resultados.filter((r) => r.status === 'ORFAO_HONORARIOS' && !r.revisao?.ignorar),
        [resultados],
    )

    useEffect(() => {
        sujoRef.current = Boolean(
            linhasHonorarios.length || linhasMellis.length || linhasBase.length || resultados.length,
        )
    }, [linhasHonorarios.length, linhasMellis.length, linhasBase.length, resultados.length])

    const nomesArquivosAtuais = {
        base: arquivoBase?.name || nomesArquivosSalvos.base || '',
        plano: arquivoHonorarios?.name || nomesArquivosSalvos.plano || '',
        lab: arquivoMellis?.name || nomesArquivosSalvos.lab || '',
    }

    const estadoParaSalvar = {
        passo,
        nomesArquivos: nomesArquivosAtuais,
        headersHonorarios,
        headersMellis,
        headersBase,
        mapColsHonorarios,
        mapColsMellis,
        mapColsBase,
        linhasHonorarios,
        linhasMellis,
        linhasBase,
        vinculosBase,
        faltHonorarios,
        faltMellis,
        faltBase,
        resultados,
        resumo,
        revisoes,
        equivalencias,
        aliasesPessoa,
        perfis,
    }
    estadoSessaoRef.current = estadoParaSalvar

    const recarregarSessoes = async () => {
        try {
            setSessoes(await listarSessoesConferencia())
        } catch (e) {
            console.warn('[conferencia] sessões locais:', e?.message || e)
        }
    }

    const persistirSessao = async () => {
        const estado = estadoSessaoRef.current
        if (!estado || !sessaoTemConteudo(estado)) return
        try {
            const meta = await salvarSessaoLocal(sessaoIdRef.current, estado)
            sessaoIdRef.current = meta.id
            await recarregarSessoes()
        } catch (e) {
            console.warn('[conferencia] salvar sessão:', e?.message || e)
            setAviso('Não foi possível salvar a sessão neste computador (espaço ou permissão).')
        }
    }

    useEffect(() => {
        void recarregarSessoes()
    }, [])

    useEffect(() => {
        if (ignorarSaveRef.current) {
            ignorarSaveRef.current = false
            return
        }
        if (!sessaoTemConteudo(estadoParaSalvar)) return
        const t = setTimeout(() => {
            void persistirSessao()
        }, 700)
        return () => clearTimeout(t)
    }, [
        passo,
        nomesArquivosAtuais.base,
        nomesArquivosAtuais.plano,
        nomesArquivosAtuais.lab,
        headersHonorarios,
        headersMellis,
        headersBase,
        mapColsHonorarios,
        mapColsMellis,
        mapColsBase,
        linhasHonorarios,
        linhasMellis,
        linhasBase,
        vinculosBase,
        faltHonorarios,
        faltMellis,
        faltBase,
        resultados,
        resumo,
        revisoes,
        equivalencias,
        aliasesPessoa,
        perfis,
    ])

    useEffect(() => {
        const onBeforeUnload = (e) => {
            if (!sujoRef.current) return
            e.preventDefault()
            e.returnValue = ''
        }
        const onVisivel = () => {
            if (document.visibilityState === 'hidden') void persistirSessao()
        }
        window.addEventListener('beforeunload', onBeforeUnload)
        document.addEventListener('visibilitychange', onVisivel)
        return () => {
            window.removeEventListener('beforeunload', onBeforeUnload)
            document.removeEventListener('visibilitychange', onVisivel)
        }
    }, [])

    useEffect(() => {
        if (!histAberto) return
        const onDoc = (e) => {
            if (!histRef.current?.contains(e.target)) setHistAberto(false)
        }
        document.addEventListener('mousedown', onDoc)
        return () => document.removeEventListener('mousedown', onDoc)
    }, [histAberto])

    const parseArquivo = async (arquivo, mapCols, origem) => {
        const buffer = await arquivo.arrayBuffer()
        return parsearExcelConferenciaViaWorker(buffer, {
            mapeamentoManual: mapCols,
            origem,
        })
    }

    const aplicarParse = (parsed, origem) => {
        const auto = mapearIndicesColunasConferencia(parsed.headers || [], {}, origem)
        const falt = parsed.faltantes || camposFaltantesMapeamento(parsed.idx || auto.idx, { origem })
        const preencherMapa = (prev, campos) => {
            const next = { ...prev }
            for (const campo of campos) {
                if (next[campo] == null && auto.idx[campo] >= 0) next[campo] = auto.idx[campo]
            }
            return next
        }
        if (origem === 'valores_base') {
            setHeadersBase(parsed.headers || [])
            setLinhasBase(parsed.linhas || [])
            setFaltBase(falt)
            setMapColsBase((prev) => preencherMapa(prev, CAMPOS_VALORES_BASE))
        } else if (origem === 'honorarios') {
            setHeadersHonorarios(parsed.headers || [])
            setLinhasHonorarios(parsed.linhas || [])
            setFaltHonorarios(falt)
            setMapColsHonorarios((prev) => preencherMapa(prev, CAMPOS_PLANO))
        } else {
            setHeadersMellis(parsed.headers || [])
            setLinhasMellis(parsed.linhas || [])
            setFaltMellis(falt)
            setMapColsMellis((prev) => preencherMapa(prev, CAMPOS_LABORATORIO))
        }
        return falt
    }

    const onFileBase = async (file) => {
        if (!file) return
        setArquivoBase(file)
        setErro('')
        setProcessando(true)
        try {
            const parsed = await parseArquivo(file, mapColsBase, 'valores_base')
            const falt = aplicarParse(parsed, 'valores_base')
            if (parsed.erro && falt.length) setErro(parsed.erro)
            else setPasso('preview')
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setProcessando(false)
        }
    }

    const onFileHonorarios = async (file) => {
        if (!file) return
        setArquivoHonorarios(file)
        setErro('')
        setProcessando(true)
        try {
            const parsed = await parseArquivo(file, mapColsHonorarios, 'honorarios')
            const falt = aplicarParse(parsed, 'honorarios')
            if (parsed.erro && falt.length) setErro(parsed.erro)
            else setPasso('preview')
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setProcessando(false)
        }
    }

    const onFileMellis = async (file) => {
        if (!file) return
        setArquivoMellis(file)
        setErro('')
        setProcessando(true)
        try {
            const parsed = await parseArquivo(file, mapColsMellis, 'mellislab')
            const falt = aplicarParse(parsed, 'mellislab')
            if (parsed.erro && falt.length) setErro(parsed.erro)
            else setPasso('preview')
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setProcessando(false)
        }
    }

    const reparseComMapeamento = async () => {
        if (!arquivoBase || !arquivoHonorarios || !arquivoMellis) {
            setErro('Envie as três planilhas: Valores de Base, Relatório Plano e Relatório Laboratório.')
            return
        }
        setProcessando(true)
        setErro('')
        try {
            const [b, h, m] = await Promise.all([
                parseArquivo(arquivoBase, mapColsBase, 'valores_base'),
                parseArquivo(arquivoHonorarios, mapColsHonorarios, 'honorarios'),
                parseArquivo(arquivoMellis, mapColsMellis, 'mellislab'),
            ])
            const faltB = aplicarParse(b, 'valores_base')
            const faltH = aplicarParse(h, 'honorarios')
            const faltM = aplicarParse(m, 'mellislab')
            if (faltB.length || faltH.length || faltM.length || b.erro || h.erro || m.erro) {
                setErro(b.erro || h.erro || m.erro || 'Ajuste o mapeamento das colunas obrigatórias.')
                return
            }
            setPasso('preview')
            setFeedback('Prévia atualizada. Confira as linhas e os vínculos de exame antes de comparar.')
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setProcessando(false)
        }
    }

    const executarComparacao = async () => {
        if (!podeComparar) {
            setErro(
                pendentesVinculo.length
                    ? 'Vincule os exames do plano à lista de Valores de Base (ambiguidades são manuais).'
                    : 'Mapeie as três planilhas e gere a prévia antes de comparar.',
            )
            return
        }
        setProcessando(true)
        setErro('')
        try {
            const out = runConferencia({
                honorarios: linhasHonorarios,
                mellislab: linhasMellis,
                valoresBase: linhasBase,
                vinculosBase,
                equivalencias,
                aliasesPessoa,
                perfis,
            })
            setResultados(out.resultados)
            setResumo(out.resumo)
            setSelecionados(new Set())
            setPasso('resultado')
            setFeedback('Comparação concluída. O valor oficial é o de Valores de Base.')
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setProcessando(false)
        }
    }

    const aplicarEstadoSessao = (e) => {
        const passoRest = passoEfetivoSessao(e)
        setPasso(passoRest)
        setNomesArquivosSalvos(e.nomesArquivos || { base: '', plano: '', lab: '' })
        setArquivoHonorarios(null)
        setArquivoMellis(null)
        setArquivoBase(null)
        setHeadersHonorarios(e.headersHonorarios || [])
        setHeadersMellis(e.headersMellis || [])
        setHeadersBase(e.headersBase || [])
        setMapColsHonorarios(e.mapColsHonorarios || {})
        setMapColsMellis(e.mapColsMellis || {})
        setMapColsBase(e.mapColsBase || {})
        setLinhasHonorarios(e.linhasHonorarios || [])
        setLinhasMellis(e.linhasMellis || [])
        setLinhasBase(e.linhasBase || [])
        setVinculosBase(e.vinculosBase || {})
        setFaltHonorarios(e.faltHonorarios || [])
        setFaltMellis(e.faltMellis || [])
        setFaltBase(e.faltBase || [])
        setResultados(e.resultados || [])
        setResumo(e.resumo || null)
        setRevisoes(e.revisoes || [])
        setEquivalencias(e.equivalencias || [])
        setAliasesPessoa(e.aliasesPessoa || [])
        setPerfis(e.perfis || [])
        setSelecionados(new Set())
        setItemAberto(null)
        setFiltro('todos')
        setBusca('')
        setOrdem({ chave: '', dir: 'asc' })
    }

    const restaurarSessao = async (id) => {
        setProcessando(true)
        setErro('')
        try {
            const reg = await carregarSessaoLocal(id)
            if (!reg?.estado) {
                setErro('Sessão não encontrada ou já expirou (30 dias).')
                await recarregarSessoes()
                return
            }
            ignorarSaveRef.current = true
            sessaoIdRef.current = reg.id
            aplicarEstadoSessao(reg.estado)
            await salvarSessaoLocal(reg.id, {
                ...reg.estado,
                passo: passoEfetivoSessao(reg.estado),
            })
            await recarregarSessoes()
            setHistAberto(false)
            setFeedback(`Sessão restaurada (${formatarQuandoSessao(reg.atualizadoEm)}).`)
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setProcessando(false)
        }
    }

    const excluirSessao = async (id, ev) => {
        ev?.stopPropagation?.()
        try {
            await excluirSessaoLocal(id)
            if (sessaoIdRef.current === id) sessaoIdRef.current = null
            await recarregarSessoes()
            setFeedback('Sessão excluída.')
        } catch (e) {
            setErro(e?.message || String(e))
        }
    }

    const registrarRevisao = async (item, acao, extra = {}) => {
        const agora = new Date().toISOString()
        const revisao = {
            acao,
            usuario: profile?.nome || userId || '',
            dataHora: agora,
            justificativa: extra.justificativa || '',
            resultadoId: item.id,
            ignorar: acao === 'ignorar',
            ...extra,
        }
        if (acao === 'parear') {
            const oposto = resultados.find((r) => r.id === extra.opostoId)
            if (!oposto) {
                setErro('Escolha uma entrada do relatório oposto para encaixar.')
                return
            }
            const hon =
                item.status === 'ORFAO_HONORARIOS' ? item.honorarios : oposto.honorarios
            const mel = item.status === 'ORFAO_MELLISLAB' ? item.mellis : oposto.mellis
            if (!hon || !mel) {
                setErro('Não foi possível montar o par: falta um dos lados.')
                return
            }
            const par = {
                ...montarParManual(hon, mel, { equivalencias, aliasesPessoa }),
                revisao,
            }
            const next = resultados.filter((r) => r.id !== item.id && r.id !== oposto.id)
            next.push(par)
            setRevisoes((prev) => [...prev, revisao])
            setResultados(next)
            setResumo(resumirConferencia(next))
            setSelecionados((prev) => {
                const s = new Set(prev)
                s.delete(item.id)
                s.delete(oposto.id)
                s.add(par.id)
                return s
            })
            const fila = visiveis.length ? visiveis : resultados
            const proximo = proximoOrfaoApos(fila, item.id, [oposto.id])
            setItemAberto(proximo)
            setFeedback(
                proximo
                    ? 'Correspondência encaixada. Abrindo o próximo órfão.'
                    : 'Correspondência encaixada. Não há mais órfãos na lista.',
            )
            return
        }
        const next = resultados.map((r) =>
            r.id !== item.id ? r : aplicarAcaoNoResultado(r, acao, extra, revisao),
        )
        setRevisoes((prev) => [...prev, revisao])
        setResultados(next)
        setResumo(resumirConferencia(next))
        const avancarOrfao = acao === 'confirmar' || acao === 'ignorar'
        const fila = visiveis.length ? visiveis : resultados
        const proximo = avancarOrfao ? proximoOrfaoApos(fila, item.id) : null
        setItemAberto(proximo)
        if (acao === 'tutor_alternativo' && item.honorarios && item.mellis) {
            setAliasesPessoa((prev) => [
                ...prev,
                {
                    tipo: 'tutor',
                    nomeLab: item.mellis.tutor,
                    nomePlano: item.honorarios.tutor,
                },
            ])
        }
        if (acao === 'exame_equivalente' && item.honorarios && item.mellis) {
            setEquivalencias((prev) => [
                ...prev,
                { a: item.honorarios.exame, b: item.mellis.exame },
            ])
        }
        setFeedback('Ação registrada no histórico.')
    }

    const alternarSelecao = (id) => {
        setSelecionados((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const alternarTodosVisiveis = () => {
        setSelecionados((prev) => {
            const next = new Set(prev)
            if (todosVisiveisMarcados) {
                for (const id of idsVisiveis) next.delete(id)
            } else {
                for (const id of idsVisiveis) next.add(id)
            }
            return next
        })
    }

    const aplicarAcaoEmMassa = (acao) => {
        if (!podeEditar) return
        const alvos = resultados.filter((r) => selecionados.has(r.id) && itemAceitaAcao(r, acao))
        if (!alvos.length) {
            setErro('Nenhuma das linhas selecionadas aceita essa ação.')
            return
        }
        const agora = new Date().toISOString()
        const novasRevisoes = alvos.map((item) => ({
            acao,
            usuario: profile?.nome || userId || '',
            dataHora: agora,
            justificativa: '',
            resultadoId: item.id,
            ignorar: acao === 'ignorar',
            emMassa: true,
        }))
        const porId = new Map(novasRevisoes.map((x) => [x.resultadoId, x]))
        const idsOk = new Set(alvos.map((a) => a.id))
        const next = resultados.map((r) =>
            idsOk.has(r.id) ? aplicarAcaoNoResultado(r, acao, {}, porId.get(r.id)) : r,
        )
        setRevisoes((prev) => [...prev, ...novasRevisoes])
        setResultados(next)
        setResumo(resumirConferencia(next))
        if (acao === 'tutor_alternativo') {
            setAliasesPessoa((prev) => [
                ...prev,
                ...alvos
                    .filter((i) => i.honorarios && i.mellis)
                    .map((i) => ({
                        tipo: 'tutor',
                        nomeLab: i.mellis.tutor,
                        nomePlano: i.honorarios.tutor,
                    })),
            ])
        }
        if (acao === 'exame_equivalente') {
            setEquivalencias((prev) => [
                ...prev,
                ...alvos
                    .filter((i) => i.honorarios && i.mellis)
                    .map((i) => ({ a: i.honorarios.exame, b: i.mellis.exame })),
            ])
        }
        setSelecionados(new Set())
        const pulados = selecionados.size - alvos.length
        setFeedback(
            pulados
                ? `Ação aplicada em ${alvos.length} linha(s). ${pulados} não aceita(m) essa ação.`
                : `Ação aplicada em ${alvos.length} linha(s).`,
        )
    }

    const codigoElabDoItem = (item) => item?.honorarios?.codigo_base || item?.honorarios?.codigo || ''

    const etapas = [
        { id: 'setup', label: '1. Importar', liberada: true },
        {
            id: 'preview',
            label: '2. Prévia',
            liberada: Boolean(
                headersHonorarios.length ||
                    headersMellis.length ||
                    headersBase.length ||
                    linhasHonorarios.length,
            ),
        },
        { id: 'resultado', label: '3. Resultado', liberada: Boolean(resultados.length) },
    ]

    return (
        <main className="credenciamento_main conf_lab_page">
            <header className="conf_lab_header">
                <p className="conf_lab_kicker">Configurações</p>
                <h1>Conferência Laboratório × Plano</h1>
                <p className="conf_lab_lead">
                    O valor oficial vem da planilha Valores de Base. O Relatório Plano busca esse
                    valor pelo nome do exame (vínculos ambíguos são manuais). O Relatório
                    Laboratório traz o valor lançado.
                </p>
            </header>

            {erro ? (
                <CredenciamentoMainAlert message={erro} onClose={() => setErro('')} />
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
                {etapas.map((etapa) => (
                    <button
                        key={etapa.id}
                        type="button"
                        className={`conf_lab_step_btn${passo === etapa.id ? ' is-active' : ''}${etapa.liberada ? '' : ' is-disabled'}`}
                        disabled={!etapa.liberada}
                        onClick={() => setPasso(etapa.id)}
                    >
                        {etapa.label}
                    </button>
                ))}
            </nav>

            {passo === 'setup' || passo === 'preview' ? (
                <section className="conf_lab_card">
                    <div className="conf_lab_card_topo">
                        <h2>Importar e mapear</h2>
                        <div className="conf_lab_hist" ref={histRef}>
                            <button
                                type="button"
                                className={`conf_lab_hist_btn${histAberto ? ' is-open' : ''}`}
                                title="Sessões salvas (até 30 dias)"
                                aria-label="Sessões salvas"
                                aria-expanded={histAberto}
                                onClick={() => {
                                    setHistAberto((v) => !v)
                                    void recarregarSessoes()
                                }}
                            >
                                <IconeHistoricoSessao />
                                {sessoes.length ? (
                                    <span className="conf_lab_hist_qtd">{sessoes.length}</span>
                                ) : null}
                            </button>
                            {histAberto ? (
                                <div
                                    className="conf_lab_hist_painel"
                                    role="dialog"
                                    aria-label="Sessões salvas"
                                >
                                    <header>
                                        <strong>Sessões salvas</strong>
                                        <span>
                                            Guardadas neste computador por até 30 dias.
                                        </span>
                                    </header>
                                    {sessoes.length === 0 ? (
                                        <p className="conf_lab_muted">
                                            Nenhuma sessão nos últimos 30 dias.
                                        </p>
                                    ) : (
                                        <ul>
                                            {sessoes.map((s) => {
                                                const arqs = [
                                                    s.nomesArquivos?.plano,
                                                    s.nomesArquivos?.lab,
                                                    s.nomesArquivos?.base,
                                                ]
                                                    .filter(Boolean)
                                                    .join(' · ')
                                                return (
                                                    <li key={s.id}>
                                                        <button
                                                            type="button"
                                                            className="conf_lab_hist_item"
                                                            disabled={processando}
                                                            onClick={() =>
                                                                void restaurarSessao(s.id)
                                                            }
                                                        >
                                                            <span className="conf_lab_hist_quando">
                                                                {formatarQuandoSessao(
                                                                    s.atualizadoEm,
                                                                )}
                                                            </span>
                                                            <span className="conf_lab_hist_arqs">
                                                                {arqs || 'Planilhas importadas'}
                                                            </span>
                                                            <span className="conf_lab_hist_tot">
                                                                {s.totais.plano} plano ·{' '}
                                                                {s.totais.lab} lab
                                                                {s.totais.pares
                                                                    ? ` · ${s.totais.pares} conferidos`
                                                                    : ''}
                                                                {s.passo === 'resultado'
                                                                    ? ' · resultado'
                                                                    : ''}
                                                            </span>
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="conf_lab_hist_del"
                                                            title="Excluir sessão"
                                                            aria-label="Excluir sessão"
                                                            onClick={(ev) =>
                                                                void excluirSessao(s.id, ev)
                                                            }
                                                        >
                                                            ×
                                                        </button>
                                                    </li>
                                                )
                                            })}
                                        </ul>
                                    )}
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <div className="conf_lab_uploads conf_lab_uploads_tres">
                        <UploadZone
                            titulo="Valores de Base"
                            dica="Código | Nome | Valor (oficial)"
                            arquivo={arquivoBase}
                            nomeArquivo={nomesArquivosAtuais.base}
                            onFile={(f) => void onFileBase(f)}
                            disabled={processando || !podeEditar}
                        />
                        <UploadZone
                            titulo="Relatório Plano"
                            dica="Data | Tutor | Pet | Exame (sem valor)"
                            arquivo={arquivoHonorarios}
                            nomeArquivo={nomesArquivosAtuais.plano}
                            onFile={(f) => void onFileHonorarios(f)}
                            disabled={processando || !podeEditar}
                        />
                        <UploadZone
                            titulo="Relatório Laboratório"
                            dica="Data | Tutor | Pet | Exame | Valor"
                            arquivo={arquivoMellis}
                            nomeArquivo={nomesArquivosAtuais.lab}
                            onFile={(f) => void onFileMellis(f)}
                            disabled={processando || !podeEditar}
                        />
                    </div>

                    {headersBase.length || headersHonorarios.length || headersMellis.length ? (
                        <div className="conf_lab_map_cols">
                            <h3>Mapear colunas</h3>
                            <div className="conf_lab_map_cols_grid conf_lab_map_cols_tres">
                                <MapaColunas
                                    titulo="Valores de Base"
                                    headers={headersBase}
                                    mapCols={mapColsBase}
                                    setMapCols={setMapColsBase}
                                    campos={CAMPOS_VALORES_BASE}
                                    rotulos={{ exame: 'Nome' }}
                                />
                                <MapaColunas
                                    titulo="Relatório Plano"
                                    headers={headersHonorarios}
                                    mapCols={mapColsHonorarios}
                                    setMapCols={setMapColsHonorarios}
                                    campos={CAMPOS_PLANO}
                                />
                                <MapaColunas
                                    titulo="Relatório Laboratório"
                                    headers={headersMellis}
                                    mapCols={mapColsMellis}
                                    setMapCols={setMapColsMellis}
                                    campos={CAMPOS_LABORATORIO}
                                />
                            </div>
                            {(faltBase.length || faltHonorarios.length || faltMellis.length) && (
                                <p className="conf_lab_muted">
                                    Faltando Base: {faltBase.join(', ') || '—'} · Plano:{' '}
                                    {faltHonorarios.join(', ') || '—'} · Laboratório:{' '}
                                    {faltMellis.join(', ') || '—'}
                                </p>
                            )}
                        </div>
                    ) : null}

                    {passo === 'preview' ? (
                        <>
                            <div className="conf_lab_preview_grid conf_lab_preview_tres">
                                <PreviewTabela
                                    titulo="Prévia Valores de Base"
                                    linhas={linhasBase}
                                    colunas={[
                                        { key: 'codigo', label: 'Código' },
                                        { key: 'nome', label: 'Nome' },
                                        { key: 'valor', label: 'Valor', tipo: 'valor' },
                                    ]}
                                />
                                <PreviewTabela
                                    titulo="Prévia Relatório Plano"
                                    linhas={planoComBase}
                                    colunas={[
                                        { key: 'tutor', label: 'Tutor' },
                                        { key: 'pet', label: 'Pet' },
                                        { key: 'data', label: 'Data', tipo: 'data' },
                                        { key: 'exame', label: 'Exame' },
                                        { key: 'codigo_base', label: 'Cód. base' },
                                        { key: 'valor_base', label: 'Valor base', tipo: 'valor' },
                                    ]}
                                />
                                <PreviewTabela
                                    titulo="Prévia Relatório Laboratório"
                                    linhas={linhasMellis}
                                />
                            </div>
                            {pendentesVinculo.length ? (
                                <div className="conf_lab_vinculos">
                                    <h3>Vincular exames do plano à lista de Valores de Base</h3>
                                    <p className="conf_lab_muted">
                                        Nome sem correspondência única. Escolha o item desta
                                        conferência. Não escolhemos automaticamente.
                                    </p>
                                    <ul>
                                        {pendentesVinculo.map((p) => (
                                            <li key={p.chave}>
                                                <span className="conf_lab_vinculo_meta">
                                                    <strong>{p.exame}</strong>
                                                    <em>
                                                        {p.valores.length
                                                            ? p.valores
                                                                  .map((v) => formatarValorConferencia(v))
                                                                  .join(' · ')
                                                            : 'sem valor de base'}
                                                    </em>
                                                    <small>
                                                        {p.qtd} incidência{p.qtd === 1 ? '' : 's'}
                                                        {p.tipo === 'ambiguo' ? ' · ambíguo' : ''}
                                                    </small>
                                                </span>
                                                <ComboExame
                                                    itens={itensExameBase}
                                                    value={vinculosBase[p.chave] || ''}
                                                    placeholder="Buscar código ou nome…"
                                                    vazio="Nenhum exame na Valores de Base"
                                                    onChange={(id) => {
                                                        setVinculosBase((prev) => {
                                                            const next = { ...prev }
                                                            if (!id) delete next[p.chave]
                                                            else next[p.chave] = id
                                                            return next
                                                        })
                                                    }}
                                                />
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ) : linhasHonorarios.length && linhasBase.length ? (
                                <p className="conf_lab_muted">
                                    Todos os exames do plano têm valor de base único.
                                </p>
                            ) : null}
                        </>
                    ) : null}

                    <div className="conf_lab_actions">
                        <button
                            type="button"
                            className="credenciamento_main_action_btn secondary"
                            disabled={processando || !podeEditar}
                            onClick={() => setRegrasAberto(true)}
                        >
                            Equivalências e perfis
                        </button>
                        <button
                            type="button"
                            className="credenciamento_main_action_btn secondary"
                            disabled={
                                processando || !arquivoHonorarios || !arquivoMellis || !arquivoBase
                            }
                            onClick={() => void reparseComMapeamento()}
                        >
                            {processando ? 'Lendo…' : 'Atualizar prévia'}
                        </button>
                        <button
                            type="button"
                            className="credenciamento_main_action_btn"
                            disabled={!podeComparar || processando}
                            onClick={() => void executarComparacao()}
                        >
                            {processando ? 'Comparando…' : 'Executar comparação'}
                        </button>
                    </div>
                </section>
            ) : null}

            {passo === 'resultado' && resumo ? (
                <section className="conf_lab_card">
                    <h2>Resultado da conferência</h2>
                    <div className="conf_lab_dash">
                        <DashCard
                            label="Total valor de base"
                            valor={formatarValorConferencia(resumo.totalHonorarios)}
                        />
                        <DashCard
                            label="Total laboratório"
                            valor={formatarValorConferencia(resumo.totalMellis)}
                        />
                        <DashCard label="Itens conferidos" valor={resumo.itensConferidos} />
                        <DashCard label="Itens OK" valor={resumo.itensOk} destaque="ok" />
                        <DashCard
                            label="Valores divergentes"
                            valor={resumo.valoresDivergentes}
                            destaque="warn"
                        />
                        <DashCard
                            label="Datas divergentes"
                            valor={resumo.datasDivergentes}
                            destaque="warn"
                        />
                        <DashCard label="Órfãos Laboratório" valor={resumo.orfaosMellis} />
                        <DashCard label="Órfãos Plano" valor={resumo.orfaosHonorarios} />
                        <DashCard
                            label="Revisões manuais"
                            valor={resumo.revisoesManuais}
                            destaque="rev"
                        />
                        <DashCard
                            label="Diferença financeira"
                            valor={`${formatarValorConferencia(resumo.diferencaFinanceira)} (${resumo.diferencaFinanceira >= 0 ? 'a mais' : 'a menos'})`}
                            destaque="warn"
                        />
                    </div>
                    <p className="conf_lab_muted">
                        Cobrado a mais: {formatarValorConferencia(resumo.valoresCobradosAMais)} · a
                        menos: {formatarValorConferencia(resumo.valoresCobradosAMenos)}
                    </p>

                    <div className="conf_lab_filtros">
                        {FILTROS_RAPIDOS.map((f) => (
                            <button
                                key={f.id}
                                type="button"
                                className={`conf_lab_chip${filtro === f.id ? ' is-active' : ''}`}
                                onClick={() => setFiltro(f.id)}
                            >
                                {f.label}
                            </button>
                        ))}
                        <input
                            type="search"
                            value={busca}
                            onChange={(e) => setBusca(e.target.value)}
                            placeholder="Busca textual…"
                            className="conf_lab_busca"
                        />
                    </div>

                    {podeEditar && selecionados.size > 0 ? (
                        <div className="conf_lab_massa" role="toolbar" aria-label="Ações em massa">
                            <strong>
                                {selecionados.size} selecionada{selecionados.size === 1 ? '' : 's'}
                            </strong>
                            {ACOES_MASSA.map((a) => (
                                <button
                                    key={a.id}
                                    type="button"
                                    className={`credenciamento_main_action_btn${a.id === 'confirmar' ? '' : ' secondary'}`}
                                    onClick={() => aplicarAcaoEmMassa(a.id)}
                                >
                                    {a.label}
                                </button>
                            ))}
                            <button
                                type="button"
                                className="credenciamento_main_action_btn secondary"
                                onClick={() => setSelecionados(new Set())}
                            >
                                Limpar seleção
                            </button>
                        </div>
                    ) : null}

                    <div className="conf_lab_table_wrap conf_lab_table_wrap_compact">
                        <table className="conf_lab_table conf_lab_table_compact">
                            <thead>
                                <tr>
                                    <th className="conf_lab_col_sel">
                                        {podeEditar ? (
                                            <CheckboxIndeterminado
                                                checked={todosVisiveisMarcados}
                                                indeterminate={
                                                    algunsVisiveisMarcados && !todosVisiveisMarcados
                                                }
                                                onChange={alternarTodosVisiveis}
                                                label="Selecionar todas as linhas visíveis"
                                            />
                                        ) : null}
                                    </th>
                                    <ThOrdenavel
                                        coluna="status"
                                        ordem={ordem}
                                        onOrdenar={alternarOrdem}
                                        className="conf_lab_col_status"
                                    >
                                        Status
                                    </ThOrdenavel>
                                    <th className="conf_lab_col_origem" aria-label="Origem" />
                                    <ThOrdenavel coluna="tutor" ordem={ordem} onOrdenar={alternarOrdem}>
                                        Tutor
                                    </ThOrdenavel>
                                    <ThOrdenavel coluna="animal" ordem={ordem} onOrdenar={alternarOrdem}>
                                        Animal
                                    </ThOrdenavel>
                                    <ThOrdenavel
                                        coluna="data"
                                        ordem={ordem}
                                        onOrdenar={alternarOrdem}
                                        className="conf_lab_col_data"
                                    >
                                        Data
                                    </ThOrdenavel>
                                    <ThOrdenavel coluna="exame" ordem={ordem} onOrdenar={alternarOrdem}>
                                        Exame
                                    </ThOrdenavel>
                                    <ThOrdenavel
                                        coluna="valor"
                                        ordem={ordem}
                                        onOrdenar={alternarOrdem}
                                        className="conf_lab_col_valor"
                                    >
                                        Valor
                                    </ThOrdenavel>
                                    <ThOrdenavel
                                        coluna="difdias"
                                        ordem={ordem}
                                        onOrdenar={alternarOrdem}
                                        className="conf_lab_col_difdias"
                                    >
                                        Dif dias
                                    </ThOrdenavel>
                                    <ThOrdenavel
                                        coluna="difvalor"
                                        ordem={ordem}
                                        onOrdenar={alternarOrdem}
                                        className="conf_lab_col_difvalor"
                                    >
                                        Dif Valor
                                    </ThOrdenavel>
                                    <ThOrdenavel
                                        coluna="confianca"
                                        ordem={ordem}
                                        onOrdenar={alternarOrdem}
                                        className="conf_lab_col_conf"
                                    >
                                        Confiança
                                    </ThOrdenavel>
                                    <ThOrdenavel coluna="resultado" ordem={ordem} onOrdenar={alternarOrdem}>
                                        Resultado
                                    </ThOrdenavel>
                                </tr>
                            </thead>
                            {visiveis.map((r, i) => (
                                <tbody
                                    key={r.id}
                                    className={`conf_lab_par ${classeStatus(r.status)}${selecionados.has(r.id) ? ' is-sel' : ''}`}
                                    onClick={(e) => {
                                        if (cliqueAbreDetalhe(e)) setItemAberto(r)
                                    }}
                                >
                                    <tr>
                                        <td className="conf_lab_col_sel" rowSpan={2}>
                                            {podeEditar ? (
                                                <input
                                                    type="checkbox"
                                                    checked={selecionados.has(r.id)}
                                                    onChange={() => alternarSelecao(r.id)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    aria-label={`Selecionar linha ${i + 1}`}
                                                />
                                            ) : (
                                                i + 1
                                            )}
                                        </td>
                                        <td className="conf_lab_col_status" rowSpan={2}>
                                            <span className={`conf_lab_badge ${classeStatus(r.status)}`}>
                                                {rotuloStatusConferencia(r.status)}
                                            </span>
                                        </td>
                                        <td className="conf_lab_col_origem">
                                            <img
                                                src={logoE}
                                                alt="Plano"
                                                title="Plano"
                                                className="conf_lab_ico_plano"
                                            />
                                        </td>
                                        <td>{r.honorarios ? r.tutor_honorarios || '—' : '—'}</td>
                                        <td>{r.honorarios ? r.pet_honorarios || '—' : '—'}</td>
                                        <td className="conf_lab_col_data">
                                            {r.honorarios
                                                ? formatarDataConferencia(r.data_honorarios)
                                                : '—'}
                                        </td>
                                        <td>
                                            {r.honorarios ? r.exame_honorarios || '—' : '—'}
                                        </td>
                                        <td className="conf_lab_col_valor">
                                            {r.honorarios
                                                ? formatarValorConferencia(r.valor_honorarios)
                                                : '—'}
                                        </td>
                                        <td className="conf_lab_col_difdias" rowSpan={2}>
                                            {r.diferenca_dias ?? '—'}
                                        </td>
                                        <td className="conf_lab_col_difvalor" rowSpan={2}>
                                            {textoDiferencaValor(r)}
                                        </td>
                                        <td className="conf_lab_col_conf" rowSpan={2}>
                                            {r.confianca || '—'}
                                        </td>
                                        <td className="conf_lab_col_resultado" rowSpan={2}>
                                            <span>{r.motivo || '—'}</span>
                                            <small>{r.revisao?.acao || r.acao || 'Revisar'}</small>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td className="conf_lab_col_origem">
                                            <span
                                                className="conf_lab_ico_lab"
                                                title="Laboratório"
                                                aria-label="Laboratório"
                                            >
                                                <span className="conf_lab_frasco" aria-hidden="true" />
                                            </span>
                                        </td>
                                        <td>{r.mellis ? r.tutor_mellislab || '—' : '—'}</td>
                                        <td>{r.mellis ? r.pet_mellislab || '—' : '—'}</td>
                                        <td className="conf_lab_col_data">
                                            {r.mellis ? formatarDataConferencia(r.data_mellislab) : '—'}
                                        </td>
                                        <td>{r.mellis ? r.exame_mellislab || '—' : '—'}</td>
                                        <td className="conf_lab_col_valor">
                                            {r.mellis
                                                ? formatarValorConferencia(r.valor_mellislab)
                                                : '—'}
                                        </td>
                                    </tr>
                                </tbody>
                            ))}
                        </table>
                    </div>

                    <div className="conf_lab_orfaos_grid">
                        <div>
                            <h3>Órfãos Laboratório</h3>
                            <ul>
                                {orfaosMellis.map((r) => (
                                    <li key={r.id}>
                                        <button type="button" onClick={() => setItemAberto(r)}>
                                            {r.tutor_mellislab} · {r.pet_mellislab} ·{' '}
                                            {formatarDataConferencia(r.data_mellislab)} · {r.exame_mellislab}{' '}
                                            · {formatarValorConferencia(r.valor_mellislab)} (linha{' '}
                                            {r.mellis?.linha_original || '—'})
                                        </button>
                                    </li>
                                ))}
                                {!orfaosMellis.length ? (
                                    <li className="conf_lab_muted">Nenhum órfão no laboratório.</li>
                                ) : null}
                            </ul>
                        </div>
                        <div>
                            <h3>Órfãos Plano</h3>
                            <ul>
                                {orfaosHonorarios.map((r) => (
                                    <li key={r.id}>
                                        <button type="button" onClick={() => setItemAberto(r)}>
                                            {r.tutor_honorarios} · {r.pet_honorarios} ·{' '}
                                            {formatarDataConferencia(r.data_honorarios)} · {r.exame_honorarios}{' '}
                                            · {formatarValorConferencia(r.valor_honorarios)} (linha{' '}
                                            {r.honorarios?.linha_original || '—'})
                                        </button>
                                    </li>
                                ))}
                                {!orfaosHonorarios.length ? (
                                    <li className="conf_lab_muted">Nenhum órfão no plano.</li>
                                ) : null}
                            </ul>
                        </div>
                    </div>

                    <div className="conf_lab_actions">
                        <button
                            type="button"
                            className="credenciamento_main_action_btn secondary"
                            onClick={() => setRegrasAberto(true)}
                        >
                            Equivalências e perfis
                        </button>
                        <button
                            type="button"
                            className="credenciamento_main_action_btn"
                            onClick={() =>
                                void exportarConferenciaHonorariosExcel({
                                    resultados,
                                    resumo,
                                    revisoes,
                                })
                            }
                        >
                            Exportar Excel
                        </button>
                    </div>
                </section>
            ) : null}

            <PainelDetalheConferencia
                item={itemAberto}
                codigoElab={itemAberto ? codigoElabDoItem(itemAberto) : ''}
                onClose={() => setItemAberto(null)}
                onAcao={(acao, extra) => itemAberto && void registrarRevisao(itemAberto, acao, extra)}
                podeEditar={podeEditar}
                orfaosPlano={orfaosHonorarios}
                orfaosLab={orfaosMellis}
            />
            <CadastroRegrasConferencia
                aberto={regrasAberto}
                onClose={() => setRegrasAberto(false)}
                equivalencias={equivalencias}
                perfis={perfis}
                examesOpcoes={nomesExameOpcoes}
                onSalvarEquivalencia={(a, b) => {
                    if (!String(a || '').trim() || !String(b || '').trim()) {
                        setErro('Informe os dois nomes da equivalência.')
                        return
                    }
                    setEquivalencias((prev) => [...prev, { a: a.trim(), b: b.trim() }])
                    setFeedback('Equivalência adicionada nesta conferência.')
                }}
                onSalvarPerfil={(dados) => {
                    if (!String(dados?.nome || '').trim()) {
                        setErro('Informe o nome do perfil.')
                        return
                    }
                    setPerfis((prev) => [...prev, dados])
                    setFeedback('Perfil adicionado nesta conferência.')
                }}
            />
        </main>
    )
}

export default ConfigConferenciaLaboratorio
