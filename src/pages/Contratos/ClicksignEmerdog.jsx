import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    PAPEIS_SIGNATARIO_CLICKSIGN,
    clicksignRequest,
    extrairIndicadoresMeta,
    extrairListaDocumentos,
    extrairListaEnvelopes,
    extrairListaSignatarios,
    garantirRequisitosAutenticacaoEmailCobertos,
    garantirRequisitosQualificacaoCobertos,
    mergeSignersWithQualificationLabels,
    intervaloCriacaoMesAtualUtc,
    montarPathListagemEnvelopes,
    nomeSignatarioValido,
    normalizarPapelQualificacao,
    normalizarTelefoneBr,
    pathFromClicksignLink,
    payloadAtivarEnvelope,
    payloadDocumentoPdf,
    payloadEnvelopeRascunho,
    payloadRequisitoQualificacao,
    payloadSignatario,
} from '../../lib/clicksign/clicksignClient.js'
import {
    alternarFavoritoAgenda,
    atualizarContatoAgendaPorId,
    carregarAgendaSignatarios,
    removerContatoAgendaPorId,
    upsertContatoAgenda,
} from '../../lib/clicksign/agendaSignatarios.js'
import './ContratosEmerdog.css'
import './ClicksignEmerdog.css'

const TOAST_MS = 20000
const PDF_MAX_BYTES = 12 * 1024 * 1024
const STORAGE_FLUXO_EID = 'emerdog_cs_fluxo_eid'

function erroApiTexto(data) {
    if (!data) return '—'
    if (data.error) return String(data.error)
    if (Array.isArray(data.errors) && data.errors[0]) {
        const e = data.errors[0]
        return String(e.detail || e.title || JSON.stringify(e))
    }
    return JSON.stringify(data).slice(0, 500)
}

/** Datas ISO → DD/MM/AAAA HH:mm:ss (hora local). */
function formatarDataPtBr(iso) {
    if (!iso) return '—'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return String(iso)
    const pad = (n) => String(n).padStart(2, '0')
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function IconeOlho({ visivel }) {
    return (
        <svg className="clicksign_icon_eye" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            {visivel ? (
                <>
                    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                    <circle cx="12" cy="12" r="3" />
                </>
            ) : (
                <>
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a21.77 21.77 0 0 1 5.06-7.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                </>
            )}
        </svg>
    )
}

export default function ClicksignEmerdog() {
    const [tab, setTab] = useState('envelopes')
    const [toast, setToast] = useState(null)
    const [loading, setLoading] = useState(false)
    const [rows, setRows] = useState([])
    const [links, setLinks] = useState({})
    const [meta, setMeta] = useState({})
    const [listPath, setListPath] = useState(() => montarPathListagemEnvelopes({ pageNumber: 1, pageSize: 20 }))
    const [statusFilter, setStatusFilter] = useState('')

    const [mesLoading, setMesLoading] = useState(false)
    const [mesMeta, setMesMeta] = useState({})
    const [mesCount, setMesCount] = useState(null)

    const [filtroNomeEnvelope, setFiltroNomeEnvelope] = useState('')
    const [filtroNomeDebounced, setFiltroNomeDebounced] = useState('')
    const debounceNomeRef = useRef(null)
    const [mostrarIds, setMostrarIds] = useState(true)
    const [deletingId, setDeletingId] = useState('')

    const [fluxoEnvelopeId, setFluxoEnvelopeId] = useState('')
    const [fluxoNome, setFluxoNome] = useState('')
    const [fluxoAssunto, setFluxoAssunto] = useState('')
    const [fluxoMensagem, setFluxoMensagem] = useState('')
    const [fluxoSignNome, setFluxoSignNome] = useState('')
    const [fluxoSignEmail, setFluxoSignEmail] = useState('')
    const [fluxoPhone, setFluxoPhone] = useState('')
    const [fluxoCanal, setFluxoCanal] = useState('email')
    const [fluxoPapel, setFluxoPapel] = useState('sign')
    const [agendaSigs, setAgendaSigs] = useState(() => carregarAgendaSignatarios())
    const [fluxoDropAtivo, setFluxoDropAtivo] = useState(false)
    const [fluxoDocs, setFluxoDocs] = useState([])
    const [fluxoSigs, setFluxoSigs] = useState([])
    const [fluxoBusy, setFluxoBusy] = useState(false)
    const [fluxoDocRemovendoId, setFluxoDocRemovendoId] = useState('')
    const [fluxoSigRemovendoId, setFluxoSigRemovendoId] = useState('')
    const [fluxoEdicaoLista, setFluxoEdicaoLista] = useState(false)

    /** Modais de signatários: `novo` | `agenda` | `agenda_edit` | `qual` (assinar como). */
    const [signModal, setSignModal] = useState(null)
    const [signDraft, setSignDraft] = useState({
        channel: 'email',
        email: '',
        phone: '',
        nome: '',
        saveAgenda: true,
    })
    /** Dados após «Avançar» (novo ou agenda), antes de escolher qualificação. */
    const [signPending, setSignPending] = useState(null)
    const [signModalAgendaTab, setSignModalAgendaTab] = useState('todos')
    const [signModalAgendaBusca, setSignModalAgendaBusca] = useState('')
    const [signModalAgendaId, setSignModalAgendaId] = useState(null)
    const [signAgendaEditId, setSignAgendaEditId] = useState(null)
    const [signQualPapel, setSignQualPapel] = useState('sign')

    const [detailOpen, setDetailOpen] = useState(false)
    const [detailId, setDetailId] = useState('')
    const [detailJson, setDetailJson] = useState(null)
    const [detailLoading, setDetailLoading] = useState(false)
    const [detailDocs, setDetailDocs] = useState([])
    const [detailSigs, setDetailSigs] = useState([])
    const [detailReqs, setDetailReqs] = useState([])

    const [confirmacaoExclusao, setConfirmacaoExclusao] = useState(null)

    const fluxoEidRef = useRef('')
    const montarEdicaoEnvelopeIdRef = useRef('')
    const signReplaceSignerIdRef = useRef('')
    useEffect(() => {
        fluxoEidRef.current = fluxoEnvelopeId.trim()
    }, [fluxoEnvelopeId])

    const resetMontarFluxo = useCallback(() => {
        setFluxoEnvelopeId('')
        setFluxoNome('')
        setFluxoAssunto('')
        setFluxoMensagem('')
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
        setSignModal(null)
        setSignPending(null)
        setSignModalAgendaId(null)
        setSignModalAgendaBusca('')
        setSignModalAgendaTab('todos')
        setSignQualPapel('sign')
        setSignAgendaEditId(null)
        setSignDraft({
            channel: 'email',
            email: '',
            phone: '',
            nome: '',
            saveAgenda: true,
        })
        try {
            sessionStorage.removeItem(STORAGE_FLUXO_EID)
        } catch {
            /* ignore */
        }
    }, [])

    const pushToast = useCallback((variant, title, body) => {
        if (body === undefined) {
            setToast({ variant, title, body: null })
            return
        }
        setToast({ variant, title, body: String(body || '').trim() || '—' })
    }, [])

    useEffect(() => {
        if (!toast) return undefined
        const t = setTimeout(() => setToast(null), TOAST_MS)
        return () => clearTimeout(t)
    }, [toast])

    const carregarLista = useCallback(
        async (path) => {
            setLoading(true)
            const { ok, status, data } = await clicksignRequest('GET', path)
            setLoading(false)
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
            setListPath(path)
        },
        [pushToast],
    )

    const carregarUsoMes = useCallback(async () => {
        setMesLoading(true)
        const intervalo = intervaloCriacaoMesAtualUtc()
        const path = montarPathListagemEnvelopes({
            pageNumber: 1,
            pageSize: 50,
            filterCreated: intervalo,
        })
        const { ok, data } = await clicksignRequest('GET', path)
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
    }, [])

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
        const path = montarPathListagemEnvelopes({
            pageNumber: 1,
            pageSize: 20,
            filterStatus: statusFilter,
            filterName: filtroNomeDebounced,
        })
        void carregarLista(path)
    }, [tab, statusFilter, filtroNomeDebounced, carregarLista])

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
                const { ok, data } = await clicksignRequest('GET', `/envelopes/${encodeURIComponent(eid)}`)
                if (!ok) return
                const st = data?.data?.attributes?.status
                if (String(st || '').toLowerCase() === 'draft') {
                    pushToast(
                        'info',
                        'Rascunho guardado na Clicksign',
                        'Pode dar sequência à edição na lista Envelopes (abrir detalhe e continuar na Clicksign em Editar) ou iniciar outro fluxo em Montar envelope.',
                    )
                }
            })()
        }
    }, [tab, pushToast])

    const aplicarFiltroEstado = (valor) => {
        setStatusFilter(valor)
    }

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
            const { ok, status, data } = await clicksignRequest('DELETE', `/envelopes/${encodeURIComponent(id)}`)
            setDeletingId('')
            if (!ok) {
                pushToast('error', `Eliminar envelope ${status}`, erroApiTexto(data))
                return
            }
            pushToast('info', `Envelope excluido | ${nomeToast}`, undefined)
            if (detailOpen && detailId === id) setDetailOpen(false)
            await carregarLista(listPath)
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

    const abrirDetalhe = async (id) => {
        setDetailId(id)
        setDetailOpen(true)
        setDetailLoading(true)
        setDetailJson(null)
        setDetailDocs([])
        setDetailSigs([])
        setDetailReqs([])
        const enc = clicksignRequest('GET', `/envelopes/${encodeURIComponent(id)}`)
        const docs = clicksignRequest('GET', `/envelopes/${encodeURIComponent(id)}/documents`)
        const sigs = clicksignRequest('GET', `/envelopes/${encodeURIComponent(id)}/signers`)
        const reqs = clicksignRequest('GET', `/envelopes/${encodeURIComponent(id)}/requirements`)
        const [r0, r1, r2, r3] = await Promise.all([enc, docs, sigs, reqs])
        setDetailLoading(false)
        if (!r0.ok) {
            pushToast('error', `Detalhe ${r0.status}`, erroApiTexto(r0.data))
            setDetailJson(r0.data)
            return
        }
        setDetailJson(r0.data)
        if (r1.ok) setDetailDocs(extrairListaDocumentos(r1.data))
        if (r2.ok) setDetailSigs(extrairListaSignatarios(r2.data))
        if (r3.ok) {
            const arr = Array.isArray(r3.data?.data) ? r3.data.data : r3.data?.data ? [r3.data.data] : []
            setDetailReqs(
                arr.map((item) => ({
                    id: item?.id ?? '',
                    tipo: item?.type ?? '—',
                    resumo: JSON.stringify(item?.attributes || {}).slice(0, 120),
                })),
            )
        }
    }

    const abrirMontarEdicaoDesdeDetalhe = useCallback(() => {
        const id = String(detailId || '').trim()
        const st = String(detailJson?.data?.attributes?.status ?? detailJson?.data?.attributes?.state ?? '')
            .trim()
            .toLowerCase()
        if (!id) return
        if (st !== 'draft') {
            pushToast('error', 'Edição', 'Só envelopes em rascunho (draft) podem ser editados nesta ferramenta.')
            return
        }
        montarEdicaoEnvelopeIdRef.current = id
        setDetailOpen(false)
        setTab('montar')
    }, [detailId, detailJson, pushToast])

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
                const enc = await clicksignRequest('GET', `/envelopes/${encodeURIComponent(edicaoId)}`)
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
                    clicksignRequest('GET', `/envelopes/${encodeURIComponent(edicaoId)}/documents`),
                    clicksignRequest('GET', `/envelopes/${encodeURIComponent(edicaoId)}/signers`),
                    clicksignRequest('GET', `/envelopes/${encodeURIComponent(edicaoId)}/requirements`),
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
        } else {
            resetMontarFluxo()
        }
    }, [tab, resetMontarFluxo, pushToast])

    const criarEnvelopeFluxo = async () => {
        setFluxoBusy(true)
        const extras = {}
        if (fluxoAssunto.trim()) extras.default_subject = fluxoAssunto.trim()
        if (fluxoMensagem.trim()) extras.default_message = fluxoMensagem.trim()
        const body = payloadEnvelopeRascunho(fluxoNome, extras)
        const { ok, status, data } = await clicksignRequest('POST', '/envelopes', body)
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
        pushToast('info', 'Envelope criado', id ? 'Já pode anexar PDF e adicionar signatários nesta tela.' : 'Resposta sem ID — confira a lista de envelopes ou abra o detalhe do registo criado.')
        setFluxoNome('')
        await carregarLista(listPath)
        await carregarUsoMes()
    }

    const anexarPdfFluxo = async (fileList) => {
        const file = fileList?.[0]
        if (!file || file.type !== 'application/pdf') {
            pushToast('error', 'Ficheiro', 'Selecione um PDF.')
            return
        }
        if (file.size > PDF_MAX_BYTES) {
            pushToast('error', 'Ficheiro', `O PDF ultrapassa ${PDF_MAX_BYTES / (1024 * 1024)} MB.`)
            return
        }
        let eid = fluxoEnvelopeId.trim()
        if (!eid) {
            try {
                eid = String(sessionStorage.getItem(STORAGE_FLUXO_EID) || '').trim()
            } catch {
                eid = ''
            }
        }
        if (!eid) {
            pushToast('error', 'Envelope', 'Crie primeiro o envelope (passo 1). O ID será preenchido automaticamente.')
            return
        }
        if (!fluxoEnvelopeId && eid) setFluxoEnvelopeId(eid)
        setFluxoBusy(true)
        let dataUrlPdf = ''
        try {
            const dataUrl = await new Promise((resolve, reject) => {
                const fr = new FileReader()
                fr.onload = () => resolve(fr.result)
                fr.onerror = () => reject(new Error('Leitura do PDF falhou.'))
                fr.readAsDataURL(file)
            })
            dataUrlPdf = String(dataUrl || '')
        } catch (e) {
            setFluxoBusy(false)
            pushToast('error', 'PDF', e?.message || 'Falha ao ler o ficheiro.')
            return
        }
        const encCheck = await clicksignRequest('GET', `/envelopes/${encodeURIComponent(eid)}`)
        const st = encCheck.ok ? encCheck.data?.data?.attributes?.status : null
        if (st && String(st).toLowerCase() !== 'draft') {
            setFluxoBusy(false)
            pushToast(
                'error',
                'Envelope',
                'Só é possível anexar PDF com o envelope em rascunho (draft). Crie um novo em «Montar envelope» ou use um rascunho ainda não ativado.',
            )
            return
        }
        const body = payloadDocumentoPdf(eid, file.name, dataUrlPdf)
        let { ok, status, data } = await clicksignRequest('POST', `/envelopes/${encodeURIComponent(eid)}/documents`, body)
        if (!ok && (status === 500 || status === 422)) {
            const bodyAlt = payloadDocumentoPdf(eid, file.name, dataUrlPdf, { includeEnvelopeRelationship: true })
            const r2 = await clicksignRequest('POST', `/envelopes/${encodeURIComponent(eid)}/documents`, bodyAlt)
            ok = r2.ok
            status = r2.status
            data = r2.data
        }
        setFluxoBusy(false)
        if (!ok) {
            pushToast('error', `Documento ${status}`, erroApiTexto(data))
            return
        }
        const nomeDoc = String(file.name || 'documento.pdf').trim() || 'documento.pdf'
        pushToast('info', 'Documento Anexado', nomeDoc)
        await refreshFluxoListas(eid)
        await carregarLista(listPath)
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
        const encCheck = await clicksignRequest('GET', `/envelopes/${encodeURIComponent(eid)}`)
        const st = encCheck.ok ? encCheck.data?.data?.attributes?.status : null
        if (st && String(st).toLowerCase() !== 'draft') {
            pushToast('error', 'Envelope', 'Só é possível remover documentos com o envelope em rascunho (draft).')
            return
        }
        setFluxoDocRemovendoId(did)
        try {
            const { ok, status, data } = await clicksignRequest(
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
            await carregarLista(listPath)
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
        const encCheck = await clicksignRequest('GET', `/envelopes/${encodeURIComponent(eid)}`)
        const st = encCheck.ok ? encCheck.data?.data?.attributes?.status : null
        if (st && String(st).toLowerCase() !== 'draft') {
            pushToast('error', 'Envelope', 'Só é possível remover signatários com o envelope em rascunho (draft).')
            return
        }
        setFluxoSigRemovendoId(sid)
        try {
            const { ok, status, data } = await clicksignRequest(
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
            await carregarLista(listPath)
        } finally {
            setFluxoSigRemovendoId('')
        }
    }

    const refreshFluxoListas = useCallback(async (eid) => {
        const id = String(eid || fluxoEnvelopeId || '').trim()
        if (!id) return
        const [d1, d2, d3] = await Promise.all([
            clicksignRequest('GET', `/envelopes/${encodeURIComponent(id)}/documents`),
            clicksignRequest('GET', `/envelopes/${encodeURIComponent(id)}/signers`),
            clicksignRequest('GET', `/envelopes/${encodeURIComponent(id)}/requirements`),
        ])
        if (d1.ok) setFluxoDocs(extrairListaDocumentos(d1.data))
        else setFluxoDocs([])
        if (d2.ok) setFluxoSigs(mergeSignersWithQualificationLabels(d2.data, d3.ok ? d3.data : null))
        else setFluxoSigs([])
    }, [fluxoEnvelopeId])

    const fecharSignModal = useCallback(() => {
        signReplaceSignerIdRef.current = ''
        setSignModal(null)
        setSignPending(null)
        setSignModalAgendaId(null)
        setSignModalAgendaBusca('')
        setSignModalAgendaTab('todos')
        setSignAgendaEditId(null)
    }, [])

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
            const ch = channel === 'whatsapp' ? 'whatsapp' : 'email'
            if (ch === 'email' && !String(email || '').trim()) {
                pushToast('error', 'Signatário', 'Preencha o e-mail ou mude o canal para WhatsApp.')
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
            if (replaceId) {
                const dr = await clicksignRequest('DELETE', `/envelopes/${encodeURIComponent(eid)}/signers/${encodeURIComponent(replaceId)}`)
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
                channel: ch,
            })
            const { ok, status, data } = await clicksignRequest('POST', `/envelopes/${encodeURIComponent(eid)}/signers`, body)
            if (!ok) {
                setFluxoBusy(false)
                pushToast('error', `Signatário ${status}`, erroApiTexto(data))
                return false
            }
            const signerId = String(data?.data?.id || '').trim()
            const papelUsar = normalizarPapelQualificacao(papel)
            let docsParaReq = fluxoDocs
            const docsRes = await clicksignRequest('GET', `/envelopes/${encodeURIComponent(eid)}/documents`)
            if (docsRes.ok) {
                docsParaReq = extrairListaDocumentos(docsRes.data)
                setFluxoDocs(docsParaReq)
            }
            let qualOk = true
            if (signerId && docsParaReq.length > 0) {
                for (const doc of docsParaReq) {
                    const docId = String(doc.id || '').trim()
                    if (!docId) continue
                    const reqBody = payloadRequisitoQualificacao(eid, {
                        documentId: docId,
                        signerId,
                        role: papelUsar,
                    })
                    const rq = await clicksignRequest('POST', `/envelopes/${encodeURIComponent(eid)}/requirements`, reqBody)
                    if (!rq.ok) {
                        qualOk = false
                        pushToast(
                            'error',
                            `Requisito de qualificação ${rq.status}`,
                            erroApiTexto(rq.data) || 'O signatário foi criado; crie o requisito de qualificação na Clicksign ou tente novamente.',
                        )
                        break
                    }
                }
            }
            setFluxoBusy(false)
            if (docsParaReq.length === 0) {
                pushToast(
                    'info',
                    'Signatário adicionado',
                    'Anexe um PDF no passo 2 para criar automaticamente o requisito de qualificação com o papel escolhido.',
                )
            } else if (qualOk) {
                pushToast('info', 'Signatário adicionado', 'Requisito de qualificação criado para cada documento em rascunho.')
            }
            if (gravarNaAgenda) {
                setAgendaSigs(
                    upsertContatoAgenda({
                        name: nomeTrim,
                        email: String(email || '').trim(),
                        phone: String(phone || '').trim(),
                        channel: ch,
                        papel: papelUsar,
                    }),
                )
            }
            setFluxoPapel(papelUsar)
            setFluxoCanal(ch)
            setFluxoSignNome('')
            setFluxoSignEmail('')
            setFluxoPhone('')
            await refreshFluxoListas(eid)
            return true
        },
        [fluxoEnvelopeId, fluxoDocs, pushToast, refreshFluxoListas],
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
            const sync = await garantirRequisitosQualificacaoCobertos(clicksignRequest, eid)
            if (sync.erroListagem) {
                pushToast('error', 'Envelope', 'Não foi possível listar documentos ou signatários para sincronizar requisitos.')
                await refreshFluxoListas(eid)
                return
            }
            if (sync.falhas.length > 0) {
                const f0 = sync.falhas[0]
                pushToast('error', `Qualificação ${f0.status}`, erroApiTexto(f0.data) || 'Falha ao criar requisito de qualificação.')
                await refreshFluxoListas(eid)
                return
            }
            if (sync.criados > 0) {
                pushToast('info', 'Requisitos', `${sync.criados} requisito(s) de qualificação criado(s) automaticamente.`)
            }

            const body = payloadAtivarEnvelope(eid)
            let { ok, status, data } = await clicksignRequest('PATCH', `/envelopes/${encodeURIComponent(eid)}`, body)

            if (!ok && status === 422) {
                await garantirRequisitosAutenticacaoEmailCobertos(clicksignRequest, eid)
                await refreshFluxoListas(eid)
                const retry = await clicksignRequest('PATCH', `/envelopes/${encodeURIComponent(eid)}`, body)
                ok = retry.ok
                status = retry.status
                data = retry.data
            }

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
            pushToast('info', 'Envelope ativado', 'Status running. As notificações dependem dos requisitos e da configuração da conta.')
            await refreshFluxoListas(eid)
            await carregarLista(listPath)
            await carregarUsoMes()
        } finally {
            setFluxoBusy(false)
        }
    }

    const pagina = (linkUrl) => {
        const local = pathFromClicksignLink(linkUrl)
        if (local) carregarLista(local)
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

    const indicadoresPlano = extrairIndicadoresMeta(meta)
    const indicadoresMes = extrairIndicadoresMeta(mesMeta)
    const mesNome = new Date().toLocaleString('pt-BR', { month: 'long', year: 'numeric' })

    return (
        <div className="contratos_emerdog clicksign_emerdog clicksign_emerdog_full">
            <h1>Clicksign — Assinatura Eletrônica</h1>

            <div className="contratos_tabs clicksign_tabs_scroll" role="tablist">
                <button type="button" className={`contratos_tab ${tab === 'envelopes' ? 'is-active' : ''}`} onClick={() => setTab('envelopes')}>
                    Envelopes
                </button>
                <button type="button" className={`contratos_tab ${tab === 'montar' ? 'is-active' : ''}`} onClick={() => setTab('montar')}>
                    Montar envelope
                </button>
            </div>

            <div className="contratos_card">
                {tab === 'envelopes' && (
                    <div>
                        <div className="clicksign_stats">
                            <div className="clicksign_stat_card">
                                <span className="clicksign_stat_label">Lista atual</span>
                                <strong className="clicksign_stat_value">{meta?.record_count != null ? meta.record_count : rows.length}</strong>
                                <span className="clicksign_stat_hint">registos</span>
                            </div>
                            <div className="clicksign_stat_card">
                                <span className="clicksign_stat_label">Criados no mês ({mesNome})</span>
                                <strong className="clicksign_stat_value">{mesLoading ? '…' : mesCount != null ? mesCount : '—'}</strong>
                                <span className="clicksign_stat_hint">no mês corrente</span>
                            </div>
                        </div>
                        {Object.keys(indicadoresMes).length > 0 && (
                            <pre className="clicksign_pre clicksign_pre_compact">{JSON.stringify(indicadoresMes, null, 2)}</pre>
                        )}
                        {Object.keys(indicadoresPlano).length > 0 && (
                            <p className="contratos_hint">
                                Indicadores extra na lista: <code>{JSON.stringify(indicadoresPlano)}</code>
                            </p>
                        )}

                        <div className="clicksign_toolbar">
                            <button type="button" className="contratos_btn contratos_btn_secondary" disabled={loading} onClick={() => carregarLista(listPath)}>
                                Atualizar lista
                            </button>
                            <div className="contratos_field clicksign_field_inline clicksign_field_grow">
                                <label htmlFor="cs-filtro-nome">Nome do envelope</label>
                                <input
                                    id="cs-filtro-nome"
                                    className="contratos_input"
                                    value={filtroNomeEnvelope}
                                    onChange={(e) => setFiltroNomeEnvelope(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault()
                                            commitFiltroNomeImediato()
                                        }
                                    }}
                                    placeholder="Filtra por nome (atualiza ao digitar)…"
                                />
                            </div>
                            <div className="contratos_field clicksign_field_inline">
                                <label htmlFor="cs-filtro-estado">Estado</label>
                                <select
                                    id="cs-filtro-estado"
                                    className="contratos_select"
                                    value={statusFilter}
                                    onChange={(e) => aplicarFiltroEstado(e.target.value)}
                                >
                                    <option value="">Todos</option>
                                    <option value="draft">Rascunho</option>
                                    <option value="running">Em processo</option>
                                    <option value="closed">Finalizado</option>
                                    <option value="canceled">Cancelado</option>
                                </select>
                            </div>
                            <button
                                type="button"
                                className={`contratos_btn contratos_btn_secondary clicksign_btn_icon ${mostrarIds ? '' : 'is-muted'}`}
                                onClick={() => setMostrarIds((v) => !v)}
                                title={mostrarIds ? 'Ocultar IDs na lista' : 'Mostrar IDs na lista'}
                                aria-label={mostrarIds ? 'Ocultar IDs na lista' : 'Mostrar IDs na lista'}
                            >
                                <IconeOlho visivel={mostrarIds} />
                                <span className="clicksign_btn_icon_label">{mostrarIds ? 'Ocultar ID' : 'Mostrar ID'}</span>
                            </button>
                        </div>
                        <div className="clicksign_table_wrap">
                            <table className="clicksign_table clicksign_table_envelopes">
                                <colgroup>
                                    <col className="clicksign_col_nome" />
                                    <col className="clicksign_col_estado" />
                                    <col className="clicksign_col_data" />
                                    <col className="clicksign_col_data" />
                                    <col className="clicksign_col_id" />
                                    <col className="clicksign_col_acoes" />
                                </colgroup>
                                <thead>
                                    <tr>
                                        <th className="clicksign_col_nome">Nome</th>
                                        <th className="clicksign_col_estado">Estado</th>
                                        <th className="clicksign_col_data">Criado</th>
                                        <th className="clicksign_col_data">Atualizado</th>
                                        <th className="clicksign_col_id">ID</th>
                                        <th className="clicksign_col_acoes">Ações</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.length === 0 && (
                                        <tr>
                                            <td colSpan={6} className="clicksign_td_empty">
                                                {loading ? 'A carregar…' : 'Nenhum envelope encontrado.'}
                                            </td>
                                        </tr>
                                    )}
                                    {rows.map((r) => (
                                        <tr key={r.id}>
                                            <td className="clicksign_col_nome" data-label="Nome">
                                                {r.name}
                                            </td>
                                            <td className="clicksign_col_estado" data-label="Estado">
                                                <span
                                                    className={`clicksign_badge clicksign_badge--${String(r.status).toLowerCase().replace(/[^a-z]/g, '') || 'unknown'}`}
                                                >
                                                    {r.status}
                                                </span>
                                            </td>
                                            <td className="clicksign_col_data" data-label="Criado">
                                                {formatarDataPtBr(r.created)}
                                            </td>
                                            <td className="clicksign_col_data" data-label="Atualizado">
                                                {formatarDataPtBr(r.updated)}
                                            </td>
                                            <td className="clicksign_col_id clicksign_mono" data-label="ID">
                                                {mostrarIds ? r.id : '********-****-****-****-************'}
                                            </td>
                                            <td className="clicksign_col_acoes" data-label="Ações">
                                                <div className="clicksign_td_actions">
                                                    <button
                                                        type="button"
                                                        className="contratos_btn contratos_btn_primary clicksign_btn_sm"
                                                        onClick={() => abrirDetalhe(r.id)}
                                                    >
                                                        Detalhe
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="table_delete_btn"
                                                        disabled={loading || deletingId === r.id}
                                                        title="Excluir envelope (Shift = excluir rápido)"
                                                        onClick={(e) => void excluirEnvelope(r.id, r.name, { ignorarConfirmacao: e.shiftKey })}
                                                    >
                                                        🗑️
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="clicksign_pagination">
                            <button type="button" className="contratos_btn contratos_btn_secondary" disabled={!links.prev || loading} onClick={() => pagina(links.prev)}>
                                Anterior
                            </button>
                            <button type="button" className="contratos_btn contratos_btn_secondary" disabled={!links.next || loading} onClick={() => pagina(links.next)}>
                                Seguinte
                            </button>
                        </div>
                    </div>
                )}

                {tab === 'montar' && (
                    <div className="cs_flow">
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
                                Cada vez que abre este separador inicia um <strong>novo</strong> rascunho local. Se sair com um envelope em rascunho na Clicksign, mostramos um aviso para continuar em Envelopes (detalhe / editar).
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
                                            placeholder="Ex.: Contrato — clínica X"
                                        />
                                    </div>
                                    <div className="contratos_field">
                                        <label htmlFor="cs-fl-sub">Assunto do e-mail (opcional)</label>
                                        <input
                                            id="cs-fl-sub"
                                            className="contratos_input cs_input"
                                            value={fluxoAssunto}
                                            onChange={(e) => setFluxoAssunto(e.target.value)}
                                            placeholder="Assunto da solicitação de assinatura"
                                        />
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
                                    <button type="button" className="contratos_btn contratos_btn_primary" disabled={fluxoBusy} onClick={() => criarEnvelopeFluxo()}>
                                        + Criar envelope
                                    </button>
                                </div>
                                <details className="cs_details">
                                    <summary>Avançado — colar outro ID</summary>
                                    <div className="contratos_field">
                                        <label htmlFor="cs-fl-id">Envelope ID (UUID)</label>
                                        <input
                                            id="cs-fl-id"
                                            className="contratos_input cs_input clicksign_mono"
                                            value={fluxoEnvelopeId}
                                            onChange={(e) => setFluxoEnvelopeId(e.target.value)}
                                            onBlur={(e) => {
                                                const v = e.target.value.trim()
                                                if (v) persistirEnvelopeSessao(v)
                                            }}
                                            placeholder="Cole aqui se continuar um rascunho existente"
                                        />
                                    </div>
                                </details>
                            </div>
                        </section>

                        <section className={`cs_card cs_card_docs ${!fluxoEnvelopeId.trim() ? 'is-locked' : ''}`}>
                            <header className="cs_card_head">
                                <span className="cs_card_dot cs_dot_red" aria-hidden />
                                <h2 className="cs_card_title">2. Documentos</h2>
                            </header>
                            <div className="cs_card_body">
                                {!fluxoEnvelopeId.trim() && <div className="cs_lock_msg">Crie o envelope no passo 1 para desbloquear o envio.</div>}
                                <div
                                    className={`cs_dropzone ${fluxoDropAtivo ? 'is-active' : ''} ${!fluxoEnvelopeId.trim() ? 'is-disabled' : ''}`}
                                    onDragEnter={(e) => {
                                        e.preventDefault()
                                        if (fluxoEnvelopeId.trim()) setFluxoDropAtivo(true)
                                    }}
                                    onDragOver={(e) => {
                                        e.preventDefault()
                                        if (fluxoEnvelopeId.trim()) setFluxoDropAtivo(true)
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
                                    <p className="cs_dropzone_sub">ou escolha um ficheiro (máx. ~{PDF_MAX_BYTES / (1024 * 1024)} MB)</p>
                                    <label className="contratos_btn contratos_btn_secondary clicksign_btn_sm cs_file_label">
                                        Escolher PDF
                                        <input
                                            className="cs_file_input"
                                            type="file"
                                            accept="application/pdf,.pdf"
                                            disabled={fluxoBusy || !fluxoEnvelopeId.trim()}
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
                                                        saveAgenda: true,
                                                    })
                                                    setSignModal('novo')
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
                                                    setSignModalAgendaId(null)
                                                    setSignModal('agenda')
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
                                            {agendaOrdenada.length === 0
                                                ? 'Agenda vazia — os contactos guardados ao adicionar signatários aparecem em «Signatário da agenda».'
                                                : `${agendaOrdenada.length} contacto(s) na agenda neste dispositivo.`}
                                        </p>
                                    </>
                                )}
                            </div>
                        </section>

                        <div className="cs_summary_grid">
                            <div className="cs_summary_card">
                                <h3 className="cs_summary_title">Documentos</h3>
                                <ul className="cs_summary_list">
                                    {fluxoDocs.length === 0 && <li className="cs_summary_empty">Nenhum ficheiro ainda.</li>}
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
                                                    {s.email !== '—' ? s.email : ''} {s.phone && s.phone !== '—' ? `· ${s.phone}` : ''} · {s.status}
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
                                                            phone: ph,
                                                            nome: String(s.name || '').trim(),
                                                            saveAgenda: false,
                                                        })
                                                        setSignModal('novo')
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

                        <section className="cs_card cs_card_footer">
                            <p className="cs_fineprint">
                                Antes de <strong>enviar</strong>, crie os requisitos de qualificação e autenticação na API (
                                <a href="https://developers.clicksign.com/docs/guia-de-criacao-o-passo-a-passo-padrao" target="_blank" rel="noopener noreferrer">
                                    guia
                                </a>
                                ). Depois use o botão «Enviar envelope» quando os requisitos estiverem configurados na sua conta.
                            </p>
                            <button type="button" className="contratos_btn contratos_btn_secondary" disabled={fluxoBusy} onClick={() => ativarEnvelopeFluxo()}>
                                Enviar envelope 
                            </button>
                        </section>
                    </div>
                )}

            </div>

            {signModal && (
                <div className="contratos_modal_backdrop" role="presentation" onClick={() => !fluxoBusy && fecharSignModal()}>
                    <div
                        className={`contratos_modal cs_sign_modal ${signModal === 'agenda' || signModal === 'agenda_edit' ? 'cs_sign_modal--wide' : ''}`}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="cs-sign-modal-title"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {signModal === 'novo' && (
                            <>
                                <div className="contratos_modal_head">
                                    <h2 id="cs-sign-modal-title" className="cs_sign_modal_title">
                                        Adicionar novo signatário
                                    </h2>
                                </div>
                                <div className="contratos_modal_body cs_sign_modal_body">
                                    <div className="cs_sign_field_group">
                                        <h3 className="cs_sign_section_label">Envio</h3>
                                        <div className="contratos_field cs_sign_w400">
                                            <label htmlFor="cs-sig-ch">Canal</label>
                                            <select
                                                id="cs-sig-ch"
                                                className="contratos_select cs_input"
                                                value={signDraft.channel}
                                                onChange={(e) => setSignDraft((d) => ({ ...d, channel: e.target.value }))}
                                            >
                                                <option value="email">E-mail</option>
                                                <option value="whatsapp">WhatsApp</option>
                                            </select>
                                        </div>
                                        {signDraft.channel === 'email' ? (
                                            <div className="contratos_field cs_sign_w400">
                                                <label htmlFor="cs-sig-em">E-mail</label>
                                                <input
                                                    id="cs-sig-em"
                                                    className="contratos_input cs_input"
                                                    type="email"
                                                    autoComplete="email"
                                                    placeholder="Digite o e-mail"
                                                    value={signDraft.email}
                                                    onChange={(e) => setSignDraft((d) => ({ ...d, email: e.target.value }))}
                                                />
                                            </div>
                                        ) : (
                                            <>
                                                <div className="contratos_field cs_sign_w400">
                                                    <label htmlFor="cs-sig-ph">Telefone</label>
                                                    <input
                                                        id="cs-sig-ph"
                                                        className="contratos_input cs_input"
                                                        inputMode="numeric"
                                                        autoComplete="tel"
                                                        placeholder="11999998888"
                                                        value={signDraft.phone}
                                                        onChange={(e) => setSignDraft((d) => ({ ...d, phone: e.target.value }))}
                                                    />
                                                </div>
                                                <div className="contratos_field cs_sign_w400">
                                                    <label htmlFor="cs-sig-em2">E-mail (opcional)</label>
                                                    <input
                                                        id="cs-sig-em2"
                                                        className="contratos_input cs_input"
                                                        type="email"
                                                        value={signDraft.email}
                                                        onChange={(e) => setSignDraft((d) => ({ ...d, email: e.target.value }))}
                                                    />
                                                </div>
                                            </>
                                        )}
                                        <label className="cs_sign_check">
                                            <input
                                                type="checkbox"
                                                checked={signDraft.saveAgenda}
                                                onChange={(e) => setSignDraft((d) => ({ ...d, saveAgenda: e.target.checked }))}
                                            />
                                            Salvar na agenda
                                        </label>
                                    </div>

                                    <div className="cs_sign_field_group">
                                        <div className="contratos_field cs_sign_w400">
                                            <label htmlFor="cs-sig-nome">Nome completo</label>
                                            <input
                                                id="cs-sig-nome"
                                                className="contratos_input cs_input"
                                                value={signDraft.nome}
                                                onChange={(e) => setSignDraft((d) => ({ ...d, nome: e.target.value }))}
                                                placeholder="Nome e apelido ou razão social"
                                            />
                                        </div>
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
                                            if (!nomeSignatarioValido(signDraft.nome)) {
                                                pushToast('error', 'Signatário', 'Indique o nome completo (pelo menos duas palavras).')
                                                return
                                            }
                                            if (signDraft.channel === 'email' && !signDraft.email.trim()) {
                                                pushToast('error', 'Signatário', 'Preencha o e-mail.')
                                                return
                                            }
                                            if (signDraft.channel === 'whatsapp') {
                                                const tel = normalizarTelefoneBr(signDraft.phone)
                                                if (tel.length < 10 || tel.length > 11) {
                                                    pushToast('error', 'WhatsApp', 'Telefone com DDD: 10 ou 11 dígitos.')
                                                    return
                                                }
                                            }
                                            setSignPending({
                                                name: signDraft.nome.trim(),
                                                email: signDraft.email.trim(),
                                                phone: signDraft.phone,
                                                channel: signDraft.channel,
                                                gravarNaAgenda: signDraft.saveAgenda,
                                                source: 'novo',
                                            })
                                            setSignQualPapel(normalizarPapelQualificacao(fluxoPapel))
                                            setSignModal('qual')
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
                                    </div>
                                    <div className="cs_sign_table_wrap">
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
                                                    <tr key={c.localId} className={signModalAgendaId === c.localId ? 'is-selected' : ''}>
                                                        <td>
                                                            <input
                                                                type="radio"
                                                                name="cs-ag-sel"
                                                                className="cs_sign_radio"
                                                                checked={signModalAgendaId === c.localId}
                                                                onChange={() => setSignModalAgendaId(c.localId)}
                                                                aria-label={`Selecionar ${c.name}`}
                                                            />
                                                        </td>
                                                        <td>{c.name}</td>
                                                        <td>{c.channel === 'whatsapp' ? c.phone || '—' : c.email || '—'}</td>
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
                                                                        channel: c.channel === 'whatsapp' ? 'whatsapp' : 'email',
                                                                        email: String(c.email || '').trim(),
                                                                        phone: String(c.phone || '').trim(),
                                                                        nome: String(c.name || '').trim(),
                                                                        saveAgenda: true,
                                                                    })
                                                                    setSignQualPapel(normalizarPapelQualificacao(c.papel))
                                                                    setSignModal('agenda_edit')
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
                                                                    if (!window.confirm(`Remover «${nm}» da agenda neste dispositivo?`)) return
                                                                    if (signModalAgendaId === c.localId) setSignModalAgendaId(null)
                                                                    setAgendaSigs(removerContatoAgendaPorId(c.localId))
                                                                    pushToast('info', 'Agenda', 'Contacto removido.')
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
                                                                onClick={() => setAgendaSigs(alternarFavoritoAgenda(c.localId))}
                                                            >
                                                                {c.favorite ? '★' : '☆'}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                                <div className="contratos_modal_foot cs_sign_modal_foot">
                                    <button type="button" className="contratos_btn contratos_btn_secondary" disabled={fluxoBusy} onClick={() => fecharSignModal()}>
                                        Cancelar
                                    </button>
                                    <button
                                        type="button"
                                        className="contratos_btn contratos_btn_primary cs_sign_btn_fwd"
                                        disabled={fluxoBusy || !signModalAgendaId}
                                        onClick={() => {
                                            const c = agendaOrdenada.find((x) => x.localId === signModalAgendaId)
                                            if (!c) {
                                                pushToast('error', 'Agenda', 'Selecione um contacto.')
                                                return
                                            }
                                            setSignPending({
                                                name: String(c.name || '').trim(),
                                                email: String(c.email || '').trim(),
                                                phone: String(c.phone || '').trim(),
                                                channel: c.channel === 'whatsapp' ? 'whatsapp' : 'email',
                                                gravarNaAgenda: true,
                                                source: 'agenda',
                                            })
                                            const p = String(c.papel || 'sign').trim()
                                            setSignQualPapel(normalizarPapelQualificacao(p))
                                            setSignModal('qual')
                                        }}
                                    >
                                        Avançar <span aria-hidden>→</span>
                                    </button>
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
                                            <select
                                                id="cs-sig-ed-ch"
                                                className="contratos_select cs_input"
                                                value={signDraft.channel}
                                                onChange={(e) => setSignDraft((d) => ({ ...d, channel: e.target.value }))}
                                            >
                                                <option value="email">E-mail</option>
                                                <option value="whatsapp">WhatsApp</option>
                                            </select>
                                        </div>
                                        {signDraft.channel === 'email' ? (
                                            <div className="contratos_field cs_sign_w400">
                                                <label htmlFor="cs-sig-ed-em">E-mail</label>
                                                <input
                                                    id="cs-sig-ed-em"
                                                    className="contratos_input cs_input"
                                                    type="email"
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
                                                        onChange={(e) => setSignDraft((d) => ({ ...d, phone: e.target.value }))}
                                                    />
                                                </div>
                                                <div className="contratos_field cs_sign_w400">
                                                    <label htmlFor="cs-sig-ed-em2">E-mail (opcional)</label>
                                                    <input
                                                        id="cs-sig-ed-em2"
                                                        className="contratos_input cs_input"
                                                        type="email"
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
                                            <select
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
                                            </select>
                                        </div>
                                    </div>
                                </div>
                                <div className="contratos_modal_foot cs_sign_modal_foot">
                                    <button type="button" className="contratos_btn contratos_btn_secondary" disabled={fluxoBusy} onClick={() => fecharSignModal()}>
                                        Cancelar
                                    </button>
                                    <button type="button" className="contratos_btn cs_sign_btn_outline" disabled={fluxoBusy} onClick={() => setSignModal('agenda')}>
                                        Voltar à lista
                                    </button>
                                    <button
                                        type="button"
                                        className="contratos_btn contratos_btn_primary"
                                        disabled={fluxoBusy}
                                        onClick={() => {
                                            if (!nomeSignatarioValido(signDraft.nome)) {
                                                pushToast('error', 'Agenda', 'Indique o nome completo (pelo menos duas palavras).')
                                                return
                                            }
                                            if (signDraft.channel === 'email' && !signDraft.email.trim()) {
                                                pushToast('error', 'Agenda', 'Preencha o e-mail.')
                                                return
                                            }
                                            if (signDraft.channel === 'whatsapp') {
                                                const tel = normalizarTelefoneBr(signDraft.phone)
                                                if (tel.length < 10 || tel.length > 11) {
                                                    pushToast('error', 'Agenda', 'Telefone com DDD: 10 ou 11 dígitos.')
                                                    return
                                                }
                                            }
                                            setAgendaSigs(
                                                atualizarContatoAgendaPorId(signAgendaEditId, {
                                                    name: signDraft.nome.trim(),
                                                    email: signDraft.email.trim(),
                                                    phone: signDraft.phone,
                                                    channel: signDraft.channel,
                                                    papel: normalizarPapelQualificacao(signQualPapel),
                                                }),
                                            )
                                            pushToast('info', 'Agenda', 'Contacto atualizado.')
                                            setSignAgendaEditId(null)
                                            setSignModal('agenda')
                                        }}
                                    >
                                        Guardar
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
                                            {signPending.channel === 'whatsapp' ? (
                                                <>
                                                    <span>{signPending.phone || '—'}</span>
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
                                        <select
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
                                        </select>
                                    </div>
                                </div>
                                <div className="contratos_modal_foot cs_sign_modal_foot">
                                    <button
                                        type="button"
                                        className="contratos_btn cs_sign_btn_outline"
                                        disabled={fluxoBusy}
                                        onClick={() => {
                                            setSignModal(signPending.source === 'novo' ? 'novo' : 'agenda')
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
                                                gravarNaAgenda: signPending.gravarNaAgenda,
                                            })
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
                <div className="contratos_modal_backdrop" role="presentation" onClick={() => setDetailOpen(false)}>
                    <div className="contratos_modal clicksign_modal_wide" role="dialog" aria-modal="true" aria-labelledby="cs-det-title" onClick={(e) => e.stopPropagation()}>
                        <div className="contratos_modal_head clicksign_modal_head_row" id="cs-det-title">
                            <span className="clicksign_modal_title_text">
                                Envelope {mostrarIds ? detailId : '**'}
                            </span>
                            <button
                                type="button"
                                className={`contratos_btn contratos_btn_secondary clicksign_btn_icon ${mostrarIds ? '' : 'is-muted'}`}
                                onClick={() => setMostrarIds((v) => !v)}
                                title={mostrarIds ? 'Ocultar ID' : 'Mostrar ID'}
                                aria-label={mostrarIds ? 'Ocultar ID' : 'Mostrar ID'}
                            >
                                <IconeOlho visivel={mostrarIds} />
                            </button>
                        </div>
                        <div className="contratos_modal_body clicksign_modal_body">
                            {detailLoading && <p>A carregar…</p>}
                            {!detailLoading && detailJson && (
                                <>
                                    <div className="clicksign_detail_attrs">
                                        <p>
                                            <strong>Estado:</strong>{' '}
                                            <span
                                                className={`clicksign_badge clicksign_badge--${String(detailJson?.data?.attributes?.status || '')
                                                    .toLowerCase()
                                                    .replace(/[^a-z]/g, '') || 'unknown'}`}
                                            >
                                                {detailJson?.data?.attributes?.status ?? '—'}
                                            </span>
                                        </p>
                                        <p>
                                            <strong>Nome:</strong> {detailJson?.data?.attributes?.name ?? '—'}
                                        </p>
                                        <p>
                                            <strong>Criado:</strong> {formatarDataPtBr(detailJson?.data?.attributes?.created ?? detailJson?.data?.attributes?.created_at)}
                                        </p>
                                        <p>
                                            <strong>Atualizado:</strong>{' '}
                                            {formatarDataPtBr(
                                                detailJson?.data?.attributes?.modified ??
                                                    detailJson?.data?.attributes?.updated_at ??
                                                    detailJson?.data?.attributes?.modified_at,
                                            )}
                                        </p>
                                    </div>
                                    <h3 className="clicksign_subtitle">Documentos</h3>
                                    <div className="clicksign_detail_table_wrap">
                                        <table className="clicksign_detail_table">
                                            <thead>
                                                <tr>
                                                    <th>Ficheiro</th>
                                                    <th>Estado</th>
                                                    <th>ID</th>
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
                                                        <td>
                                                            <code>{d.filename}</code>
                                                        </td>
                                                        <td>{d.status}</td>
                                                        <td className="clicksign_mono">{mostrarIds ? d.id : '**'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <h3 className="clicksign_subtitle">Signatários</h3>
                                    <div className="clicksign_detail_table_wrap">
                                        <table className="clicksign_detail_table">
                                            <thead>
                                                <tr>
                                                    <th>Nome</th>
                                                    <th>E-mail</th>
                                                    <th>Telefone</th>
                                                    <th>Estado</th>
                                                    <th>ID</th>
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
                                                        <td>{s.name}</td>
                                                        <td>{s.email}</td>
                                                        <td>{s.phone && s.phone !== '—' ? s.phone : '—'}</td>
                                                        <td>{s.status}</td>
                                                        <td className="clicksign_mono">{mostrarIds ? s.id : '**'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <h3 className="clicksign_subtitle">Requisitos</h3>
                                    <ul className="clicksign_mini_list">
                                        {detailReqs.length === 0 && <li>—</li>}
                                        {detailReqs.map((r) => (
                                            <li key={r.id}>
                                                <code>{r.tipo}</code> — {r.resumo}
                                            </li>
                                        ))}
                                    </ul>
                                    <details className="clicksign_details">
                                        <summary>JSON completo (envelope)</summary>
                                        <pre className="clicksign_pre contratos_preview_pre">{JSON.stringify(detailJson, null, 2)}</pre>
                                    </details>
                                </>
                            )}
                        </div>
                        <div className="contratos_modal_foot clicksign_modal_foot">
                            <button type="button" className="contratos_btn contratos_btn_secondary" onClick={() => setDetailOpen(false)}>
                                Fechar
                            </button>
                            {!detailLoading && detailJson && String(detailJson?.data?.attributes?.status ?? '').toLowerCase() === 'draft' && (
                                <button type="button" className="contratos_btn contratos_btn_primary" onClick={() => abrirMontarEdicaoDesdeDetalhe()}>
                                    Editar
                                </button>
                            )}
                            <a
                                className="contratos_btn contratos_btn_secondary"
                                style={{ textDecoration: 'none', display: 'inline-block' }}
                                href="https://sandbox.clicksign.com"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                Abrir Clicksign
                            </a>
                        </div>
                    </div>
                </div>
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
                <div className={`contratos_toast contratos_toast--${toast.variant}`} role="alert">
                    <div className="contratos_toast_text">
                        <strong>{toast.title}</strong>
                        {toast.body != null && <span className="contratos_toast_body">{toast.body}</span>}
                    </div>
                    <button type="button" className="contratos_toast_close" onClick={() => setToast(null)} aria-label="Fechar">
                        ×
                    </button>
                </div>
            )}
        </div>
    )
}
