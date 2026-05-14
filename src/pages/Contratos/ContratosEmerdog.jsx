import React, { useCallback, useEffect, useRef, useState } from 'react'
import { buscarDadosCNPJ } from '../../lib/contratos/cnpjBizClient.js'
import { apenasDigitos, errosValidacao } from '../../lib/contratos/validarDocumentos.js'
import { maskCNPJ, maskCPF } from '../../lib/contratos/mascarasDocumento.js'
import { linhasParaTextoPreview, getLinhas } from '../../lib/contratos/pdf/linhasIndex.js'
import { gerarPdfBlob, downloadPdf, nomeArquivoContrato } from '../../lib/contratos/pdf/gerarContratoPdf.js'
import './ContratosEmerdog.css'

const TOAST_DURATION_MS = 20000

const clinicaInicial = {
    cnpj: '',
    razaoSocial: '',
    crmv: '',
    email: '',
    contatoAgendamento: '',
    enderecoCompleto: '',
}

const volanteInicial = {
    docTipo: 'cnpj',
    cnpj: '',
    cpf: '',
    razaoSocial: '',
    nomeCompleto: '',
    modeloAtendimento: 'Domiciliar',
    especialidade: '',
    crmv: '',
    email: '',
    contatoAgendamento: '',
    enderecoCompleto: '',
}

const parceriaInicial = {
    cnpj: '',
    razaoSocial: '',
    enderecoCompleto: '',
    responsavelLegal: '',
    emailResponsavel: '',
    contatoResponsavel: '',
}

const ContratosEmerdog = () => {
    const [tipo, setTipo] = useState('clinicas')
    const tipoRef = useRef(tipo)
    tipoRef.current = tipo
    const [clinica, setClinica] = useState(clinicaInicial)
    const [volante, setVolante] = useState(volanteInicial)
    const [parceria, setParceria] = useState(parceriaInicial)

    const [cnpjLoading, setCnpjLoading] = useState(false)
    const [toast, setToast] = useState(null)

    const [previewAberto, setPreviewAberto] = useState(false)
    const [previewTexto, setPreviewTexto] = useState('')

    const pushToast = useCallback((variant, title, body) => {
        setToast({ variant, title, body: String(body || '').trim() || '—' })
    }, [])

    useEffect(() => {
        if (!toast) return undefined
        const id = setTimeout(() => setToast(null), TOAST_DURATION_MS)
        return () => clearTimeout(id)
    }, [toast])

    const getPayload = useCallback(() => {
        if (tipo === 'clinicas') return { ...clinica }
        if (tipo === 'parceria') return { ...parceria }
        return { ...volante }
    }, [tipo, clinica, parceria, volante])

    useEffect(() => {
        let digits = ''
        if (tipo === 'clinicas') digits = apenasDigitos(clinica.cnpj)
        else if (tipo === 'parceria') digits = apenasDigitos(parceria.cnpj)
        else if (tipo === 'volantes' && volante.docTipo === 'cnpj') digits = apenasDigitos(volante.cnpj)

        if (digits.length !== 14) {
            setCnpjLoading(false)
            return undefined
        }

        let alive = true
        const tipoSnapshot = tipo

        const t = setTimeout(async () => {
            setCnpjLoading(true)
            try {
                const data = await buscarDadosCNPJ(digits)
                if (!alive || tipoRef.current !== tipoSnapshot) return
                if (tipoSnapshot === 'clinicas') {
                    setClinica((p) => {
                        if (apenasDigitos(p.cnpj) !== digits) return p
                        return {
                            ...p,
                            razaoSocial: data.razaoSocial || p.razaoSocial,
                            enderecoCompleto: data.enderecoCompleto || p.enderecoCompleto,
                        }
                    })
                } else if (tipoSnapshot === 'parceria') {
                    setParceria((p) => {
                        if (apenasDigitos(p.cnpj) !== digits) return p
                        return {
                            ...p,
                            razaoSocial: data.razaoSocial || p.razaoSocial,
                            enderecoCompleto: data.enderecoCompleto || p.enderecoCompleto,
                        }
                    })
                } else if (tipoSnapshot === 'volantes') {
                    setVolante((p) => {
                        if (p.docTipo !== 'cnpj' || apenasDigitos(p.cnpj) !== digits) return p
                        return {
                            ...p,
                            razaoSocial: data.razaoSocial || p.razaoSocial,
                            enderecoCompleto: data.enderecoCompleto || p.enderecoCompleto,
                        }
                    })
                }
            } catch (e) {
                if (alive && tipoRef.current === tipoSnapshot) {
                    pushToast('error', 'Consulta CNPJ', e?.message || 'Erro ao consultar CNPJ.')
                }
            } finally {
                if (alive) setCnpjLoading(false)
            }
        }, 480)

        return () => {
            alive = false
            clearTimeout(t)
        }
    }, [tipo, clinica.cnpj, parceria.cnpj, volante.cnpj, volante.docTipo, pushToast])

    const limpar = () => {
        setClinica(clinicaInicial)
        setVolante(volanteInicial)
        setParceria(parceriaInicial)
        setToast(null)
        setPreviewAberto(false)
    }

    const abrirPrevia = () => {
        const dados = getPayload()
        const erros = errosValidacao(tipo, dados)
        if (erros.length) {
            pushToast('error', 'Corrija os campos', erros.map((msg) => `• ${msg}`).join('\n'))
            return
        }
        setPreviewTexto(linhasParaTextoPreview(getLinhas(tipo, dados)))
        setPreviewAberto(true)
    }

    const gerarPdfFinal = () => {
        const dados = getPayload()
        const erros = errosValidacao(tipo, dados)
        if (erros.length) {
            pushToast('error', 'Corrija os campos', erros.map((msg) => `• ${msg}`).join('\n'))
            setPreviewAberto(false)
            return
        }
        try {
            const blob = gerarPdfBlob(tipo, dados)
            const nome = nomeArquivoContrato(tipo, dados)
            downloadPdf(blob, nome)
        } catch (e) {
            pushToast('error', 'PDF', e?.message || 'Falha ao gerar o PDF.')
        }
        setPreviewAberto(false)
    }

    const onChangeCnpjClinica = (e) => {
        setClinica((p) => ({ ...p, cnpj: maskCNPJ(e.target.value) }))
    }

    const onChangeCnpjParceria = (e) => {
        setParceria((p) => ({ ...p, cnpj: maskCNPJ(e.target.value) }))
    }

    const onChangeCnpjVolante = (e) => {
        setVolante((p) => ({ ...p, cnpj: maskCNPJ(e.target.value) }))
    }

    const onChangeCpfVolante = (e) => {
        setVolante((p) => ({ ...p, cpf: maskCPF(e.target.value) }))
    }

    return (
        <div className="contratos_emerdog">
            <h1>Contratos — Emerdog Plano de Saúde Animal</h1>
            <p className="contratos_emerdog_sub">Gere minutas em PDF com base nos modelos contratuais. Campos com * são obrigatórios.</p>

            <div className="contratos_tabs" role="tablist" aria-label="Tipo de contrato">
                <button
                    type="button"
                    role="tab"
                    aria-selected={tipo === 'clinicas'}
                    className={`contratos_tab${tipo === 'clinicas' ? ' is-active' : ''}`}
                    onClick={() => setTipo('clinicas')}
                >
                    Clínicas e Consultórios
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={tipo === 'volantes'}
                    className={`contratos_tab${tipo === 'volantes' ? ' is-active' : ''}`}
                    onClick={() => setTipo('volantes')}
                >
                    Veterinários Volantes
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={tipo === 'parceria'}
                    className={`contratos_tab${tipo === 'parceria' ? ' is-active' : ''}`}
                    onClick={() => setTipo('parceria')}
                >
                    Parceria Descontos
                </button>
            </div>

            <div className="contratos_card">
                {tipo === 'clinicas' && (
                    <div className="contratos_grid">
                        <div className="contratos_field">
                            <label className="contratos_field_req" htmlFor="ce-cnpj">
                                CNPJ (contratada)
                            </label>
                            <div className="contratos_cnpj_row">
                                <input
                                    id="ce-cnpj"
                                    className="contratos_input"
                                    value={clinica.cnpj}
                                    onChange={onChangeCnpjClinica}
                                    placeholder="00.000.000/0000-00"
                                    autoComplete="off"
                                />
                                {cnpjLoading && <span className="contratos_spinner" aria-hidden />}
                            </div>
                        </div>
                        <div className="contratos_field">
                            <label className="contratos_field_req" htmlFor="ce-razao">
                                Razão social
                            </label>
                            <input
                                id="ce-razao"
                                className="contratos_input"
                                value={clinica.razaoSocial}
                                onChange={(e) => setClinica((p) => ({ ...p, razaoSocial: e.target.value }))}
                            />
                        </div>
                        <div className="contratos_field">
                            <label className="contratos_field_req" htmlFor="ce-crmv">
                                CRMV
                            </label>
                            <input
                                id="ce-crmv"
                                className="contratos_input"
                                value={clinica.crmv}
                                onChange={(e) => setClinica((p) => ({ ...p, crmv: e.target.value }))}
                            />
                        </div>
                        <div className="contratos_field">
                            <label className="contratos_field_req" htmlFor="ce-email">
                                E-mail
                            </label>
                            <input
                                id="ce-email"
                                type="email"
                                className="contratos_input"
                                value={clinica.email}
                                onChange={(e) => setClinica((p) => ({ ...p, email: e.target.value }))}
                            />
                        </div>
                        <div className="contratos_field">
                            <label className="contratos_field_req" htmlFor="ce-contato">
                                Contato para agendamento
                            </label>
                            <input
                                id="ce-contato"
                                className="contratos_input"
                                value={clinica.contatoAgendamento}
                                onChange={(e) => setClinica((p) => ({ ...p, contatoAgendamento: e.target.value }))}
                            />
                        </div>
                        <div className="contratos_field" style={{ gridColumn: '1 / -1' }}>
                            <label className="contratos_field_req" htmlFor="ce-end">
                                Endereço completo
                            </label>
                            <textarea
                                id="ce-end"
                                className="contratos_textarea"
                                value={clinica.enderecoCompleto}
                                onChange={(e) => setClinica((p) => ({ ...p, enderecoCompleto: e.target.value }))}
                            />
                        </div>
                    </div>
                )}

                {tipo === 'volantes' && (
                    <div>
                        <div className="contratos_radio_row">
                            <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>Documento:</span>
                            <label>
                                <input
                                    type="radio"
                                    name="doc-vol"
                                    checked={volante.docTipo === 'cnpj'}
                                    onChange={() => setVolante((p) => ({ ...p, docTipo: 'cnpj' }))}
                                />
                                CNPJ
                            </label>
                            <label>
                                <input
                                    type="radio"
                                    name="doc-vol"
                                    checked={volante.docTipo === 'cpf'}
                                    onChange={() => setVolante((p) => ({ ...p, docTipo: 'cpf' }))}
                                />
                                CPF
                            </label>
                        </div>
                        <div className="contratos_grid">
                            {volante.docTipo === 'cnpj' ? (
                                <div className="contratos_field">
                                    <label className="contratos_field_req" htmlFor="ve-cnpj">
                                        CNPJ
                                    </label>
                                    <div className="contratos_cnpj_row">
                                        <input
                                            id="ve-cnpj"
                                            className="contratos_input"
                                            value={volante.cnpj}
                                            onChange={onChangeCnpjVolante}
                                            placeholder="00.000.000/0000-00"
                                        />
                                        {cnpjLoading && <span className="contratos_spinner" aria-hidden />}
                                    </div>
                                </div>
                            ) : (
                                <div className="contratos_field">
                                    <label className="contratos_field_req" htmlFor="ve-cpf">
                                        CPF
                                    </label>
                                    <input
                                        id="ve-cpf"
                                        className="contratos_input"
                                        value={volante.cpf}
                                        onChange={onChangeCpfVolante}
                                        placeholder="000.000.000-00"
                                    />
                                </div>
                            )}
                            {volante.docTipo === 'cnpj' ? (
                                <div className="contratos_field">
                                    <label className="contratos_field_req" htmlFor="ve-razao">
                                        Razão social
                                    </label>
                                    <input
                                        id="ve-razao"
                                        className="contratos_input"
                                        value={volante.razaoSocial}
                                        onChange={(e) => setVolante((p) => ({ ...p, razaoSocial: e.target.value }))}
                                    />
                                </div>
                            ) : (
                                <div className="contratos_field">
                                    <label className="contratos_field_req" htmlFor="ve-nome">
                                        Nome completo
                                    </label>
                                    <input
                                        id="ve-nome"
                                        className="contratos_input"
                                        value={volante.nomeCompleto}
                                        onChange={(e) => setVolante((p) => ({ ...p, nomeCompleto: e.target.value }))}
                                    />
                                </div>
                            )}
                            <div className="contratos_field">
                                <label className="contratos_field_req" htmlFor="ve-mod">
                                    Modelo de atendimento
                                </label>
                                <select
                                    id="ve-mod"
                                    className="contratos_select"
                                    value={volante.modeloAtendimento}
                                    onChange={(e) => setVolante((p) => ({ ...p, modeloAtendimento: e.target.value }))}
                                >
                                    <option value="Domiciliar">Domiciliar</option>
                                    <option value="Volante">Volante</option>
                                </select>
                            </div>
                            <div className="contratos_field">
                                <label className="contratos_field_req" htmlFor="ve-esp">
                                    Especialidade
                                </label>
                                <input
                                    id="ve-esp"
                                    className="contratos_input"
                                    value={volante.especialidade}
                                    onChange={(e) => setVolante((p) => ({ ...p, especialidade: e.target.value }))}
                                />
                            </div>
                            <div className="contratos_field">
                                <label className="contratos_field_req" htmlFor="ve-crmv">
                                    CRMV
                                </label>
                                <input
                                    id="ve-crmv"
                                    className="contratos_input"
                                    value={volante.crmv}
                                    onChange={(e) => setVolante((p) => ({ ...p, crmv: e.target.value }))}
                                />
                            </div>
                            <div className="contratos_field">
                                <label className="contratos_field_req" htmlFor="ve-email">
                                    E-mail
                                </label>
                                <input
                                    id="ve-email"
                                    type="email"
                                    className="contratos_input"
                                    value={volante.email}
                                    onChange={(e) => setVolante((p) => ({ ...p, email: e.target.value }))}
                                />
                            </div>
                            <div className="contratos_field">
                                <label className="contratos_field_req" htmlFor="ve-contato">
                                    Contato para agendamento
                                </label>
                                <input
                                    id="ve-contato"
                                    className="contratos_input"
                                    value={volante.contatoAgendamento}
                                    onChange={(e) => setVolante((p) => ({ ...p, contatoAgendamento: e.target.value }))}
                                />
                            </div>
                            <div className="contratos_field" style={{ gridColumn: '1 / -1' }}>
                                <label className="contratos_field_req" htmlFor="ve-end">
                                    Endereço completo
                                </label>
                                <textarea
                                    id="ve-end"
                                    className="contratos_textarea"
                                    value={volante.enderecoCompleto}
                                    onChange={(e) => setVolante((p) => ({ ...p, enderecoCompleto: e.target.value }))}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {tipo === 'parceria' && (
                    <div className="contratos_grid">
                        <div className="contratos_field">
                            <label className="contratos_field_req" htmlFor="pe-cnpj">
                                CNPJ
                            </label>
                            <div className="contratos_cnpj_row">
                                <input
                                    id="pe-cnpj"
                                    className="contratos_input"
                                    value={parceria.cnpj}
                                    onChange={onChangeCnpjParceria}
                                    placeholder="00.000.000/0000-00"
                                />
                                {cnpjLoading && <span className="contratos_spinner" aria-hidden />}
                            </div>
                        </div>
                        <div className="contratos_field">
                            <label className="contratos_field_req" htmlFor="pe-razao">
                                Razão social
                            </label>
                            <input
                                id="pe-razao"
                                className="contratos_input"
                                value={parceria.razaoSocial}
                                onChange={(e) => setParceria((p) => ({ ...p, razaoSocial: e.target.value }))}
                            />
                        </div>
                        <div className="contratos_field" style={{ gridColumn: '1 / -1' }}>
                            <label className="contratos_field_req" htmlFor="pe-end">
                                Endereço
                            </label>
                            <textarea
                                id="pe-end"
                                className="contratos_textarea"
                                value={parceria.enderecoCompleto}
                                onChange={(e) => setParceria((p) => ({ ...p, enderecoCompleto: e.target.value }))}
                            />
                        </div>
                        <div className="contratos_field">
                            <label className="contratos_field_req" htmlFor="pe-resp">
                                Responsável legal
                            </label>
                            <input
                                id="pe-resp"
                                className="contratos_input"
                                value={parceria.responsavelLegal}
                                onChange={(e) => setParceria((p) => ({ ...p, responsavelLegal: e.target.value }))}
                            />
                        </div>
                        <div className="contratos_field">
                            <label className="contratos_field_req" htmlFor="pe-email">
                                E-mail do responsável
                            </label>
                            <input
                                id="pe-email"
                                type="email"
                                className="contratos_input"
                                value={parceria.emailResponsavel}
                                onChange={(e) => setParceria((p) => ({ ...p, emailResponsavel: e.target.value }))}
                            />
                        </div>
                        <div className="contratos_field">
                            <label className="contratos_field_req" htmlFor="pe-tel">
                                Contato do responsável
                            </label>
                            <input
                                id="pe-tel"
                                className="contratos_input"
                                value={parceria.contatoResponsavel}
                                onChange={(e) => setParceria((p) => ({ ...p, contatoResponsavel: e.target.value }))}
                            />
                        </div>
                    </div>
                )}

                <div className="contratos_actions">
                    <button type="button" className="contratos_btn contratos_btn_secondary" onClick={limpar}>
                        Limpar formulário
                    </button>
                    <button type="button" className="contratos_btn contratos_btn_primary" onClick={abrirPrevia}>
                        Gerar prévia
                    </button>
                    <button type="button" className="contratos_btn contratos_btn_primary" onClick={gerarPdfFinal}>
                        Gerar PDF final
                    </button>
                </div>
            </div>

            <p className="contratos_assets_note">
                Minutas de referência em PDF: <code>src/assets/contratos/</code>. O texto do PDF gerado espelha o conteúdo
                dessas minutas (capítulos e cláusulas); revise juridicamente antes de assinatura. Consulta CNPJ via
                ReceitaWS;.
            </p>

            {toast && (
                <div
                    className={`contratos_toast contratos_toast--${toast.variant}`}
                    role="alert"
                    aria-live="assertive"
                >
                    <div className="contratos_toast_text">
                        <strong>{toast.title}</strong>
                        <span className="contratos_toast_body">{toast.body}</span>
                    </div>
                    <button
                        type="button"
                        className="contratos_toast_close"
                        onClick={() => setToast(null)}
                        aria-label="Fechar aviso"
                    >
                        x
                    </button>
                </div>
            )}

            {previewAberto && (
                <div
                    className="contratos_modal_backdrop"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="contratos-previa-titulo"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setPreviewAberto(false)
                    }}
                >
                    <div className="contratos_modal" onClick={(e) => e.stopPropagation()}>
                        <div id="contratos-previa-titulo" className="contratos_modal_head">
                            Prévia do contrato (texto)
                        </div>
                        <div className="contratos_modal_body">
                            <pre className="contratos_preview_pre">{previewTexto}</pre>
                        </div>
                        <div className="contratos_modal_foot">
                            <button type="button" className="contratos_btn contratos_btn_secondary" onClick={() => setPreviewAberto(false)}>
                                Fechar
                            </button>
                            <button type="button" className="contratos_btn contratos_btn_primary" onClick={gerarPdfFinal}>
                                Baixar PDF final
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default ContratosEmerdog
