import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { buscarEnderecoPorCep } from '../../../lib/viacepClient'
import { setReadOnlyFlag } from '../../../lib/supabase'
import {
    especialidadePermitidaParaPerfil,
    filtrarEspecialidadesPorPerfil,
    montarEspecialidadesIdsFormulario,
} from '../../../lib/formularioPublicoEspecialidades'
import {
    carregarConfigFormularioCredenciamento,
    carregarEspecialidadesFormularioPublico,
    carregarProcedimentosPublicadosFormulario,
    enviarEntradaFormularioCredenciamento,
    documentoCpfCnpjEstaCompleto,
    verificarDocumentoParaEnvioFormulario,
} from '../../../lib/formularioCredenciamento'
import {
    formatarCpfCnpjEntrada,
    normalizarCpfCnpjParaSalvar,
    normalizarChavePixParaSalvar,
    normalizarCrmvParaSalvar,
    normalizarEmailParaSalvar,
} from '../../../lib/prestadorCadastroHelpers'
import FormularioPublicoPassoDados from './FormularioPublicoPassoDados.jsx'
import { responsaveisParaPayload } from '../../../lib/prestadorVeterinarioCadastro.js'
import {
    validarCertificadosConclusaoObrigatorios,
    validarResponsaveisObrigatorios,
} from '../../../lib/prestadorVeterinarioValidacao.js'

/** Reativar quando o fluxo de comércio/petshop estiver liberado no formulário público. */
const FORMULARIO_PUBLICO_COMERCIO_ATIVO = false

const TIPOS_TODOS = [
    { id: 'clinica', label: 'Clínica / Consultório' },
    { id: 'volante', label: 'Veterinário volante' },
    { id: 'comercio', label: 'Comércio / petshop' },
]

const TIPOS = FORMULARIO_PUBLICO_COMERCIO_ATIVO
    ? TIPOS_TODOS
    : TIPOS_TODOS.filter((t) => t.id !== 'comercio')

const normCod = (c) => String(c || '').trim().toUpperCase()

export default function CredenciamentoFormularioPublico() {
    const { slug } = useParams()

    useEffect(() => {
        setReadOnlyFlag(false)
    }, [])
    const [loading, setLoading] = useState(true)
    const [erro, setErro] = useState('')
    const [config, setConfig] = useState(null)
    const [paginas, setPaginas] = useState([])
    const [passo, setPasso] = useState(0)
    const [enviado, setEnviado] = useState(false)

    const [tipoPerfil, setTipoPerfil] = useState('')
    const [cpfCnpj, setCpfCnpj] = useState('')
    const [docOk, setDocOk] = useState(null)
    const [docModo, setDocModo] = useState(null)
    const [verificandoDoc, setVerificandoDoc] = useState(false)
    const [nome, setNome] = useState('')
    const [telefone, setTelefone] = useState('')
    const [celular, setCelular] = useState('')
    const [email, setEmail] = useState('')
    const [cep, setCep] = useState('')
    const [endereco, setEndereco] = useState({
        logradouro: '',
        numero: '',
        complemento: '',
        bairro: '',
        cidade: '',
        uf: '',
        pais: 'Brasil',
    })
    const [tipoPix, setTipoPix] = useState('')
    const [chavePix, setChavePix] = useState('')
    const [tipoRepasse, setTipoRepasse] = useState('')

    const [procsPorPagina, setProcsPorPagina] = useState({})
    const [codigosSelecionados, setCodigosSelecionados] = useState(() => new Set())
    const [enviando, setEnviando] = useState(false)
    const [cepLoading, setCepLoading] = useState(false)
    const ultimoCepBuscadoRef = useRef('')
    const [crmv, setCrmv] = useState('')
    const [cidadesAtende, setCidadesAtende] = useState([])
    const [vetsPendentes, setVetsPendentes] = useState([])
    const [certificadosPendentes, setCertificadosPendentes] = useState([])
    const [responsaveis, setResponsaveis] = useState([])
    const [erroCertificados, setErroCertificados] = useState('')
    const [especialidades, setEspecialidades] = useState([])
    const [especialidadePrincipalId, setEspecialidadePrincipalId] = useState('')
    const [especialidadesSecundariasIds, setEspecialidadesSecundariasIds] = useState([])

    const especialidadesFiltradas = useMemo(
        () => filtrarEspecialidadesPorPerfil(especialidades, tipoPerfil),
        [especialidades, tipoPerfil],
    )

    const especialidadesIds = useMemo(
        () => montarEspecialidadesIdsFormulario(especialidadePrincipalId, especialidadesSecundariasIds),
        [especialidadePrincipalId, especialidadesSecundariasIds],
    )

    const passosServico = useMemo(() => paginas.filter((p) => p.categorias.length > 0), [paginas])
    const totalPassos = useMemo(() => 2 + passosServico.length, [passosServico.length])
    const indicePassoServico = passo - 2
    const paginaServicoAtual = passosServico[indicePassoServico] || null

    const gruposProcedimentosPagina = useMemo(() => {
        if (!paginaServicoAtual) return []
        const procs = procsPorPagina[paginaServicoAtual.id] || []
        return paginaServicoAtual.categorias
            .map((cat) => ({
                categoriaId: cat.categoriaId,
                nome: cat.nome,
                itens: procs
                    .filter((p) => Number(p.categoria_id) === Number(cat.categoriaId))
                    .sort((a, b) =>
                        String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', {
                            sensitivity: 'base',
                        }),
                    ),
            }))
            .filter((g) => g.itens.length > 0)
    }, [paginaServicoAtual, procsPorPagina])

    useEffect(() => {
        let cancelado = false
        carregarEspecialidadesFormularioPublico()
            .then((lista) => {
                if (!cancelado) setEspecialidades(lista)
            })
            .catch((e) => {
                if (!cancelado) {
                    console.error(e)
                    setErro((prev) => prev || 'Não foi possível carregar a lista de especialidades. Tente recarregar a página.')
                }
            })
        return () => {
            cancelado = true
        }
    }, [])

    useEffect(() => {
        if (
            especialidadePrincipalId &&
            !especialidadePermitidaParaPerfil(tipoPerfil, especialidadePrincipalId, especialidades)
        ) {
            setEspecialidadePrincipalId('')
        }
        setEspecialidadesSecundariasIds((prev) =>
            prev.filter((id) => especialidadePermitidaParaPerfil(tipoPerfil, id, especialidades)),
        )
    }, [tipoPerfil, especialidadePrincipalId, especialidades])

    useEffect(() => {
        if (passo === 1) {
            setDocOk(null)
            setVerificandoDoc(false)
        }
    }, [passo])

    const perfilComCertificadosResponsaveis = Boolean(tipoPerfil)

    useEffect(() => {
        const run = async () => {
            setLoading(true)
            setErro('')
            try {
                const pack = await carregarConfigFormularioCredenciamento()
                if (!pack.config?.ativo) {
                    setErro('Este formulário não está disponível no momento.')
                    return
                }
                if (slug && pack.config.slug && pack.config.slug !== slug) {
                    setErro('Formulário não encontrado.')
                    return
                }
                setConfig(pack.config)
                setPaginas(pack.paginas)

                try {
                    const esps = await carregarEspecialidadesFormularioPublico()
                    setEspecialidades(esps)
                } catch (errEsp) {
                    console.error(errEsp)
                    setErro(
                        (prev) =>
                            prev ||
                            'Não foi possível carregar a lista de especialidades. Confirme o script SQL credenciamento_listar_especialidades no Supabase.',
                    )
                }

                const mapa = {}
                for (const p of pack.paginas) {
                    const ids = p.categorias.map((c) => c.categoriaId)
                    if (!ids.length) {
                        mapa[p.id] = []
                        continue
                    }
                    mapa[p.id] = await carregarProcedimentosPublicadosFormulario(ids)
                }
                setProcsPorPagina(mapa)
            } catch (e) {
                setErro(e?.message || String(e))
            } finally {
                setLoading(false)
            }
        }
        void run()
    }, [slug])

    const verificarDoc = async () => {
        if (!documentoCpfCnpjEstaCompleto(cpfCnpj)) {
            setVerificandoDoc(false)
            setDocOk(null)
            return false
        }
        setVerificandoDoc(true)
        setDocOk(null)
        setDocModo(null)
        const r = await verificarDocumentoParaEnvioFormulario(cpfCnpj)
        setVerificandoDoc(false)
        if (r.ok) {
            setDocOk(true)
            setDocModo(r.modo || 'novo')
            setErro('')
            return true
        }
        if (r.motivo === 'duplicado' || r.motivo === 'entrada_pendente') {
            setDocOk(false)
            setDocModo(null)
            setErro(r.erro || '')
            return false
        }
        setDocOk(null)
        if (r.motivo === 'erro' && r.erro) setErro(r.erro)
        return false
    }

    const aplicarEnderecoCep = useCallback((r) => {
        setEndereco((e) => ({
            ...e,
            logradouro: r.logradouro || e.logradouro,
            bairro: r.bairro || e.bairro,
            cidade: r.cidade || e.cidade,
            uf: r.uf || e.uf,
            pais: r.pais || e.pais || 'Brasil',
            complemento: e.complemento || r.complemento || '',
        }))
        if (r.cep) setCep(r.cep)
    }, [])

    const buscarCepPorDigitos = useCallback(async (digits) => {
        if (digits.length !== 8) return
        if (ultimoCepBuscadoRef.current === digits) return
        ultimoCepBuscadoRef.current = digits
        setCepLoading(true)
        setErro('')
        try {
            const r = await buscarEnderecoPorCep(digits)
            aplicarEnderecoCep(r)
        } catch (e) {
            ultimoCepBuscadoRef.current = ''
            setErro(e?.message || 'CEP não encontrado.')
        } finally {
            setCepLoading(false)
        }
    }, [aplicarEnderecoCep])

    const buscarCep = async () => {
        const digits = String(cep || '').replace(/\D/g, '')
        await buscarCepPorDigitos(digits)
    }

    useEffect(() => {
        const digits = String(cep || '').replace(/\D/g, '')
        if (digits.length < 8) {
            ultimoCepBuscadoRef.current = ''
            return
        }
        void buscarCepPorDigitos(digits)
    }, [cep, buscarCepPorDigitos])

    const onCepChange = (valor) => {
        const digits = String(valor || '').replace(/\D/g, '').slice(0, 8)
        if (digits.length <= 5) {
            setCep(digits)
            return
        }
        setCep(`${digits.slice(0, 5)}-${digits.slice(5)}`)
    }

    const validarCertificadosResponsaveis = () => {
        const errCert = validarCertificadosConclusaoObrigatorios({ pendentes: certificadosPendentes })
        if (errCert) {
            setErroCertificados(errCert)
            setErro(errCert)
            return false
        }
        setErroCertificados('')
        const errResp = validarResponsaveisObrigatorios(responsaveis)
        if (errResp) {
            setErro(errResp)
            return false
        }
        return true
    }

    const avancar = async () => {
        setErro('')
        if (passo === 0) {
            if (!tipoPerfil) {
                setErro('Selecione o tipo de cadastro.')
                return
            }
            if (!FORMULARIO_PUBLICO_COMERCIO_ATIVO && tipoPerfil === 'comercio') {
                setErro('O cadastro para comércio / petshop não está disponível no momento.')
                setTipoPerfil('')
                return
            }
            setPasso(1)
            return
        }
        if (passo === 1) {
            if (!nome.trim()) {
                setErro('Informe o nome.')
                return
            }
            if (!especialidadePrincipalId) {
                setErro('Selecione a especialidade principal.')
                return
            }
            if (tipoPerfil === 'volante' || tipoPerfil === 'clinica') {
                if (!normalizarCrmvParaSalvar(crmv)) {
                    setErro('Informe o CRMV.')
                    return
                }
            }
            if (tipoPerfil === 'volante') {
                if (!cidadesAtende.length) {
                    setErro('Inclua pelo menos uma cidade em que você atende.')
                    return
                }
            }
            if (tipoPerfil === 'clinica') {
                for (const v of vetsPendentes) {
                    if (!String(v.nome || '').trim()) {
                        setErro('Há veterinário sem nome na lista.')
                        return
                    }
                    if (!normalizarCrmvParaSalvar(v.crmv)) {
                        setErro(`Informe o CRMV do veterinário ${v.nome}.`)
                        return
                    }
                    const espV = v.especialidades_ids?.length
                        ? v.especialidades_ids
                        : v.especialidade_id
                          ? [v.especialidade_id]
                          : []
                    if (!espV.length) {
                        setErro(`Selecione a especialidade do veterinário ${v.nome}.`)
                        return
                    }
                }
            }
            if (perfilComCertificadosResponsaveis && !validarCertificadosResponsaveis()) {
                return
            }
            if (!documentoCpfCnpjEstaCompleto(cpfCnpj)) {
                setErro('Informe um CPF ou CNPJ válido e completo.')
                return
            }
            const ok = await verificarDoc()
            if (!ok) return
            if (passosServico.length === 0) {
                await enviar()
                return
            }
            setPasso(2)
            return
        }
        if (passo < totalPassos - 1) {
            setPasso((p) => p + 1)
            return
        }
        await enviar()
    }

    const voltar = () => {
        setErro('')
        if (passo > 0) setPasso((p) => p - 1)
    }

    const toggleCodigo = (cod) => {
        const c = normCod(cod)
        setCodigosSelecionados((prev) => {
            const next = new Set(prev)
            if (next.has(c)) next.delete(c)
            else next.add(c)
            return next
        })
    }

    const enviar = async () => {
        setEnviando(true)
        setErro('')
        try {
            if (perfilComCertificadosResponsaveis && !validarCertificadosResponsaveis()) {
                setEnviando(false)
                return
            }
            const ok = await verificarDocumentoParaEnvioFormulario(cpfCnpj)
            if (!ok.ok) throw new Error(ok.erro)
            if (ok.modo) setDocModo(ok.modo)

            const payload = {
                nome: nome.trim(),
                telefone: telefone.trim(),
                celular: celular.trim(),
                email: normalizarEmailParaSalvar(email),
                cep: String(cep || '').replace(/\D/g, ''),
                endereco,
                procedimentos: [...codigosSelecionados],
                especialidades_ids: [...especialidadesIds],
                tipo_pix: tipoPix,
                chave_pix: normalizarChavePixParaSalvar(chavePix, tipoPix),
                tipo_repasse: tipoRepasse || null,
            }
            if (tipoPerfil === 'volante' || tipoPerfil === 'clinica') {
                payload.crmv = normalizarCrmvParaSalvar(crmv)
            }
            if (tipoPerfil === 'volante') {
                payload.cidadesAtende = cidadesAtende.map((c) => ({
                    cidadeId: c.cidadeId,
                    nome: c.nome,
                    uf: c.uf,
                }))
            }
            if (perfilComCertificadosResponsaveis) {
                payload.responsaveis = responsaveisParaPayload(responsaveis)
            }
            if (tipoPerfil === 'clinica') {
                payload.vetsPendentes = vetsPendentes.map((v) => ({
                    nome: String(v.nome || '').trim(),
                    crmv: normalizarCrmvParaSalvar(v.crmv),
                    especialidades_ids: v.especialidades_ids?.length
                        ? v.especialidades_ids.map(Number)
                        : v.especialidade_id
                          ? [Number(v.especialidade_id)]
                          : [],
                }))
            }
            await enviarEntradaFormularioCredenciamento({
                cpfCnpj,
                tipoPerfil,
                payload,
                certificadosFiles: perfilComCertificadosResponsaveis
                    ? certificadosPendentes.map((p) => p.file).filter(Boolean)
                    : [],
            })
            setEnviado(true)
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setEnviando(false)
        }
    }

    if (enviado) {
        return (
            <div className="el-page fcred_public_wrap fcred_public_page">
                <header className="mb-5">
                    <p className="mb-1 text-xs font-bold uppercase tracking-wider text-brand">EmerLAB</p>
                    <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink dark:text-[#e8f1f8] md:text-3xl">
                        Solicitação enviada
                    </h1>
                </header>
                <div className="fcred_public_card">
                    <h2 className="font-display text-xl font-bold text-ink dark:text-[#e8f1f8]">
                        Solicitação enviada com sucesso!
                    </h2>
                    <p>
                        {docModo === 'atualizacao'
                            ? 'Recebemos sua atualização. Nossa equipe revisará e aplicará ao seu cadastro de credenciado em breve.'
                            : 'Recebemos seus dados. Em breve, nossa equipe da Emerdog entrará em contato para concluir o credenciamento.'}
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="el-page fcred_public_wrap fcred_public_page">
            <header className="mb-5">
                <p className="mb-1 text-xs font-bold uppercase tracking-wider text-brand">EmerLAB</p>
                <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink dark:text-[#e8f1f8] md:text-3xl">
                    {config?.titulo || 'Cadastro de parceiros'}
                </h1>
            </header>
            <div className="fcred_public_card">
                <header className="fcred_public_header">
                    <p className="fcred_public_step">
                        Passo {passo + 1} de {totalPassos}
                    </p>
                </header>

                {loading && <p>Carregando formulário…</p>}
                {erro && <p className="fcred_public_erro">{erro}</p>}

                {!loading && !erro && passo === 0 && (
                    <section>
                        <p className="fcred_public_lead">Você é / possui:</p>
                        <div className="fcred_tipo_grid">
                            {TIPOS.map((t) => (
                                <button
                                    key={t.id}
                                    type="button"
                                    className={`fcred_tipo_btn ${tipoPerfil === t.id ? 'is-on' : ''}`}
                                    onClick={() => {
                                        setTipoPerfil(t.id)
                                        setCrmv('')
                                        setCidadesAtende([])
                                        setVetsPendentes([])
                                        setCertificadosPendentes([])
                                        setResponsaveis([])
                                        setEspecialidadePrincipalId('')
                                        setEspecialidadesSecundariasIds([])
                                        setTipoPix('')
                                        setChavePix('')
                                        setTipoRepasse('')
                                    }}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>
                    </section>
                )}

                {!loading && passo === 1 && tipoPerfil && (
                    <FormularioPublicoPassoDados
                        tipoPerfil={tipoPerfil}
                        cpfCnpj={cpfCnpj}
                        setCpfCnpj={(v) => {
                            setCpfCnpj(formatarCpfCnpjEntrada(v))
                            setDocOk(null)
                            setDocModo(null)
                        }}
                        docOk={docOk}
                        docModo={docModo}
                        verificandoDoc={verificandoDoc}
                        onVerificarDoc={verificarDoc}
                        nome={nome}
                        setNome={setNome}
                        telefone={telefone}
                        setTelefone={setTelefone}
                        celular={celular}
                        setCelular={setCelular}
                        email={email}
                        setEmail={setEmail}
                        crmv={crmv}
                        setCrmv={setCrmv}
                        especialidadesFiltradas={especialidadesFiltradas}
                        especialidadePrincipalId={especialidadePrincipalId}
                        setEspecialidadePrincipalId={setEspecialidadePrincipalId}
                        especialidadesSecundariasIds={especialidadesSecundariasIds}
                        setEspecialidadesSecundariasIds={setEspecialidadesSecundariasIds}
                        tipoPix={tipoPix}
                        setTipoPix={setTipoPix}
                        chavePix={chavePix}
                        setChavePix={setChavePix}
                        tipoRepasse={tipoRepasse}
                        setTipoRepasse={setTipoRepasse}
                        cep={cep}
                        onCepChange={onCepChange}
                        cepLoading={cepLoading}
                        onBuscarCep={buscarCep}
                        endereco={endereco}
                        setEndereco={setEndereco}
                        especialidades={especialidades}
                        cidadesAtende={cidadesAtende}
                        onCidadesAtendeChange={setCidadesAtende}
                        vetsPendentes={vetsPendentes}
                        onVetsPendentesChange={setVetsPendentes}
                        certificadosPendentes={certificadosPendentes}
                        onCertificadosPendentesChange={setCertificadosPendentes}
                        responsaveis={responsaveis}
                        onResponsaveisChange={setResponsaveis}
                        erroCertificados={erroCertificados}
                        onErroCertificados={setErroCertificados}
                    />
                )}

                {!loading && passo >= 2 && indicePassoServico >= 0 && indicePassoServico < passosServico.length && (
                    <section>
                        <p className="fcred_aviso_terceiros">
                            Se algum serviço for <strong>terceirizado</strong>, não marque aqui — informe depois no
                            WhatsApp da Emerdog.
                        </p>
                        <h2 className="fcred_pagina_titulo">{paginaServicoAtual?.titulo}</h2>
                        <div className="fcred_proc_pagina">
                            {gruposProcedimentosPagina.map((grupo) => (
                                <div key={grupo.categoriaId} className="fcred_proc_grupo">
                                    <h3 className="fcred_proc_categoria_tit">{grupo.nome}</h3>
                                    <div className="fcred_proc_list">
                                        {grupo.itens.map((p) => {
                                            const cod = normCod(p.codigo)
                                            const marcado = codigosSelecionados.has(cod)
                                            return (
                                                <label
                                                    key={cod}
                                                    className={`fcred_proc_item ${marcado ? 'is-on' : ''}`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={marcado}
                                                        onChange={() => toggleCodigo(cod)}
                                                    />
                                                    <span className="fcred_proc_nome">{p.nome}</span>
                                                </label>
                                            )
                                        })}
                                    </div>
                                </div>
                            ))}
                            {gruposProcedimentosPagina.length === 0 && (
                                <p className="fcred_public_muted">
                                    Nenhum procedimento publicado nestas categorias. Marque «Formulário» na
                                    Super-Tabela › Procedimentos.
                                </p>
                            )}
                        </div>
                    </section>
                )}

                {!loading && (
                    <footer className="fcred_public_nav">
                        <button type="button" className="fcred_btn secondary" disabled={passo === 0} onClick={voltar}>
                            Voltar
                        </button>
                        <button
                            type="button"
                            className="fcred_btn"
                            disabled={enviando}
                            onClick={() => void avancar()}
                        >
                            {passo >= totalPassos - 1 ? (enviando ? 'A enviar…' : 'Enviar') : 'Continuar'}
                        </button>
                    </footer>
                )}
            </div>
        </div>
    )
}
