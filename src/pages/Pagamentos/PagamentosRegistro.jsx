import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PrestadorVinculoBusca from '../Supertabela/Supertabela_negociacoes/PrestadorVinculoBusca.jsx'
import { buscarTodosPaginado, getReadOnlyFlag, setReadOnlyFlag, supabase } from '../../lib/supabase.js'
import { bloquearSeSomenteLeitura } from '../../lib/readOnlyGuard.js'
import {
    ACCESS_PROFILE_CHANGE_EVENT,
    PERMISSION_KEYS,
    getStoredAccessProfile,
    hasPermission,
    normalizarProfileAcesso,
    setStoredAccessProfile,
    usuarioSomenteLeituraGlobal,
} from '../../lib/accessControl.js'
import { normalizarTextoBusca, TIPOS_REPASSE } from '../../lib/prestadorCadastroHelpers.js'
import {
    dadosRepasseDoPrestador,
    registroComRepasseDoPrestador,
    resolverPrestadorPorNome,
    rotuloMesAnoCurto,
    rotuloTipoRepasse,
    sincronizarRepasseRegistrosComPrestadores,
    sugerirPrestadoresPorNome,
} from '../../lib/pagamentosPrestador.js'
import {
    atualizarPagamentoRegistro,
    encontrarDuplicataPrestadorCompetencia,
    excluirPagamentoRegistro,
    formatarDataAtualizadoEm,
    inserirPagamentoRegistro,
    agruparPendenciasPorPrestador,
    listarPagamentosPendentesNota,
    listarPagamentosRegistros,
    listarPagamentosRegistrosIntervalo,
    mensagemDuplicataPrestadorCompetencia,
    normalizarIntervaloCompetencia,
    registroNoIntervaloCompetencia,
} from '../../lib/pagamentosRegistros.js'
import {
    formatarValorMonetarioBr,
    normalizarValorMonetarioEntrada,
    ehTipoRpa,
    valorLiquidoRpa,
} from '../../lib/pagamentosValor.js'
import { lerRelatorioXlsx, linhasResumoMassa } from '../../lib/repasse/lerRelatorioExcel.js'
import {
    contarMesesEmAbertoPorPrestador,
    criarRelatorios,
    desfazerPagamento,
    lerConfigRepasse,
    linkDoRelatorio,
    listarRelatoriosPorRegistros,
} from '../../lib/repasse/repasseApi.js'
import { ehCompetenciaNovoModelo, rotuloStatusRelatorio } from '../../lib/repasse/repasseCore.js'
import { avisar } from '../../lib/dialogos.js'
import PagamentosEnvioWizard from './PagamentosEnvioWizard.jsx'
import PagamentosComprovanteModal from './PagamentosComprovanteModal.jsx'
import PagamentosMenuFlutuante from './PagamentosMenuFlutuante.jsx'
import PagamentosPainelPrestador from './PagamentosPainelPrestador.jsx'
import PagamentosAPagar from './PagamentosAPagar.jsx'
import './PagamentosRegistro.css'
import PagamentosExportarModal from './PagamentosExportarModal.jsx'
import { useSfscExclusaoConfirm } from '../../hooks/useSfscExclusaoConfirm.jsx'
import { Button, Modal, PageHeader, Toolbar } from '../../components/ui'
import { SelectDropdown } from '../../components/ui/Dropdown.jsx'

const hoje = new Date()
const MES_ATUAL = hoje.getMonth() + 1
const ANO_ATUAL = hoje.getFullYear()

const OPCOES_TIPO_FILTRO = [
    { value: '', label: 'Todos os tipos' },
    { value: 'rpa', label: 'RPA' },
    { value: 'rpa_sd', label: 'RPA s/desc.' },
    { value: 'nota', label: 'Nota fiscal' },
    { value: 'boleto', label: 'Boleto' },
]

const OPCOES_FILTRO_SIM_NAO = [
    { value: '', label: 'Todos' },
    { value: 'sim', label: 'Sim' },
    { value: 'nao', label: 'Não' },
]

function mesAnoParaInputMonth(mes, ano) {
    const m = Number(mes)
    const a = Number(ano)
    if (!m || m < 1 || m > 12 || !a) return ''
    return `${a}-${String(m).padStart(2, '0')}`
}

function parseInputMonth(value) {
    const hit = String(value || '').match(/^(\d{4})-(\d{2})$/)
    if (!hit) return null
    const ano = Number(hit[1])
    const mes = Number(hit[2])
    if (!Number.isFinite(ano) || !Number.isFinite(mes) || mes < 1 || mes > 12) return null
    return { mes, ano }
}

function parseBooleanMassa(raw) {
    if (raw == null) return undefined
    const s = String(raw).trim()
    if (!s) return undefined
    const n = s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
    if (['true', 'verdadeiro', 'sim', 's', '1', 'yes', 'y', 'x', 'v'].includes(n)) return true
    if (['false', 'falso', 'nao', 'n', '0', 'no'].includes(n)) return false
    return null
}

function parseCompetenciaMassa(raw) {
    const s = String(raw || '').trim()
    const m = s.match(/^(\d{1,2})\s*\/\s*(\d{2,4})$/)
    if (!m) return null
    const mes = Number(m[1])
    let ano = Number(m[2])
    if (ano >= 0 && ano < 100) ano += 2000
    if (!Number.isFinite(mes) || !Number.isFinite(ano) || mes < 1 || mes > 12 || ano < 2000 || ano > 2100) {
        return null
    }
    return { mes, ano }
}

function pareceCompetenciaMassa(raw) {
    return /^\d{1,2}\s*\/\s*\d{2,4}$/.test(String(raw || '').trim())
}

function splitLinhaMassa(linha) {
    const vazio = {
        nome: '',
        valorTexto: '',
        resposta: undefined,
        pago: undefined,
        respostaRaw: '',
        pagoRaw: '',
        extras: [],
        competencia: null,
        competenciaRaw: '',
        competenciaInvalida: false,
    }
    const s = String(linha || '').trim()
    if (!s) return { ...vazio }

    const sep = s.includes('\t') ? '\t' : s.includes(';') ? ';' : null
    if (!sep) return { ...vazio, nome: s }

    const parts = s.split(sep).map((p) => p.trim())
    const comp = parseCompetenciaMassa(parts[0])

    if (comp) {
        const nome = parts[1] || ''
        const valorTexto = parts[2] || ''
        const respostaRaw = parts.length > 3 ? parts[3] : ''
        const pagoRaw = parts.length > 4 ? parts[4] : ''
        const resposta = respostaRaw ? parseBooleanMassa(respostaRaw) : undefined
        const pago = pagoRaw ? parseBooleanMassa(pagoRaw) : undefined
        return {
            nome,
            valorTexto,
            resposta,
            pago,
            respostaRaw,
            pagoRaw,
            extras: parts.slice(5),
            competencia: comp,
            competenciaRaw: parts[0],
            competenciaInvalida: false,
        }
    }

    if (pareceCompetenciaMassa(parts[0])) {
        return {
            ...vazio,
            competenciaRaw: parts[0],
            competenciaInvalida: true,
            extras: parts.slice(1),
        }
    }

    const nome = parts[0] || ''
    const valorTexto = parts[1] || ''
    const respostaRaw = parts.length > 2 ? parts[2] : ''
    const pagoRaw = parts.length > 3 ? parts[3] : ''
    const resposta = respostaRaw ? parseBooleanMassa(respostaRaw) : undefined
    const pago = pagoRaw ? parseBooleanMassa(pagoRaw) : undefined
    return {
        nome,
        valorTexto,
        resposta,
        pago,
        respostaRaw,
        pagoRaw,
        extras: parts.slice(4),
        competencia: null,
        competenciaRaw: '',
        competenciaInvalida: false,
    }
}

/** Colunas (Tab ou ;): [MM/AAAA] prestador valor resposta pago — competência opcional na 1ª coluna. */
function parseLinhasInclusaoMassa(texto) {
    const brutas = String(texto || '').replace(/\r/g, '').split('\n')
    const itens = []
    brutas.forEach((bruta, idx) => {
        const trimmed = bruta.trim()
        if (!trimmed) return
        const parsed = splitLinhaMassa(trimmed)
        itens.push({
            linha: idx + 1,
            bruta: trimmed,
            ...parsed,
        })
    })
    return itens
}

function rotuloIntervaloCompetencia(mesDe, anoDe, mesAte, anoAte) {
    const { de, ate } = normalizarIntervaloCompetencia(mesDe, anoDe, mesAte, anoAte)
    const a = rotuloMesAnoCurto(de.mes, de.ano)
    const b = rotuloMesAnoCurto(ate.mes, ate.ano)
    if (a === b) return a
    return `${a} – ${b}`
}

export default function PagamentosRegistro() {
    const [perfilAcesso, setPerfilAcesso] = useState(() => getStoredAccessProfile())
    const [somenteLeitura, setSomenteLeitura] = useState(() => getReadOnlyFlag())
    const podeEditar =
        hasPermission(perfilAcesso, PERMISSION_KEYS.PAGAMENTOS_EDIT) && !somenteLeitura

    useEffect(() => {
        const syncPerfil = async () => {
            const { data: userData } = await supabase.auth.getUser()
            const userId = userData?.user?.id
            if (!userId) return
            const { data: profileData } = await supabase
                .from('profiles')
                .select('id, name, email, permissions')
                .eq('id', userId)
                .maybeSingle()
            if (!profileData) return
            const normalizado = normalizarProfileAcesso(profileData)
            setStoredAccessProfile(normalizado)
            setReadOnlyFlag(usuarioSomenteLeituraGlobal(normalizado))
            setPerfilAcesso(normalizado)
            setSomenteLeitura(getReadOnlyFlag())
        }
        const onPerfil = () => {
            setPerfilAcesso(getStoredAccessProfile())
            setSomenteLeitura(getReadOnlyFlag())
        }
        void syncPerfil()
        window.addEventListener(ACCESS_PROFILE_CHANGE_EVENT, onPerfil)
        return () => window.removeEventListener(ACCESS_PROFILE_CHANGE_EVENT, onPerfil)
    }, [])

    const [prestadores, setPrestadores] = useState([])
    const [registros, setRegistros] = useState([])
    const [loading, setLoading] = useState(true)
    const [salvandoId, setSalvandoId] = useState('')
    const [erro, setErro] = useState('')
    const [info, setInfo] = useState('')

    const [filtroMesDe, setFiltroMesDe] = useState(MES_ATUAL)
    const [filtroAnoDe, setFiltroAnoDe] = useState(ANO_ATUAL)
    const [filtroMesAte, setFiltroMesAte] = useState(MES_ATUAL)
    const [filtroAnoAte, setFiltroAnoAte] = useState(ANO_ATUAL)
    const [buscaNome, setBuscaNome] = useState('')
    const [filtroTipo, setFiltroTipo] = useState('')
    const [filtroResposta, setFiltroResposta] = useState('')
    const [filtroPago, setFiltroPago] = useState('')
    const [ordenarCol, setOrdenarCol] = useState('prestador')
    const [ordenarDir, setOrdenarDir] = useState('asc')

    const [massaAberta, setMassaAberta] = useState(false)
    const [exportModalAberto, setExportModalAberto] = useState(false)
    const [massaMes, setMassaMes] = useState(MES_ATUAL)
    const [massaAno, setMassaAno] = useState(ANO_ATUAL)
    const [massaLinhas, setMassaLinhas] = useState('')
    const [massaColando, setMassaColando] = useState(false)
    const [relatorioXlsx, setRelatorioXlsx] = useState(null)
    const [relatorioXlsxLendo, setRelatorioXlsxLendo] = useState(false)
    const [relatorioXlsxErro, setRelatorioXlsxErro] = useState('')
    const [arrastandoXlsx, setArrastandoXlsx] = useState(false)
    const xlsxInputRef = useRef(null)
    // Repasse mensal: relatórios por registro (null = tabelas ainda indisponíveis), config e modais.
    const [relatorios, setRelatorios] = useState(null)
    const [configRepasse, setConfigRepasse] = useState(null)
    const [filtroRelatorio, setFiltroRelatorio] = useState('')
    const [wizardAberto, setWizardAberto] = useState(false)
    const [comprovanteAlvo, setComprovanteAlvo] = useState(null)
    /** Menu flutuante aberto na tabela: { tipo: 'repasse' | 'acoes', id, el }. */
    const [menuAberto, setMenuAberto] = useState(null)
    const fecharMenu = useCallback(() => setMenuAberto(null), [])
    /** Painel lateral do prestador e fluxo «desfazer pagamento». */
    const [painelPrestador, setPainelPrestador] = useState(null)
    const [desfazendo, setDesfazendo] = useState(null)
    const [motivoDesfazer, setMotivoDesfazer] = useState('')
    const [desfazendoOcupado, setDesfazendoOcupado] = useState(false)
    /** Atalho de fila: '' | 'acao' | 'pagar' | 'divergente'. */
    const [filaRapida, setFilaRapida] = useState(() => {
        try {
            return new URLSearchParams(window.location.search).get('fila') === 'pagar' ? 'pagar' : ''
        } catch {
            return ''
        }
    })
    /** «Aprovados a pagar» (ex-Resumo): resposta marcada e ainda não pago, em todas as competências. */
    const [pendentesPagar, setPendentesPagar] = useState([])
    const [pendentesCarregando, setPendentesCarregando] = useState(true)
    const carregarPendentes = useCallback(async () => {
        try {
            setPendentesPagar(await listarPagamentosPendentesNota())
        } catch {
            setPendentesPagar([])
        } finally {
            setPendentesCarregando(false)
        }
    }, [])
    const assinaturaPendentes = useMemo(() => registros.filter((r) => r.resposta && !r.pago).length + ':' + registros.length, [registros])
    useEffect(() => {
        void carregarPendentes()
    }, [carregarPendentes, assinaturaPendentes])
    const qtdPrestadoresAPagar = useMemo(() => agruparPendenciasPorPrestador(pendentesPagar).length, [pendentesPagar])
    /** «Habilitar edição»: desligado, prestador e valor aparecem como texto (sem contorno) e não editam. */
    const [edicaoAtiva, setEdicaoAtiva] = useState(() => {
        try {
            return window.localStorage.getItem('pag_reg_edicao') === '1'
        } catch {
            return false
        }
    })
    const alternarEdicao = useCallback((ligada) => {
        setEdicaoAtiva(ligada)
        try {
            window.localStorage.setItem('pag_reg_edicao', ligada ? '1' : '0')
        } catch {
            /* sem armazenamento: vale só nesta sessão */
        }
    }, [])
    /** Meses não pagos por prestador (todas as competências), para o aviso ao lado de «Ver meses». */
    const [mesesAbertos, setMesesAbertos] = useState(() => new Map())
    const assinaturaAbertos = useMemo(() => registros.filter((r) => !r.pago).length + ':' + registros.length, [registros])
    useEffect(() => {
        if (!registros.length) return undefined
        let ativo = true
        contarMesesEmAbertoPorPrestador({ forcar: true })
            .then((m) => ativo && setMesesAbertos(m))
            .catch(() => {})
        return () => {
            ativo = false
        }
    }, [assinaturaAbertos])
    const rotuloVerMeses = (row) => {
        const total = mesesAbertos.get(String(row.prestadorId)) || 0
        const outros = total - (row.pago ? 0 : 1)
        return outros > 0 ? { texto: `Ver meses · +${outros} em aberto`, alerta: true } : { texto: 'Ver meses', alerta: false }
    }
    const [repasseOcupado, setRepasseOcupado] = useState('')
    const [resumoRelatorios, setResumoRelatorios] = useState(null)
    const [resumoMassa, setResumoMassa] = useState(null)
    const [resumoMassaSelecao, setResumoMassaSelecao] = useState({})
    const [resumoMassaBuscaId, setResumoMassaBuscaId] = useState('')
    const [resumoMassaVinculandoId, setResumoMassaVinculandoId] = useState('')

    const [valorEdicao, setValorEdicao] = useState({})

    const { askExclusao, exclusaoToast } = useSfscExclusaoConfirm()

    const rotuloPrestador = useCallback((p) => p?.nome || '', [])

    const carregarPrestadores = useCallback(async () => {
        const { data, error } = await buscarTodosPaginado(() =>
            supabase
                .from('prestadores')
                .select('id, nome, chave_pix, tipo_pix, tipo_repasse')
                .eq('ativo', true)
                .order('nome', { ascending: true }),
        )
        if (error) throw new Error(error.message)
        setPrestadores(data || [])
    }, [])

    const intervaloFiltroCompetencia = useMemo(
        () =>
            normalizarIntervaloCompetencia(
                filtroMesDe,
                filtroAnoDe,
                filtroMesAte,
                filtroAnoAte,
            ),
        [filtroMesDe, filtroAnoDe, filtroMesAte, filtroAnoAte],
    )

    const rotuloFiltroCompetencia = useMemo(
        () => rotuloIntervaloCompetencia(filtroMesDe, filtroAnoDe, filtroMesAte, filtroAnoAte),
        [filtroMesDe, filtroAnoDe, filtroMesAte, filtroAnoAte],
    )

    const ocultarColunaMes = useMemo(() => {
        const { de, ate } = intervaloFiltroCompetencia
        return Number(de.mes) === Number(ate.mes) && Number(de.ano) === Number(ate.ano)
    }, [intervaloFiltroCompetencia])

    const colSpanTabelaVazia = 7 - (ocultarColunaMes ? 1 : 0) + (relatorios !== null ? 1 : 0)

    const competenciaNovaLinha = useMemo(() => {
        const { ate } = intervaloFiltroCompetencia
        if (registroNoIntervaloCompetencia({ mes: MES_ATUAL, ano: ANO_ATUAL }, intervaloFiltroCompetencia)) {
            return { mes: MES_ATUAL, ano: ANO_ATUAL }
        }
        return { mes: ate.mes, ano: ate.ano }
    }, [intervaloFiltroCompetencia])

    const carregarRegistros = useCallback(async () => {
        setLoading(true)
        setErro('')
        try {
            const lista = await listarPagamentosRegistrosIntervalo(
                filtroMesDe,
                filtroAnoDe,
                filtroMesAte,
                filtroAnoAte,
            )
            setRegistros(lista)
        } catch (e) {
            const msg = e?.message || 'Falha ao carregar pagamentos.'
            const hint =
                /pagamentos_registros|schema cache/i.test(msg)
                    ? ' Execute no Supabase o script scripts/sql/pagamentos_registros.sql.'
                    : ''
            setErro(msg + hint)
            setRegistros([])
        } finally {
            setLoading(false)
        }
    }, [filtroMesDe, filtroAnoDe, filtroMesAte, filtroAnoAte])

    useEffect(() => {
        void carregarPrestadores().catch((e) => setErro(e?.message || 'Falha ao carregar prestadores.'))
    }, [carregarPrestadores])

    useEffect(() => {
        const recarregar = () => {
            void carregarPrestadores().catch(() => {})
        }
        window.addEventListener('focus', recarregar)
        return () => window.removeEventListener('focus', recarregar)
    }, [carregarPrestadores])

    useEffect(() => {
        void carregarRegistros()
    }, [carregarRegistros])

    const registrosComRepasseAtualizado = useMemo(
        () => registros.map((r) => registroComRepasseDoPrestador(r, prestadores)),
        [registros, prestadores],
    )

    useEffect(() => {
        if (loading || !prestadores.length) return
        setRegistros((prev) => {
            if (!prev.length) return prev
            const { lista, alterados } = sincronizarRepasseRegistrosComPrestadores(prev, prestadores)
            if (!alterados.length) return prev
            if (podeEditar) {
                for (const u of alterados) {
                    void atualizarPagamentoRegistro(u.id, {
                        mes: u.mes,
                        ano: u.ano,
                        prestadorId: u.prestadorId,
                        prestadorNome: u.prestadorNome,
                        tipoRepasse: u.tipoRepasse,
                        chavePix: u.chavePix,
                        valor: u.valor,
                        resposta: u.resposta,
                        pago: u.pago,
                        obs: u.obs,
                    }).catch(() => {})
                }
            }
            return lista
        })
    }, [prestadores, loading, registros.length, podeEditar])

    /** Filas do repasse (substituem abrir a Caixa para saber o que depende do financeiro). */
    const pertenceFila = useCallback(
        (r, fila) => {
            const rel = relatorios?.get(r.id)
            if (!rel) return false
            if (fila === 'divergente') return Boolean(rel.divergente)
            if (fila === 'acao') return rel.status === 'documento_em_revisao' || rel.status === 'reprovado'
            if (fila === 'pagar') return Boolean(r.resposta) && !r.pago
            return true
        },
        [relatorios],
    )

    const linhasFiltradas = useMemo(() => {
        const termo = normalizarTextoBusca(buscaNome)
        let lista = [...registrosComRepasseAtualizado]
        if (termo) {
            lista = lista.filter((r) => normalizarTextoBusca(r.prestadorNome).includes(termo))
        }
        if (filtroTipo) {
            lista = lista.filter((r) => String(r.tipoRepasse || '').toLowerCase() === filtroTipo)
        }
        if (filaRapida && relatorios) {
            lista = lista.filter((r) => pertenceFila(r, filaRapida))
        }
        if (filtroRelatorio) {
            lista = lista.filter((r) => {
                const rel = relatorios?.get(r.id)
                if (filtroRelatorio === 'divergente') return Boolean(rel?.divergente)
                if (filtroRelatorio === 'sem_relatorio') return !rel
                return rel?.status === filtroRelatorio
            })
        }
        if (filtroResposta === 'sim') lista = lista.filter((r) => r.resposta)
        if (filtroResposta === 'nao') lista = lista.filter((r) => !r.resposta)
        if (filtroPago === 'sim') lista = lista.filter((r) => r.pago)
        if (filtroPago === 'nao') lista = lista.filter((r) => !r.pago)

        const cmpStr = (a, b) => {
            const sa = String(a || '').toLowerCase()
            const sb = String(b || '').toLowerCase()
            if (sa < sb) return ordenarDir === 'asc' ? -1 : 1
            if (sa > sb) return ordenarDir === 'asc' ? 1 : -1
            return 0
        }
        const cmpNum = (a, b) => {
            const na = a == null ? -Infinity : Number(a)
            const nb = b == null ? -Infinity : Number(b)
            return ordenarDir === 'asc' ? na - nb : nb - na
        }
        const cmpBool = (a, b) => {
            const na = a ? 1 : 0
            const nb = b ? 1 : 0
            return ordenarDir === 'asc' ? na - nb : nb - na
        }

        lista.sort((a, b) => {
            switch (ordenarCol) {
                case 'mesAno':
                    return cmpNum(a.ano * 100 + a.mes, b.ano * 100 + b.mes)
                case 'tipo':
                    return cmpStr(a.tipoRepasse, b.tipoRepasse)
                case 'pix':
                    return cmpStr(a.chavePix, b.chavePix)
                case 'valor':
                    return cmpNum(a.valor, b.valor)
                case 'resposta':
                    return cmpBool(a.resposta, b.resposta)
                case 'pago':
                    return cmpBool(a.pago, b.pago)
                case 'atualizadoEm': {
                    const ta = a.atualizadoEm ? new Date(a.atualizadoEm).getTime() : 0
                    const tb = b.atualizadoEm ? new Date(b.atualizadoEm).getTime() : 0
                    return cmpNum(ta, tb)
                }
                case 'obs':
                    return cmpStr(a.obs, b.obs)
                case 'prestador':
                default:
                    return cmpStr(a.prestadorNome, b.prestadorNome)
            }
        })
        return lista
    }, [registrosComRepasseAtualizado, buscaNome, filtroTipo, filtroRelatorio, relatorios, filtroResposta, filtroPago, ordenarCol, ordenarDir, filaRapida, pertenceFila])

    const totalValor = useMemo(
        () => linhasFiltradas.reduce((s, r) => s + (Number(r.valor) || 0), 0),
        [linhasFiltradas],
    )

    const alternarOrdenacao = (col) => {
        if (ordenarCol === col) setOrdenarDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        else {
            setOrdenarCol(col)
            setOrdenarDir(col === 'valor' ? 'desc' : 'asc')
        }
    }

    const indicadorOrdem = (col) => {
        if (ordenarCol !== col) return ''
        return ordenarDir === 'asc' ? ' ▲' : ' ▼'
    }

    const persistirRegistro = useCallback(
        async (row) => {
            if (!row?.id) return
            const rowSalvar = registroComRepasseDoPrestador(row, prestadores)
            const duplicata = encontrarDuplicataPrestadorCompetencia(registros, rowSalvar, rowSalvar.id)
            if (duplicata) {
                setErro(mensagemDuplicataPrestadorCompetencia(rowSalvar))
                return
            }
            setSalvandoId(rowSalvar.id)
            setErro('')
            try {
                const atualizado = await atualizarPagamentoRegistro(rowSalvar.id, {
                    mes: rowSalvar.mes,
                    ano: rowSalvar.ano,
                    prestadorId: rowSalvar.prestadorId,
                    prestadorNome: rowSalvar.prestadorNome,
                    tipoRepasse: rowSalvar.tipoRepasse,
                    chavePix: rowSalvar.chavePix,
                    valor: rowSalvar.valor,
                    resposta: rowSalvar.resposta,
                    pago: rowSalvar.pago,
                    obs: rowSalvar.obs,
                })
                setRegistros((prev) => prev.map((r) => (r.id === atualizado.id ? atualizado : r)))
            } catch (e) {
                setErro(e?.message || 'Falha ao salvar.')
            } finally {
                setSalvandoId('')
            }
        },
        [registros, prestadores],
    )

    const aoSelecionarPrestador = useCallback(
        async (rowId, prestador) => {
            if (bloquearSeSomenteLeitura((m) => setErro(m)) || !podeEditar) return
            const row = registros.find((r) => r.id === rowId)
            if (!row) return
            const repasse = dadosRepasseDoPrestador(prestador)
            const next = {
                ...row,
                prestadorId: prestador ? String(prestador.id) : '',
                prestadorNome: prestador?.nome || '',
                tipoRepasse: repasse.tipo_repasse || '',
                chavePix: repasse.chave_pix || '',
            }
            const duplicata = encontrarDuplicataPrestadorCompetencia(registros, next, rowId)
            if (duplicata) {
                setErro(mensagemDuplicataPrestadorCompetencia(next))
                return
            }
            setRegistros((prev) => prev.map((r) => (r.id === rowId ? next : r)))
            await persistirRegistro(next)
        },
        [registros, podeEditar, persistirRegistro],
    )

    const aoAlterarCampo = useCallback(
        (rowId, patch) => {
            if (!podeEditar) return
            setRegistros((prev) => prev.map((r) => (r.id === rowId ? { ...r, ...patch } : r)))
        },
        [podeEditar],
    )

    const aoBlurCampo = useCallback(
        (rowId) => {
            const row = registros.find((r) => r.id === rowId)
            if (row) void persistirRegistro(row)
        },
        [registros, persistirRegistro],
    )

    const aoToggleCheck = useCallback(
        async (rowId, campo) => {
            if (bloquearSeSomenteLeitura((m) => setErro(m)) || !podeEditar) return
            const row = registros.find((r) => r.id === rowId)
            if (!row) return
            const next = { ...row, [campo]: !row[campo] }
            setRegistros((prev) => prev.map((r) => (r.id === rowId ? next : r)))
            await persistirRegistro(next)
        },
        [registros, podeEditar, persistirRegistro],
    )

    const adicionarLinha = useCallback(async () => {
        if (bloquearSeSomenteLeitura((m) => setErro(m)) || !podeEditar) return
        setErro('')
        try {
            const novo = await inserirPagamentoRegistro({
                mes: competenciaNovaLinha.mes,
                ano: competenciaNovaLinha.ano,
                prestadorId: '',
                prestadorNome: '',
                tipoRepasse: '',
                chavePix: '',
                valor: null,
                resposta: false,
                pago: false,
                obs: '',
            })
            setRegistros((prev) => [...prev, novo])
        } catch (e) {
            setErro(e?.message || 'Falha ao criar linha.')
        }
    }, [competenciaNovaLinha, podeEditar])

    const excluirLinha = useCallback(
        (rowId, opcoes = {}) => {
            if (bloquearSeSomenteLeitura((m) => setErro(m)) || !podeEditar) return

            const executarExclusao = async () => {
                setErro('')
                try {
                    await excluirPagamentoRegistro(rowId)
                    setRegistros((prev) => prev.filter((r) => r.id !== rowId))
                } catch (e) {
                    setErro(e?.message || 'Falha ao excluir.')
                }
            }

            if (opcoes.ignorarConfirmacao) {
                void executarExclusao()
                return
            }

            const row = registros.find((r) => r.id === rowId)
            const nome = String(row?.prestadorNome || '').trim() || 'este registro'
            askExclusao(`Excluir o pagamento de «${nome}»?`, executarExclusao)
        },
        [podeEditar, registros, askExclusao],
    )

    const processarColagemValor = useCallback(
        async (event, indiceInicial) => {
            if (bloquearSeSomenteLeitura((m) => setErro(m)) || !podeEditar) return
            event.preventDefault()
            const texto = event.clipboardData?.getData('text') || ''
            const linhasColadas = texto
                .replace(/\r/g, '')
                .split('\n')
                .map((l) => l.split('\t')[0]?.trim())
                .filter((l) => l.length > 0)
            if (!linhasColadas.length) return

            const updates = []
            for (let i = 0; i < linhasColadas.length; i += 1) {
                const row = linhasFiltradas[indiceInicial + i]
                if (!row) break
                const valor = normalizarValorMonetarioEntrada(linhasColadas[i])
                if (valor == null) {
                    setErro(`Valor inválido na colagem: «${linhasColadas[i]}»`)
                    continue
                }
                updates.push({ ...row, valor })
            }
            if (!updates.length) return
            setRegistros((prev) => {
                const mapa = new Map(updates.map((u) => [u.id, u]))
                return prev.map((r) => mapa.get(r.id) || r)
            })
            for (const u of updates) {
                await persistirRegistro(u)
            }
            setInfo(`${updates.length} valor(es) colado(s).`)
        },
        [linhasFiltradas, podeEditar, persistirRegistro],
    )

    /** Anexa o .xlsx do sistema principal: separa abas, gera o resumo e confere totais (docs/repasse-mensal.md §5). */
    const aoAnexarRelatorioXlsx = useCallback(async (arquivo) => {
        if (!arquivo) return
        setRelatorioXlsxErro('')
        setRelatorioXlsxLendo(true)
        try {
            if (!/\.xlsx$/i.test(arquivo.name)) throw new Error('Envie um arquivo .xlsx.')
            const relatorio = await lerRelatorioXlsx(arquivo)
            if (!relatorio.abas.length) throw new Error('Nenhuma aba de prestador encontrada no arquivo.')
            setRelatorioXlsx(relatorio)
            setMassaLinhas(linhasResumoMassa(relatorio.abas))
            // A competência da inclusão é escolhida pelo usuário; anexar o arquivo não a altera.
        } catch (e) {
            setRelatorioXlsx(null)
            setRelatorioXlsxErro(e?.message || 'Não foi possível ler o arquivo.')
        } finally {
            setRelatorioXlsxLendo(false)
        }
    }, [])

    // Ctrl+V com o .xlsx copiado no Explorer, enquanto a Inclusão em massa está aberta (texto colado segue normal).
    useEffect(() => {
        if (!massaAberta) return undefined
        const aoColar = (e) => {
            const f = Array.from(e.clipboardData?.files || []).find((x) => /\.xlsx$/i.test(x.name))
            if (!f) return
            e.preventDefault()
            void aoAnexarRelatorioXlsx(f)
        }
        document.addEventListener('paste', aoColar)
        return () => document.removeEventListener('paste', aoColar)
    }, [massaAberta, aoAnexarRelatorioXlsx])

    const repasseAtivo = relatorios !== null
    const novoModelo = useCallback(
        (row) => ehCompetenciaNovoModelo(row.mes, row.ano, configRepasse?.competencia_inicial || '2026-10'),
        [configRepasse],
    )

    const recarregarRelatorios = useCallback(async () => {
        try {
            setRelatorios(await listarRelatoriosPorRegistros(registros.map((r) => r.id)))
        } catch {
            // Migração do repasse ainda não aplicada (ou sem permissão): a tela segue como era.
            setRelatorios(null)
        }
    }, [registros])

    useEffect(() => {
        void recarregarRelatorios()
    }, [recarregarRelatorios])

    useEffect(() => {
        lerConfigRepasse().then(setConfigRepasse).catch(() => {})
    }, [])

    const nomeNormalizado = (t) => normalizarTextoBusca(t)

    /** Aba do .xlsx anexado que corresponde ao registro (A1 = nome do prestador). */
    const abaDoRegistro = useCallback(
        (row) => {
            if (!relatorioXlsx) return null
            const alvo = nomeNormalizado(row.prestadorNome)
            return (
                relatorioXlsx.abas.find((a) => nomeNormalizado(a.nomeA1) === alvo) ||
                relatorioXlsx.abas.find((a) => {
                    const p = resolverPrestadorPorNome(prestadores, a.nomeA1)
                    return p && String(p.id) === String(row.prestadorId)
                }) ||
                null
            )
        },
        [relatorioXlsx, prestadores],
    )

    /** Cria relatório + link para registros (nunca altera o registro). */
    const vincularRegistros = useCallback(
        async (pares) => {
            const itens = pares.map(({ registroId, aba }) => ({
                registro_id: registroId,
                aba,
                arquivo: relatorioXlsx?.arquivo || '',
                periodo: relatorioXlsx?.periodo || null,
            }))
            const saida = []
            for (let i = 0; i < itens.length; i += 4) {
                const { itens: r } = await criarRelatorios(itens.slice(i, i + 4))
                saida.push(...r)
            }
            await recarregarRelatorios()
            return saida
        },
        [relatorioXlsx, recarregarRelatorios],
    )

    const aoVincularRelatorio = useCallback(
        async (row) => {
            const aba = abaDoRegistro(row)
            if (!aba) {
                await avisar({
                    titulo: 'Anexe o relatório primeiro',
                    mensagem: 'Abra «Inclusão em massa», anexe o .xlsx do sistema principal e tente de novo: o relatório é vinculado pela aba cujo nome (A1) corresponde ao prestador.',
                })
                return
            }
            setRepasseOcupado(row.id)
            try {
                const [r] = await vincularRegistros([{ registroId: row.id, aba }])
                if (!r?.ok) setErro(r?.error || 'Não foi possível vincular o relatório.')
            } catch (e) {
                setErro(e.message)
            } finally {
                setRepasseOcupado('')
            }
        },
        [abaDoRegistro, vincularRegistros],
    )

    const copiarLink = useCallback(async (row) => {
        const rel = relatorios?.get(row.id)
        if (!rel) return
        try {
            const { link } = await linkDoRelatorio(rel.id)
            await navigator.clipboard.writeText(link)
            setInfo('Link copiado. Ele é a credencial do prestador: envie só a ele.')
        } catch (e) {
            setErro(e.message)
        }
    }, [relatorios])

    const abrirLink = useCallback(async (row) => {
        const rel = relatorios?.get(row.id)
        if (!rel) return
        try {
            const { link } = await linkDoRelatorio(rel.id)
            window.open(link, '_blank', 'noopener')
        } catch (e) {
            setErro(e.message)
        }
    }, [relatorios])

    /** Selo único do repasse (tabela desktop): abre menu com link e comprovante. */
    const celulaRepasse = (row) => {
        if (!repasseAtivo || !novoModelo(row)) return <span className="pag_reg_sem_repasse">—</span>
        const rel = relatorios.get(row.id)
        if (!rel) {
            return podeEditar ? (
                <button type="button" className="pag_reg_btn pag_reg_btn--sec pag_reg_btn--mini" disabled={repasseOcupado === row.id} onClick={() => void aoVincularRelatorio(row)}>
                    Vincular relatório
                </button>
            ) : (
                <span className="pag_reg_sem_repasse">—</span>
            )
        }
        if (rel.divergente) {
            return <span className="pag_reg_rel pag_reg_rel--erro" title={`Soma das linhas ${formatarValorMonetarioBr(rel.soma_linhas_repasse)} × total ${formatarValorMonetarioBr(rel.total_repasse)}`}>Total não confere</span>
        }
        const comp = rel.comprovante
        const rotulo = comp
            ? `Comprovante ${formatarDataAtualizadoEm(comp.enviado_em).slice(0, 5)}`
            : rel.fluxo === 'laboratorio_manual'
              ? 'Laboratório · manual'
              : rotuloStatusRelatorio(rel.status)
        const cls = comp ? 'aprovado' : rel.status
        return (
            <button
                type="button"
                className={`pag_reg_rel pag_reg_rel--${cls} pag_reg_rel_btn`}
                aria-haspopup="menu"
                aria-expanded={menuAberto?.tipo === 'repasse' && menuAberto.id === row.id}
                onClick={(e) => setMenuAberto({ tipo: 'repasse', id: row.id, el: e.currentTarget })}
            >
                {rotulo}
            </button>
        )
    }

    /** Pago nos registros com relatório vinculado: só existe com comprovante (clicar abre o envio). */
    const pagoPorComprovante = (row) => {
        if (!repasseAtivo || !novoModelo(row)) return false
        const rel = relatorios.get(row.id)
        return Boolean(rel && !rel.divergente)
    }

    const aoClicarPago = (row) => {
        if (!pagoPorComprovante(row)) return void aoToggleCheck(row.id, 'pago')
        const rel = relatorios.get(row.id)
        if (rel.comprovante) return
        if (row.pago) return void aoToggleCheck(row.id, 'pago') // pago à mão antes do comprovante: pode corrigir
        setComprovanteAlvo(row)
    }

    const aplicarInclusaoMassa = useCallback(async () => {
        if (bloquearSeSomenteLeitura((m) => setErro(m)) || !podeEditar) return
        setMassaColando(true)
        setErro('')
        setInfo('')
        setResumoMassa(null)
        try {
            const itens = parseLinhasInclusaoMassa(massaLinhas)
            if (!itens.length) {
                setErro('Cole ao menos uma linha (prestador ou prestador + valor).')
                return
            }

            const adicionados = []
            const falhas = []
            const inseridosRegistros = []
            const cacheAcumulado = new Map()

            const chaveCompetencia = (mes, ano) => `${Number(ano)}-${Number(mes)}`

            const obterAcumuladoCompetencia = async (mes, ano) => {
                const key = chaveCompetencia(mes, ano)
                if (cacheAcumulado.has(key)) return cacheAcumulado.get(key)
                let base = []
                const noIntervalo = registroNoIntervaloCompetencia(
                    { mes, ano },
                    intervaloFiltroCompetencia,
                )
                if (noIntervalo) {
                    base = registros.filter(
                        (r) => Number(r.mes) === Number(mes) && Number(r.ano) === Number(ano),
                    )
                } else {
                    base = await listarPagamentosRegistros({ mes, ano })
                }
                const copia = [...base]
                cacheAcumulado.set(key, copia)
                return copia
            }

            for (const item of itens) {
                if (item.competenciaInvalida) {
                    falhas.push({
                        linha: item.linha,
                        texto: item.bruta,
                        motivo: `Competência inválida «${item.competenciaRaw}». Use MM/AAAA (ex.: 01/2026).`,
                    })
                    continue
                }

                const itemMes = item.competencia?.mes ?? massaMes
                const itemAno = item.competencia?.ano ?? massaAno

                const nome = String(item.nome || '').trim()
                if (!nome) {
                    falhas.push({
                        linha: item.linha,
                        texto: item.bruta,
                        motivo: 'Nome do prestador em falta.',
                    })
                    continue
                }

                const valorTexto = String(item.valorTexto || '').trim()
                let valor = null
                if (valorTexto) {
                    valor = normalizarValorMonetarioEntrada(valorTexto)
                    if (valor == null) {
                        falhas.push({
                            linha: item.linha,
                            texto: item.bruta,
                            motivo: `Valor inválido: «${valorTexto}».`,
                        })
                        continue
                    }
                }

                if (item.extras?.length) {
                    falhas.push({
                        linha: item.linha,
                        texto: item.bruta,
                        motivo: item.competencia
                            ? 'Use no máximo 5 colunas: competência (MM/AAAA), prestador, valor, resposta, pago.'
                            : 'Use no máximo 4 colunas: prestador, valor, resposta, pago (ou 5 com MM/AAAA na 1ª).',
                    })
                    continue
                }
                if (item.respostaRaw && item.resposta === null) {
                    falhas.push({
                        linha: item.linha,
                        texto: item.bruta,
                        motivo: `Resposta inválida: use TRUE/FALSE ou SIM/NÃO (recebido «${item.respostaRaw}»).`,
                    })
                    continue
                }
                if (item.pagoRaw && item.pago === null) {
                    falhas.push({
                        linha: item.linha,
                        texto: item.bruta,
                        motivo: `Pago inválido: use TRUE/FALSE ou SIM/NÃO (recebido «${item.pagoRaw}»).`,
                    })
                    continue
                }

                const prestador = resolverPrestadorPorNome(prestadores, nome)
                const repasse = dadosRepasseDoPrestador(prestador)
                const row = {
                    mes: itemMes,
                    ano: itemAno,
                    prestadorId: prestador ? String(prestador.id) : '',
                    prestadorNome: prestador?.nome || nome,
                    tipoRepasse: repasse.tipo_repasse || '',
                    chavePix: repasse.chave_pix || '',
                    valor,
                    resposta: item.resposta ?? false,
                    pago: item.pago ?? false,
                    obs: '',
                }

                const acumuladoCompetencia = await obterAcumuladoCompetencia(itemMes, itemAno)
                const duplicata = encontrarDuplicataPrestadorCompetencia(acumuladoCompetencia, row)
                if (duplicata) {
                    falhas.push({
                        linha: item.linha,
                        texto: item.bruta,
                        motivo: mensagemDuplicataPrestadorCompetencia(row),
                    })
                    continue
                }

                try {
                    const inserido = await inserirPagamentoRegistro(row)
                    inseridosRegistros.push(inserido)
                    acumuladoCompetencia.push(inserido)
                    adicionados.push({
                        linha: item.linha,
                        registroId: inserido.id,
                        mes: inserido.mes,
                        ano: inserido.ano,
                        nomeColado: nome,
                        nome: inserido.prestadorNome,
                        valor: inserido.valor,
                        semCadastro: !prestador,
                        sugestoes: !prestador
                            ? sugerirPrestadoresPorNome(prestadores, nome, { limite: 8 }).map((p) => ({
                                  id: String(p.id),
                                  nome: p.nome,
                              }))
                            : [],
                    })
                } catch (e) {
                    falhas.push({
                        linha: item.linha,
                        texto: item.bruta,
                        motivo: e?.message || 'Erro ao gravar no banco.',
                    })
                }
            }

            // Repasse mensal: registros criados com o .xlsx anexado já nascem com relatório e link.
            setResumoRelatorios(null)
            if (relatorioXlsx && relatorios !== null && adicionados.length) {
                const pares = adicionados
                    .map((a) => ({
                        registroId: a.registroId,
                        aba:
                            relatorioXlsx.abas.find((x) => nomeNormalizado(x.nomeA1) === nomeNormalizado(a.nomeColado)) ||
                            relatorioXlsx.abas.find((x) => nomeNormalizado(x.nomeA1) === nomeNormalizado(a.nome)) ||
                            relatorioXlsx.abas.find((x) => {
                                const p = resolverPrestadorPorNome(prestadores, x.nomeA1)
                                const p2 = resolverPrestadorPorNome(prestadores, a.nomeColado)
                                return p && p2 && String(p.id) === String(p2.id)
                            }),
                    }))
                    .filter((p) => p.aba)
                if (pares.length) {
                    try {
                        const r = await vincularRegistros(pares)
                        setResumoRelatorios({
                            vinculados: r.filter((x) => x.ok).length,
                            divergentes: r.filter((x) => x.ok && x.divergente).length,
                            falhas: r.filter((x) => !x.ok).map((x) => x.error),
                        })
                    } catch (e) {
                        setResumoRelatorios({ vinculados: 0, divergentes: 0, falhas: [e.message] })
                    }
                }
            }

            const periodosInseridos = [
                ...new Set(
                    adicionados.map((a) => rotuloMesAnoCurto(a.mes, a.ano)).filter((p) => p && p !== '—'),
                ),
            ]

            setResumoMassa({
                periodo:
                    periodosInseridos.length === 1
                        ? periodosInseridos[0]
                        : periodosInseridos.length > 1
                          ? 'Várias competências'
                          : rotuloMesAnoCurto(massaMes, massaAno),
                massaMes,
                massaAno,
                adicionados,
                falhas,
            })
            setResumoMassaSelecao({})
            setResumoMassaBuscaId('')

            if (inseridosRegistros.length) {
                const novosNoFiltro = inseridosRegistros.filter((r) =>
                    registroNoIntervaloCompetencia(r, intervaloFiltroCompetencia),
                )
                if (novosNoFiltro.length) {
                    setRegistros((prev) => {
                        const ids = new Set(prev.map((r) => r.id))
                        const novos = novosNoFiltro.filter((r) => !ids.has(r.id))
                        return novos.length ? [...prev, ...novos] : prev
                    })
                }
            }

            setMassaLinhas('')
            setMassaAberta(false)

            const algumForaDoFiltro =
                inseridosRegistros.length > 0 &&
                inseridosRegistros.some(
                    (r) => !registroNoIntervaloCompetencia(r, intervaloFiltroCompetencia),
                )
            if (algumForaDoFiltro) {
                const rotulos = [
                    ...new Set(
                        inseridosRegistros.map((r) => rotuloMesAnoCurto(r.mes, r.ano)).filter((p) => p !== '—'),
                    ),
                ]
                setInfo(
                    rotulos.length === 1
                        ? `${inseridosRegistros.length} registro(s) em ${rotulos[0]}. Ajuste o intervalo De–Até para ver na tabela.`
                        : `${inseridosRegistros.length} registro(s) em ${rotulos.join(', ')}. Amplie o intervalo De–Até no filtro.`,
                )
            }
        } catch (e) {
            setErro(e?.message || 'Falha na inclusão em massa.')
        } finally {
            setMassaColando(false)
        }
    }, [
        massaLinhas,
        massaMes,
        massaAno,
        prestadores,
        intervaloFiltroCompetencia,
        podeEditar,
        registros,
        relatorioXlsx,
        relatorios,
        vincularRegistros,
    ])

    const filtroCompetenciaDe = mesAnoParaInputMonth(filtroMesDe, filtroAnoDe)
    const filtroCompetenciaAte = mesAnoParaInputMonth(filtroMesAte, filtroAnoAte)
    const massaCompetencia = mesAnoParaInputMonth(massaMes, massaAno)

    const aoMudarFiltroCompetenciaDe = useCallback((value) => {
        const p = parseInputMonth(value)
        if (!p) return
        setFiltroMesDe(p.mes)
        setFiltroAnoDe(p.ano)
    }, [])

    const aoMudarFiltroCompetenciaAte = useCallback((value) => {
        const p = parseInputMonth(value)
        if (!p) return
        setFiltroMesAte(p.mes)
        setFiltroAnoAte(p.ano)
    }, [])

    const aoMudarMassaCompetencia = useCallback((value) => {
        const p = parseInputMonth(value)
        if (!p) return
        setMassaMes(p.mes)
        setMassaAno(p.ano)
    }, [])

    const vincularResumoMassa = useCallback(
        async (item, prestador) => {
            if (bloquearSeSomenteLeitura((m) => setErro(m)) || !podeEditar) return
            if (!item?.registroId || !prestador) return

            const row = registros.find((r) => r.id === item.registroId)
            const mes = row?.mes ?? item.mes ?? resumoMassa?.massaMes ?? competenciaNovaLinha.mes
            const ano = row?.ano ?? item.ano ?? resumoMassa?.massaAno ?? competenciaNovaLinha.ano
            const repasse = dadosRepasseDoPrestador(prestador)

            const candidato = {
                mes,
                ano,
                prestadorId: String(prestador.id),
                prestadorNome: prestador.nome,
                tipoRepasse: repasse.tipo_repasse || '',
                chavePix: repasse.chave_pix || '',
                valor: row?.valor ?? item.valor,
                resposta: row?.resposta ?? false,
                pago: row?.pago ?? false,
                obs: row?.obs ?? '',
            }

            setResumoMassaVinculandoId(item.registroId)
            setErro('')
            try {
                let listaDup = registros
                if (!registroNoIntervaloCompetencia({ mes, ano }, intervaloFiltroCompetencia)) {
                    listaDup = await listarPagamentosRegistros({ mes, ano })
                }
                const duplicata = encontrarDuplicataPrestadorCompetencia(listaDup, candidato, item.registroId)
                if (duplicata) {
                    setErro(mensagemDuplicataPrestadorCompetencia(candidato))
                    return
                }

                const atualizado = await atualizarPagamentoRegistro(item.registroId, candidato)

                if (registroNoIntervaloCompetencia(atualizado, intervaloFiltroCompetencia)) {
                    setRegistros((prev) => {
                        const existe = prev.some((r) => r.id === atualizado.id)
                        if (existe) {
                            return prev.map((r) => (r.id === atualizado.id ? atualizado : r))
                        }
                        return [...prev, atualizado]
                    })
                }

                setResumoMassa((prev) => {
                    if (!prev) return prev
                    return {
                        ...prev,
                        adicionados: prev.adicionados.map((a) =>
                            a.registroId === item.registroId
                                ? {
                                      ...a,
                                      semCadastro: false,
                                      nome: prestador.nome,
                                      sugestoes: [],
                                  }
                                : a,
                        ),
                    }
                })
                setResumoMassaSelecao((prev) => {
                    const next = { ...prev }
                    delete next[item.registroId]
                    return next
                })
                if (resumoMassaBuscaId === item.registroId) setResumoMassaBuscaId('')
            } catch (e) {
                setErro(e?.message || 'Falha ao vincular prestador.')
            } finally {
                setResumoMassaVinculandoId('')
            }
        },
        [
            registros,
            resumoMassa,
            intervaloFiltroCompetencia,
            competenciaNovaLinha,
            podeEditar,
            resumoMassaBuscaId,
        ],
    )

    const resumoMassaTemSemMatch = Boolean(resumoMassa?.adicionados?.some((a) => a.semCadastro))

    return (
        <div className="el-legacy-wrap pag_reg">
            <PageHeader
                kicker="Pagamentos"
                title="Registro de pagamentos"
                description="Filtre por competência e prestador, inclua registros e acompanhe respostas e pagamentos."
            />
            <Toolbar title="Filtros">
                <label className="ek-field ek-field--half">
                    <span className="ek-label">Competência — de</span>
                    <input
                        type="month"
                        className="ek-input"
                        value={filtroCompetenciaDe}
                        onChange={(e) => aoMudarFiltroCompetenciaDe(e.target.value)}
                        aria-label="Competência inicial"
                    />
                </label>
                <label className="ek-field ek-field--half">
                    <span className="ek-label">Competência — até</span>
                    <input
                        type="month"
                        className="ek-input"
                        value={filtroCompetenciaAte}
                        onChange={(e) => aoMudarFiltroCompetenciaAte(e.target.value)}
                        aria-label="Competência final"
                    />
                </label>
                <label className="ek-field ek-field--grow">
                    <span className="ek-label">Prestador</span>
                    <input
                        type="search"
                        className="ek-input"
                        value={buscaNome}
                        onChange={(e) => setBuscaNome(e.target.value)}
                        placeholder="Filtrar por nome…"
                    />
                </label>
                <label className="ek-field ek-field--half">
                    <span className="ek-label">Tipo</span>
                    <SelectDropdown className="ek-select" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
                        {OPCOES_TIPO_FILTRO.map((o) => (
                            <option key={o.value || 'todos'} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </SelectDropdown>
                </label>
                <label className="ek-field ek-field--half">
                    <span className="ek-label">Resposta</span>
                    <SelectDropdown className="ek-select" value={filtroResposta} onChange={(e) => setFiltroResposta(e.target.value)}>
                        {OPCOES_FILTRO_SIM_NAO.map((o) => (
                            <option key={`resp-${o.value || 't'}`} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </SelectDropdown>
                </label>
                <label className="ek-field ek-field--half">
                    <span className="ek-label">Pago</span>
                    <SelectDropdown className="ek-select" value={filtroPago} onChange={(e) => setFiltroPago(e.target.value)}>
                        {OPCOES_FILTRO_SIM_NAO.map((o) => (
                            <option key={`pago-${o.value || 't'}`} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </SelectDropdown>
                </label>
                {repasseAtivo && (
                    <label className="ek-field ek-field--half">
                        <span className="ek-label">Relatório</span>
                        <SelectDropdown className="ek-select" value={filtroRelatorio} onChange={(e) => setFiltroRelatorio(e.target.value)}>
                            <option value="">Todos</option>
                            <option value="sem_relatorio">Sem relatório</option>
                            <option value="nao_enviado">Não enviado</option>
                            <option value="agendado">Agendado</option>
                            <option value="enviado">Enviado</option>
                            <option value="visualizado">Visualizado</option>
                            <option value="aprovado">Aprovado</option>
                            <option value="documento_em_revisao">Documento em revisão</option>
                            <option value="documento_devolvido">Documento devolvido</option>
                            <option value="reprovado">Reprovado</option>
                            <option value="divergente">Total não confere</option>
                        </SelectDropdown>
                    </label>
                )}
                <div className="ek-toolbar__actions">
                    {podeEditar && (
                        <label className="ek-check">
                            <input type="checkbox" checked={edicaoAtiva} onChange={(e) => alternarEdicao(e.target.checked)} />
                            Habilitar edição
                        </label>
                    )}
                    {podeEditar && repasseAtivo && (
                        <button type="button" className="ek-btn ek-btn--secondary" onClick={() => setWizardAberto(true)}>
                            Enviar relatórios
                        </button>
                    )}
                    <button type="button" className="ek-btn ek-btn--secondary" onClick={() => setExportModalAberto(true)}>
                        Exportar Excel
                    </button>
                    <button type="button" className="ek-btn ek-btn--secondary" onClick={() => setMassaAberta(true)}>
                        Inclusão em massa
                    </button>
                    {podeEditar && (
                        <button type="button" className="ek-btn" onClick={() => void adicionarLinha()}>
                            + Linha
                        </button>
                    )}
                </div>
            </Toolbar>

            <Modal open={massaAberta} onClose={() => setMassaAberta(false)} busy={massaColando} title="Inclusão em massa" size="xl">
                <div className="pag_reg_massa">
                    <p className="pag_reg_massa_tip">
                        <strong>Formato:</strong> uma linha por registro, colunas com <strong>Tab</strong>{' '}
                        (Excel) ou <code>;</code>. Com competência na linha:{' '}
                        <code>MM/AAAA[TAB]prestador[TAB]valor[TAB]resposta[TAB]pago</code>. Sem mês na
                        linha, usa a <strong>competência padrão</strong> abaixo:{' '}
                        <code>prestador[TAB]valor[TAB]TRUE[TAB]TRUE</code>.
                        <br />
                        Resposta e pago: <code>TRUE</code>/<code>FALSE</code> ou <code>SIM</code>/
                        <code>NÃO</code>. Ex. com datas:{' '}
                        <code>01/2026[TAB]Clínica[TAB]150[TAB]TRUE[TAB]TRUE</code>.
                    </p>
                    <div className="pag_reg_massa_row">
                        <label className="ek-field">
                            <span className="ek-label">Competência padrão (linhas sem MM/AAAA)</span>
                            <input
                                type="month"
                                className="ek-input"
                                value={massaCompetencia}
                                onChange={(e) => aoMudarMassaCompetencia(e.target.value)}
                                disabled={massaColando}
                            />
                        </label>
                    </div>
                    <div className="pag_reg_massa_xlsx">
                        <div
                            className={`comprovante_drop${arrastandoXlsx ? ' is-over' : ''}${relatorioXlsx ? ' has-file' : ''}${massaColando || relatorioXlsxLendo ? ' is-disabled' : ''}`}
                            role="button"
                            tabIndex={0}
                            aria-disabled={massaColando || relatorioXlsxLendo}
                            onClick={() => !(massaColando || relatorioXlsxLendo) && xlsxInputRef.current?.click()}
                            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), !(massaColando || relatorioXlsxLendo) && xlsxInputRef.current?.click())}
                            onDragOver={(e) => { e.preventDefault(); setArrastandoXlsx(true) }}
                            onDragLeave={() => setArrastandoXlsx(false)}
                            onDrop={(e) => { e.preventDefault(); setArrastandoXlsx(false); void aoAnexarRelatorioXlsx(e.dataTransfer.files?.[0]) }}
                        >
                            {relatorioXlsx ? (
                                <>
                                    <span className="comprovante_drop_nome">{relatorioXlsx.arquivo}</span>
                                    <span className="comprovante_drop_dica">{relatorioXlsx.abas.length} abas lidas · clique para trocar o arquivo</span>
                                </>
                            ) : (
                                <>
                                    <span className="comprovante_drop_titulo">Relatório de atendimentos (.xlsx)</span>
                                    <span className="comprovante_drop_dica">Escolher arquivo, arrastar aqui ou colar com <kbd>Ctrl</kbd> + <kbd>V</kbd></span>
                                </>
                            )}
                        </div>
                        <input
                            ref={xlsxInputRef}
                            type="file"
                            accept=".xlsx"
                            className="sr-only"
                            tabIndex={-1}
                            disabled={massaColando || relatorioXlsxLendo}
                            onChange={(e) => {
                                void aoAnexarRelatorioXlsx(e.target.files?.[0])
                                e.target.value = ''
                            }}
                        />
                        {relatorioXlsxLendo && <p className="pag_reg_massa_xlsx_msg">Lendo arquivo…</p>}
                        {relatorioXlsxErro && (
                            <p className="pag_reg_massa_xlsx_msg pag_reg_massa_xlsx_msg--erro" role="alert">
                                {relatorioXlsxErro}
                            </p>
                        )}
                        {relatorioXlsx && (
                            <div className="pag_reg_massa_xlsx_resumo">
                                <p className="pag_reg_massa_xlsx_msg">
                                    <strong>{relatorioXlsx.abas.length}</strong> abas lidas de{' '}
                                    {relatorioXlsx.arquivo};{' '}
                                    <strong>{relatorioXlsx.abas.filter((a) => a.divergente).length}</strong>{' '}
                                    com total que não confere;{' '}
                                    <strong>
                                        {relatorioXlsx.abas.filter((a) => a.fluxo === 'laboratorio_manual').length}
                                    </strong>{' '}
                                    laboratório(s) em fluxo manual. O texto abaixo foi preenchido com o total
                                    de cada aba; nenhum registro foi criado ainda.
                                </p>
                                <details>
                                    <summary>Separação do relatório</summary>
                                    <div className="pag_reg_table_wrap">
                                        <table className="pag_reg_massa_xlsx_tabela">
                                            <thead>
                                                <tr>
                                                    <th>Aba</th>
                                                    <th>Nome (A1)</th>
                                                    <th>Atend.</th>
                                                    <th>Soma das linhas</th>
                                                    <th>Total da aba</th>
                                                    <th>Conferência</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {relatorioXlsx.abas.map((a) => (
                                                    <tr
                                                        key={a.abaOriginal + a.nomeA1}
                                                        className={a.divergente ? 'is-divergente' : undefined}
                                                    >
                                                        <td>{a.abaNome}</td>
                                                        <td>{a.nomeA1}</td>
                                                        <td>{a.atendimentos}</td>
                                                        <td>{formatarValorMonetarioBr(a.somaLinhas)}</td>
                                                        <td>{formatarValorMonetarioBr(a.totalAba)}</td>
                                                        <td>
                                                            {a.fluxo === 'laboratorio_manual'
                                                                ? 'Laboratório · manual'
                                                                : a.divergente
                                                                  ? `Total não confere (${formatarValorMonetarioBr(a.diferencaTotais)})`
                                                                  : 'Confere'}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </details>
                            </div>
                        )}
                    </div>
                    <label className="pag_reg_massa_area pag_reg_massa_area--full">
                        <span>Linhas</span>
                        <textarea
                            rows={8}
                            value={massaLinhas}
                            onChange={(e) => setMassaLinhas(e.target.value)}
                            disabled={massaColando}
                        />
                    </label>
                    <button
                        type="button"
                        className="pag_reg_btn"
                        disabled={massaColando || !podeEditar}
                        title={
                            !podeEditar
                                ? somenteLeitura
                                    ? 'Perfil somente leitura.'
                                    : 'Sem permissão para editar pagamentos.'
                                : undefined
                        }
                        onClick={() => void aplicarInclusaoMassa()}
                    >
                        {massaColando ? 'Incluindo…' : 'Criar registros'}
                    </button>
                    {!podeEditar && (
                        <p className="pag_reg_massa_sem_edit">
                            {somenteLeitura
                                ? 'Modo somente leitura: não é possível criar registros.'
                                : 'Peça a permissão «Editar Pagamentos» em Gerenciar acessos (ou «Editar Credenciamento»).'}
                        </p>
                    )}
                </div>
            </Modal>

            {erro && (
                <div className="pag_reg_banner pag_reg_banner--erro" role="alert">
                    {erro}
                    <button type="button" onClick={() => setErro('')}>
                        ×
                    </button>
                </div>
            )}
            {resumoRelatorios && (
                <div className={`pag_reg_banner ${resumoRelatorios.falhas.length ? 'pag_reg_banner--erro' : 'pag_reg_banner--info'}`} role="status">
                    <span className="pag_reg_banner_txt">
                        <strong>{resumoRelatorios.vinculados}</strong> relatório(s) vinculado(s)
                        {resumoRelatorios.divergentes > 0 ? ` · ${resumoRelatorios.divergentes} com total que não confere (ficam fora do envio)` : ''}
                        {resumoRelatorios.falhas.length > 0 ? ` · ${resumoRelatorios.falhas.length} falha(s): ${[...new Set(resumoRelatorios.falhas)].join('; ')}` : ''}
                    </span>
                    <button type="button" onClick={() => setResumoRelatorios(null)} aria-label="Fechar aviso">
                        ×
                    </button>
                </div>
            )}
            {info && (
                <div className="pag_reg_banner pag_reg_banner--info">
                    {info}
                    <button type="button" onClick={() => setInfo('')}>
                        ×
                    </button>
                </div>
            )}
            {resumoMassa && (
                <section className="pag_reg_resumo_massa" aria-live="polite">
                    <header className="pag_reg_resumo_massa_head">
                        <div className="pag_reg_resumo_massa_titulo">
                            <strong>Inclusão em massa</strong>
                            <span className="pag_reg_resumo_massa_periodo">{resumoMassa.periodo}</span>
                        </div>
                        <div className="pag_reg_resumo_massa_stats">
                            <span className="pag_reg_resumo_stat pag_reg_resumo_stat--ok">
                                {resumoMassa.adicionados.length} incluído(s)
                            </span>
                            {resumoMassa.falhas.length > 0 ? (
                                <span className="pag_reg_resumo_stat pag_reg_resumo_stat--erro">
                                    {resumoMassa.falhas.length} falha(s)
                                </span>
                            ) : null}
                            {resumoMassa.adicionados.filter((a) => a.semCadastro).length > 0 ? (
                                <span className="pag_reg_resumo_stat pag_reg_resumo_stat--aviso">
                                    {resumoMassa.adicionados.filter((a) => a.semCadastro).length} sem match
                                </span>
                            ) : null}
                        </div>
                        <button type="button" onClick={() => setResumoMassa(null)}>
                            Fechar
                        </button>
                    </header>
                    {resumoMassa.adicionados.length > 0 && (
                        <div className="pag_reg_resumo_massa_sec">
                            <h3>Incluídos</h3>
                            <div className="pag_reg_resumo_massa_scroll overflow-x-auto">
                                <table
                                    className={[
                                        'pag_reg_resumo_tabela',
                                        resumoMassaTemSemMatch && podeEditar ? 'pag_reg_resumo_tabela--com_vinculo' : '',
                                    ]
                                        .filter(Boolean)
                                        .join(' ')}
                                >
                                    <thead>
                                        <tr>
                                            <th className="pag_reg_resumo_col_linha">#</th>
                                            <th className="pag_reg_resumo_col_comp">Comp.</th>
                                            <th>Prestador</th>
                                            <th className="pag_reg_resumo_col_valor">Valor</th>
                                            <th className="pag_reg_resumo_col_status">Cadastro</th>
                                            {resumoMassaTemSemMatch && podeEditar ? (
                                                <th className="pag_reg_resumo_col_vinculo">Vincular ao cadastro</th>
                                            ) : null}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {resumoMassa.adicionados.map((a) => (
                                            <tr key={a.registroId || `ok-${a.linha}-${a.nome}`}>
                                                <td className="pag_reg_resumo_col_linha">{a.linha}</td>
                                                <td className="pag_reg_resumo_col_comp">
                                                    {rotuloMesAnoCurto(a.mes, a.ano)}
                                                </td>
                                                <td className="pag_reg_resumo_col_nome">
                                                    <div className="pag_reg_resumo_nome_linha">
                                                        <span className="pag_reg_resumo_nome_principal">
                                                            {a.semCadastro ? a.nomeColado || a.nome : a.nome}
                                                        </span>
                                                        {!a.semCadastro && String(a.nomeColado || '').trim() ? (
                                                            <span
                                                                className="pag_reg_resumo_nome_colado"
                                                                title="Nome na mensagem colada"
                                                            >
                                                                ({a.nomeColado})
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                </td>
                                                <td className="pag_reg_resumo_col_valor">
                                                    {a.valor != null ? formatarValorMonetarioBr(a.valor) : '—'}
                                                </td>
                                                <td className="pag_reg_resumo_col_status">
                                                    {a.semCadastro ? (
                                                        <span className="pag_reg_resumo_badge pag_reg_resumo_badge--aviso">
                                                            Sem match
                                                        </span>
                                                    ) : (
                                                        <span className="pag_reg_resumo_badge pag_reg_resumo_badge--ok">
                                                            Vinculado
                                                        </span>
                                                    )}
                                                </td>
                                                {resumoMassaTemSemMatch && podeEditar ? (
                                                    <td className="pag_reg_resumo_col_vinculo">
                                                        {a.semCadastro ? (
                                                            <div className="pag_reg_resumo_vinculo">
                                                                {a.sugestoes?.length > 0 ? (
                                                                    <SelectDropdown
                                                                        className="pag_reg_resumo_select"
                                                                        value={resumoMassaSelecao[a.registroId] || ''}
                                                                        disabled={
                                                                            resumoMassaVinculandoId === a.registroId
                                                                        }
                                                                        onChange={(e) =>
                                                                            setResumoMassaSelecao((prev) => ({
                                                                                ...prev,
                                                                                [a.registroId]: e.target.value,
                                                                            }))
                                                                        }
                                                                        aria-label={`Sugestões para linha ${a.linha}`}
                                                                    >
                                                                        <option value="">Possíveis matches…</option>
                                                                        {a.sugestoes.map((s) => (
                                                                            <option key={s.id} value={s.id}>
                                                                                {s.nome}
                                                                            </option>
                                                                        ))}
                                                                    </SelectDropdown>
                                                                ) : (
                                                                    <span className="pag_reg_resumo_sem_sug">
                                                                        Nenhuma sugestão automática
                                                                    </span>
                                                                )}
                                                                <div className="pag_reg_resumo_vinculo_acoes">
                                                                    {a.sugestoes?.length > 0 ? (
                                                                        <button
                                                                            type="button"
                                                                            className="pag_reg_resumo_btn"
                                                                            disabled={
                                                                                !resumoMassaSelecao[a.registroId] ||
                                                                                resumoMassaVinculandoId === a.registroId
                                                                            }
                                                                            onClick={() => {
                                                                                const id =
                                                                                    resumoMassaSelecao[a.registroId]
                                                                                const p = prestadores.find(
                                                                                    (pr) => String(pr.id) === id,
                                                                                )
                                                                                if (p) void vincularResumoMassa(a, p)
                                                                            }}
                                                                        >
                                                                            {resumoMassaVinculandoId === a.registroId
                                                                                ? 'Salvando…'
                                                                                : 'Vincular'}
                                                                        </button>
                                                                    ) : null}
                                                                    <button
                                                                        type="button"
                                                                        className="pag_reg_resumo_btn pag_reg_resumo_btn--sec"
                                                                        disabled={
                                                                            resumoMassaVinculandoId === a.registroId
                                                                        }
                                                                        onClick={() =>
                                                                            setResumoMassaBuscaId((atual) =>
                                                                                atual === a.registroId
                                                                                    ? ''
                                                                                    : a.registroId,
                                                                            )
                                                                        }
                                                                    >
                                                                        {resumoMassaBuscaId === a.registroId
                                                                            ? 'Fechar busca'
                                                                            : 'Buscar outro…'}
                                                                    </button>
                                                                </div>
                                                                {resumoMassaBuscaId === a.registroId ? (
                                                                    <div className="pag_reg_resumo_busca_wrap">
                                                                        <PrestadorVinculoBusca
                                                                            prestadores={prestadores}
                                                                            prestadorId=""
                                                                            rotuloFn={rotuloPrestador}
                                                                            onChange={(p) => {
                                                                                if (p) void vincularResumoMassa(a, p)
                                                                            }}
                                                                            disabled={
                                                                                resumoMassaVinculandoId ===
                                                                                a.registroId
                                                                            }
                                                                            placeholder="Pesquisar no cadastro…"
                                                                        />
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                        ) : (
                                                            <span className="pag_reg_resumo_vinculo_ok">—</span>
                                                        )}
                                                    </td>
                                                ) : null}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                    {resumoMassa.falhas.length > 0 && (
                        <div className="pag_reg_resumo_massa_sec pag_reg_resumo_massa_sec--erro">
                            <h3>Falhas</h3>
                            <div className="pag_reg_resumo_massa_scroll overflow-x-auto">
                                <table className="pag_reg_resumo_tabela pag_reg_resumo_tabela--erro">
                                    <thead>
                                        <tr>
                                            <th className="pag_reg_resumo_col_linha">#</th>
                                            <th>Motivo</th>
                                            <th>Linha colada</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {resumoMassa.falhas.map((f) => (
                                            <tr key={`fail-${f.linha}-${f.texto}`}>
                                                <td className="pag_reg_resumo_col_linha">{f.linha}</td>
                                                <td>{f.motivo}</td>
                                                <td className="pag_reg_resumo_col_texto" title={f.texto || ''}>
                                                    {f.texto ? `«${f.texto}»` : '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                    {resumoMassa.adicionados.length === 0 && resumoMassa.falhas.length === 0 && (
                        <p className="pag_reg_resumo_massa_vazio">Nenhuma linha processada.</p>
                    )}
                </section>
            )}

            <div className="pag_reg_resumo">
                <span>
                    {rotuloFiltroCompetencia} · {linhasFiltradas.length} registro(s)
                </span>
                <strong>Total: {formatarValorMonetarioBr(totalValor)}</strong>
            </div>

            {repasseAtivo && (
                <div className="pag_reg_filas" role="group" aria-label="Filas do repasse">
                    {[
                        ['', 'Todos'],
                        ['acao', 'Aguardando minha ação'],
                        ['pagar', 'Aprovados a pagar'],
                        ['divergente', 'Divergentes'],
                    ].map(([chave, rotulo]) => {
                        const n = chave === 'pagar' ? qtdPrestadoresAPagar : chave ? registrosComRepasseAtualizado.filter((r) => pertenceFila(r, chave)).length : registrosComRepasseAtualizado.length
                        return (
                            <button
                                key={chave || 'todos'}
                                type="button"
                                className={`pag_reg_fila${filaRapida === chave ? ' is-on' : ''}`}
                                aria-pressed={filaRapida === chave}
                                onClick={() => setFilaRapida(chave)}
                            >
                                {rotulo} <b>{n}</b>
                            </button>
                        )
                    })}
                </div>
            )}

            {filaRapida === 'pagar' && repasseAtivo ? (
                <PagamentosAPagar
                    registros={pendentesPagar}
                    busca={buscaNome}
                    carregando={pendentesCarregando}
                    podeEditar={podeEditar}
                    onAbrirPainel={setPainelPrestador}
                />
            ) : loading ? (
                <p className="pag_reg_loading">A carregar…</p>
            ) : (
                <>
                    <div className="pag_reg_table_wrap overflow-x-auto">
                        <table
                            className={[
                                'pag_reg_table',
                                'tabela-cartoes',
                                ocultarColunaMes ? 'pag_reg_table--sem_mes' : '',
                                edicaoAtiva ? '' : 'pag_reg_table--leitura',
                            ]
                                .filter(Boolean)
                                .join(' ')}
                        >
                            <thead>
                                <tr>
                                    <th className="pag_reg_col_mes">
                                        <button type="button" onClick={() => alternarOrdenacao('mesAno')}>
                                            Mês{indicadorOrdem('mesAno')}
                                        </button>
                                    </th>
                                    <th className="pag_reg_col_prestador">
                                        <button type="button" onClick={() => alternarOrdenacao('prestador')}>
                                            Prestador{indicadorOrdem('prestador')}
                                        </button>
                                    </th>
                                    <th className="pag_reg_col_valor">
                                        <button type="button" onClick={() => alternarOrdenacao('valor')}>
                                            Valor{indicadorOrdem('valor')}
                                        </button>
                                    </th>
                                    <th className="pag_reg_col_chk">
                                        <button type="button" onClick={() => alternarOrdenacao('resposta')}>
                                            Resposta{indicadorOrdem('resposta')}
                                        </button>
                                    </th>
                                    <th className="pag_reg_col_chk">
                                        <button type="button" onClick={() => alternarOrdenacao('pago')}>
                                            Pago{indicadorOrdem('pago')}
                                        </button>
                                    </th>
                                    {repasseAtivo && <th className="pag_reg_col_rel">Repasse</th>}
                                    <th className="pag_reg_col_atualizado">
                                        <button type="button" onClick={() => alternarOrdenacao('atualizadoEm')}>
                                            Atualizado{indicadorOrdem('atualizadoEm')}
                                        </button>
                                    </th>
                                    <th className="pag_reg_th_acao">
                                        <span className="pag_reg_sr_only">Ações</span>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {linhasFiltradas.length === 0 && (
                                    <tr>
                                        <td colSpan={colSpanTabelaVazia} className="pag_reg_empty">
                                            Nenhum registro no intervalo De–Até selecionado.
                                        </td>
                                    </tr>
                                )}
                                {linhasFiltradas.map((row, idx) => (
                                    <tr
                                        key={row.id}
                                        className={[
                                            row.pago ? 'pag_reg_row--pago' : '',
                                            repasseAtivo && novoModelo(row) && relatorios.get(row.id)?.divergente
                                                ? 'pag_reg_row--divergente'
                                                : '',
                                            salvandoId === row.id ? 'is-saving' : '',
                                        ]
                                            .filter(Boolean)
                                            .join(' ')}
                                    >
                                        <td data-label="Mês" className="pag_reg_col_mes">
                                            {rotuloMesAnoCurto(row.mes, row.ano)}
                                        </td>
                                        <td data-label="Prestador" className="pag_reg_col_prestador">
                                            <PrestadorVinculoBusca
                                                prestadores={prestadores}
                                                prestadorId={row.prestadorId}
                                                rotuloFn={rotuloPrestador}
                                                titleValor={row.prestadorNome || undefined}
                                                onChange={(p) => void aoSelecionarPrestador(row.id, p)}
                                                disabled={!podeEditar || !edicaoAtiva}
                                                usePortal
                                                placeholder="Pesquisar prestador…"
                                            />
                                            <div className="pag_reg_sub" title={row.chavePix || ''}>
                                                <span className="pag_reg_sub_txt">
                                                    {rotuloTipoRepasse(row.tipoRepasse)}
                                                    {row.chavePix && row.chavePix !== rotuloTipoRepasse(row.tipoRepasse) ? ` · ${row.chavePix}` : ''}
                                                </span>
                                                {row.prestadorId && (
                                                    <button
                                                        type="button"
                                                        className={`pag_reg_link_meses${rotuloVerMeses(row).alerta ? ' has-abertos' : ''}`}
                                                        onClick={() => setPainelPrestador({ id: row.prestadorId, nome: row.prestadorNome })}
                                                    >
                                                        {rotuloVerMeses(row).texto}
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                        <td data-label="Valor" className="pag_reg_col_valor">
                                            <div className={ehTipoRpa(row.tipoRepasse) && valorLiquidoRpa(row.valor) != null ? 'pag_reg_valor_rpa' : 'pag_reg_valor_simples'}>
                                            {ehTipoRpa(row.tipoRepasse) && valorLiquidoRpa(row.valor) != null && (
                                                    <>
                                                        <span className="pag_reg_rot" title="Valor com desconto de 11% (RPA)">Líquido −11%</span>
                                                        <strong className="pag_reg_liq">{formatarValorMonetarioBr(valorLiquidoRpa(row.valor))}</strong>
                                                        <span className="pag_reg_rot">Original</span>
                                                    </>
                                                )}
                                            <input
                                                className={`pag_reg_input_valor${ehTipoRpa(row.tipoRepasse) ? ' pag_reg_input_valor--original' : ''}`}
                                                title={ehTipoRpa(row.tipoRepasse) ? 'Valor original (antes do desconto de 11%)' : undefined}
                                                type="text"
                                                inputMode="decimal"
                                                disabled={!podeEditar || !edicaoAtiva}
                                                value={
                                                    valorEdicao[row.id] !== undefined
                                                        ? valorEdicao[row.id]
                                                        : row.valor != null
                                                          ? formatarValorMonetarioBr(row.valor)
                                                          : ''
                                                }
                                                onChange={(e) => {
                                                    const txt = e.target.value
                                                    setValorEdicao((prev) => ({ ...prev, [row.id]: txt }))
                                                    aoAlterarCampo(row.id, {
                                                        valor: normalizarValorMonetarioEntrada(txt),
                                                    })
                                                }}
                                                onFocus={() => {
                                                    setValorEdicao((prev) => ({
                                                        ...prev,
                                                        [row.id]:
                                                            row.valor != null
                                                                ? String(row.valor).replace('.', ',')
                                                                : '',
                                                    }))
                                                }}
                                                onBlur={() => {
                                                    setValorEdicao((prev) => {
                                                        const next = { ...prev }
                                                        delete next[row.id]
                                                        return next
                                                    })
                                                    aoBlurCampo(row.id)
                                                }}
                                                onPaste={(e) => void processarColagemValor(e, idx)}
                                            />
                                            </div>
                                        </td>
                                        <td data-label="Resposta" className="pag_reg_col_chk pag_reg_chk">
                                            <label
                                                className={`pag_reg_chk_label${!podeEditar ? ' is-disabled' : ''}`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={row.resposta}
                                                    disabled={!podeEditar}
                                                    onChange={() => void aoToggleCheck(row.id, 'resposta')}
                                                />
                                                <span className="pag_reg_sr_only">Resposta</span>
                                            </label>
                                        </td>
                                        <td data-label="Pago" className="pag_reg_col_chk pag_reg_chk">
                                            <label
                                                className={`pag_reg_chk_label${!podeEditar ? ' is-disabled' : ''}`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={row.pago}
                                                    disabled={!podeEditar || Boolean(relatorios?.get(row.id)?.comprovante && pagoPorComprovante(row))}
                                                    title={
                                                        pagoPorComprovante(row)
                                                            ? relatorios.get(row.id)?.comprovante
                                                                ? 'Pago com comprovante'
                                                                : 'Clique para anexar o comprovante e marcar como pago'
                                                            : undefined
                                                    }
                                                    onChange={() => aoClicarPago(row)}
                                                />
                                                <span className="pag_reg_sr_only">Pago</span>
                                            </label>
                                        </td>
                                        {repasseAtivo && (
                                            <td data-label="Repasse" className="pag_reg_col_rel">
                                                {celulaRepasse(row)}
                                            </td>
                                        )}
                                        <td data-label="Atualizado" className="pag_reg_col_atualizado" title={row.atualizadoEm || ''}>
                                            {formatarDataAtualizadoEm(row.atualizadoEm)}
                                        </td>
                                        <td className="pag_reg_td_acao">
                                            <button
                                                type="button"
                                                className={`pag_reg_btn_mais${row.obs ? ' has-obs' : ''}`}
                                                aria-label="Mais ações"
                                                aria-haspopup="menu"
                                                title={row.obs ? `Obs: ${row.obs}` : 'Mais ações'}
                                                onClick={(e) => setMenuAberto({ tipo: 'acoes', id: row.id, el: e.currentTarget })}
                                            >
                                                ⋯
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <ul className="pag_reg_cards" aria-label="Registros (mobile)">
                        {linhasFiltradas.length === 0 ? (
                            <li className="pag_reg_card pag_reg_card--empty">
                                Nenhum registro no intervalo De–Até selecionado.
                            </li>
                        ) : (
                            linhasFiltradas.map((row, idx) => (
                                <li
                                    key={`card-${row.id}`}
                                    className={[
                                        'pag_reg_card',
                                        row.pago ? 'pag_reg_card--pago' : '',
                                        salvandoId === row.id ? 'is-saving' : '',
                                    ]
                                        .filter(Boolean)
                                        .join(' ')}
                                >
                                    <div className="pag_reg_card_head">
                                        <span className="pag_reg_card_comp">
                                            {rotuloMesAnoCurto(row.mes, row.ano)}
                                        </span>
                                        <span className="pag_reg_card_tipo">
                                            {rotuloTipoRepasse(row.tipoRepasse)}
                                        </span>
                                        {podeEditar && (
                                            <button
                                                type="button"
                                                className="table_delete_btn"
                                                title="Excluir (Shift+clique: sem confirmação)"
                                                aria-label="Excluir registro"
                                                onClick={(event) =>
                                                    void excluirLinha(row.id, {
                                                        ignorarConfirmacao: event.shiftKey,
                                                    })
                                                }
                                            >
                                                🗑️
                                            </button>
                                        )}
                                    </div>
                                    <label className="pag_reg_card_field">
                                        <span>Prestador</span>
                                        <PrestadorVinculoBusca
                                            prestadores={prestadores}
                                            prestadorId={row.prestadorId}
                                            rotuloFn={rotuloPrestador}
                                            titleValor={row.prestadorNome || undefined}
                                            onChange={(p) => void aoSelecionarPrestador(row.id, p)}
                                            disabled={!podeEditar}
                                            placeholder="Prestador…"
                                        />
                                    </label>
                                    <p className="pag_reg_card_meta pag_reg_card_pix" title={row.chavePix || ''}>
                                        <span className="pag_reg_card_field_label">PIX</span>
                                        {row.chavePix || '—'}
                                    </p>
                                    <label className="pag_reg_card_field">
                                        <span>Valor{ehTipoRpa(row.tipoRepasse) && valorLiquidoRpa(row.valor) != null ? ` · líquido ${formatarValorMonetarioBr(valorLiquidoRpa(row.valor))} (−11%)` : ''}</span>
                                        <input
                                            className="pag_reg_input_valor"
                                            type="text"
                                            inputMode="decimal"
                                            disabled={!podeEditar}
                                            value={row.valor != null ? formatarValorMonetarioBr(row.valor) : ''}
                                            onChange={(e) =>
                                                aoAlterarCampo(row.id, {
                                                    valor: normalizarValorMonetarioEntrada(e.target.value),
                                                })
                                            }
                                            onBlur={() => aoBlurCampo(row.id)}
                                            onPaste={(e) => void processarColagemValor(e, idx)}
                                        />
                                    </label>
                                    {repasseAtivo && novoModelo(row) && (
                                        <div className="pag_reg_card_repasse">
                                            <div>{celulaRepasse(row)}</div>
                                            {row.prestadorId && (
                                                <button type="button" className={`pag_reg_link_meses${rotuloVerMeses(row).alerta ? ' has-abertos' : ''}`} onClick={() => setPainelPrestador({ id: row.prestadorId, nome: row.prestadorNome })}>
                                                    {rotuloVerMeses(row).texto}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    <div className="pag_reg_card_checks">
                                        <label>
                                            <input
                                                type="checkbox"
                                                checked={row.resposta}
                                                disabled={!podeEditar}
                                                onChange={() => void aoToggleCheck(row.id, 'resposta')}
                                            />
                                            Resposta
                                        </label>
                                        <label>
                                            <input
                                                type="checkbox"
                                                checked={row.pago}
                                                disabled={!podeEditar || Boolean(relatorios?.get(row.id)?.comprovante && pagoPorComprovante(row))}
                                                onChange={() => aoClicarPago(row)}
                                            />
                                            Pago
                                        </label>
                                    </div>
                                    <p className="pag_reg_card_meta" title={row.atualizadoEm || ''}>
                                        <span className="pag_reg_card_field_label">Atualizado</span>
                                        {formatarDataAtualizadoEm(row.atualizadoEm)}
                                    </p>
                                    <label className="pag_reg_card_field">
                                        <span>Obs</span>
                                        <input
                                            className="pag_reg_input_obs"
                                            type="text"
                                            disabled={!podeEditar}
                                            value={row.obs}
                                            onChange={(e) => aoAlterarCampo(row.id, { obs: e.target.value })}
                                            onBlur={() => aoBlurCampo(row.id)}
                                            placeholder="Observações"
                                        />
                                    </label>
                                </li>
                            ))
                        )}
                    </ul>
                </>
            )}
            {exclusaoToast}
            <PagamentosEnvioWizard
                open={wizardAberto}
                onClose={() => setWizardAberto(false)}
                registros={linhasFiltradas}
                relatorios={relatorios || new Map()}
                onConcluido={() => void recarregarRelatorios()}
            />
            {menuAberto &&
                (() => {
                    const row = registros.find((r) => r.id === menuAberto.id)
                    if (!row) return null
                    if (menuAberto.tipo === 'repasse') {
                        const rel = relatorios?.get(row.id)
                        if (!rel) return null
                        return (
                            <PagamentosMenuFlutuante ancora={menuAberto.el} onFechar={fecharMenu}>
                                <button type="button" role="menuitem" onClick={() => { fecharMenu(); void copiarLink(row) }}>Copiar link</button>
                                <button type="button" role="menuitem" onClick={() => { fecharMenu(); void abrirLink(row) }}>Abrir relatório</button>
                                {podeEditar && !rel.comprovante && (
                                    <>
                                        <hr />
                                        <button type="button" role="menuitem" onClick={() => { fecharMenu(); setComprovanteAlvo(row) }}>Anexar comprovante</button>
                                    </>
                                )}
                                {podeEditar && rel.comprovante && (
                                    <>
                                        <hr />
                                        <button type="button" role="menuitem" className="pag_reg_menu_perigo" onClick={() => { fecharMenu(); setMotivoDesfazer(''); setDesfazendo(row) }}>Desfazer pagamento…</button>
                                    </>
                                )}
                            </PagamentosMenuFlutuante>
                        )
                    }
                    return (
                        <PagamentosMenuFlutuante ancora={menuAberto.el} onFechar={fecharMenu} alinhar="direita">
                            <label className="pag_reg_menu_campo">
                                Observações
                                <input
                                    type="text"
                                    disabled={!podeEditar}
                                    value={row.obs}
                                    placeholder="observações"
                                    onChange={(e) => aoAlterarCampo(row.id, { obs: e.target.value })}
                                    onBlur={() => aoBlurCampo(row.id)}
                                />
                            </label>
                            {podeEditar && (
                                <>
                                    <hr />
                                    <button
                                        type="button"
                                        role="menuitem"
                                        className="pag_reg_menu_perigo"
                                        title="Shift + clique = exclusão rápida."
                                        onClick={(event) => {
                                            fecharMenu()
                                            void excluirLinha(row.id, { ignorarConfirmacao: event.shiftKey })
                                        }}
                                    >
                                        Excluir registro
                                    </button>
                                </>
                            )}
                        </PagamentosMenuFlutuante>
                    )
                })()}
            {comprovanteAlvo && relatorios?.get(comprovanteAlvo.id) && (
                <PagamentosComprovanteModal
                    open
                    key={comprovanteAlvo.id}
                    itens={[{ registro: comprovanteAlvo, relatorio: relatorios.get(comprovanteAlvo.id) }]}
                    onClose={() => setComprovanteAlvo(null)}
                    onEnviado={() => {
                        setRegistros((prev) => prev.map((r) => (r.id === comprovanteAlvo.id ? { ...r, pago: true } : r)))
                        void recarregarRelatorios()
                        setInfo('Comprovante enviado e registro marcado como pago.')
                    }}
                />
            )}
            {painelPrestador && (
                <PagamentosPainelPrestador
                    prestadorId={painelPrestador.id}
                    prestadorNome={painelPrestador.nome}
                    competenciaInicial={configRepasse?.competencia_inicial}
                    podeEditar={podeEditar}
                    onClose={() => setPainelPrestador(null)}
                    onMudou={() => {
                        void carregarRegistros()
                        void carregarPendentes()
                        void recarregarRelatorios()
                    }}
                />
            )}
            <Modal
                open={Boolean(desfazendo)}
                onClose={() => setDesfazendo(null)}
                busy={desfazendoOcupado}
                title="Desfazer pagamento"
                description={desfazendo ? `${desfazendo.prestadorNome} · ${rotuloMesAnoCurto(desfazendo.mes, desfazendo.ano)}` : ''}
                footer={
                    <>
                        <Button variant="secondary" disabled={desfazendoOcupado} onClick={() => setDesfazendo(null)}>Cancelar</Button>
                        <Button
                            variant="dangerSolid"
                            disabled={motivoDesfazer.trim().length < 5 || desfazendoOcupado}
                            onClick={async () => {
                                setDesfazendoOcupado(true)
                                try {
                                    const alvo = desfazendo
                                    await desfazerPagamento(relatorios.get(alvo.id).id, motivoDesfazer.trim())
                                    setRegistros((prev) => prev.map((r) => (r.id === alvo.id ? { ...r, pago: false } : r)))
                                    await recarregarRelatorios()
                                    setDesfazendo(null)
                                    setInfo('Pagamento desfeito. O comprovante foi removido do registro.')
                                } catch (e) {
                                    setErro(e.message)
                                } finally {
                                    setDesfazendoOcupado(false)
                                }
                            }}
                        >
                            Desfazer pagamento
                        </Button>
                    </>
                }
            >
                <label className="flex flex-col gap-1.5 text-sm font-semibold">
                    Motivo (obrigatório, fica no log do relatório)
                    <textarea rows={3} className="rounded-xl border border-line p-3 text-base font-medium" value={motivoDesfazer} onChange={(e) => setMotivoDesfazer(e.target.value)} maxLength={500} />
                </label>
                <p className="mt-2 text-xs text-ink-soft">O e-mail já enviado ao prestador não é cancelado. Só o comprovante e a marcação de pago são removidos.</p>
            </Modal>
            <PagamentosExportarModal
                aberto={exportModalAberto}
                onClose={() => setExportModalAberto(false)}
                mesInicial={filtroMesDe}
                anoInicial={filtroAnoDe}
                onErro={(msg) => setErro(msg)}
                onOk={(msg) => setInfo(msg)}
            />
        </div>
    )
}
