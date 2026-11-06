import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { filtrarPorTermoBusca, normalizarTextoBusca } from '../../lib/prestadorCadastroHelpers.js'
import {
    PAPEIS_SIGNATARIO_CLICKSIGN,
    clicksignRequest,
    dataEncerramentoEnvelope,
    enriquecerDocumentosComArquivos,
    extrairListaDocumentos,
    extrairListaEnvelopes,
    extrairListaSignatarios,
    montarLinhasSignatariosDetalhe,
    paresAutenticacaoExistentes,
    paresQualificacaoExistentes,
    rotuloDataEncerramentoEnvelope,
    rotuloEstadoDocumento,
    signatarioPossuiQualificacao,
    urlAbrirEnvelopeClicksign,
    abrirVisualizacaoDocumento,
    erroApiTexto,
    extrairRolesQualificacaoPorSignatario,
    contagemRequisitosPorTipo,
    garantirRequisitosCompletosAntesAtivar,
    matrizRequisitosPareceCompleta,
    obterRequisitosEnvelope,
    payloadRequisitoAutenticacao,
    requisitoDuplicadoOuConflito,
    mergeSignersWithQualificationLabels,
    intervaloCriacaoMesAtualUtc,
    intervaloCriacaoUltimos30DiasUtc,
    listarEnvelopesTodasPaginas,
    montarPathListagemEnvelopes,
    nomeSignatarioValido,
    normalizarPapelQualificacao,
    normalizarTelefoneBr,
    formatarTelefoneBrExibicao,
    rotuloEstadoEnvelope,
    rotuloPapelQualificacao,
    payloadAtivarEnvelope,
    payloadAtualizarEnvelope,
    payloadNotificarEnvelope,
    deadlineAtDeDias,
    INTERVALOS_LEMBRETE_CLICKSIGN,
    cancelarEnvelopeClicksign,
    envelopeStatusNormalizado,
    nomeEnvelopeDoArquivoPdf,
    payloadEnvelopeRascunho,
    payloadRequisitoQualificacao,
    limparCacheClicksign,
    payloadSignatario } from '../../lib/clicksign/clicksignClient.js'
import {
    CLICKSIGN_PDF_STORAGE_MAX_BYTES,
    anexarPdfEnvelopeViaStorage,
    garantirSessaoClicksign,
} from '../../lib/clicksign/clicksignUploadDocumento.js'
import {
    enviarLembreteSignatario,
    payloadAtualizarSignatario } from '../../lib/clicksign/clicksignSignatarioOps.js'
import {
    alternarFavoritoAgenda,
    atualizarContatoAgendaPorId,
    carregarAgendaSignatarios,
    migrarAgendaLocalSeNecessario,
    removerContatoAgendaPorId,
    upsertContatoAgenda } from '../../lib/clicksign/agendaSignatarios.js'
import {
    buscarPerfisParaMencaoSignatario,
    filtrarSugestoesSignatarioKanban,
    listarSugestoesSignatarioKanbanAssinatura,
    termoMencaoSignatario,
} from '../../lib/clicksign/sugestoesSignatarioKanban.js'
import { buscarDadosCNPJ, ORIGENS_CONSULTA_CNPJ } from '../../lib/contratos/consultaCnpj.js'
import {
    limparTodasNotificacoesContratos,
    listarNotificacoesContratosRecentes,
} from '../../lib/clicksign/clicksignNotificacoes.js'
import { supabase } from '../../lib/supabase.js'
import { maskTelefoneBr } from '../../lib/telefoneBrasil.js'
import { PERMISSION_KEYS, hasPermission, useStoredAccessProfile } from '../../lib/accessControl.js'
import './ContratosEmerdog.css'
import './ClicksignEmerdog.css'
import { TOAST_AUTO_DISMISS_MS, abrirUrlDownload, formatarDataPtBr } from './contratosUi.js'
import { useConfirmacaoExclusaoAutoDismiss } from '../../lib/toastUi.js'
import { Badge, Button, EmptyState, LoadingState, Modal, PageHeader, buttonClassName } from '../../components/ui'
import { confirmarAcao } from '../../lib/dialogos.js'
import { SelectDropdown } from '../../components/ui/Dropdown.jsx'

const PDF_MAX_BYTES = CLICKSIGN_PDF_STORAGE_MAX_BYTES
const STORAGE_FLUXO_EID = 'emerdog_cs_fluxo_eid'
/**
 * A ativação do envelope não notifica os signatários (doc Clicksign): é preciso chamar
 * POST /envelopes/:id/notifications. Defina VITE_CLICKSIGN_NOTIFICAR_AO_ATIVAR=false se a conta
 * já notificar sozinha, para não enviar o aviso em duplicidade.
 */
const NOTIFICAR_AO_ATIVAR = String(import.meta.env?.VITE_CLICKSIGN_NOTIFICAR_AO_ATIVAR ?? 'true').trim().toLowerCase() !== 'false'
/** Limite da Clicksign para o assunto padrão do e-mail. */
const ASSUNTO_MAX = 100

/** Campos opcionais do passo 1 (assunto, mensagem, prazo, lembretes) no formato da API. */
function montarExtrasEnvelope({ assunto = '', mensagem = '', prazoDias = '', lembrete = '' } = {}) {
    const extras = {}
    const a = String(assunto).trim().slice(0, ASSUNTO_MAX)
    const m = String(mensagem).trim()
    if (a) extras.default_subject = a
    if (m) extras.default_message = m
    const deadline = deadlineAtDeDias(prazoDias)
    if (deadline) extras.deadline_at = deadline
    if (String(lembrete) === 'nenhum') extras.remind_interval = null
    else if (String(lembrete).trim()) extras.remind_interval = Number(lembrete)
    return extras
}

/** Erros do formulário «novo signatário» (mostrados ao lado de cada campo, não em toast). */
function errosSignDraft(d) {
    const e = {}
    if (!nomeSignatarioValido(d.nome)) e.nome = 'Informe o nome completo (nome e sobrenome).'
    const em = String(d.email || '').trim()
    if (!em) e.email = 'Informe o e-mail (a Clicksign exige).'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) e.email = 'E-mail inválido.'
    if (String(d.channel || '').toLowerCase() === 'whatsapp') {
        const tel = normalizarTelefoneBr(d.phone)
        if (tel.length < 10 || tel.length > 11) e.phone = 'Telefone com DDD: 10 ou 11 dígitos.'
    }
    return e
}

/**
 * Posição fixa para um menu suspenso ligado a `el`: abre para baixo e, se faltar espaço, para cima,
 * limitando a altura ao espaço disponível. No celular devolve `undefined` (o CSS usa folha inferior).
 */
function estiloMenuFlutuante(el, alturaMenu = 200) {
    if (typeof window === 'undefined' || !el || window.innerWidth < 640) return undefined
    const r = el.getBoundingClientRect()
    const abaixo = window.innerHeight - r.bottom
    const acima = r.top
    const abrirAcima = abaixo < alturaMenu && acima > abaixo
    return {
        position: 'fixed',
        left: 'auto',
        right: Math.max(8, window.innerWidth - r.right),
        top: abrirAcima ? 'auto' : r.bottom + 4,
        bottom: abrirAcima ? window.innerHeight - r.top + 4 : 'auto',
        maxHeight: Math.max(120, (abrirAcima ? acima : abaixo) - 16),
        overflowY: 'auto',
    }
}

/** Canal de notificação do signatário (evita comparar strings inconsistentes). */
function canalSignatario(channel) {
    return String(channel || '').toLowerCase() === 'whatsapp' ? 'whatsapp' : 'email'
}

function IconeMenuVertical() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <circle cx="12" cy="5" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="12" cy="19" r="1.8" />
        </svg>
    )
}

/** Estado do filtro → status da API e texto de lista vazia. */
const SECOES_PAINEL = {
    running: { status: 'running', emptyEnvelope: 'Nenhum envelope em processo' },
    closed: { status: 'closed', emptyEnvelope: 'Nenhum envelope finalizado' },
    canceled: { status: 'canceled', emptyEnvelope: 'Nenhum envelope cancelado' },
    draft: { status: 'draft', emptyEnvelope: 'Nenhum rascunho' },
    all: { status: '', emptyEnvelope: 'Nenhum envelope encontrado' },
}

/** Filtros de estado do Painel (a contagem só aparece onde bate com o que a lista mostra). */
const FILTROS_ESTADO_PAINEL = [
    { chave: 'all', rotulo: 'Todos' },
    { chave: 'draft', rotulo: 'Rascunhos', contagem: 'draft' },
    { chave: 'running', rotulo: 'Em processo', contagem: 'running' },
    { chave: 'closed', rotulo: 'Finalizados' },
    { chave: 'canceled', rotulo: 'Cancelados' },
]

/** Tom do selo (ui/Badge) por estado do envelope. */
function tomBadgeEnvelope(status) {
    if (status === 'closed') return 'ok'
    if (status === 'canceled' || status === 'cancelled') return 'erro'
    if (status === 'running') return 'info'
    return 'neutral'
}

export default function ClicksignEmerdog() {
    const [tab, setTab] = useState('envelopes')
    const [toast, setToast] = useState(null)
    const [loading, setLoading] = useState(false)
    const [rows, setRows] = useState([])
    const [, setLinks] = useState({})
    const [, setMeta] = useState({})
    const [, setListPath] = useState(() => montarPathListagemEnvelopes({ pageNumber: 1, pageSize: 20 }))
    const [statusFilter, setStatusFilter] = useState('')
    const [vistaPainel, setVistaPainel] = useState('all')
    const [contagens, setContagens] = useState({ draft: null, running: null, recusas: 0, closed30: null, canceled30: null })
    const [contagensLoading, setContagensLoading] = useState(false)
    const [notificacoes, setNotificacoes] = useState([])
    const [notifSyncing, setNotifSyncing] = useState(false)
    const notifSyncApiRef = useRef(false)

    const [mesLoading, setMesLoading] = useState(false)
    const [, setMesMeta] = useState({})
    const [mesCount, setMesCount] = useState(null)

    const [filtroNomeEnvelope, setFiltroNomeEnvelope] = useState('')
    const [filtroNomeDebounced, setFiltroNomeDebounced] = useState('')
    const debounceNomeRef = useRef(null)
    /** Evita rajadas que geram 429 na Clicksign (1 lembrete/min por signatário). */
    const lembreteEnviadoEmRef = useRef(new Map())
    const [deletingId, setDeletingId] = useState('')
    const [ordenarColuna, setOrdenarColuna] = useState('created')
    const [ordenarDir, setOrdenarDir] = useState('desc')
    const [itensPorPaginaLista, setItensPorPaginaLista] = useState(10)
    /** Carga sob demanda: só a 1ª página (50) vem ao abrir; o resto por «Carregar mais». */
    const [listaPagina, setListaPagina] = useState(1)
    const [listaTotal, setListaTotal] = useState(0)
    const [carregandoMais, setCarregandoMais] = useState(false)
    const [paginaAtualLista, setPaginaAtualLista] = useState(1)

    const [fluxoEnvelopeId, setFluxoEnvelopeId] = useState('')
    const [fluxoNome, setFluxoNome] = useState('')
    const [fluxoAssunto, setFluxoAssunto] = useState('')
    const [fluxoMensagem, setFluxoMensagem] = useState('')
    /** Prazo em dias (vazio = padrão da conta, 30) e intervalo de lembretes ('' = padrão da conta). */
    const [fluxoPrazoDias, setFluxoPrazoDias] = useState('')
    const [fluxoLembrete, setFluxoLembrete] = useState('')
    const [fluxoSignNome, setFluxoSignNome] = useState('')
    const [fluxoSignEmail, setFluxoSignEmail] = useState('')
    const [fluxoPhone, setFluxoPhone] = useState('')
    const [fluxoCanal, setFluxoCanal] = useState('email')
    const [fluxoPapel, setFluxoPapel] = useState('sign')
    const [agendaSigs, setAgendaSigs] = useState([])
    const [agendaCarregando, setAgendaCarregando] = useState(true)
    const [fluxoDropAtivo, setFluxoDropAtivo] = useState(false)
    const [fluxoDocs, setFluxoDocs] = useState([])
    const [fluxoSigs, setFluxoSigs] = useState([])
    const [fluxoBusy, setFluxoBusy] = useState(false)
    const [fluxoDocRemovendoId, setFluxoDocRemovendoId] = useState('')
    const [fluxoSigRemovendoId, setFluxoSigRemovendoId] = useState('')
    const [fluxoEdicaoLista, setFluxoEdicaoLista] = useState(false)

    /** Modais de signatários: `novo` | `agenda` | `agenda_edit` | `qual` (assinar como). */
    const [signModal, setSignModal] = useState(null)
    const [signModalCliquesFora, setSignModalCliquesFora] = useState(0)
    const [signTentouAvancar, setSignTentouAvancar] = useState(false)
    const [signDraft, setSignDraft] = useState({
        channel: 'email',
        email: '',
        phone: '',
        nome: '',
        saveAgenda: true })
    /** Dados após «Avançar» (novo ou agenda), antes de escolher qualificação. */
    const [signPending, setSignPending] = useState(null)
    const [signModalAgendaTab, setSignModalAgendaTab] = useState('todos')
    const [signModalAgendaBusca, setSignModalAgendaBusca] = useState('')
    const [signModalAgendaSel, setSignModalAgendaSel] = useState([])
    const [agendaQualPorId, setAgendaQualPorId] = useState({})
    const [signAgendaEditId, setSignAgendaEditId] = useState(null)
    const [signQualPapel, setSignQualPapel] = useState('sign')
    const [sugestoesKanban, setSugestoesKanban] = useState([])
    const [sugestoesKanbanLoading, setSugestoesKanbanLoading] = useState(false)
    const [sugestoesKanbanBusca, setSugestoesKanbanBusca] = useState('')
    const signModalRef = useRef(null)

    const abrirSignModalKanban = useCallback((modal) => {
        setSignModalCliquesFora(0)
        setSugestoesKanbanLoading(true)
        setSignModal(modal)
        signModalRef.current = modal
    }, [])

    const irParaSignModal = useCallback((modal) => {
        setSignModalCliquesFora(0)
        setSignModal(modal)
        signModalRef.current = modal
    }, [])

    const [detailOpen, setDetailOpen] = useState(false)
    const [detailTab, setDetailTab] = useState('resumo')
    const [detailHist, setDetailHist] = useState([])
    const [detailHistLoading, setDetailHistLoading] = useState(false)
    const [detailId, setDetailId] = useState('')
    const [detailJson, setDetailJson] = useState(null)
    const [detailLoading, setDetailLoading] = useState(false)
    const [, setDetailCancelando] = useState(false)
    const [detailDocs, setDetailDocs] = useState([])
    const [detailSigs, setDetailSigs] = useState([])
    const [detailSignersRaw, setDetailSignersRaw] = useState({})
    const [detailSigBusyId, setDetailSigBusyId] = useState('')
    const [, setDetailReqs] = useState([])
    const [envelopeMenuId, setEnvelopeMenuId] = useState('')
    const [docMenuId, setDocMenuId] = useState('')
    const [docMenuEstilo, setDocMenuEstilo] = useState(undefined)
    const [envMenuEstilo, setEnvMenuEstilo] = useState(undefined)

    const [confirmacaoExclusao, setConfirmacaoExclusao] = useState(null)

    useConfirmacaoExclusaoAutoDismiss(confirmacaoExclusao, setConfirmacaoExclusao)

    useEffect(() => {
        if (signModal !== 'novo' && signModal !== 'agenda') return undefined
        let cancel = false
        listarSugestoesSignatarioKanbanAssinatura()
            .then((lista) => {
                if (!cancel) setSugestoesKanban(lista)
            })
            .catch(() => {
                if (!cancel) setSugestoesKanban([])
            })
            .finally(() => {
                if (!cancel) setSugestoesKanbanLoading(false)
            })
        return () => {
            cancel = true
        }
    }, [signModal])

    const sugestoesKanbanFiltradas = useMemo(
        () => filtrarSugestoesSignatarioKanban(sugestoesKanban, sugestoesKanbanBusca).slice(0, 12),
        [sugestoesKanban, sugestoesKanbanBusca],
    )

    const [mencaoPerfis, setMencaoPerfis] = useState([])
    const [mencaoLoading, setMencaoLoading] = useState(false)

    const aplicarSugestaoKanban = useCallback(async (s) => {
        if (!s) return
        let nome = String(s.nome || '').trim()
        if (s.temCnpj && s.cpfCnpj) {
            try {
                const dados = await buscarDadosCNPJ(s.cpfCnpj, {
                    origem: ORIGENS_CONSULTA_CNPJ.CONTRATOS_EMERDOG,
                })
                const razao = String(dados?.razaoSocial || '').trim()
                if (razao) nome = razao
            } catch {
                /* mantém razão social do cadastro / nome já resolvido na lista */
            }
        }
        setSignDraft((d) => ({
            ...d,
            nome: nome || d.nome,
            email: s.email || d.email,
            phone: s.telefone || d.phone,
            channel: d.channel === 'whatsapp' || (s.telefone && !s.email) ? 'whatsapp' : 'email',
            saveAgenda: d.saveAgenda,
        }))
        setSugestoesKanbanBusca('')
        setMencaoPerfis([])
    }, [])

    const termoMencao = signModal === 'novo' ? termoMencaoSignatario(signDraft.nome) : null

    useEffect(() => {
        if (termoMencao == null || termoMencao.length < 2) {
            setMencaoPerfis([])
            setMencaoLoading(false)
            return undefined
        }
        let cancel = false
        setMencaoLoading(true)
        const t = setTimeout(() => {
            buscarPerfisParaMencaoSignatario(termoMencao)
                .then((lista) => {
                    if (!cancel) setMencaoPerfis(lista)
                })
                .finally(() => {
                    if (!cancel) setMencaoLoading(false)
                })
        }, 250)
        return () => {
            cancel = true
            clearTimeout(t)
        }
    }, [termoMencao])

    const aplicarMencaoPerfil = useCallback(async (perfil) => {
        if (!perfil) return
        let nomePerfil = String(perfil.nome || '').trim()
        if (perfil.temCnpj && perfil.cpfCnpj) {
            try {
                const dados = await buscarDadosCNPJ(perfil.cpfCnpj, {
                    origem: ORIGENS_CONSULTA_CNPJ.CONTRATOS_EMERDOG,
                })
                const razao = String(dados?.razaoSocial || '').trim()
                if (razao) nomePerfil = razao
            } catch {
                /* mantém razão social do cadastro já resolvida na lista */
            }
        }
        setSignDraft((d) => {
            const semMencao = String(d.nome || '').replace(/(?:^|\s)@[^\s@]*$/, '').trim()
            const nome = [semMencao, nomePerfil].filter(Boolean).join(' ').trim()
            return {
                ...d,
                nome: nome || nomePerfil,
                email: perfil.email || d.email,
                phone: perfil.telefone || d.phone,
            }
        })
        setMencaoPerfis([])
    }, [])

    const fluxoEidRef = useRef('')
    const montarEdicaoEnvelopeIdRef = useRef('')
    const fluxoImportPdfRef = useRef(null)
    const dashUploadInputRef = useRef(null)
    const signReplaceSignerIdRef = useRef('')
    const [dashDropAtivo, setDashDropAtivo] = useState(false)
    useEffect(() => {
        fluxoEidRef.current = fluxoEnvelopeId.trim()
    }, [fluxoEnvelopeId])

    useEffect(() => {
        if (!envelopeMenuId && !docMenuId) return undefined
        const fecharMenus = () => {
            setEnvelopeMenuId('')
            setDocMenuId('')
        }
        const fecharSeFora = (e) => {
            const alvo = e.target
            if (alvo instanceof Element && alvo.closest('.clicksign_row_menu_wrap')) return
            fecharMenus()
        }
        const fecharSeTeclaEsc = (e) => {
            if (e.key !== 'Escape') return
            // Esc fecha só o menu (sem fechar o modal do detalhe junto)
            e.stopPropagation()
            fecharMenus()
        }
        // Menu flutuante tem posição fixa: ao rolar ou redimensionar ele se soltaria do botão.
        const fecharAoRolar = (e) => {
            const alvo = e.target
            if (alvo instanceof Element && alvo.closest('.clicksign_dropdown')) return
            fecharMenus()
        }
        document.addEventListener('mousedown', fecharSeFora)
        document.addEventListener('keydown', fecharSeTeclaEsc)
        window.addEventListener('scroll', fecharAoRolar, true)
        window.addEventListener('resize', fecharMenus)
        return () => {
            document.removeEventListener('mousedown', fecharSeFora)
            document.removeEventListener('keydown', fecharSeTeclaEsc)
            window.removeEventListener('scroll', fecharAoRolar, true)
            window.removeEventListener('resize', fecharMenus)
        }
    }, [envelopeMenuId, docMenuId])

    const resetMontarFluxo = useCallback(() => {
        setFluxoEnvelopeId('')
        setFluxoNome('')
        setFluxoAssunto('')
        setFluxoMensagem('')
        setFluxoPrazoDias('')
        setFluxoLembrete('')
        setFluxoSignNome('')
        setFluxoSignEmail('')
        setFluxoPhone('')
        setFluxoCanal('email')
        setFluxoPapel('sign')
        setFluxoDropAtivo(false)
        setFluxoDocs([])
        setFluxoSigs([])
        setFluxoSigRemovendoId('')
        setFluxoEdicaoLista(false)
        signReplaceSignerIdRef.current = ''
        signModalRef.current = null
        setSignModal(null)
        setSignModalCliquesFora(0)
        setSignPending(null)
        setSignModalAgendaSel([])
        setAgendaQualPorId({})
        setSignModalAgendaBusca('')
        setSignModalAgendaTab('todos')
        setSignQualPapel('sign')
        setSignAgendaEditId(null)
        setSignDraft({
            channel: 'email',
            email: '',
            phone: '',
            nome: '',
            saveAgenda: true })
        try {
            sessionStorage.removeItem(STORAGE_FLUXO_EID)
        } catch {
            /* ignore */
        }
    }, [])

    const pushToast = useCallback((variant, title, body, options) => {
        const opts = options && typeof options === 'object' ? options : {}
        if (body === undefined) {
            setToast({
                variant,
                title,
                body: null,
                onConfirm: opts.onConfirm || null,
                confirmLabel: opts.confirmLabel || 'Confirmar',
                cancelLabel: opts.cancelLabel || 'Cancelar' })
            return
        }
        setToast({
            variant,
            title,
            body: String(body || '').trim() || '—',
            onConfirm: opts.onConfirm || null,
            confirmLabel: opts.confirmLabel || 'Confirmar',
            cancelLabel: opts.cancelLabel || 'Cancelar' })
    }, [])

    useEffect(() => {
        if (!toast) return undefined
        const t = setTimeout(() => setToast(null), TOAST_AUTO_DISMISS_MS)
        return () => clearTimeout(t)
    }, [toast])

    useEffect(() => {
        let cancel = false
        setAgendaCarregando(true)
        void (async () => {
            try {
                await migrarAgendaLocalSeNecessario()
                const lista = await carregarAgendaSignatarios()
                if (!cancel) setAgendaSigs(lista)
            } catch (e) {
                if (!cancel) {
                    setAgendaSigs([])
                    pushToast('error', 'Agenda', e?.message || 'Não foi possível carregar a agenda compartilhada.')
                }
            } finally {
                if (!cancel) setAgendaCarregando(false)
            }
        })()
        return () => {
            cancel = true
        }
        // pushToast é estável (useCallback); carregar na montagem
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const accessProfile = useStoredAccessProfile()
    const podeEditarContratos = hasPermission(accessProfile, PERMISSION_KEYS.CONTRATOS_EDIT)
    const podeVerContratos =
        hasPermission(accessProfile, PERMISSION_KEYS.CONTRATOS_VIEW) ||
        podeEditarContratos ||
        hasPermission(accessProfile, PERMISSION_KEYS.ACCESS_MANAGE)

    const csRequest = useCallback(
        async (method, path, body) => {
            const m = String(method || 'GET').toUpperCase()
            if (!podeVerContratos) {
                pushToast(
                    'error',
                    'Contratos',
                    'Sem permissão de Contratos neste perfil. Saia e entre de novo, ou peça contratos.view ao admin.',
                )
                return { ok: false, status: 403, data: { error: 'Sem permissão para esta operação.' } }
            }
            if (m !== 'GET' && m !== 'HEAD' && !podeEditarContratos) {
                pushToast('error', 'Contratos', 'Somente visualização: sem permissão para alterar envelopes na Clicksign.')
                return { ok: false, status: 403, data: { error: 'readonly' } }
            }
            return clicksignRequest(method, path, body)
        },
        [podeEditarContratos, podeVerContratos, pushToast],
    )

    const carregarLista = useCallback(
        async (origem) => {
            setLoading(true)
            try {
                if (typeof origem === 'string' && origem.startsWith('/envelopes')) {
                    const { ok, status, data } = await csRequest('GET', origem)
                    if (!ok) {
                        pushToast('error', `Erro ${status}`, erroApiTexto(data))
                        setRows([])
                        setLinks({})
                        setMeta({})
                        return
                    }
                    const ex = extrairListaEnvelopes(data)
                    setRows(ex.rows)
                    setLinks(ex.links || {})
                    setMeta(ex.meta || {})
                    setListPath(origem)
                    return
                }
                const opts =
                    origem && typeof origem === 'object'
                        ? { filterStatus: statusFilter, ...origem, filterName: '' }
                        : { filterStatus: statusFilter, filterName: '' }
                const res = await listarEnvelopesTodasPaginas(csRequest, { ...opts, maxPaginas: 1 })
                if (!res.ok) {
                    pushToast('error', `Erro ${res.status || ''}`, erroApiTexto(res.data))
                    setRows([])
                    setLinks({})
                    setMeta({})
                    return
                }
                setRows(res.rows)
                setListaPagina(1)
                setListaTotal(typeof res.meta?.record_count === 'number' ? res.meta.record_count : res.rows.length)
                setLinks({})
                setMeta({
                    ...(res.meta || {}),
                    record_count:
                        typeof res.meta?.record_count === 'number'
                            ? res.meta.record_count
                            : res.rows.length,
                    loaded_count: res.rows.length })
                setListPath(
                    montarPathListagemEnvelopes({
                        pageNumber: 1,
                        pageSize: 50,
                        filterStatus: opts.filterStatus || '' }),
                )
            } finally {
                setLoading(false)
            }
        },
        [pushToast, csRequest, statusFilter],
    )

    const carregarMaisEnvelopes = async () => {
        if (carregandoMais) return
        setCarregandoMais(true)
        try {
            const proxima = listaPagina + 1
            const path = montarPathListagemEnvelopes({ pageNumber: proxima, pageSize: 50, filterStatus: statusFilter })
            const { ok, status, data } = await csRequest('GET', path)
            if (!ok) {
                pushToast('error', `Erro ${status}`, erroApiTexto(data))
                return
            }
            const ex = extrairListaEnvelopes(data)
            setRows((atual) => {
                const ids = new Set(atual.map((r) => r.id))
                return [...atual, ...ex.rows.filter((r) => !ids.has(r.id))]
            })
            setListaPagina(proxima)
        } finally {
            setCarregandoMais(false)
        }
    }

    const carregarUsoMes = useCallback(async () => {
        setMesLoading(true)
        const intervalo = intervaloCriacaoMesAtualUtc()
        // Só a contagem interessa (meta.record_count): 1 item basta.
        const path = montarPathListagemEnvelopes({
            pageNumber: 1,
            pageSize: 1,
            filterCreated: intervalo })
        const { ok, data } = await csRequest('GET', path)
        setMesLoading(false)
        if (!ok) {
            setMesMeta({})
            setMesCount(null)
            return
        }
        setMesMeta(data?.meta || {})
        const rc = data?.meta?.record_count
        const n = typeof rc === 'number' ? rc : Array.isArray(data?.data) ? data.data.length : null
        setMesCount(n)
    }, [csRequest])

    const contarEnvelopesPath = useCallback(
        async (path) => {
            const { ok, data } = await csRequest('GET', path)
            if (!ok) return null
            const rc = data?.meta?.record_count
            if (typeof rc === 'number') return rc
            return Array.isArray(data?.data) ? data.data.length : null
        },
        [csRequest],
    )

    /** Recusas dos últimos 30 dias: vêm do webhook (evento `refusal`), sem gastar cota da API. */
    const contarRecusas30Dias = useCallback(async () => {
        try {
            const desde = new Date(Date.now() - 30 * 86_400_000).toISOString()
            const { count, error } = await supabase
                .from('clicksign_notificacoes_webhook')
                .select('id', { count: 'exact', head: true })
                .eq('evento', 'refusal')
                .gte('criado_em', desde)
            return error ? null : (count ?? 0)
        } catch {
            return null
        }
    }, [])

    const recarregarNotificacoesUi = useCallback(async () => {
        const lista = await listarNotificacoesContratosRecentes(80)
        setNotificacoes(lista)
    }, [])

    /** Só relê as notificações do Supabase (alimentadas pelo webhook) — sem polling na API Clicksign. */
    const sincronizarNotificacoesPainel = useCallback(async () => {
        if (notifSyncApiRef.current) return
        notifSyncApiRef.current = true
        setNotifSyncing(true)
        try {
            await recarregarNotificacoesUi()
        } finally {
            notifSyncApiRef.current = false
            setNotifSyncing(false)
        }
    }, [recarregarNotificacoesUi])

    const limparListaNotificacoes = useCallback(() => {
        void (async () => {
            await limparTodasNotificacoesContratos(csRequest)
            setNotificacoes([])
        })()
    }, [csRequest])

    const carregarContagensDashboard = useCallback(async () => {
        setContagensLoading(true)
        const intervalo30 = intervaloCriacaoUltimos30DiasUtc()
        try {
            const [draft, running, closed30, canceled30, recusas] = await Promise.all([
                contarEnvelopesPath(
                    montarPathListagemEnvelopes({ pageNumber: 1, pageSize: 1, filterStatus: 'draft' }),
                ),
                contarEnvelopesPath(
                    montarPathListagemEnvelopes({ pageNumber: 1, pageSize: 1, filterStatus: 'running' }),
                ),
                contarEnvelopesPath(
                    montarPathListagemEnvelopes({
                        pageNumber: 1,
                        pageSize: 1,
                        filterStatus: 'closed',
                        filterCreated: intervalo30 }),
                ),
                contarEnvelopesPath(
                    montarPathListagemEnvelopes({
                        pageNumber: 1,
                        pageSize: 1,
                        filterStatus: 'canceled',
                        filterCreated: intervalo30 }),
                ),
                contarRecusas30Dias(),
            ])
            setContagens({ draft, running, recusas, closed30, canceled30 })
        } finally {
            setContagensLoading(false)
        }
    }, [contarEnvelopesPath, contarRecusas30Dias])

    const abrirSecaoPainel = (chave) => {
        const sec = SECOES_PAINEL[chave]
        if (!sec) return
        setVistaPainel(chave)
        setStatusFilter(sec.status || '')
        setPaginaAtualLista(1)
    }

    useEffect(() => {
        if (debounceNomeRef.current) clearTimeout(debounceNomeRef.current)
        debounceNomeRef.current = setTimeout(() => {
            debounceNomeRef.current = null
            setFiltroNomeDebounced(filtroNomeEnvelope.trim())
        }, 400)
        return () => {
            if (debounceNomeRef.current) clearTimeout(debounceNomeRef.current)
        }
    }, [filtroNomeEnvelope])

    useEffect(() => {
        if (tab !== 'envelopes') return
        void carregarLista({ filterStatus: statusFilter })
    }, [tab, statusFilter, carregarLista])

    useEffect(() => {
        if (tab === 'envelopes') {
            void carregarContagensDashboard()
            void sincronizarNotificacoesPainel()

            const onLocal = () => {
                void recarregarNotificacoesUi()
            }
            window.addEventListener('emerdog-clicksign-notif-change', onLocal)

            const channel = supabase
                .channel('cs-hub-notifs-webhook')
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table: 'clicksign_notificacoes_webhook' },
                    onLocal,
                )
                .subscribe()

            // Sem polling na API Clicksign: o webhook + Realtime do Supabase cobrem o tempo real.
            return () => {
                window.removeEventListener('emerdog-clicksign-notif-change', onLocal)
                void supabase.removeChannel(channel)
            }
        }
        return undefined
    }, [
        tab,
        carregarContagensDashboard,
        sincronizarNotificacoesPainel,
        recarregarNotificacoesUi,
    ])

    useEffect(() => {
        if (tab === 'envelopes') {
            void carregarUsoMes()
        }
    }, [tab, carregarUsoMes])

    useEffect(() => {
        if (tab !== 'montar') return undefined
        return () => {
            const eid = fluxoEidRef.current.trim()
            if (!eid) return
            void (async () => {
                const { ok, data } = await csRequest('GET', `/envelopes/${encodeURIComponent(eid)}`)
                if (!ok) return
                const st = data?.data?.attributes?.status
                if (String(st || '').toLowerCase() === 'draft') {
                    pushToast(
                        'info',
                        'Rascunho salvo na Clicksign',
                        'Pode dar sequência à edição na lista Envelopes (abrir detalhe e continuar na Clicksign em Editar) ou iniciar outro fluxo em Montar envelope.',
                    )
                }
            })()
        }
    }, [tab, pushToast])

    /** Recarrega lista, contagens e atualizações (ignora o cache curto de listagens). */
    const atualizarPainel = () => {
        limparCacheClicksign()
        void carregarLista({ filterStatus: statusFilter })
        void carregarContagensDashboard()
        void carregarUsoMes()
        void recarregarNotificacoesUi()
    }

    const novoEnvelope = () => {
        montarEdicaoEnvelopeIdRef.current = ''
        fluxoImportPdfRef.current = null
        setTab('montar')
    }

    const continuarRascunho = (envelopeId) => {
        const id = String(envelopeId || '').trim()
        if (!id) return
        montarEdicaoEnvelopeIdRef.current = id
        setTab('montar')
    }

    const copiarIdEnvelope = async (envelopeId) => {
        const id = String(envelopeId || '').trim()
        if (!id) return
        try {
            await navigator.clipboard.writeText(id)
            pushToast('success', 'ID copiado', id)
        } catch {
            pushToast('error', 'Copiar ID', 'Não foi possível copiar. Selecione o ID e use Ctrl+C.')
        }
    }

    const ariaSort = (coluna) =>
        ordenarColuna === coluna ? (ordenarDir === 'asc' ? 'ascending' : 'descending') : 'none'

    const commitFiltroNomeImediato = () => {
        if (debounceNomeRef.current) {
            clearTimeout(debounceNomeRef.current)
            debounceNomeRef.current = null
        }
        setFiltroNomeDebounced(filtroNomeEnvelope.trim())
    }

    const abrirConfirmacaoExclusao = (mensagem, onConfirmar) => {
        setConfirmacaoExclusao({ mensagem, onConfirmar })
    }

    const excluirEnvelope = async (id, nome, opcoes = {}) => {
        const nomeLimpo = String(nome || '').trim()
        const nomeToast = nomeLimpo || '—'
        const executarExclusao = async () => {
            setDeletingId(id)
            const { ok, status, data } = await csRequest('DELETE', `/envelopes/${encodeURIComponent(id)}`)
            setDeletingId('')
            if (!ok) {
                pushToast('error', `Eliminar envelope ${status}`, erroApiTexto(data))
                return
            }
            pushToast('info', `Envelope excluido | ${nomeToast}`, undefined)
            if (detailOpen && detailId === id) setDetailOpen(false)
            await carregarLista()
            await carregarUsoMes()
        }
        if (opcoes.ignorarConfirmacao) {
            await executarExclusao()
            return
        }
        const msg =
            nomeLimpo !== ''
                ? `Excluir o envelope "${nomeLimpo}"?`
                : `Excluir este envelope (ID ${String(id).slice(0, 8)}…)?`
        abrirConfirmacaoExclusao(msg, executarExclusao)
    }

    const cancelarEnvelope = (id, nome) => {
        const nomeLimpo = String(nome || '').trim()
        const idStr = String(id || '').trim()
        if (!idStr) return
        const msg =
            nomeLimpo !== ''
                ? `Cancelar «${nomeLimpo}»? O envelope deixa de aceitar assinaturas e permanece na lista como cancelado (não é eliminado).`
                : `Cancelar este envelope? O processo de assinatura será interrompido e o estado passará a cancelado.`
        pushToast('confirm', 'Cancelar envelope', msg, {
            confirmLabel: 'Cancelar envelope',
            cancelLabel: 'Voltar',
            onConfirm: async () => {
                setDetailCancelando(true)
                const resultado = await cancelarEnvelopeClicksign(idStr, csRequest)
                setDetailCancelando(false)
                if (!resultado.ok) {
                    const extra =
                        resultado.failedFilename != null
                            ? ` Documento: ${resultado.failedFilename}.`
                            : ''
                    pushToast(
                        'error',
                        `Cancelar ${resultado.status}`,
                        (erroApiTexto(resultado.data) || 'Não foi possível cancelar o envelope.') + extra,
                    )
                    return
                }
                const n = resultado.canceledCount ?? 0
                const corpo =
                    resultado.alreadyCanceled === true
                        ? 'Os documentos deste envelope já estavam cancelados ou finalizados.'
                        : n === 1
                          ? '1 documento foi cancelado; o envelope deixa de aceitar assinaturas.'
                          : `${n} documentos foram cancelados; o envelope deixa de aceitar assinaturas.`
                pushToast('success', 'Envelope cancelado', corpo)
                if (detailOpen && detailId === idStr) {
                    await abrirDetalhe(idStr)
                }
                await carregarLista()
                await carregarUsoMes()
            } })
    }

    const fecharDetalheModal = useCallback(() => {
        setDetailOpen(false)
        setDocMenuId('')
    }, [])

    const statusDetalheEnvelope = useMemo(() => {
        const st = detailJson?.data?.attributes?.status ?? detailJson?.data?.attributes?.state ?? ''
        return envelopeStatusNormalizado(st)
    }, [detailJson])

    const enviarLembreteSignatarioDetalhe = async (signerId, nomeExibicao) => {
        const eid = String(detailId || '').trim()
        const sid = String(signerId || '').trim()
        if (!eid || !sid) return
        if (!podeEditarContratos) {
            pushToast('error', 'Permissão', 'Sem permissão para enviar lembretes.')
            return
        }
        setDetailSigBusyId(sid)
        try {
            const resultado = await enviarLembreteSignatario(csRequest, eid, sid, lembreteEnviadoEmRef.current)
            if (!resultado.ok) {
                pushToast('error', resultado.rateLimited ? 'Limite de lembretes' : 'Lembrete', resultado.message)
                return
            }
            pushToast('success', 'Lembrete enviado', nomeExibicao || 'Signatário')
        } finally {
            setDetailSigBusyId('')
        }
    }

    const abrirEdicaoSignatarioDetalhe = (signerId) => {
        const sid = String(signerId || '').trim()
        const raw = detailSignersRaw[sid] || {}
        const st = statusDetalheEnvelope
        if (st === 'draft') {
            signReplaceSignerIdRef.current = sid
            setFluxoEnvelopeId(detailId)
            persistirEnvelopeSessao(detailId)
            setSignDraft({
                channel: raw.phone ? 'whatsapp' : 'email',
                email: raw.email || '',
                phone: raw.phone || '',
                nome: raw.name || '',
                saveAgenda: false })
            abrirSignModalKanban('novo')
            fecharDetalheModal()
            setTab('montar')
            setFluxoEdicaoLista(true)
            pushToast('info', 'Editar signatário', 'Altere os dados e confirme para substituir o signatário no rascunho.')
            return
        }
        signReplaceSignerIdRef.current = sid
        setFluxoEnvelopeId(detailId)
        persistirEnvelopeSessao(detailId)
        setSignDraft({
            channel: raw.phone ? 'whatsapp' : 'email',
            email: raw.email || '',
            phone: raw.phone || '',
            nome: raw.name || '',
            saveAgenda: false })
        abrirSignModalKanban('novo')
    }

    const adicionarSignatarioDesdeDetalhe = () => {
        const eid = String(detailId || '').trim()
        if (!eid) return
        setFluxoEnvelopeId(eid)
        persistirEnvelopeSessao(eid)
        signReplaceSignerIdRef.current = ''
        setSignDraft({
            channel: 'email',
            email: '',
            phone: '',
            nome: '',
            saveAgenda: true })
        abrirSignModalKanban('novo')
        if (statusDetalheEnvelope === 'draft') {
            fecharDetalheModal()
            setTab('montar')
            setFluxoEdicaoLista(true)
        }
    }

    /** Linha do tempo do envelope: eventos que o webhook já gravou (não consome a cota da API Clicksign). */
    const carregarHistoricoEnvelope = async (id) => {
        setDetailHist([])
        setDetailHistLoading(true)
        try {
            const { data, error } = await supabase
                .from('clicksign_notificacoes_webhook')
                .select('id, evento, texto, criado_em')
                .eq('envelope_id', id)
                .order('criado_em', { ascending: false })
                .limit(50)
            setDetailHist(error ? [] : data || [])
        } catch {
            setDetailHist([])
        } finally {
            setDetailHistLoading(false)
        }
    }

    const abrirDetalhe = async (id) => {
        setEnvelopeMenuId('')
        setDocMenuId('')
        setDetailId(id)
        setDetailTab('resumo')
        void carregarHistoricoEnvelope(id)
        setDetailOpen(true)
        setDetailLoading(true)
        setDetailJson(null)
        setDetailDocs([])
        setDetailSigs([])
        setDetailSignersRaw({})
        setDetailReqs([])
        const enc = csRequest('GET', `/envelopes/${encodeURIComponent(id)}`)
        const docs = csRequest('GET', `/envelopes/${encodeURIComponent(id)}/documents`)
        const sigs = csRequest('GET', `/envelopes/${encodeURIComponent(id)}/signers`)
        const reqs = obterRequisitosEnvelope(csRequest, id)
        const [r0, r1, r2, r3] = await Promise.all([enc, docs, sigs, reqs])
        setDetailLoading(false)
        if (!r0.ok) {
            pushToast('error', `Detalhe ${r0.status}`, erroApiTexto(r0.data))
            setDetailJson(r0.data)
            return
        }
        setDetailJson(r0.data)
        const reqNorm = r3.ok ? r3.data : null
        if (r1.ok) {
            let docRows = extrairListaDocumentos(r1.data)
            docRows = await enriquecerDocumentosComArquivos(csRequest, id, docRows)
            setDetailDocs(docRows)
        } else {
            setDetailDocs([])
        }
        if (r2.ok) {
            const arrSig = Array.isArray(r2.data?.data) ? r2.data.data : r2.data?.data ? [r2.data.data] : []
            const byId = {}
            const rawMap = {}
            for (const item of arrSig) {
                if (item?.id) byId[item.id] = item
            }
            const rows = extrairListaSignatarios(r2.data)
            rows.forEach((s) => {
                rawMap[s.id] = s
            })
            setDetailSignersRaw(rawMap)
            setDetailSigs(montarLinhasSignatariosDetalhe(r2.data, reqNorm, byId))
        } else {
            setDetailSigs([])
            setDetailSignersRaw({})
        }
        if (r3.ok) {
            const arr = Array.isArray(r3.data?.data) ? r3.data.data : r3.data?.data ? [r3.data.data] : []
            setDetailReqs(
                arr.map((item) => ({
                    id: item?.id ?? '',
                    tipo: item?.type ?? '—',
                    resumo: JSON.stringify(item?.attributes || {}).slice(0, 120) })),
            )
        }
    }

    const persistirEnvelopeSessao = (id) => {
        const v = String(id || '').trim()
        if (!v) return
        try {
            sessionStorage.setItem(STORAGE_FLUXO_EID, v)
        } catch {
            /* ignore */
        }
    }

    useEffect(() => {
        if (tab !== 'montar') return
        const raw = montarEdicaoEnvelopeIdRef.current
        montarEdicaoEnvelopeIdRef.current = ''
        const edicaoId = String(raw || '').trim()
        if (edicaoId) {
            setFluxoEdicaoLista(true)
            setFluxoSignNome('')
            setFluxoSignEmail('')
            setFluxoPhone('')
            setFluxoCanal('email')
            setFluxoPapel('sign')
            setFluxoDropAtivo(false)
            setFluxoNome('')
            setFluxoAssunto('')
            setFluxoMensagem('')
            setFluxoEnvelopeId(edicaoId)
            persistirEnvelopeSessao(edicaoId)
            void (async () => {
                const enc = await csRequest('GET', `/envelopes/${encodeURIComponent(edicaoId)}`)
                if (enc.ok) {
                    const a = enc.data?.data?.attributes || {}
                    if (a.name != null && String(a.name).trim()) setFluxoNome(String(a.name).trim())
                    if (a.default_subject != null && String(a.default_subject).trim()) {
                        setFluxoAssunto(String(a.default_subject).trim())
                    }
                    if (a.default_message != null && String(a.default_message).trim()) {
                        setFluxoMensagem(String(a.default_message).trim())
                    }
                }
                const [d1, d2, d3] = await Promise.all([
                    csRequest('GET', `/envelopes/${encodeURIComponent(edicaoId)}/documents`),
                    csRequest('GET', `/envelopes/${encodeURIComponent(edicaoId)}/signers`),
                    obterRequisitosEnvelope(csRequest, edicaoId),
                ])
                if (d1.ok) setFluxoDocs(extrairListaDocumentos(d1.data))
                else setFluxoDocs([])
                if (d2.ok) setFluxoSigs(mergeSignersWithQualificationLabels(d2.data, d3.ok ? d3.data : null))
                else setFluxoSigs([])
            })()
            pushToast(
                'info',
                'Envelope carregado',
                'Documentos e signatários sincronizados. Pode remover documentos, anexar novos e adicionar signatários.',
            )
        } else if (!fluxoImportPdfRef.current) {
            resetMontarFluxo()
        }
    }, [tab, resetMontarFluxo, pushToast])

    const extrasEnvelopeDoFormulario = () =>
        montarExtrasEnvelope({
            assunto: fluxoAssunto,
            mensagem: fluxoMensagem,
            prazoDias: fluxoPrazoDias,
            lembrete: fluxoLembrete,
        })

    /**
     * Salva nome/assunto/mensagem/prazo/lembretes de um envelope JÁ criado (ex.: nascido do PDF).
     * Só é possível em rascunho; antes deste ajuste não havia como renomear depois do upload.
     */
    const salvarEnvelopeFluxo = async () => {
        const eid = fluxoEnvelopeId.trim()
        if (!eid) return
        const nome = fluxoNome.trim()
        if (!nome) {
            pushToast('error', 'Nome do envelope', 'Informe um nome para o envelope.')
            return
        }
        setFluxoBusy(true)
        try {
            const encCheck = await csRequest('GET', `/envelopes/${encodeURIComponent(eid)}`)
            const st = encCheck.ok ? envelopeStatusNormalizado(encCheck.data?.data?.attributes?.status) : ''
            if (st && st !== 'draft') {
                pushToast('error', 'Envelope', 'Só é possível alterar o envelope em rascunho (draft).')
                return
            }
            const extras = extrasEnvelopeDoFormulario()
            // Campos limpos pelo usuário precisam ir vazios para a API (senão o valor antigo permanece).
            const campos = {
                name: nome,
                default_subject: extras.default_subject ?? null,
                default_message: extras.default_message ?? null,
            }
            if ('deadline_at' in extras) campos.deadline_at = extras.deadline_at
            if ('remind_interval' in extras) campos.remind_interval = extras.remind_interval
            const { ok, status, data } = await csRequest(
                'PATCH',
                `/envelopes/${encodeURIComponent(eid)}`,
                payloadAtualizarEnvelope(eid, campos),
            )
            if (!ok) {
                pushToast('error', `Salvar envelope ${status}`, erroApiTexto(data))
                return
            }
            pushToast('success', 'Envelope atualizado', `«${nome}»`)
            await carregarLista()
        } finally {
            setFluxoBusy(false)
        }
    }

    const criarEnvelopeFluxo = async () => {
        if (fluxoEnvelopeId.trim()) {
            // Já existe: nunca criar um segundo envelope — apenas salvar as alterações.
            await salvarEnvelopeFluxo()
            return
        }
        if (!fluxoNome.trim()) {
            pushToast('error', 'Nome do envelope', 'Informe um nome para o envelope.')
            return
        }
        setFluxoBusy(true)
        const extras = extrasEnvelopeDoFormulario()
        const body = payloadEnvelopeRascunho(fluxoNome, extras)
        const { ok, status, data } = await csRequest('POST', '/envelopes', body)
        setFluxoBusy(false)
        if (!ok) {
            pushToast('error', `Criar envelope ${status}`, erroApiTexto(data))
            return
        }
        const id = data?.data?.id ?? ''
        if (id) {
            setFluxoEnvelopeId(id)
            setFluxoEdicaoLista(false)
            persistirEnvelopeSessao(id)
            void refreshFluxoListas(id)
        }
        pushToast('info', 'Envelope criado', id ? 'Já pode anexar PDF e adicionar signatários nesta tela.' : 'Resposta sem ID — confira a lista de envelopes ou abra o detalhe do registro criado.')
        // O nome permanece no campo: agora ele pode ser editado e salvo ("Salvar alterações").
        await carregarLista()
        await carregarUsoMes()
    }

    const removerDocumentoFluxo = async (docId, nomeFicheiro) => {
        const did = String(docId || '').trim()
        if (!did) return
        let eid = fluxoEnvelopeId.trim()
        if (!eid) {
            try {
                eid = String(sessionStorage.getItem(STORAGE_FLUXO_EID) || '').trim()
            } catch {
                eid = ''
            }
        }
        if (!eid) {
            pushToast('error', 'Envelope', 'Sem envelope ativo.')
            return
        }
        const encCheck = await csRequest('GET', `/envelopes/${encodeURIComponent(eid)}`)
        const st = encCheck.ok ? encCheck.data?.data?.attributes?.status : null
        if (st && String(st).toLowerCase() !== 'draft') {
            pushToast('error', 'Envelope', 'Só é possível remover documentos com o envelope em rascunho (draft).')
            return
        }
        setFluxoDocRemovendoId(did)
        try {
            const { ok, status, data } = await csRequest(
                'DELETE',
                `/envelopes/${encodeURIComponent(eid)}/documents/${encodeURIComponent(did)}`,
            )
            if (!ok) {
                pushToast('error', `Remover documento ${status}`, erroApiTexto(data))
                return
            }
            const nome = String(nomeFicheiro || '').trim() || did.slice(0, 8)
            pushToast('info', 'Documento removido', nome)
            await refreshFluxoListas(eid)
            await carregarLista()
        } finally {
            setFluxoDocRemovendoId('')
        }
    }

    const removerSignatarioFluxo = async (signerId, nomeExibicao) => {
        const sid = String(signerId || '').trim()
        if (!sid) return
        let eid = fluxoEnvelopeId.trim()
        if (!eid) {
            try {
                eid = String(sessionStorage.getItem(STORAGE_FLUXO_EID) || '').trim()
            } catch {
                eid = ''
            }
        }
        if (!eid) {
            pushToast('error', 'Envelope', 'Sem envelope ativo.')
            return
        }
        const encCheck = await csRequest('GET', `/envelopes/${encodeURIComponent(eid)}`)
        const st = encCheck.ok ? encCheck.data?.data?.attributes?.status : null
        if (st && String(st).toLowerCase() !== 'draft') {
            pushToast('error', 'Envelope', 'Só é possível remover signatários com o envelope em rascunho (draft).')
            return
        }
        setFluxoSigRemovendoId(sid)
        try {
            const { ok, status, data } = await csRequest(
                'DELETE',
                `/envelopes/${encodeURIComponent(eid)}/signers/${encodeURIComponent(sid)}`,
            )
            if (!ok) {
                pushToast('error', `Remover signatário ${status}`, erroApiTexto(data))
                return
            }
            const nome = String(nomeExibicao || '').trim() || sid.slice(0, 8)
            pushToast('info', 'Signatário removido', nome)
            await refreshFluxoListas(eid)
            await carregarLista()
        } finally {
            setFluxoSigRemovendoId('')
        }
    }

    const refreshFluxoListas = useCallback(async (eid) => {
        const id = String(eid || fluxoEnvelopeId || '').trim()
        if (!id) return { docs: [], sigs: [] }
        const [d1, d2, d3] = await Promise.all([
            csRequest('GET', `/envelopes/${encodeURIComponent(id)}/documents`),
            csRequest('GET', `/envelopes/${encodeURIComponent(id)}/signers`),
            obterRequisitosEnvelope(csRequest, id),
        ])
        const docs = d1.ok ? extrairListaDocumentos(d1.data) : []
        const sigs = d2.ok ? mergeSignersWithQualificationLabels(d2.data, d3.ok ? d3.data : null) : []
        setFluxoDocs(docs)
        setFluxoSigs(sigs)
        return { docs, sigs }
    }, [fluxoEnvelopeId])

    const anexarPdfAoEnvelopeId = useCallback(
        async (eid, file) => {
            const id = String(eid || '').trim()
            if (!id) {
                pushToast('error', 'Envelope', 'Sem envelope ativo.')
                return false
            }
            setFluxoBusy(true)
            try {
                const sess = await garantirSessaoClicksign()
                if (!sess.ok) {
                    pushToast('error', 'Sessão', sess.error || 'Sessão ausente. Faça login de novo.')
                    return false
                }

                const encCheck = await csRequest('GET', `/envelopes/${encodeURIComponent(id)}`)
                if (!encCheck.ok && (encCheck.status === 401 || encCheck.status === 403)) {
                    pushToast('error', 'Sessão', erroApiTexto(encCheck.data) || 'Sessão ausente.')
                    return false
                }
                const st = encCheck.ok ? encCheck.data?.data?.attributes?.status : null
                if (st && String(st).toLowerCase() !== 'draft') {
                    pushToast(
                        'error',
                        'Envelope',
                        'Só é possível anexar PDF com o envelope em rascunho (draft). Crie um novo em «Montar envelope» ou use um rascunho ainda não ativado.',
                    )
                    return false
                }

                // Via Storage → API (evita 413 da Vercel no body base64 do proxy)
                const up = await anexarPdfEnvelopeViaStorage(id, file, { nomeArquivo: file.name })
                if (!up.ok) {
                    pushToast('error', `Documento ${up.status || ''}`.trim(), erroApiTexto(up.data))
                    return false
                }
                const nomeDoc = String(file.name || 'documento.pdf').trim() || 'documento.pdf'
                pushToast('info', 'Documento anexado', nomeDoc)
                await refreshFluxoListas(id)
                await carregarLista()
                return true
            } catch (e) {
                pushToast('error', 'PDF', e?.message || 'Falha ao anexar o arquivo.')
                return false
            } finally {
                setFluxoBusy(false)
            }
        },
        [pushToast, carregarLista, refreshFluxoListas],
    )

    const executarMontarComPdf = useCallback(
        async (file, nomeEnvelope, preservar = null) => {
            // `preservar`: o que o usuário já digitou no passo 1 antes de soltar o PDF — tem prioridade
            // sobre o nome do arquivo (antes era descartado e o envelope nascia com o nome do arquivo).
            const nome =
                String(preservar?.nome || '').trim() ||
                String(nomeEnvelope || nomeEnvelopeDoArquivoPdf(file.name)).trim() ||
                'Documento'
            resetMontarFluxo()
            setFluxoNome(nome)
            if (preservar) {
                setFluxoAssunto(preservar.assunto || '')
                setFluxoMensagem(preservar.mensagem || '')
                setFluxoPrazoDias(preservar.prazoDias || '')
                setFluxoLembrete(preservar.lembrete || '')
            }
            setFluxoBusy(true)
            const body = payloadEnvelopeRascunho(nome, preservar ? montarExtrasEnvelope(preservar) : {})
            const { ok, status, data } = await csRequest('POST', '/envelopes', body)
            if (!ok) {
                setFluxoBusy(false)
                pushToast('error', `Criar envelope ${status}`, erroApiTexto(data))
                return
            }
            const id = data?.data?.id ?? ''
            if (!id) {
                setFluxoBusy(false)
                pushToast('error', 'Envelope', 'Resposta sem ID do envelope.')
                return
            }
            setFluxoEnvelopeId(id)
            setFluxoNome(nome)
            setFluxoEdicaoLista(false)
            persistirEnvelopeSessao(id)
            const anexou = await anexarPdfAoEnvelopeId(id, file)
            if (anexou) {
                pushToast('info', 'Envelope criado', `«${nome}» — PDF anexado. Você pode renomear o envelope no passo 1 («Salvar alterações»), adicionar signatários e enviar quando estiver pronto.`)
            }
            await carregarLista()
            await carregarUsoMes()
        },
        [resetMontarFluxo, pushToast, anexarPdfAoEnvelopeId, carregarLista, carregarUsoMes],
    )

    const validarPdfFicheiro = useCallback(
        (file) => {
            if (!file || file.type !== 'application/pdf') {
                pushToast('error', 'Arquivo', 'Selecione um PDF.')
                return false
            }
            if (file.size > PDF_MAX_BYTES) {
                pushToast('error', 'Arquivo', `O PDF ultrapassa ${PDF_MAX_BYTES / (1024 * 1024)} MB.`)
                return false
            }
            return true
        },
        [pushToast],
    )

    const enfileirarPdfPainel = useCallback(
        (fileList) => {
            const file = fileList?.[0]
            if (!validarPdfFicheiro(file)) return
            const nome = nomeEnvelopeDoArquivoPdf(file.name)
            montarEdicaoEnvelopeIdRef.current = ''
            if (tab === 'montar') {
                void executarMontarComPdf(file, nome)
                return
            }
            fluxoImportPdfRef.current = { file, nome }
            setTab('montar')
        },
        [tab, validarPdfFicheiro, executarMontarComPdf],
    )

    const anexarPdfFluxo = async (fileList) => {
        const file = fileList?.[0]
        if (!validarPdfFicheiro(file)) return
        let eid = fluxoEnvelopeId.trim()
        if (!eid) {
            try {
                eid = String(sessionStorage.getItem(STORAGE_FLUXO_EID) || '').trim()
            } catch {
                eid = ''
            }
        }
        if (!eid) {
            const nome = nomeEnvelopeDoArquivoPdf(file.name)
            // Se o usuário já preencheu o passo 1, esses dados valem mais que o nome do arquivo.
            await executarMontarComPdf(file, nome, {
                nome: fluxoNome,
                assunto: fluxoAssunto,
                mensagem: fluxoMensagem,
                prazoDias: fluxoPrazoDias,
                lembrete: fluxoLembrete,
            })
            return
        }
        if (!fluxoEnvelopeId && eid) setFluxoEnvelopeId(eid)
        await anexarPdfAoEnvelopeId(eid, file)
    }

    useEffect(() => {
        if (tab !== 'montar') return
        const importPdf = fluxoImportPdfRef.current
        if (importPdf?.file) {
            fluxoImportPdfRef.current = null
            montarEdicaoEnvelopeIdRef.current = ''
            void executarMontarComPdf(importPdf.file, importPdf.nome)
        }
    }, [tab, executarMontarComPdf])

    const fecharSignModal = useCallback(() => {
        signReplaceSignerIdRef.current = ''
        signModalRef.current = null
        setSignModal(null)
        setSignModalCliquesFora(0)
        setSignTentouAvancar(false)
        setSignPending(null)
        setSignModalAgendaSel([])
        setAgendaQualPorId({})
        setSignModalAgendaBusca('')
        setSignModalAgendaTab('todos')
        setSugestoesKanbanBusca('')
        setSignAgendaEditId(null)
    }, [])

    const onSignModalBackdropClick = useCallback(() => {
        if (fluxoBusy) return
        // Com dados digitados, clicar fora NÃO fecha (evita perder o que foi preenchido): use Cancelar.
        const sujo =
            signModal === 'novo' &&
            Boolean(String(signDraft.nome || '').trim() || String(signDraft.email || '').trim() || String(signDraft.phone || '').trim())
        if (sujo) return
        fecharSignModal()
    }, [fluxoBusy, fecharSignModal, signModal, signDraft])

    const adicionarSignatarioComParametros = useCallback(
        async ({ nome, email, phone, channel, papel, gravarNaAgenda }) => {
            let eid = fluxoEnvelopeId.trim()
            if (!eid) {
                try {
                    eid = String(sessionStorage.getItem(STORAGE_FLUXO_EID) || '').trim()
                } catch {
                    eid = ''
                }
            }
            if (!eid) {
                pushToast('error', 'Envelope', 'Crie o envelope no passo 1 (o ID aparece no cartão «Envelope ativo»).')
                return false
            }
            if (!fluxoEnvelopeId && eid) setFluxoEnvelopeId(eid)
            const nomeTrim = String(nome || '').trim()
            if (!nomeSignatarioValido(nomeTrim)) {
                pushToast('error', 'Signatário', 'Use o nome completo (pelo menos duas palavras), como na Clicksign.')
                return false
            }
            const ch = canalSignatario(channel)
            const emTrim = String(email || '').trim()
            if (!emTrim) {
                pushToast(
                    'error',
                    'Signatário',
                    'A Clicksign exige e-mail no cadastro do signatário (a autenticação pode ser por WhatsApp).',
                )
                return false
            }
            if (ch === 'whatsapp') {
                const tel = normalizarTelefoneBr(phone)
                if (tel.length < 10 || tel.length > 11) {
                    pushToast('error', 'WhatsApp', 'Indique DDD + número com 10 ou 11 dígitos (ex.: 11999998888).')
                    return false
                }
            }
            const replaceId = String(signReplaceSignerIdRef.current || '').trim()
            const encStRes = await csRequest('GET', `/envelopes/${encodeURIComponent(eid)}`)
            const encSt = encStRes.ok
                ? envelopeStatusNormalizado(encStRes.data?.data?.attributes?.status ?? encStRes.data?.data?.attributes?.state)
                : 'draft'

            if (replaceId && encSt === 'running') {
                setFluxoBusy(true)
                const patchBody = payloadAtualizarSignatario({
                    signerId: replaceId,
                    name: nomeTrim,
                    email,
                    phone,
                    channel: ch })
                const pr = await csRequest(
                    'PATCH',
                    `/envelopes/${encodeURIComponent(eid)}/signers/${encodeURIComponent(replaceId)}`,
                    patchBody,
                )
                setFluxoBusy(false)
                signReplaceSignerIdRef.current = ''
                if (!pr.ok) {
                    const msg = erroApiTexto(pr.data)
                    const hint502 =
                        pr.status === 502
                            ? ' A API pode ter respondido vazio; confira o proxy Clicksign e tente remover e adicionar o signatário em rascunho.'
                            : ''
                    pushToast('error', `Atualizar signatário ${pr.status}`, `${msg}${hint502}`)
                    return false
                }
                pushToast('success', 'Signatário atualizado', nomeTrim)
                if (detailOpen && detailId === eid) await abrirDetalhe(eid)
                else await refreshFluxoListas(eid)
                return true
            }

            if (replaceId) {
                const dr = await csRequest('DELETE', `/envelopes/${encodeURIComponent(eid)}/signers/${encodeURIComponent(replaceId)}`)
                if (!dr.ok) {
                    pushToast('error', `Remover signatário anterior ${dr.status}`, erroApiTexto(dr.data))
                    return false
                }
                signReplaceSignerIdRef.current = ''
            }
            setFluxoBusy(true)
            const body = payloadSignatario(eid, {
                name: nomeTrim,
                email,
                phone,
                channel: ch })
            const { ok, status, data } = await csRequest('POST', `/envelopes/${encodeURIComponent(eid)}/signers`, body)
            if (!ok) {
                setFluxoBusy(false)
                pushToast('error', `Signatário ${status}`, erroApiTexto(data))
                return false
            }
            const signerId = String(data?.data?.id || '').trim()
            const papelUsar = normalizarPapelQualificacao(papel)
            let docsParaReq = fluxoDocs
            const docsRes = await csRequest('GET', `/envelopes/${encodeURIComponent(eid)}/documents`)
            if (docsRes.ok) {
                docsParaReq = extrairListaDocumentos(docsRes.data)
                setFluxoDocs(docsParaReq)
            }
            let requisitosOk = true
            const authMetodo = ch === 'whatsapp' ? 'whatsapp' : 'email'
            const reqsPrevRes = await obterRequisitosEnvelope(csRequest, eid)
            const reqNorm = reqsPrevRes.ok ? reqsPrevRes.data : null
            const rolesPrev = extrairRolesQualificacaoPorSignatario(reqNorm)
            const coveredQual = paresQualificacaoExistentes(reqNorm)
            const coveredAuth = paresAutenticacaoExistentes(reqNorm)

            if (signerId && signatarioPossuiQualificacao(rolesPrev, signerId)) {
                setFluxoBusy(false)
                pushToast(
                    'error',
                    'Qualificação',
                    'Este signatário já possui uma qualificação neste envelope. Remova-o e adicione novamente se precisar alterar o papel.',
                )
                return false
            }

            if (signerId && docsParaReq.length > 0) {
                for (const doc of docsParaReq) {
                    const docId = String(doc.id || '').trim()
                    if (!docId) continue
                    const par = `${docId}|${signerId}`
                    const papelExistente = rolesPrev[signerId]
                    if (papelExistente && papelExistente !== papelUsar) {
                        requisitosOk = false
                        pushToast(
                            'error',
                            'Qualificação',
                            `Este signatário já está como «${rotuloPapelQualificacao(papelExistente)}». Só é permitida uma qualificação por assinante.`,
                        )
                        break
                    }
                    if (!coveredQual.has(par)) {
                        const reqBody = payloadRequisitoQualificacao(eid, {
                            documentId: docId,
                            signerId,
                            role: papelUsar })
                        const rq = await csRequest(
                            'POST',
                            `/envelopes/${encodeURIComponent(eid)}/requirements`,
                            reqBody,
                        )
                        if (!rq.ok && !requisitoDuplicadoOuConflito(rq)) {
                            requisitosOk = false
                            pushToast(
                                'error',
                                `Requisito de qualificação ${rq.status}`,
                                erroApiTexto(rq.data) ||
                                    'O signatário foi criado; crie o requisito de qualificação na Clicksign ou tente novamente.',
                            )
                            break
                        }
                        coveredQual.add(par)
                        rolesPrev[signerId] = papelUsar
                    }
                    if (!coveredAuth.has(par)) {
                        const authBody = payloadRequisitoAutenticacao(eid, {
                            documentId: docId,
                            signerId,
                            auth: authMetodo })
                        const ra = await csRequest(
                            'POST',
                            `/envelopes/${encodeURIComponent(eid)}/requirements`,
                            authBody,
                        )
                        if (!ra.ok && !requisitoDuplicadoOuConflito(ra)) {
                            requisitosOk = false
                            pushToast(
                                'error',
                                `Requisito de autenticação ${ra.status}`,
                                erroApiTexto(ra.data) ||
                                    'O signatário foi criado; configure autenticação (e-mail/WhatsApp) na Clicksign ou tente novamente.',
                            )
                            break
                        }
                        coveredAuth.add(par)
                    }
                }
            }
            setFluxoBusy(false)
            if (docsParaReq.length === 0) {
                pushToast(
                    'info',
                    'Signatário adicionado',
                    'Anexe um PDF no passo 2 para criar automaticamente os requisitos de qualificação e autenticação.',
                )
            } else if (requisitosOk) {
                pushToast('info', 'Signatário adicionado', 'Qualificação e autenticação criadas para cada documento em rascunho.')
            }
            if (gravarNaAgenda) {
                try {
                    setAgendaSigs(
                        await upsertContatoAgenda({
                            name: nomeTrim,
                            email: String(email || '').trim(),
                            phone: maskTelefoneBr(phone || ''),
                            channel: ch,
                            papel: papelUsar,
                        }),
                    )
                } catch (e) {
                    pushToast('error', 'Agenda', e?.message || 'Não foi possível gravar na agenda compartilhada.')
                }
            }
            setFluxoPapel(papelUsar)
            setFluxoCanal(ch)
            setFluxoSignNome('')
            setFluxoSignEmail('')
            setFluxoPhone('')
            await refreshFluxoListas(eid)
            if (detailOpen && detailId === eid) await abrirDetalhe(eid)
            return true
        },
        [fluxoEnvelopeId, fluxoDocs, pushToast, refreshFluxoListas, detailOpen, detailId, abrirDetalhe],
    )

    const ativarEnvelopeFluxo = async () => {
        let eid = fluxoEnvelopeId.trim()
        if (!eid) {
            try {
                eid = String(sessionStorage.getItem(STORAGE_FLUXO_EID) || '').trim()
            } catch {
                eid = ''
            }
        }
        if (!eid) {
            pushToast('error', 'Envelope', 'Crie primeiro o envelope (passo 1).')
            return
        }
        if (!fluxoEnvelopeId && eid) setFluxoEnvelopeId(eid)
        setFluxoBusy(true)
        try {
            const { docs: docsAtivos, sigs: sigsAtivos } = (await refreshFluxoListas(eid)) || {
                docs: [],
                sigs: [] }
            if (docsAtivos.length === 0) {
                pushToast('error', 'Enviar envelope', 'Anexe pelo menos um documento (passo 2) antes de enviar.')
                return
            }
            if (sigsAtivos.length === 0) {
                pushToast('error', 'Enviar envelope', 'Adicione pelo menos um signatário (passo 3) antes de enviar.')
                return
            }
            const nomeConfirma = fluxoNome.trim() || 'este envelope'
            const confirmou = await confirmarAcao({
                titulo: `Enviar «${nomeConfirma}» para assinatura?`,
                mensagem: `${docsAtivos.length} documento(s) · ${sigsAtivos.length} signatário(s).\nApós o envio não será possível alterar documentos nem signatários.`,
                confirmar: 'Enviar para assinatura',
                cancelar: 'Voltar',
            })
            if (!confirmou) return
            const needReq = Math.max(0, docsAtivos.length) * Math.max(0, sigsAtivos.length)
            if (needReq > 0) {
                const reqsAtual = await obterRequisitosEnvelope(csRequest, eid)
                if (reqsAtual.ok) {
                    const { qual, auth } = contagemRequisitosPorTipo(reqsAtual.data)
                    const completo = matrizRequisitosPareceCompleta(
                        reqsAtual.data,
                        docsAtivos.length,
                        sigsAtivos.length,
                    )
                    if ((qual > needReq || auth > needReq) && completo) {
                        pushToast(
                            'info',
                            'Requisitos',
                            `Há ${qual} qualificação(ões) e ${auth} autenticação(ões) (para este envio bastam cerca de ${needReq} de cada). Não serão criados requisitos novos; a seguir tentamos ativar o envelope na Clicksign.`,
                        )
                    }
                }
            }

            const sync = await garantirRequisitosCompletosAntesAtivar(csRequest, eid)
            if (sync.erroListagem) {
                pushToast('error', 'Envelope', 'Não foi possível listar documentos ou signatários para sincronizar requisitos.')
                await refreshFluxoListas(eid)
                return
            }
            if (sync.falhas.length > 0) {
                const f0 = sync.falhas[0]
                const rotulo = sync.etapa === 'autenticacao' ? 'Autenticação' : 'Qualificação'
                pushToast(
                    'error',
                    `${rotulo} ${f0.status}`,
                    erroApiTexto(f0.data) || `Falha ao criar requisito de ${rotulo.toLowerCase()}.`,
                )
                await refreshFluxoListas(eid)
                return
            }
            const criadosTotal = (sync.criadosQual || 0) + (sync.criadosAuth || 0)
            if (criadosTotal > 0) {
                pushToast(
                    'info',
                    'Requisitos',
                    `${criadosTotal} requisito(s) criado(s) automaticamente (qualificação e autenticação).`,
                )
            }

            const body = payloadAtivarEnvelope(eid)
            const { ok, status, data } = await csRequest('PATCH', `/envelopes/${encodeURIComponent(eid)}`, body)

            if (!ok) {
                await refreshFluxoListas(eid)
                let msg = erroApiTexto(data)
                if (status === 422) {
                    const detalheApi = Array.isArray(data?.errors)
                        ? data.errors
                              .map((e) => String(e?.detail || e?.title || '').trim())
                              .filter(Boolean)
                              .join(' ')
                        : ''
                    if (detalheApi) msg = detalheApi
                    msg = `${msg}\n\nSe o erro continuar, abra o envelope em «Envelopes» → detalhe → «Requisitos» ou configure autenticação no painel da sandbox.`
                }
                pushToast('error', `Ativar ${status}`, msg)
                return
            }
            // A ativação não envia o aviso aos signatários: a notificação é uma chamada à parte.
            let avisoNotificacao = ''
            if (NOTIFICAR_AO_ATIVAR) {
                const notif = await csRequest(
                    'POST',
                    `/envelopes/${encodeURIComponent(eid)}/notifications`,
                    payloadNotificarEnvelope(''),
                )
                if (!notif.ok) {
                    avisoNotificacao = ` Atenção: o envelope foi ativado, mas o aviso aos signatários falhou (${notif.status}: ${erroApiTexto(notif.data)}). Use «Lembrete» no detalhe do envelope.`
                }
            }
            resetMontarFluxo()
            setTab('envelopes')
            await carregarLista()
            await carregarUsoMes()
            if (avisoNotificacao) {
                pushToast('error', 'Envelope enviado, mas…', avisoNotificacao.trim())
            } else {
                pushToast(
                    'success',
                    'Envelope enviado',
                    NOTIFICAR_AO_ATIVAR
                        ? 'O envelope foi ativado e os signatários foram notificados.'
                        : 'O envelope foi ativado. Os signatários serão notificados conforme a configuração da conta.',
                )
            }
        } finally {
            setFluxoBusy(false)
        }
    }

    const alternarOrdenacaoLista = (coluna) => {
        if (ordenarColuna === coluna) {
            setOrdenarDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        } else {
            setOrdenarColuna(coluna)
            setOrdenarDir(coluna === 'name' ? 'asc' : 'desc')
        }
    }

    const indicadorOrdenacao = (coluna) => {
        if (ordenarColuna !== coluna) return ''
        return ordenarDir === 'asc' ? ' ▲' : ' ▼'
    }

    const rowsFiltradasNome = useMemo(() => {
        const termo = filtroNomeDebounced
        if (!termo.trim()) return rows
        return rows.filter((r) => {
            const blob = normalizarTextoBusca([r.name, r.id].filter(Boolean).join(' '))
            return filtrarPorTermoBusca(blob, termo)
        })
    }, [rows, filtroNomeDebounced])

    const rowsOrdenadas = useMemo(() => {
        const list = [...rowsFiltradasNome]
        const fator = ordenarDir === 'asc' ? 1 : -1
        list.sort((a, b) => {
            if (ordenarColuna === 'name') {
                return fator * String(a.name ?? '').localeCompare(String(b.name ?? ''), 'pt-BR', { sensitivity: 'base' })
            }
            if (ordenarColuna === 'status') {
                return (
                    fator *
                    String(a.status ?? '').localeCompare(String(b.status ?? ''), 'pt-BR', { sensitivity: 'base' })
                )
            }
            if (ordenarColuna === 'created' || ordenarColuna === 'updated') {
                const ta = new Date(a[ordenarColuna] || 0).getTime()
                const tb = new Date(b[ordenarColuna] || 0).getTime()
                if (Number.isNaN(ta) && Number.isNaN(tb)) return 0
                if (Number.isNaN(ta)) return 1
                if (Number.isNaN(tb)) return -1
                return fator * (ta - tb)
            }
            return 0
        })
        return list
    }, [rowsFiltradasNome, ordenarColuna, ordenarDir])

    const totalPaginasLista = useMemo(() => {
        return Math.max(1, Math.ceil(rowsOrdenadas.length / Number(itensPorPaginaLista || 10)))
    }, [rowsOrdenadas.length, itensPorPaginaLista])

    const rowsPaginadas = useMemo(() => {
        const inicio = (Math.max(1, paginaAtualLista) - 1) * Number(itensPorPaginaLista || 10)
        const fim = inicio + Number(itensPorPaginaLista || 10)
        return rowsOrdenadas.slice(inicio, fim)
    }, [rowsOrdenadas, paginaAtualLista, itensPorPaginaLista])

    useEffect(() => {
        setPaginaAtualLista(1)
    }, [filtroNomeDebounced, statusFilter])

    useEffect(() => {
        setPaginaAtualLista((anterior) => Math.min(Math.max(1, anterior), totalPaginasLista))
    }, [totalPaginasLista])

    const handleTrocarItensPorPaginaLista = (valor) => {
        const proximo = Number(valor)
        if (!proximo || proximo < 1) return
        setItensPorPaginaLista(proximo)
        setPaginaAtualLista(1)
    }

    const agendaOrdenada = useMemo(() => {
        return [...agendaSigs].sort((a, b) => {
            const fa = a.favorite ? 1 : 0
            const fb = b.favorite ? 1 : 0
            if (fb !== fa) return fb - fa
            return String(a.name || '').localeCompare(String(b.name || ''), 'pt', { sensitivity: 'base' })
        })
    }, [agendaSigs])

    const agendaModalFiltrada = useMemo(() => {
        if (signModalAgendaTab === 'kanban') return []
        let list = [...agendaOrdenada]
        if (signModalAgendaTab === 'favoritos') list = list.filter((c) => c.favorite)
        const q = signModalAgendaBusca.trim().toLowerCase()
        if (q) {
            list = list.filter((c) => {
                const nome = String(c.name || '').toLowerCase()
                const em = String(c.email || '').toLowerCase()
                const tel = String(c.phone || '').replace(/\D/g, '')
                const qn = q.replace(/\D/g, '')
                return nome.includes(q) || em.includes(q) || (qn.length > 0 && tel.includes(qn))
            })
        }
        return list
    }, [agendaOrdenada, signModalAgendaTab, signModalAgendaBusca])

    const agendaKanbanFiltrada = useMemo(() => {
        if (signModalAgendaTab !== 'kanban') return []
        return filtrarSugestoesSignatarioKanban(sugestoesKanban, signModalAgendaBusca)
    }, [signModalAgendaTab, sugestoesKanban, signModalAgendaBusca])

    const mesNome = new Date().toLocaleString('pt-BR', { month: 'long', year: 'numeric' })
    const secaoLista = SECOES_PAINEL[vistaPainel] || SECOES_PAINEL.all
    const fmtContagem = (n) => (contagensLoading ? '…' : n != null ? String(n) : '—')
    const errosSign = errosSignDraft(signDraft)

    /** O que ainda impede o envio (vazio = pronto). Alimenta o passo a passo e o botão de enviar. */
    const pendenciaEnvio = !fluxoEnvelopeId.trim()
        ? 'criar o envelope (passo 1)'
        : fluxoDocs.length === 0
          ? 'anexar pelo menos um documento (passo 2)'
          : fluxoSigs.length === 0
            ? 'adicionar pelo menos um signatário (passo 3)'
            : ''
    const passosFluxo = (() => {
        const feitos = [Boolean(fluxoEnvelopeId.trim()), fluxoDocs.length > 0, fluxoSigs.length > 0, false]
        const titulos = ['Envelope', 'Documentos', 'Signatários', 'Enviar']
        const primeiroPendente = feitos.findIndex((ok) => !ok)
        return titulos.map((titulo, i) => ({ n: i + 1, titulo, ok: feitos[i], ativo: i === primeiroPendente }))
    })()

    return (
        <div
            className={`el-legacy-wrap contratos_emerdog clicksign_emerdog clicksign_emerdog_full${!podeEditarContratos ? ' clicksign_readonly' : ''}`}
        >
            <PageHeader
                kicker="Contratos"
                title="Clicksign — Assinatura Eletrônica"
                description="Monte envelopes, acompanhe assinaturas e gerencie documentos na Clicksign."
                actions={
                    podeEditarContratos ? (
                        <Button onClick={novoEnvelope}>+ Novo envelope</Button>
                    ) : null
                }
            />

            {!podeEditarContratos && (
                <p className="contratos_readonly_banner" role="status">
                    Somente visualização em Contratos/Clicksign: listagens e detalhes liberados; criar, enviar ou excluir bloqueados.
                </p>
            )}

            <div
                className="contratos_tabs clicksign_tabs_scroll"
                role="tablist"
                aria-label="Seções do Clicksign"
                onKeyDown={(e) => {
                    // Setas alternam entre as abas (padrão WAI-ARIA).
                    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
                    e.preventDefault()
                    const ordem = ['envelopes', 'montar']
                    const atual = ordem.indexOf(tab)
                    const prox =
                        e.key === 'Home' ? 0 : e.key === 'End' ? ordem.length - 1 : (atual + (e.key === 'ArrowRight' ? 1 : -1) + ordem.length) % ordem.length
                    setTab(ordem[prox])
                    window.requestAnimationFrame(() => document.getElementById(`cs-tab-${ordem[prox]}`)?.focus())
                }}
            >
                <button
                    type="button"
                    id="cs-tab-envelopes"
                    role="tab"
                    aria-selected={tab === 'envelopes'}
                    tabIndex={tab === 'envelopes' ? 0 : -1}
                    className={`contratos_tab ${tab === 'envelopes' ? 'is-active' : ''}`}
                    onClick={() => setTab('envelopes')}
                >
                    Painel
                </button>
                <button
                    type="button"
                    id="cs-tab-montar"
                    role="tab"
                    aria-selected={tab === 'montar'}
                    tabIndex={tab === 'montar' ? 0 : -1}
                    className={`contratos_tab ${tab === 'montar' ? 'is-active' : ''}`}
                    onClick={() => setTab('montar')}
                >
                    Montar envelope
                </button>
            </div>

            <div className="contratos_card">
                {tab === 'envelopes' && (
                    <div className="cs_dash_root">
                        <div className="cs_painel_filtros" role="group" aria-label="Filtrar envelopes por estado">
                            <div className="ek-segmented cs_painel_segmentos">
                                {FILTROS_ESTADO_PAINEL.map((op) => {
                                    const n = op.contagem ? contagens[op.contagem] : null
                                    return (
                                        <button
                                            key={op.chave}
                                            type="button"
                                            className="ek-segmented__opt"
                                            aria-pressed={vistaPainel === op.chave}
                                            onClick={() => abrirSecaoPainel(op.chave)}
                                        >
                                            {op.rotulo}
                                            {op.contagem && n != null && !contagensLoading ? (
                                                <span className="cs_painel_segmento_n">{n}</span>
                                            ) : null}
                                        </button>
                                    )
                                })}
                            </div>
                            <p className="cs_painel_resumo" aria-live="polite">
                                Últimos 30 dias: <strong>{fmtContagem(contagens.closed30)}</strong> finalizados ·{' '}
                                <strong>{fmtContagem(contagens.canceled30)}</strong> cancelados ·{' '}
                                <span title="Recusas de assinatura registradas pelo webhook da Clicksign">
                                    <strong>{fmtContagem(contagens.recusas)}</strong> recusas
                                </span>{' '}
                                · Criados em {mesNome}: <strong>{mesLoading ? '…' : mesCount != null ? mesCount : '—'}</strong>
                            </p>
                        </div>

                        <div className="cs_painel_topo">
                            <div
                                className={`cs_dash_upload_card cs_dash_upload_card--compact ${dashDropAtivo ? 'is-drag' : ''}`}
                                role="button"
                                tabIndex={0}
                                aria-label="Adicionar documento PDF para criar um novo envelope"
                                onClick={() => podeEditarContratos && dashUploadInputRef.current?.click()}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault()
                                        if (podeEditarContratos) dashUploadInputRef.current?.click()
                                    }
                                }}
                                onDragEnter={(e) => {
                                    e.preventDefault()
                                    setDashDropAtivo(true)
                                }}
                                onDragOver={(e) => {
                                    e.preventDefault()
                                    setDashDropAtivo(true)
                                }}
                                onDragLeave={(e) => {
                                    e.preventDefault()
                                    if (!e.currentTarget.contains(e.relatedTarget)) setDashDropAtivo(false)
                                }}
                                onDrop={(e) => {
                                    e.preventDefault()
                                    setDashDropAtivo(false)
                                    const f = e.dataTransfer?.files
                                    if (f?.length && podeEditarContratos) enfileirarPdfPainel(f)
                                }}
                            >
                                <input
                                    ref={dashUploadInputRef}
                                    type="file"
                                    accept="application/pdf,.pdf"
                                    className="cs_dash_upload_input"
                                    aria-hidden
                                    tabIndex={-1}
                                    onChange={(e) => {
                                        const files = e.target.files
                                        if (files?.length) enfileirarPdfPainel(files)
                                        e.target.value = ''
                                    }}
                                />
                                <span className="cs_dash_upload_icon" aria-hidden>
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                        <path d="M12 18v-8M9 13l3-3 3 3" />
                                    </svg>
                                </span>
                                <strong>Adicionar documento</strong>
                                <span className="cs_dash_upload_hint">Clique ou arraste um PDF para criar um envelope</span>
                            </div>

                            <section className="cs_dash_notify" aria-labelledby="cs-dash-notify-title">
                                <div className="cs_dash_notify_head">
                                    <h3 id="cs-dash-notify-title" className="cs_dash_notify_title">
                                        Atualizações recentes
                                    </h3>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={notificacoes.length === 0}
                                        onClick={limparListaNotificacoes}
                                    >
                                        Limpar
                                    </Button>
                                </div>
                                {notifSyncing && notificacoes.length === 0 && (
                                    <p className="cs_dash_notify_empty">Carregando…</p>
                                )}
                                {!notifSyncing && notificacoes.length === 0 && (
                                    <p className="cs_dash_notify_empty">
                                        Nada de novo. Avisamos quando alguém assinar, recusar ou um envelope for concluído.
                                    </p>
                                )}
                                {notificacoes.length > 0 && (
                                    <ul className="cs_dash_notify_list">
                                        {notificacoes.slice(0, 5).map((n) => (
                                            <li key={n.id}>
                                                <button
                                                    type="button"
                                                    className="cs_dash_notify_row"
                                                    onClick={() => abrirDetalhe(n.envelopeId)}
                                                >
                                                    <span className="cs_dash_notify_texto">{n.texto}</span>
                                                    <span className="cs_dash_notify_quando">{formatarDataPtBr(n.at)}</span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>
                        </div>

                        <div className="clicksign_toolbar cs_list_toolbar">
                            <div className="contratos_field clicksign_field_inline clicksign_field_grow">
                                <label htmlFor="cs-filtro-nome">Buscar</label>
                                <input
                                    id="cs-filtro-nome"
                                    className="contratos_input"
                                    type="search"
                                    value={filtroNomeEnvelope}
                                    onChange={(e) => setFiltroNomeEnvelope(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault()
                                            commitFiltroNomeImediato()
                                        }
                                    }}
                                    placeholder="Nome do envelope ou ID…"
                                />
                            </div>
                            <Button variant="secondary" disabled={loading} onClick={atualizarPainel}>
                                {loading ? 'Atualizando…' : 'Atualizar'}
                            </Button>
                        </div>
                        <div className="clicksign_table_wrap overflow-x-auto">
                            <table className="clicksign_table clicksign_table_envelopes">
                                <colgroup>
                                    <col className="clicksign_col_nome" />
                                    <col className="clicksign_col_estado" />
                                    <col className="clicksign_col_data" />
                                    <col className="clicksign_col_data" />
                                    <col className="clicksign_col_acoes" />
                                </colgroup>
                                <thead>
                                    <tr>
                                        <th className="clicksign_col_nome clicksign_th_sortable" aria-sort={ariaSort('name')}>
                                            <button type="button" className="clicksign_th_sort_btn" onClick={() => alternarOrdenacaoLista('name')}>
                                                Nome{indicadorOrdenacao('name')}
                                            </button>
                                        </th>
                                        <th className="clicksign_col_estado clicksign_th_sortable" aria-sort={ariaSort('status')}>
                                            <button type="button" className="clicksign_th_sort_btn" onClick={() => alternarOrdenacaoLista('status')}>
                                                Estado{indicadorOrdenacao('status')}
                                            </button>
                                        </th>
                                        <th className="clicksign_col_data clicksign_th_sortable" aria-sort={ariaSort('created')}>
                                            <button type="button" className="clicksign_th_sort_btn" onClick={() => alternarOrdenacaoLista('created')}>
                                                Criado{indicadorOrdenacao('created')}
                                            </button>
                                        </th>
                                        <th className="clicksign_col_data clicksign_th_sortable" aria-sort={ariaSort('updated')}>
                                            <button type="button" className="clicksign_th_sort_btn" onClick={() => alternarOrdenacaoLista('updated')}>
                                                Atualizado{indicadorOrdenacao('updated')}
                                            </button>
                                        </th>
                                        <th className="clicksign_col_acoes">Ações</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rowsOrdenadas.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="clicksign_td_empty">
                                                {loading ? (
                                                    <LoadingState label="Carregando envelopes…" />
                                                ) : (
                                                    <EmptyState
                                                        title={filtroNomeDebounced ? 'Nenhum envelope com esse termo' : secaoLista?.emptyEnvelope || 'Nenhum envelope encontrado.'}
                                                        description={
                                                            filtroNomeDebounced
                                                                ? listaTotal > rows.length
                                                                    ? 'A busca vale só para os envelopes já carregados. Use «Carregar mais envelopes» para procurar nos mais antigos.'
                                                                    : 'Revise a busca ou escolha outro estado acima.'
                                                                : 'Arraste um PDF acima ou crie um novo envelope.'
                                                        }
                                                        action={
                                                            podeEditarContratos ? (
                                                                <Button onClick={novoEnvelope}>Novo envelope</Button>
                                                            ) : null
                                                        }
                                                    />
                                                )}
                                            </td>
                                        </tr>
                                    )}
                                    {rowsPaginadas.map((r) => {
                                        const stLinha = envelopeStatusNormalizado(r.status)
                                        return (
                                            <tr
                                                key={r.id}
                                                className="cs_row_clicavel"
                                                tabIndex={0}
                                                onClick={() => abrirDetalhe(r.id)}
                                                onKeyDown={(e) => {
                                                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                                                        e.preventDefault()
                                                        abrirDetalhe(r.id)
                                                    }
                                                }}
                                            >
                                                <td className="clicksign_col_nome" data-label="Nome">
                                                    {r.name}
                                                </td>
                                                <td className="clicksign_col_estado" data-label="Estado">
                                                    <Badge tone={tomBadgeEnvelope(stLinha)}>{rotuloEstadoEnvelope(r.status)}</Badge>
                                                </td>
                                                <td className="clicksign_col_data" data-label="Criado">
                                                    {formatarDataPtBr(r.created)}
                                                </td>
                                                <td className="clicksign_col_data" data-label="Atualizado">
                                                    {formatarDataPtBr(r.updated)}
                                                </td>
                                                <td className="clicksign_col_acoes" data-label="Ações">
                                                    <div
                                                        className="clicksign_td_actions clicksign_row_menu_wrap"
                                                        onClick={(e) => e.stopPropagation()}
                                                        onKeyDown={(e) => e.stopPropagation()}
                                                    >
                                                        {stLinha === 'draft' && podeEditarContratos && (
                                                            <Button variant="secondary" size="sm" onClick={() => continuarRascunho(r.id)}>
                                                                Continuar
                                                            </Button>
                                                        )}
                                                        <button
                                                            type="button"
                                                            className="clicksign_menu_trigger"
                                                            aria-label={`Ações do envelope ${r.name}`}
                                                            aria-haspopup="menu"
                                                            aria-expanded={envelopeMenuId === r.id}
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                if (envelopeMenuId === r.id) {
                                                                    setEnvelopeMenuId('')
                                                                    return
                                                                }
                                                                setEnvMenuEstilo(estiloMenuFlutuante(e.currentTarget, 240))
                                                                setEnvelopeMenuId(r.id)
                                                            }}
                                                        >
                                                            <IconeMenuVertical />
                                                        </button>
                                                        {envelopeMenuId === r.id && (
                                                            <div className="clicksign_dropdown clicksign_dropdown--up" role="menu" style={envMenuEstilo}>
                                                                <button
                                                                    type="button"
                                                                    role="menuitem"
                                                                    onClick={() => {
                                                                        setEnvelopeMenuId('')
                                                                        abrirDetalhe(r.id)
                                                                    }}
                                                                >
                                                                    Exibir detalhes
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    role="menuitem"
                                                                    onClick={() => {
                                                                        setEnvelopeMenuId('')
                                                                        void copiarIdEnvelope(r.id)
                                                                    }}
                                                                >
                                                                    Copiar ID
                                                                </button>
                                                                {stLinha === 'running' && podeEditarContratos && (
                                                                    <button
                                                                        type="button"
                                                                        role="menuitem"
                                                                        onClick={() => {
                                                                            setEnvelopeMenuId('')
                                                                            cancelarEnvelope(r.id, r.name)
                                                                        }}
                                                                    >
                                                                        Cancelar envelope
                                                                    </button>
                                                                )}
                                                                <a
                                                                    role="menuitem"
                                                                    className="clicksign_dropdown_link"
                                                                    href={urlAbrirEnvelopeClicksign(r.id, r.selfLink)}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    onClick={() => setEnvelopeMenuId('')}
                                                                >
                                                                    Abrir no Clicksign
                                                                </a>
                                                                {stLinha === 'draft' && podeEditarContratos && (
                                                                    <button
                                                                        type="button"
                                                                        role="menuitem"
                                                                        className="clicksign_dropdown_danger"
                                                                        disabled={loading || deletingId === r.id}
                                                                        onClick={(e) => {
                                                                            setEnvelopeMenuId('')
                                                                            void excluirEnvelope(r.id, r.name, {
                                                                                ignorarConfirmacao: e.shiftKey })
                                                                        }}
                                                                    >
                                                                        Excluir rascunho
                                                                    </button>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {!loading && rowsOrdenadas.length > 0 && (
                            <div className="clicksign_lista_paginacao">
                                <div className="clicksign_lista_paginacao_info">
                                    Exibindo{' '}
                                    <strong>
                                        {(paginaAtualLista - 1) * itensPorPaginaLista + 1}-
                                        {Math.min(paginaAtualLista * itensPorPaginaLista, rowsOrdenadas.length)}
                                    </strong>{' '}
                                    de <strong>{rowsOrdenadas.length}</strong>
                                </div>
                                <div className="clicksign_lista_paginacao_controles">
                                    <label className="clicksign_lista_paginacao_label">
                                        Por página
                                        <SelectDropdown
                                            className="contratos_select"
                                            value={itensPorPaginaLista}
                                            onChange={(e) => handleTrocarItensPorPaginaLista(e.target.value)}
                                        >
                                            <option value={10}>10</option>
                                            <option value={20}>20</option>
                                            <option value={30}>30</option>
                                            <option value={40}>40</option>
                                            <option value={100}>100</option>
                                        </SelectDropdown>
                                    </label>
                                    <Button
                                        variant="secondary"
                                        onClick={() => setPaginaAtualLista((p) => Math.max(1, p - 1))}
                                        disabled={paginaAtualLista <= 1}
                                    >
                                        Anterior
                                    </Button>
                                    <span className="clicksign_lista_paginacao_page">
                                        Página {paginaAtualLista} de {totalPaginasLista}
                                    </span>
                                    <Button
                                        variant="secondary"
                                        onClick={() => setPaginaAtualLista((p) => Math.min(totalPaginasLista, p + 1))}
                                        disabled={paginaAtualLista >= totalPaginasLista}
                                    >
                                        Próxima
                                    </Button>
                                </div>
                            </div>
                        )}
                        {!loading && listaTotal > rows.length && (
                            <div className="cs_carregar_mais">
                                <p className="ek-hint">
                                    Mostrando {rows.length} de {listaTotal} envelopes (os mais recentes).
                                </p>
                                <Button variant="secondary" disabled={carregandoMais} onClick={carregarMaisEnvelopes}>
                                    {carregandoMais ? 'Carregando…' : 'Carregar mais envelopes'}
                                </Button>
                            </div>
                        )}
                    </div>
                )}

                {tab === 'montar' && (
                    <div className="cs_flow cs_flow--layout">
                        <div className="cs_flow_main">
                        <ol className="cs_stepper" aria-label="Etapas para enviar o envelope">
                            {passosFluxo.map((p) => (
                                <li key={p.n} className={`cs_stepper_item ${p.ok ? 'is-done' : ''} ${p.ativo ? 'is-active' : ''}`} aria-current={p.ativo ? 'step' : undefined}>
                                    <span className="cs_stepper_num" aria-hidden>{p.ok ? '✓' : p.n}</span>
                                    <span className="cs_stepper_txt">{p.titulo}</span>
                                </li>
                            ))}
                        </ol>
                        {fluxoEnvelopeId.trim() ? (
                            <div className="cs_env_strip">
                                <span className="cs_env_badge">Envelope ativo</span>
                                {fluxoEdicaoLista && (
                                    <span className="cs_env_badge cs_env_badge_edicao" title="Carregado a partir da lista Envelopes">
                                        Edição
                                    </span>
                                )}
                                <code className="cs_env_id">{fluxoEnvelopeId.trim()}</code>
                                <button type="button" className="contratos_btn contratos_btn_secondary clicksign_btn_sm" disabled={fluxoBusy} onClick={() => refreshFluxoListas()}>
                                    Atualizar listas
                                </button>
                                <button
                                    type="button"
                                    className="contratos_btn contratos_btn_secondary clicksign_btn_sm"
                                    onClick={() => {
                                        resetMontarFluxo()
                                        pushToast('info', 'Novo fluxo', 'Pode criar outro envelope.')
                                    }}
                                >
                                    Novo envelope
                                </button>
                            </div>
                        ) : (
                            <p className="contratos_hint cs_hint_inline">
                                Cada vez que você abre esta aba inicia um <strong>novo</strong> rascunho local. Se sair com um envelope em rascunho na Clicksign, mostramos um aviso para continuar em Envelopes (detalhe / editar).
                            </p>
                        )}

                        <section className="cs_card">
                            <header className="cs_card_head">
                                <span className="cs_card_dot" aria-hidden />
                                <h2 className="cs_card_title">1. Envelope</h2>
                                <span className="cs_card_tag">rascunho</span>
                            </header>
                            <div className="cs_card_body">
                                <div className="cs_field_grid">
                                    <div className="contratos_field">
                                        <label htmlFor="cs-fl-nome">Nome do envelope</label>
                                        <input
                                            id="cs-fl-nome"
                                            className="contratos_input cs_input"
                                            value={fluxoNome}
                                            onChange={(e) => setFluxoNome(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && !fluxoBusy) {
                                                    e.preventDefault()
                                                    void criarEnvelopeFluxo()
                                                }
                                            }}
                                            placeholder="Ex.: Contrato — clínica X"
                                            maxLength={200}
                                        />
                                        {fluxoEnvelopeId.trim() && (
                                            <p className="contratos_hint cs_hint_inline">
                                                Alterações em nome, assunto, mensagem, prazo e lembretes só valem depois de clicar em «Salvar alterações».
                                            </p>
                                        )}
                                    </div>
                                    <div className="contratos_field">
                                        <label htmlFor="cs-fl-sub">Assunto do e-mail (opcional)</label>
                                        <input
                                            id="cs-fl-sub"
                                            className="contratos_input cs_input"
                                            value={fluxoAssunto}
                                            onChange={(e) => setFluxoAssunto(e.target.value)}
                                            placeholder="Assunto da solicitação de assinatura"
                                            maxLength={ASSUNTO_MAX}
                                        />
                                    </div>
                                </div>
                                <div className="cs_field_grid">
                                    <div className="contratos_field">
                                        <label htmlFor="cs-fl-prazo">Prazo para assinar (dias, opcional)</label>
                                        <input
                                            id="cs-fl-prazo"
                                            className="contratos_input cs_input"
                                            type="number"
                                            inputMode="numeric"
                                            min={1}
                                            max={90}
                                            value={fluxoPrazoDias}
                                            onChange={(e) => setFluxoPrazoDias(e.target.value)}
                                            placeholder="Padrão da conta: 30"
                                        />
                                    </div>
                                    <div className="contratos_field">
                                        <label htmlFor="cs-fl-lembrete">Lembrete automático (opcional)</label>
                                        <select
                                            id="cs-fl-lembrete"
                                            className="contratos_input cs_input"
                                            value={fluxoLembrete}
                                            onChange={(e) => setFluxoLembrete(e.target.value)}
                                        >
                                            <option value="">Padrão da conta (a cada 3 dias)</option>
                                            {INTERVALOS_LEMBRETE_CLICKSIGN.map((d) => (
                                                <option key={d} value={String(d)}>
                                                    A cada {d} {d === 1 ? 'dia' : 'dias'}
                                                </option>
                                            ))}
                                            <option value="nenhum">Sem lembretes</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="contratos_field">
                                    <label htmlFor="cs-fl-msg">Mensagem (opcional)</label>
                                    <textarea
                                        id="cs-fl-msg"
                                        className="contratos_textarea cs_textarea"
                                        rows={3}
                                        value={fluxoMensagem}
                                        onChange={(e) => setFluxoMensagem(e.target.value)}
                                        placeholder="Mensagem enviada aos signatários (quando aplicável ao plano)"
                                    />
                                </div>
                                <div className="cs_actions_row">
                                    <button type="button" className="contratos_btn contratos_btn_primary" disabled={fluxoBusy || !fluxoNome.trim()} onClick={() => criarEnvelopeFluxo()}>
                                        {fluxoEnvelopeId.trim() ? 'Salvar alterações' : '+ Criar envelope'}
                                    </button>
                                </div>
                            </div>
                        </section>

                        <section className="cs_card cs_card_docs">
                            <header className="cs_card_head">
                                <span className="cs_card_dot cs_dot_red" aria-hidden />
                                <h2 className="cs_card_title">2. Documentos</h2>
                            </header>
                            <div className="cs_card_body">
                                {!fluxoEnvelopeId.trim() && <p className="contratos_hint cs_dropzone_hint_top">Escolha ou arraste um PDF. Usamos o nome acima; se estiver vazio, o nome do arquivo (dá para renomear depois).</p>}
                                <div
                                    className={`cs_dropzone ${fluxoDropAtivo ? 'is-active' : ''} ${!fluxoEnvelopeId.trim() ? 'cs_dropzone--auto_env' : ''}`}
                                    onDragEnter={(e) => {
                                        e.preventDefault()
                                        setFluxoDropAtivo(true)
                                    }}
                                    onDragOver={(e) => {
                                        e.preventDefault()
                                        setFluxoDropAtivo(true)
                                    }}
                                    onDragLeave={() => setFluxoDropAtivo(false)}
                                    onDrop={(e) => {
                                        e.preventDefault()
                                        setFluxoDropAtivo(false)
                                        const f = e.dataTransfer?.files
                                        if (f?.length) void anexarPdfFluxo(f)
                                    }}
                                >
                                    <div className="cs_dropzone_icon" aria-hidden>
                                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                                            <path d="M12 4v12M8 8l4-4 4 4M4 20h16" />
                                        </svg>
                                    </div>
                                    <p className="cs_dropzone_title">Arraste e solte o PDF aqui</p>
                                    <p className="cs_dropzone_sub">ou escolha um arquivo (máx. ~{PDF_MAX_BYTES / (1024 * 1024)} MB)</p>
                                    <label className="contratos_btn contratos_btn_secondary clicksign_btn_sm cs_file_label">
                                        Escolher PDF
                                        <input
                                            className="cs_file_input"
                                            type="file"
                                            accept="application/pdf,.pdf"
                                            disabled={fluxoBusy}
                                            onChange={(e) => {
                                                const files = e.target.files
                                                if (files?.length) void anexarPdfFluxo(files)
                                                e.target.value = ''
                                            }}
                                        />
                                    </label>
                                </div>
                            </div>
                        </section>

                        <section className={`cs_card ${!fluxoEnvelopeId.trim() ? 'is-locked' : ''}`}>
                            <header className="cs_card_head">
                                <span className="cs_card_dot cs_dot_red" aria-hidden />
                                <h2 className="cs_card_title">
                                    3. Signatários <span className="cs_sig_req_mark" title="Obrigatório antes de enviar o envelope">
                                        *
                                    </span>
                                </h2>
                            </header>
                            <div className="cs_card_body">
                                {!fluxoEnvelopeId.trim() && <div className="cs_lock_msg">Crie o envelope no passo 1.</div>}
                                {fluxoEnvelopeId.trim() && (
                                    <>
                                        <div className="cs_sig_pills" role="group" aria-label="Incluir signatário">
                                            <button
                                                type="button"
                                                className="cs_sig_pill"
                                                disabled={fluxoBusy}
                                                onClick={() => {
                                                    signReplaceSignerIdRef.current = ''
                                                    setSignDraft({
                                                        channel: fluxoCanal,
                                                        email: fluxoSignEmail,
                                                        phone: fluxoPhone,
                                                        nome: fluxoSignNome,
                                                        saveAgenda: true })
                                                    abrirSignModalKanban('novo')
                                                }}
                                            >
                                                <span className="cs_sig_pill_icon" aria-hidden>
                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                                                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                                                        <circle cx="9" cy="7" r="4" />
                                                        <path d="M19 8v6M22 11h-6" />
                                                    </svg>
                                                </span>
                                                Signatário novo
                                            </button>
                                            <button
                                                type="button"
                                                className="cs_sig_pill"
                                                disabled={fluxoBusy}
                                                onClick={() => {
                                                    setSignModalAgendaBusca('')
                                                    setSignModalAgendaTab('todos')
                                                    setSignModalAgendaSel([])
                                                    setAgendaQualPorId({})
                                                    abrirSignModalKanban('agenda')
                                                }}
                                            >
                                                <span className="cs_sig_pill_icon" aria-hidden>
                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                                                        <rect x="3" y="4" width="18" height="16" rx="2" />
                                                        <path d="M7 8h6M7 12h10" />
                                                    </svg>
                                                </span>
                                                Signatário da agenda
                                            </button>
                                        </div>
                                        <p className="contratos_hint cs_sig_agenda_count">
                                            {agendaCarregando
                                                ? 'Carregando agenda compartilhada…'
                                                : agendaOrdenada.length === 0
                                                  ? 'Agenda vazia — os contatos salvos ao adicionar signatários aparecem em «Signatário da agenda» (compartilhados com a equipe).'
                                                  : `${agendaOrdenada.length} contato(s) na agenda compartilhada.`}
                                        </p>
                                    </>
                                )}
                            </div>
                        </section>

                        </div>
                        <aside className="cs_flow_aside" aria-label="Resumo do envelope">
                        <section className="cs_card cs_card_resumo">
                            <h2 className="cs_aside_title">Resumo</h2>
                            <p className="cs_aside_nome">{fluxoNome.trim() || 'Envelope sem nome'}</p>
                        <div className="cs_summary_grid">
                            <div className="cs_summary_card">
                                <h3 className="cs_summary_title">Documentos</h3>
                                <ul className="cs_summary_list">
                                    {fluxoDocs.length === 0 && <li className="cs_summary_empty">Nenhum arquivo ainda.</li>}
                                    {fluxoDocs.map((d) => (
                                        <li key={d.id} className="cs_summary_item cs_summary_item_with_actions">
                                            <div className="cs_summary_item_main">
                                                <span className="cs_summary_name">{d.filename}</span>
                                                <span className="cs_summary_meta">{d.status}</span>
                                            </div>
                                            <button
                                                type="button"
                                                className="cs_summary_remove"
                                                title="Remover documento"
                                                aria-label={`Remover ${d.filename}`}
                                                disabled={!fluxoEnvelopeId.trim() || fluxoDocRemovendoId !== '' || fluxoSigRemovendoId !== '' || fluxoBusy}
                                                onClick={() => void removerDocumentoFluxo(d.id, d.filename)}
                                            >
                                                −
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            <div className="cs_summary_card">
                                <h3 className="cs_summary_title">Signatários</h3>
                                <ul className="cs_summary_list">
                                    {fluxoSigs.length === 0 && <li className="cs_summary_empty">Nenhum signatário ainda.</li>}
                                    {fluxoSigs.map((s) => (
                                        <li key={s.id} className="cs_summary_item cs_summary_item_with_actions">
                                            <div className="cs_summary_item_main">
                                                <span className="cs_summary_name">
                                                    {s.qualificationLabel ? `${s.name} — ${s.qualificationLabel}` : s.name}
                                                </span>
                                                <span className="cs_summary_meta">
                                                    {s.email !== '—' ? s.email : ''}{' '}
                                                    {s.phone && s.phone !== '—' ? `· ${formatarTelefoneBrExibicao(s.phone)}` : ''} · {s.status}
                                                </span>
                                            </div>
                                            <div className="cs_summary_sig_actions">
                                                <button
                                                    type="button"
                                                    className="cs_summary_edit"
                                                    title="Editar e voltar a adicionar"
                                                    aria-label={`Editar ${s.name}`}
                                                    disabled={!fluxoEnvelopeId.trim() || fluxoSigRemovendoId !== '' || fluxoDocRemovendoId !== '' || fluxoBusy}
                                                    onClick={() => {
                                                        const em = String(s.email || '').trim()
                                                        const ph = String(s.phone || '')
                                                            .trim()
                                                            .replace(/—/g, '')
                                                        const canal = ph && (!em || em === '—') ? 'whatsapp' : 'email'
                                                        signReplaceSignerIdRef.current = String(s.id || '').trim()
                                                        setSignDraft({
                                                            channel: canal,
                                                            email: em && em !== '—' ? em : '',
                                                            phone: maskTelefoneBr(ph),
                                                            nome: String(s.name || '').trim(),
                                                            saveAgenda: false })
                                                        abrirSignModalKanban('novo')
                                                    }}
                                                >
                                                    ✎
                                                </button>
                                                <button
                                                    type="button"
                                                    className="cs_summary_remove"
                                                    title="Remover signatário"
                                                    aria-label={`Remover ${s.name}`}
                                                    disabled={!fluxoEnvelopeId.trim() || fluxoSigRemovendoId !== '' || fluxoDocRemovendoId !== '' || fluxoBusy}
                                                    onClick={() => void removerSignatarioFluxo(s.id, s.name)}
                                                >
                                                    −
                                                </button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>

                            <p className="cs_fineprint">
                                Os requisitos de <strong>qualificação</strong> e <strong>autenticação</strong> são criados automaticamente para cada documento e signatário. Ao clicar em «Enviar para assinatura», o envelope é ativado e os signatários são avisados (
                                <a href="https://developers.clicksign.com/docs/guia-de-criacao-o-passo-a-passo-padrao" target="_blank" rel="noopener noreferrer">
                                    guia da Clicksign
                                </a>
                                ).
                            </p>
                        <div className="cs_card_footer">
                            {pendenciaEnvio ? (
                                <p className="ek-hint cs_aside_pendencia" role="status">
                                    Falta: {pendenciaEnvio}
                                </p>
                            ) : null}
                            <Button
                                className="ek-btn--block"
                                disabled={fluxoBusy || Boolean(pendenciaEnvio)}
                                onClick={() => ativarEnvelopeFluxo()}
                            >
                                {fluxoBusy ? 'Aguarde…' : 'Enviar para assinatura'}
                            </Button>
                        </div>
                        </section>
                        </aside>
                    </div>
                )}

            </div>

            {signModal && (
                <div
                    className="contratos_modal_backdrop cs_sign_modal_layer"
                    role="presentation"
                    onClick={onSignModalBackdropClick}
                >
                    <div
                        className={`contratos_modal cs_sign_modal ${signModal === 'novo' ? 'cs_sign_modal--novo' : ''} ${signModal === 'agenda' || signModal === 'agenda_edit' || signModal === 'agenda_multi_qual' ? 'cs_sign_modal--wide' : ''}`}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="cs-sign-modal-title"
                        onClick={(e) => {
                            e.stopPropagation()
                            setSignModalCliquesFora(0)
                        }}
                    >
                        {signModalCliquesFora === 1 ? (
                            <p className="cs_sign_fechar_dica" role="status">
                                Clique outra vez fora para fechar
                            </p>
                        ) : null}
                        {signModal === 'novo' && (
                            <>
                                <div className="contratos_modal_head">
                                    <h2 id="cs-sign-modal-title" className="cs_sign_modal_title">
                                        Adicionar novo signatário
                                    </h2>
                                </div>
                                <div className="contratos_modal_body cs_sign_modal_body">
                                    <div className="cs_sign_kanban_sugestoes" aria-label="Sugestões do Kanban">
                                        <h3 className="cs_sign_section_label">Kanban — Aguardando Assinatura</h3>
                                        <p className="contratos_hint cs_sign_kanban_hint">
                                            Prestadores com perfil vinculado na coluna aguardando_assinatura.
                                            Clique para preencher razão social / e-mail.
                                        </p>
                                        <input
                                            className="contratos_input cs_input cs_sign_kanban_busca"
                                            type="search"
                                            placeholder="Filtrar sugestões…"
                                            value={sugestoesKanbanBusca}
                                            onChange={(e) => setSugestoesKanbanBusca(e.target.value)}
                                            aria-label="Filtrar sugestões do Kanban"
                                        />
                                        {sugestoesKanbanLoading ? (
                                            <p className="contratos_hint">Carregando sugestões…</p>
                                        ) : sugestoesKanbanFiltradas.length === 0 ? (
                                            <p className="contratos_hint">
                                                Nenhuma sugestão (cards em «Aguardando Assinatura» com prestador
                                                vinculado).
                                            </p>
                                        ) : (
                                            <ul className="cs_sign_kanban_lista">
                                                {sugestoesKanbanFiltradas.map((s) => (
                                                    <li key={`${s.prestadorId}-${s.cardId}`}>
                                                        <button
                                                            type="button"
                                                            className="cs_sign_kanban_item"
                                                            onClick={() => void aplicarSugestaoKanban(s)}
                                                            title={
                                                                s.temCnpj
                                                                    ? 'Preencher com razão social (CNPJ)'
                                                                    : s.email
                                                                      ? 'Preencher com o nome do card'
                                                                      : 'Sem e-mail no cadastro — complete manualmente'
                                                            }
                                                        >
                                                            <span className="cs_sign_kanban_item_nome">
                                                                {s.nome || `Prestador #${s.prestadorId}`}
                                                            </span>
                                                            <span className="cs_sign_kanban_item_meta">
                                                                {s.temCnpj ? 'CNPJ · ' : ''}
                                                                {s.email || 'sem e-mail'}
                                                                {[s.cidade, s.uf].filter(Boolean).length
                                                                    ? ` · ${[s.cidade, s.uf].filter(Boolean).join('/')}`
                                                                    : ''}
                                                            </span>
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>

                                    <div className="cs_sign_field_group">
                                        <h3 className="cs_sign_section_label">Envio</h3>
                                        <div className="contratos_field cs_sign_field_full">
                                            <label htmlFor="cs-sig-ch">Canal</label>
                                            <SelectDropdown
                                                id="cs-sig-ch"
                                                className="contratos_select cs_input"
                                                value={signDraft.channel}
                                                onChange={(e) => {
                                                    const ch = canalSignatario(e.target.value)
                                                    setSignDraft((d) => ({
                                                        ...d,
                                                        channel: ch,
                                                        phone: ch === 'email' ? '' : d.phone }))
                                                }}
                                            >
                                                <option value="email">E-mail</option>
                                                <option value="whatsapp">WhatsApp</option>
                                            </SelectDropdown>
                                        </div>
                                        {canalSignatario(signDraft.channel) === 'email' ? (
                                            <div className="contratos_field cs_sign_field_full">
                                                <label htmlFor="cs-sig-em">E-mail</label>
                                                <input
                                                    id="cs-sig-em"
                                                    className="contratos_input cs_input"
                                                    type="text"
                                                    inputMode="email"
                                                    autoComplete="email"
                                                    placeholder="Digite o e-mail"
                                                    value={signDraft.email}
                                                    aria-invalid={signTentouAvancar && errosSign.email ? 'true' : undefined}
                                                    onChange={(e) => setSignDraft((d) => ({ ...d, email: e.target.value }))}
                                                />
                                                {signTentouAvancar && errosSign.email ? <p className="ek-error" role="alert">{errosSign.email}</p> : null}
                                            </div>
                                        ) : (
                                            <>
                                                <div className="contratos_field cs_sign_field_full">
                                                    <label htmlFor="cs-sig-ph">Telefone (WhatsApp)</label>
                                                    <input
                                                        id="cs-sig-ph"
                                                        className="contratos_input cs_input"
                                                        type="text"
                                                        inputMode="numeric"
                                                        autoComplete="tel"
                                                        placeholder="11999998888"
                                                        value={signDraft.phone}
                                                        aria-invalid={signTentouAvancar && errosSign.phone ? 'true' : undefined}
                                                        onChange={(e) =>
                                                            setSignDraft((d) => ({ ...d, phone: maskTelefoneBr(e.target.value) }))
                                                        }
                                                    />
                                                    {signTentouAvancar && errosSign.phone ? <p className="ek-error" role="alert">{errosSign.phone}</p> : null}
                                                </div>
                                                <div className="contratos_field cs_sign_field_full">
                                                    <label htmlFor="cs-sig-em-wpp">E-mail</label>
                                                    <input
                                                        id="cs-sig-em-wpp"
                                                        className="contratos_input cs_input"
                                                        type="text"
                                                        inputMode="email"
                                                        autoComplete="email"
                                                        placeholder="Obrigatório na Clicksign"
                                                        value={signDraft.email}
                                                        aria-invalid={signTentouAvancar && errosSign.email ? 'true' : undefined}
                                                        onChange={(e) => setSignDraft((d) => ({ ...d, email: e.target.value }))}
                                                    />
                                                    {signTentouAvancar && errosSign.email ? <p className="ek-error" role="alert">{errosSign.email}</p> : null}
                                                </div>
                                                <p className="contratos_hint cs_sign_wpp_hint">
                                                    A autenticação será por WhatsApp; a API exige e-mail no cadastro do signatário.
                                                </p>
                                            </>
                                        )}
                                    </div>

                                    <div className="cs_sign_field_group">
                                        <div className="contratos_field cs_sign_field_full">
                                            <label htmlFor="cs-sig-nome">Nome completo</label>
                                            <input
                                                id="cs-sig-nome"
                                                className="contratos_input cs_input"
                                                value={signDraft.nome}
                                                aria-invalid={signTentouAvancar && errosSign.nome ? 'true' : undefined}
                                                onChange={(e) => setSignDraft((d) => ({ ...d, nome: e.target.value }))}
                                                placeholder="Nome, razão social ou @nome do perfil"
                                                autoComplete="off"
                                            />
                                            {signTentouAvancar && errosSign.nome ? <p className="ek-error" role="alert">{errosSign.nome}</p> : null}
                                            {termoMencao != null ? (
                                                <div className="cs_sign_mencao" role="listbox" aria-label="Perfis do sistema">
                                                    {termoMencao.length < 2 ? (
                                                        <p className="contratos_hint">Digite ao menos 2 letras depois de @.</p>
                                                    ) : mencaoLoading ? (
                                                        <p className="contratos_hint">A procurar perfil…</p>
                                                    ) : mencaoPerfis.length === 0 ? (
                                                        <p className="contratos_hint">Nenhum perfil com esse nome.</p>
                                                    ) : (
                                                        <ul className="cs_sign_kanban_lista">
                                                            {mencaoPerfis.map((p) => (
                                                                <li key={p.id}>
                                                                    <button
                                                                        type="button"
                                                                        className="cs_sign_kanban_item"
                                                                        onClick={() => void aplicarMencaoPerfil(p)}
                                                                    >
                                                                        <span className="cs_sign_kanban_item_nome">{p.nome}</span>
                                                                        <span className="cs_sign_kanban_item_meta">
                                                                            {p.temCnpj ? 'CNPJ · ' : ''}
                                                                            {p.email || 'sem e-mail'}
                                                                        </span>
                                                                    </button>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </div>
                                            ) : (
                                                <p className="contratos_hint">Use @nome para puxar nome e e-mail do perfil no sistema.</p>
                                            )}
                                        </div>
                                        <label className="cs_sign_save_agenda">
                                            <input
                                                type="checkbox"
                                                className="cs_sign_check_input"
                                                checked={signDraft.saveAgenda}
                                                onChange={(e) => setSignDraft((d) => ({ ...d, saveAgenda: e.target.checked }))}
                                            />
                                            <span>Salvar na agenda</span>
                                        </label>
                                    </div>
                                </div>
                                <div className="contratos_modal_foot cs_sign_modal_foot">
                                    <button type="button" className="contratos_btn cs_sign_btn_outline" disabled={fluxoBusy} onClick={() => fecharSignModal()}>
                                        Cancelar
                                    </button>
                                    <button
                                        type="button"
                                        className="contratos_btn contratos_btn_primary cs_sign_btn_fwd"
                                        disabled={fluxoBusy}
                                        onClick={() => {
                                            setSignTentouAvancar(true)
                                            if (Object.keys(errosSign).length > 0) {
                                                const primeiro = errosSign.nome ? 'cs-sig-nome' : errosSign.phone ? 'cs-sig-ph' : canalSignatario(signDraft.channel) === 'whatsapp' ? 'cs-sig-em-wpp' : 'cs-sig-em'
                                                document.getElementById(primeiro)?.focus()
                                                return
                                            }
                                            const chAv = canalSignatario(signDraft.channel)
                                            setSignPending({
                                                name: signDraft.nome.trim(),
                                                email: signDraft.email.trim(),
                                                phone: chAv === 'whatsapp' ? signDraft.phone : '',
                                                channel: chAv,
                                                gravarNaAgenda: signDraft.saveAgenda,
                                                source: 'novo' })
                                            setSignQualPapel(normalizarPapelQualificacao(fluxoPapel))
                                            irParaSignModal('qual')
                                        }}
                                    >
                                        Avançar <span aria-hidden>→</span>
                                    </button>
                                </div>
                            </>
                        )}

                        {signModal === 'agenda' && (
                            <>
                                <div className="contratos_modal_head">
                                    <h2 id="cs-sign-modal-title" className="cs_sign_modal_title">
                                        Agenda
                                    </h2>
                                </div>
                                <div className="contratos_modal_body cs_sign_modal_body">
                                    <div className="cs_sign_search">
                                        <span className="cs_sign_search_ico" aria-hidden>
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                                                <circle cx="11" cy="11" r="7" />
                                                <path d="M21 21l-4.3-4.3" />
                                            </svg>
                                        </span>
                                        <input
                                            id="cs-ag-busca"
                                            className="contratos_input cs_input cs_sign_search_input"
                                            placeholder="Busque por um contato"
                                            aria-label="Buscar contato"
                                            value={signModalAgendaBusca}
                                            onChange={(e) => setSignModalAgendaBusca(e.target.value)}
                                        />
                                    </div>
                                    <div className="cs_sign_tabs" role="tablist">
                                        <button
                                            type="button"
                                            role="tab"
                                            className={`cs_sign_tab ${signModalAgendaTab === 'todos' ? 'is-active' : ''}`}
                                            aria-selected={signModalAgendaTab === 'todos'}
                                            onClick={() => setSignModalAgendaTab('todos')}
                                        >
                                            Todos
                                        </button>
                                        <button
                                            type="button"
                                            role="tab"
                                            className={`cs_sign_tab ${signModalAgendaTab === 'favoritos' ? 'is-active' : ''}`}
                                            aria-selected={signModalAgendaTab === 'favoritos'}
                                            onClick={() => setSignModalAgendaTab('favoritos')}
                                        >
                                            Favoritos
                                        </button>
                                        <button
                                            type="button"
                                            role="tab"
                                            className={`cs_sign_tab ${signModalAgendaTab === 'kanban' ? 'is-active' : ''}`}
                                            aria-selected={signModalAgendaTab === 'kanban'}
                                            onClick={() => setSignModalAgendaTab('kanban')}
                                        >
                                            Kanban
                                        </button>
                                    </div>
                                    <div className="cs_sign_table_wrap overflow-x-auto">
                                        {signModalAgendaTab === 'kanban' ? (
                                            <table className="cs_sign_table">
                                                <thead>
                                                    <tr>
                                                        <th>Razão social / nome</th>
                                                        <th>E-mail</th>
                                                        <th>Local</th>
                                                        <th className="cs_sign_th_icon" aria-label="Usar" />
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {sugestoesKanbanLoading ? (
                                                        <tr>
                                                            <td colSpan={4} className="clicksign_td_empty">
                                                                Carregando…
                                                            </td>
                                                        </tr>
                                                    ) : agendaKanbanFiltrada.length === 0 ? (
                                                        <tr>
                                                            <td colSpan={4} className="clicksign_td_empty">
                                                                Nenhum prestador em «Aguardando Assinatura» com perfil
                                                                vinculado.
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        agendaKanbanFiltrada.map((s) => (
                                                            <tr key={`${s.prestadorId}-${s.cardId}`}>
                                                                <td>{s.nome || `Prestador #${s.prestadorId}`}</td>
                                                                <td>{s.email || '—'}</td>
                                                                <td>
                                                                    {[s.cidade, s.uf].filter(Boolean).join('/') || '—'}
                                                                </td>
                                                                <td>
                                                                    <button
                                                                        type="button"
                                                                        className="contratos_btn contratos_btn_secondary clicksign_btn_sm"
                                                                        onClick={() => {
                                                                            void (async () => {
                                                                                await aplicarSugestaoKanban(s)
                                                                                if (signModalRef.current == null) return
                                                                                abrirSignModalKanban('novo')
                                                                            })()
                                                                        }}
                                                                    >
                                                                        Usar
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        ))
                                                    )}
                                                </tbody>
                                            </table>
                                        ) : (
                                            <table className="cs_sign_table">
                                            <thead>
                                                <tr>
                                                    <th className="cs_sign_th_sel" aria-label="Selecionar" />
                                                    <th>Nome</th>
                                                    <th>Contato</th>
                                                    <th className="cs_sign_th_icon" aria-label="Editar" />
                                                    <th className="cs_sign_th_icon" aria-label="Eliminar" />
                                                    <th className="cs_sign_th_icon">Fav.</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {agendaModalFiltrada.length === 0 && (
                                                    <tr>
                                                        <td colSpan={6} className="clicksign_td_empty">
                                                            Nenhum contacto nesta vista.
                                                        </td>
                                                    </tr>
                                                )}
                                                {agendaModalFiltrada.map((c) => (
                                                    <tr key={c.localId} className={signModalAgendaSel.includes(c.localId) ? 'is-selected' : ''}>
                                                        <td>
                                                            <input
                                                                type="checkbox"
                                                                className="cs_sign_check_input"
                                                                checked={signModalAgendaSel.includes(c.localId)}
                                                                onChange={() => {
                                                                    setSignModalAgendaSel((prev) =>
                                                                        prev.includes(c.localId)
                                                                            ? prev.filter((id) => id !== c.localId)
                                                                            : [...prev, c.localId],
                                                                    )
                                                                }}
                                                                aria-label={`Selecionar ${c.name}`}
                                                            />
                                                        </td>
                                                        <td>{c.name}</td>
                                                        <td>
                                                            {c.channel === 'whatsapp'
                                                                ? formatarTelefoneBrExibicao(c.phone) || '—'
                                                                : c.email || '—'}
                                                        </td>
                                                        <td>
                                                            <button
                                                                type="button"
                                                                className="cs_sign_table_edit"
                                                                title="Editar contacto"
                                                                aria-label={`Editar ${c.name}`}
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    setSignAgendaEditId(c.localId)
                                                                    setSignDraft({
                                                                        channel: canalSignatario(c.channel),
                                                                        email: String(c.email || '').trim(),
                                                                        phone: maskTelefoneBr(c.phone || ''),
                                                                        nome: String(c.name || '').trim(),
                                                                        saveAgenda: true })
                                                                    setSignQualPapel(normalizarPapelQualificacao(c.papel))
                                                                    irParaSignModal('agenda_edit')
                                                                }}
                                                            >
                                                                ✎
                                                            </button>
                                                        </td>
                                                        <td>
                                                            <button
                                                                type="button"
                                                                className="cs_sign_table_remove"
                                                                title="Remover da agenda"
                                                                aria-label={`Remover ${c.name} da agenda`}
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    const nm = String(c.name || '').trim() || 'este contacto'
                                                                    const localId = c.localId
                                                                    pushToast(
                                                                        'confirm',
                                                                        'Remover da agenda',
                                                                        `Remover «${nm}» da agenda compartilhada?`,
                                                                        {
                                                                            confirmLabel: 'Remover',
                                                                            cancelLabel: 'Cancelar',
                                                                            onConfirm: () => {
                                                                                void (async () => {
                                                                                    try {
                                                                                        if (signModalAgendaSel.includes(localId)) {
                                                                                            setSignModalAgendaSel((prev) =>
                                                                                                prev.filter((id) => id !== localId),
                                                                                            )
                                                                                            setAgendaQualPorId((m) => {
                                                                                                const next = { ...m }
                                                                                                delete next[localId]
                                                                                                return next
                                                                                            })
                                                                                        }
                                                                                        setAgendaSigs(await removerContatoAgendaPorId(localId))
                                                                                        pushToast('success', 'Agenda', 'Contacto removido.')
                                                                                    } catch (err) {
                                                                                        pushToast(
                                                                                            'error',
                                                                                            'Agenda',
                                                                                            err?.message || 'Falha ao remover contacto.',
                                                                                        )
                                                                                    }
                                                                                })()
                                                                            },
                                                                        },
                                                                    )
                                                                }}
                                                            >
                                                                −
                                                            </button>
                                                        </td>
                                                        <td>
                                                            <button
                                                                type="button"
                                                                className={`cs_agenda_star ${c.favorite ? 'is-on' : ''}`}
                                                                title={c.favorite ? 'Retirar favorito' : 'Favorito'}
                                                                aria-label="Favorito"
                                                                onClick={() => {
                                                                    void (async () => {
                                                                        try {
                                                                            setAgendaSigs(await alternarFavoritoAgenda(c.localId))
                                                                        } catch (e) {
                                                                            pushToast(
                                                                                'error',
                                                                                'Agenda',
                                                                                e?.message || 'Falha ao atualizar favorito.',
                                                                            )
                                                                        }
                                                                    })()
                                                                }}
                                                            >
                                                                {c.favorite ? '★' : '☆'}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        )}
                                    </div>
                                </div>
                                <div className="contratos_modal_foot cs_sign_modal_foot">
                                    <button type="button" className="contratos_btn contratos_btn_secondary" disabled={fluxoBusy} onClick={() => fecharSignModal()}>
                                        Cancelar
                                    </button>
                                    {signModalAgendaTab !== 'kanban' ? (
                                    <button
                                        type="button"
                                        className="contratos_btn contratos_btn_primary cs_sign_btn_fwd"
                                        disabled={fluxoBusy || signModalAgendaSel.length === 0}
                                        onClick={() => {
                                            const selecionados = signModalAgendaSel
                                                .map((id) => agendaOrdenada.find((x) => x.localId === id))
                                                .filter(Boolean)
                                            if (selecionados.length === 0) {
                                                pushToast('error', 'Agenda', 'Selecione pelo menos um contacto.')
                                                return
                                            }
                                            for (const c of selecionados) {
                                                const canalAg = canalSignatario(c.channel)
                                                if (!String(c.email || '').trim()) {
                                                    pushToast(
                                                        'error',
                                                        'Agenda',
                                                        `«${c.name}» não tem e-mail (obrigatório na Clicksign). Edite o contacto ou retire da seleção.`,
                                                    )
                                                    return
                                                }
                                                if (canalAg === 'whatsapp') {
                                                    const tel = normalizarTelefoneBr(c.phone)
                                                    if (tel.length < 10 || tel.length > 11) {
                                                        pushToast(
                                                            'error',
                                                            'WhatsApp',
                                                            `«${c.name}» não tem telefone válido (DDD + número).`,
                                                        )
                                                        return
                                                    }
                                                }
                                            }
                                            const map = {}
                                            for (const c of selecionados) {
                                                map[c.localId] = normalizarPapelQualificacao(c.papel || 'sign')
                                            }
                                            setAgendaQualPorId(map)
                                            irParaSignModal('agenda_multi_qual')
                                        }}
                                    >
                                        Avançar ({signModalAgendaSel.length}) <span aria-hidden>→</span>
                                    </button>
                                    ) : null}
                                </div>
                            </>
                        )}

                        {signModal === 'agenda_edit' && signAgendaEditId && (
                            <>
                                <div className="contratos_modal_head">
                                    <h2 id="cs-sign-modal-title" className="cs_sign_modal_title">
                                        Editar contacto da agenda
                                    </h2>
                                </div>
                                <div className="contratos_modal_body cs_sign_modal_body">
                                    <div className="cs_sign_field_group">
                                        <h3 className="cs_sign_section_label">Envio</h3>
                                        <div className="contratos_field cs_sign_w400">
                                            <label htmlFor="cs-sig-ed-ch">Canal</label>
                                            <SelectDropdown
                                                id="cs-sig-ed-ch"
                                                className="contratos_select cs_input"
                                                value={signDraft.channel}
                                                onChange={(e) => {
                                                    const ch = canalSignatario(e.target.value)
                                                    setSignDraft((d) => ({
                                                        ...d,
                                                        channel: ch,
                                                        phone: ch === 'email' ? '' : d.phone }))
                                                }}
                                            >
                                                <option value="email">E-mail</option>
                                                <option value="whatsapp">WhatsApp</option>
                                            </SelectDropdown>
                                        </div>
                                        {canalSignatario(signDraft.channel) === 'email' ? (
                                            <div className="contratos_field cs_sign_w400">
                                                <label htmlFor="cs-sig-ed-em">E-mail</label>
                                                <input
                                                    id="cs-sig-ed-em"
                                                    className="contratos_input cs_input"
                                                    type="text"
                                                    inputMode="email"
                                                    value={signDraft.email}
                                                    onChange={(e) => setSignDraft((d) => ({ ...d, email: e.target.value }))}
                                                />
                                            </div>
                                        ) : (
                                            <>
                                                <div className="contratos_field cs_sign_w400">
                                                    <label htmlFor="cs-sig-ed-ph">Telefone</label>
                                                    <input
                                                        id="cs-sig-ed-ph"
                                                        className="contratos_input cs_input"
                                                        inputMode="numeric"
                                                        value={signDraft.phone}
                                                        onChange={(e) =>
                                                            setSignDraft((d) => ({ ...d, phone: maskTelefoneBr(e.target.value) }))
                                                        }
                                                    />
                                                </div>
                                                <div className="contratos_field cs_sign_w400">
                                                    <label htmlFor="cs-sig-ed-em2">E-mail</label>
                                                    <input
                                                        id="cs-sig-ed-em2"
                                                        className="contratos_input cs_input"
                                                        type="text"
                                                        inputMode="email"
                                                        placeholder="Obrigatório na Clicksign"
                                                        value={signDraft.email}
                                                        onChange={(e) => setSignDraft((d) => ({ ...d, email: e.target.value }))}
                                                    />
                                                </div>
                                            </>
                                        )}
                                    </div>
                                    <div className="cs_sign_field_group">
                                        <div className="contratos_field cs_sign_w400">
                                            <label htmlFor="cs-sig-ed-nome">Nome completo</label>
                                            <input
                                                id="cs-sig-ed-nome"
                                                className="contratos_input cs_input"
                                                value={signDraft.nome}
                                                onChange={(e) => setSignDraft((d) => ({ ...d, nome: e.target.value }))}
                                            />
                                        </div>
                                        <div className="contratos_field cs_sign_w400">
                                            <label htmlFor="cs-sig-ed-papel">Qualificação (agenda)</label>
                                            <SelectDropdown
                                                id="cs-sig-ed-papel"
                                                className="contratos_select cs_input"
                                                value={signQualPapel}
                                                onChange={(e) => setSignQualPapel(e.target.value)}
                                            >
                                                {PAPEIS_SIGNATARIO_CLICKSIGN.map((p) => (
                                                    <option key={p.value} value={p.value}>
                                                        {p.label}
                                                    </option>
                                                ))}
                                            </SelectDropdown>
                                        </div>
                                    </div>
                                </div>
                                <div className="contratos_modal_foot cs_sign_modal_foot">
                                    <button type="button" className="contratos_btn contratos_btn_secondary" disabled={fluxoBusy} onClick={() => fecharSignModal()}>
                                        Cancelar
                                    </button>
                                    <button type="button" className="contratos_btn cs_sign_btn_outline" disabled={fluxoBusy} onClick={() => abrirSignModalKanban('agenda')}>
                                        Voltar à lista
                                    </button>
                                    <button
                                        type="button"
                                        className="contratos_btn contratos_btn_primary"
                                        disabled={fluxoBusy}
                                        onClick={() => {
                                            void (async () => {
                                                if (!nomeSignatarioValido(signDraft.nome)) {
                                                    pushToast(
                                                        'error',
                                                        'Agenda',
                                                        'Indique o nome completo (pelo menos duas palavras).',
                                                    )
                                                    return
                                                }
                                                const chEd = canalSignatario(signDraft.channel)
                                                if (!signDraft.email.trim()) {
                                                    pushToast(
                                                        'error',
                                                        'Agenda',
                                                        'Preencha o e-mail (obrigatório na Clicksign).',
                                                    )
                                                    return
                                                }
                                                if (chEd === 'whatsapp') {
                                                    const tel = normalizarTelefoneBr(signDraft.phone)
                                                    if (tel.length < 10 || tel.length > 11) {
                                                        pushToast(
                                                            'error',
                                                            'Agenda',
                                                            'Telefone com DDD: 10 ou 11 dígitos.',
                                                        )
                                                        return
                                                    }
                                                }
                                                try {
                                                    setAgendaSigs(
                                                        await atualizarContatoAgendaPorId(signAgendaEditId, {
                                                            name: signDraft.nome.trim(),
                                                            email: signDraft.email.trim(),
                                                            phone: signDraft.phone,
                                                            channel: chEd,
                                                            papel: normalizarPapelQualificacao(signQualPapel),
                                                        }),
                                                    )
                                                    pushToast('info', 'Agenda', 'Contacto atualizado.')
                                                    setSignAgendaEditId(null)
                                                    abrirSignModalKanban('agenda')
                                                } catch (e) {
                                                    pushToast(
                                                        'error',
                                                        'Agenda',
                                                        e?.message || 'Não foi possível atualizar o contacto.',
                                                    )
                                                }
                                            })()
                                        }}
                                    >
                                        Guardar
                                    </button>
                                </div>
                            </>
                        )}

                        {signModal === 'agenda_multi_qual' && (
                            <>
                                <div className="contratos_modal_head">
                                    <h2 id="cs-sign-modal-title" className="cs_sign_modal_title">
                                        Qualificação por signatário
                                    </h2>
                                </div>
                                <div className="contratos_modal_body cs_sign_modal_body">
                                    <p className="contratos_hint">
                                        Defina como cada contacto selecionado irá assinar. Em seguida serão adicionados ao envelope.
                                    </p>
                                    <div className="cs_sign_table_wrap overflow-x-auto">
                                        <table className="cs_sign_table">
                                            <thead>
                                                <tr>
                                                    <th>Nome</th>
                                                    <th>Contato</th>
                                                    <th>Assinar como</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {signModalAgendaSel.map((localId) => {
                                                    const c = agendaOrdenada.find((x) => x.localId === localId)
                                                    if (!c) return null
                                                    return (
                                                        <tr key={localId}>
                                                            <td>{c.name}</td>
                                                            <td>
                                                                {c.channel === 'whatsapp'
                                                                    ? formatarTelefoneBrExibicao(c.phone) || '—'
                                                                    : c.email || '—'}
                                                            </td>
                                                            <td>
                                                                <SelectDropdown
                                                                    className="contratos_select cs_input cs_sign_qual_select_inline"
                                                                    value={agendaQualPorId[localId] || 'sign'}
                                                                    onChange={(e) =>
                                                                        setAgendaQualPorId((m) => ({
                                                                            ...m,
                                                                            [localId]: e.target.value }))
                                                                    }
                                                                    aria-label={`Qualificação de ${c.name}`}
                                                                >
                                                                    {PAPEIS_SIGNATARIO_CLICKSIGN.map((p) => (
                                                                        <option key={p.value} value={p.value}>
                                                                            {p.label}
                                                                        </option>
                                                                    ))}
                                                                </SelectDropdown>
                                                            </td>
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                                <div className="contratos_modal_foot cs_sign_modal_foot">
                                    <button
                                        type="button"
                                        className="contratos_btn cs_sign_btn_outline"
                                        disabled={fluxoBusy}
                                        onClick={() => abrirSignModalKanban('agenda')}
                                    >
                                        Voltar
                                    </button>
                                    <button type="button" className="contratos_btn contratos_btn_secondary" disabled={fluxoBusy} onClick={() => fecharSignModal()}>
                                        Cancelar
                                    </button>
                                    <button
                                        type="button"
                                        className="contratos_btn contratos_btn_primary"
                                        disabled={fluxoBusy || signModalAgendaSel.length === 0}
                                        onClick={async () => {
                                            let okCount = 0
                                            for (const localId of signModalAgendaSel) {
                                                const c = agendaOrdenada.find((x) => x.localId === localId)
                                                if (!c) continue
                                                const canalAg = canalSignatario(c.channel)
                                                const papel = normalizarPapelQualificacao(agendaQualPorId[localId] || c.papel || 'sign')
                                                const ok = await adicionarSignatarioComParametros({
                                                    nome: String(c.name || '').trim(),
                                                    email: String(c.email || '').trim(),
                                                    phone: maskTelefoneBr(c.phone || ''),
                                                    channel: canalAg,
                                                    papel,
                                                    gravarNaAgenda: true })
                                                if (ok) okCount += 1
                                                else break
                                            }
                                            if (okCount > 0) {
                                                pushToast(
                                                    'success',
                                                    'Signatários',
                                                    okCount === 1
                                                        ? '1 signatário adicionado ao envelope.'
                                                        : `${okCount} signatários adicionados ao envelope.`,
                                                )
                                            }
                                            if (okCount === signModalAgendaSel.length) fecharSignModal()
                                        }}
                                    >
                                        Adicionar ao envelope
                                    </button>
                                </div>
                            </>
                        )}

                        {signModal === 'qual' && signPending && (
                            <>
                                <div className="contratos_modal_head">
                                    <h2 id="cs-sign-modal-title" className="cs_sign_modal_title">
                                        Assinar como
                                    </h2>
                                </div>
                                <div className="contratos_modal_body cs_sign_modal_body">
                                    <div className="cs_sign_qual_card">
                                        <p className="cs_sign_qual_name">{signPending.name}</p>
                                        <p className="cs_sign_qual_email">
                                            {canalSignatario(signPending.channel) === 'whatsapp' ? (
                                                <>
                                                    <span>{formatarTelefoneBrExibicao(signPending.phone) || '—'}</span>
                                                    {signPending.email ? (
                                                        <>
                                                            <br />
                                                            <span>{signPending.email}</span>
                                                        </>
                                                    ) : null}
                                                </>
                                            ) : (
                                                signPending.email || '—'
                                            )}
                                        </p>
                                    </div>
                                    <div className="contratos_field">
                                        <label htmlFor="cs-sig-papel-sel">
                                            Assinar como <span className="cs_sig_req_mark">*</span>
                                        </label>
                                        <SelectDropdown
                                            id="cs-sig-papel-sel"
                                            className="contratos_select cs_input cs_sign_qual_select_proj"
                                            value={signQualPapel}
                                            onChange={(e) => setSignQualPapel(e.target.value)}
                                        >
                                            {PAPEIS_SIGNATARIO_CLICKSIGN.map((p) => (
                                                <option key={p.value} value={p.value}>
                                                    {p.label}
                                                </option>
                                            ))}
                                        </SelectDropdown>
                                    </div>
                                </div>
                                <div className="contratos_modal_foot cs_sign_modal_foot">
                                    <button
                                        type="button"
                                        className="contratos_btn cs_sign_btn_outline"
                                        disabled={fluxoBusy}
                                        onClick={() => {
                                            abrirSignModalKanban(signPending.source === 'novo' ? 'novo' : 'agenda')
                                            setSignDraft((d) => ({
                                                ...d,
                                                channel: canalSignatario(signPending.channel) }))
                                            setSignPending(null)
                                        }}
                                    >
                                        Voltar
                                    </button>
                                    <button type="button" className="contratos_btn cs_sign_btn_outline" disabled={fluxoBusy} onClick={() => fecharSignModal()}>
                                        Cancelar
                                    </button>
                                    <button
                                        type="button"
                                        className="contratos_btn contratos_btn_primary"
                                        disabled={fluxoBusy || !signQualPapel}
                                        onClick={async () => {
                                            const ok = await adicionarSignatarioComParametros({
                                                nome: signPending.name,
                                                email: signPending.email,
                                                phone: signPending.phone,
                                                channel: signPending.channel,
                                                papel: signQualPapel,
                                                gravarNaAgenda: signPending.gravarNaAgenda })
                                            if (ok) fecharSignModal()
                                        }}
                                    >
                                        Adicionar
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {detailOpen && (
                <Modal
                    open
                    size="xl"
                    onClose={signModal ? undefined : fecharDetalheModal}
                    title={detailJson?.data?.attributes?.name || 'Envelope'}
                    description={detailJson ? undefined : 'Carregando dados do envelope…'}
                    footer={
                        <>
                            <Button variant="secondary" onClick={() => fecharDetalheModal()}>
                                Fechar
                            </Button>
                            {!detailLoading && detailId ? (
                                <a
                                    className={buttonClassName({ variant: 'primary' })}
                                    href={urlAbrirEnvelopeClicksign(detailId, detailJson?.data?.links?.self ?? detailJson?.links?.self)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    Abrir no Clicksign
                                </a>
                            ) : null}
                        </>
                    }
                >
                    <div className="clicksign_modal_body">
                            {detailLoading && <LoadingState label="Carregando envelope…" />}
                            {!detailLoading && detailJson && (
                                <>
                                    <div className="ek-segmented cs_detail_tabs" role="group" aria-label="Seções do envelope">
                                        {[
                                            ['resumo', 'Resumo'],
                                            ['signatarios', `Signatários (${detailSigs.length})`],
                                            ['documentos', `Documentos (${detailDocs.length})`],
                                            ['historico', 'Histórico'],
                                        ].map(([k, r]) => (
                                            <button key={k} type="button" className="ek-segmented__opt" aria-pressed={detailTab === k} onClick={() => setDetailTab(k)}>
                                                {r}
                                            </button>
                                        ))}
                                    </div>
                                    {detailTab === 'resumo' && (
                                    <>
                                    <div className="clicksign_detail_attrs">
                                        <p>
                                            <strong>Estado:</strong>{' '}
                                            <Badge tone={tomBadgeEnvelope(statusDetalheEnvelope)}>
                                                {rotuloEstadoEnvelope(detailJson?.data?.attributes?.status)}
                                            </Badge>
                                        </p>
                                        <p>
                                            <strong>Nome:</strong> {detailJson?.data?.attributes?.name ?? '—'}
                                        </p>
                                        <p>
                                            <strong>ID:</strong> <code className="clicksign_mono">{detailId}</code>{' '}
                                            <Button variant="ghost" size="sm" onClick={() => void copiarIdEnvelope(detailId)}>
                                                Copiar
                                            </Button>
                                        </p>
                                        <p>
                                            <strong>Criado em:</strong>{' '}
                                            {formatarDataPtBr(
                                                detailJson?.data?.attributes?.created ??
                                                    detailJson?.data?.attributes?.created_at,
                                            )}
                                        </p>
                                        {rotuloDataEncerramentoEnvelope(detailJson?.data?.attributes?.status) ? (
                                            <p>
                                                <strong>
                                                    {rotuloDataEncerramentoEnvelope(detailJson?.data?.attributes?.status)}:
                                                </strong>{' '}
                                                {formatarDataPtBr(
                                                    dataEncerramentoEnvelope(detailJson?.data?.attributes),
                                                )}
                                            </p>
                                        ) : null}
                                    </div>
                                    </>
                                    )}
                                    {detailTab === 'signatarios' && (
                                    <>
                                    <div className="clicksign_detail_sig_head">
                                        <h3 className="clicksign_subtitle">Signatários</h3>
                                        {podeEditarContratos && (statusDetalheEnvelope === 'running' || statusDetalheEnvelope === 'draft') && (
                                            <button
                                                type="button"
                                                className="contratos_btn contratos_btn_secondary clicksign_btn_sm"
                                                onClick={adicionarSignatarioDesdeDetalhe}
                                            >
                                                + Adicionar signatário
                                            </button>
                                        )}
                                    </div>
                                    <div className="clicksign_detail_table_wrap overflow-x-auto">
                                        <table className="clicksign_detail_table">
                                            <thead>
                                                <tr>
                                                    <th>Nome</th>
                                                    <th>Contato</th>
                                                    <th>Qualificação</th>
                                                    <th>Assinatura</th>
                                                    <th>Ações</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {detailSigs.length === 0 && (
                                                    <tr>
                                                        <td colSpan={5} className="clicksign_td_empty">
                                                            Nenhum signatário.
                                                        </td>
                                                    </tr>
                                                )}
                                                {detailSigs.map((s) => (
                                                    <tr key={s.id}>
                                                        <td data-label="Nome">{s.name}</td>
                                                        <td data-label="Contato">{s.contactLabel}</td>
                                                        <td data-label="Qualificação">{s.qualificationLabel}</td>
                                                        <td data-label="Assinatura">{s.signatureLabel}</td>
                                                        <td data-label="Ações">
                                                            {podeEditarContratos && statusDetalheEnvelope === 'running' && (
                                                                <div className="clicksign_detail_sig_actions">
                                                                    <button
                                                                        type="button"
                                                                        className="contratos_btn contratos_btn_secondary clicksign_btn_sm"
                                                                        disabled={detailSigBusyId === s.id}
                                                                        onClick={() =>
                                                                            void enviarLembreteSignatarioDetalhe(s.id, s.name)
                                                                        }
                                                                    >
                                                                        Lembrete
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        className="contratos_btn contratos_btn_secondary clicksign_btn_sm"
                                                                        onClick={() => abrirEdicaoSignatarioDetalhe(s.id)}
                                                                    >
                                                                        Editar
                                                                    </button>
                                                                </div>
                                                            )}
                                                            {podeEditarContratos && statusDetalheEnvelope === 'draft' && (
                                                                <button
                                                                    type="button"
                                                                    className="contratos_btn contratos_btn_secondary clicksign_btn_sm"
                                                                    onClick={() => abrirEdicaoSignatarioDetalhe(s.id)}
                                                                >
                                                                    Editar
                                                                </button>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    </>
                                    )}
                                    {detailTab === 'documentos' && (
                                    <>
                                    <h3 className="clicksign_subtitle">Documentos</h3>
                                    <div className="clicksign_detail_table_wrap overflow-x-auto">
                                        <table className="clicksign_detail_table">
                                            <thead>
                                                <tr>
                                                    <th>Nome</th>
                                                    <th>Estado</th>
                                                    <th className="clicksign_col_doc_menu" aria-label="Ações" />
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {detailDocs.length === 0 && (
                                                    <tr>
                                                        <td colSpan={3} className="clicksign_td_empty">
                                                            Nenhum documento.
                                                        </td>
                                                    </tr>
                                                )}
                                                {detailDocs.map((d) => (
                                                    <tr key={d.id}>
                                                        <td data-label="Nome">{d.filename}</td>
                                                        <td data-label="Estado">{rotuloEstadoDocumento(d.status)}</td>
                                                        <td className="clicksign_col_doc_menu">
                                                            <div
                                                                className="clicksign_detail_doc_actions clicksign_row_menu_wrap"
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                <button
                                                                    type="button"
                                                                    className="clicksign_menu_trigger"
                                                                    aria-label={`Ações — ${d.filename}`}
                                                                    aria-expanded={docMenuId === d.id}
                                                                    onClick={(e) => {
                                                                        e.stopPropagation()
                                                                        if (docMenuId === d.id) {
                                                                            setDocMenuId('')
                                                                            return
                                                                        }
                                                                        // Posição calculada pelo botão: a área rolável do modal não corta o menu.
                                                                        setDocMenuEstilo(estiloMenuFlutuante(e.currentTarget))
                                                                        setDocMenuId(d.id)
                                                                    }}
                                                                >
                                                                    <IconeMenuVertical />
                                                                </button>
                                                                {docMenuId === d.id && (
                                                                    <div
                                                                        className="clicksign_dropdown clicksign_dropdown--left clicksign_dropdown--up"
                                                                        role="menu"
                                                                        style={docMenuEstilo}
                                                                    >
                                                                        <a
                                                                            role="menuitem"
                                                                            className="clicksign_dropdown_link"
                                                                            href={urlAbrirEnvelopeClicksign(
                                                                                detailId,
                                                                                detailJson?.data?.links?.self ??
                                                                                    detailJson?.links?.self,
                                                                            )}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            onClick={() => setDocMenuId('')}
                                                                        >
                                                                            Abrir no Clicksign
                                                                        </a>
                                                                        <button
                                                                            type="button"
                                                                            role="menuitem"
                                                                            onClick={() => {
                                                                                setDocMenuId('')
                                                                                void (async () => {
                                                                                    const r = await abrirVisualizacaoDocumento(detailId, d)
                                                                                    if (!r?.ok && r?.reason === 'popup_blocked') {
                                                                                        pushToast(
                                                                                            'error',
                                                                                            'Visualizar',
                                                                                            'O browser bloqueou a janela. Permita pop-ups para este site.',
                                                                                        )
                                                                                    } else if (!r?.ok) {
                                                                                        pushToast(
                                                                                            'error',
                                                                                            'Visualizar',
                                                                                            'Não foi possível abrir o documento.',
                                                                                        )
                                                                                    }
                                                                                })()
                                                                            }}
                                                                        >
                                                                            Visualizar documento
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            role="menuitem"
                                                                            onClick={() => {
                                                                                setDocMenuId('')
                                                                                if (!abrirUrlDownload(d.fileOriginal)) {
                                                                                    pushToast(
                                                                                        'error',
                                                                                        'Download',
                                                                                        'URL do original indisponível.',
                                                                                    )
                                                                                }
                                                                            }}
                                                                        >
                                                                            Baixar documento original
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            role="menuitem"
                                                                            onClick={() => {
                                                                                setDocMenuId('')
                                                                                if (!abrirUrlDownload(d.fileSigned)) {
                                                                                    pushToast(
                                                                                        'error',
                                                                                        'Download',
                                                                                        'Documento assinado indisponível.',
                                                                                    )
                                                                                }
                                                                            }}
                                                                        >
                                                                            Baixar documento assinado
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            role="menuitem"
                                                                            onClick={() => {
                                                                                setDocMenuId('')
                                                                                const okO = abrirUrlDownload(d.fileOriginal)
                                                                                const okS = abrirUrlDownload(d.fileSigned)
                                                                                if (!okO && !okS) {
                                                                                    pushToast(
                                                                                        'error',
                                                                                        'Download',
                                                                                        'Nenhum arquivo disponível.',
                                                                                    )
                                                                                }
                                                                            }}
                                                                        >
                                                                            Baixar original e assinado
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    </>
                                    )}
                                    {detailTab === 'historico' && (
                                        <div className="cs_historico">
                                            <h3 className="clicksign_subtitle">Histórico de eventos</h3>
                                            {detailHistLoading && <LoadingState label="Carregando histórico…" />}
                                            {!detailHistLoading && detailHist.length === 0 && (
                                                <EmptyState
                                                    title="Sem eventos registrados"
                                                    description="Assinaturas, recusas, cancelamentos e conclusão aparecem aqui assim que a Clicksign avisar o sistema."
                                                />
                                            )}
                                            {!detailHistLoading && detailHist.length > 0 && (
                                                <ol className="cs_timeline">
                                                    {detailHist.map((ev) => (
                                                        <li key={ev.id} className={`cs_timeline_item cs_timeline_item--${ev.evento}`}>
                                                            <span className="cs_timeline_quando">{formatarDataPtBr(ev.criado_em)}</span>
                                                            <span className="cs_timeline_texto">{ev.texto}</span>
                                                        </li>
                                                    ))}
                                                </ol>
                                            )}
                                        </div>
                                    )}
                                </>
                            )}
                    </div>
                </Modal>
            )}

            {confirmacaoExclusao && (
                <div className="clicksign_confirm_exclusao" role="alertdialog" aria-live="assertive">
                    <div className="clicksign_confirm_exclusao_text">
                        <strong>Confirmar exclusão</strong>
                        <span>{confirmacaoExclusao.mensagem}</span>
                    </div>
                    <div className="clicksign_confirm_exclusao_actions">
                        <button
                            type="button"
                            className="clicksign_confirm_exclusao_btn danger"
                            onClick={async () => {
                                const acao = confirmacaoExclusao.onConfirmar
                                setConfirmacaoExclusao(null)
                                await acao()
                            }}
                        >
                            Confirmar
                        </button>
                        <button type="button" className="clicksign_confirm_exclusao_btn" onClick={() => setConfirmacaoExclusao(null)}>
                            Cancelar
                        </button>
                    </div>
                </div>
            )}

            {toast && (
                <div
                    className={`contratos_toast contratos_toast--${toast.variant}`}
                    role={toast.variant === 'confirm' ? 'alertdialog' : 'alert'}
                >
                    <div className="contratos_toast_text">
                        <strong>{toast.title}</strong>
                        {toast.body != null && <span className="contratos_toast_body">{toast.body}</span>}
                        {toast.variant === 'confirm' && toast.onConfirm && (
                            <div className="contratos_toast_actions">
                                <button
                                    type="button"
                                    className="contratos_toast_btn contratos_toast_btn--danger"
                                    onClick={() => {
                                        const fn = toast.onConfirm
                                        setToast(null)
                                        if (typeof fn === 'function') fn()
                                    }}
                                >
                                    {toast.confirmLabel || 'Confirmar'}
                                </button>
                                <button type="button" className="contratos_toast_btn" onClick={() => setToast(null)}>
                                    {toast.cancelLabel || 'Cancelar'}
                                </button>
                            </div>
                        )}
                    </div>
                    {toast.variant !== 'confirm' && (
                        <button type="button" className="contratos_toast_close" onClick={() => setToast(null)} aria-label="Fechar">
                            ×
                        </button>
                    )}
                </div>
            )}
        </div>
    )
}
