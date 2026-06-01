import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { buscarEnderecoPorCep } from '../../../lib/viacepClient'
import { supabase } from '../../../lib/supabase'
import {
    especialidadePermitidaParaPerfil,
    filtrarEspecialidadesPorPerfil,
    montarEspecialidadesIdsFormulario,
} from '../../../lib/formularioPublicoEspecialidades'
import {
    carregarConfigFormularioCredenciamento,
    carregarProcedimentosPublicadosFormulario,
    enviarEntradaFormularioCredenciamento,
    documentoCpfCnpjEstaCompleto,
    verificarDocumentoDisponivel,
} from '../../../lib/formularioCredenciamento'
import {
    formatarCpfCnpjEntrada,
    normalizarCpfCnpjParaSalvar,
    normalizarChavePixParaSalvar,
    normalizarCrmvParaSalvar,
    normalizarEmailParaSalvar,
} from '../../../lib/prestadorCadastroHelpers'
import FormularioPublicoPassoDados from './FormularioPublicoPassoDados.jsx'

const TIPOS = [
    { id: 'clinica', label: 'Clínica / Consultório' },
    { id: 'volante', label: 'Veterinário volante' },
    { id: 'comercio', label: 'Comércio / petshop' },
]

const normCod = (c) => String(c || '').trim().toUpperCase()

export default function CredenciamentoFormularioPublico() {
    const { slug } = useParams()
    const [loading, setLoading] = useState(true)
    const [erro, setErro] = useState('')
    const [config, setConfig] = useState(null)
    const [paginas, setPaginas] = useState([])
    const [passo, setPasso] = useState(0)
    const [enviado, setEnviado] = useState(false)

    const [tipoPerfil, setTipoPerfil] = useState('')
    const [cpfCnpj, setCpfCnpj] = useState('')
    const [docOk, setDocOk] = useState(null)
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
    const [crmv, setCrmv] = useState('')
    const [cidadesAtende, setCidadesAtende] = useState([])
    const [vetsPendentes, setVetsPendentes] = useState([])
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
        supabase
            .from('especialidades')
            .select('id, nome, tipo')
            .order('nome')
            .then(({ data }) => setEspecialidades(data || []))
    }, [])

    useEffect(() => {
        if (especialidadePrincipalId && !especialidadePermitidaParaPerfil(tipoPerfil, especialidadePrincipalId)) {
            setEspecialidadePrincipalId('')
        }
        setEspecialidadesSecundariasIds((prev) =>
            prev.filter((id) => especialidadePermitidaParaPerfil(tipoPerfil, id)),
        )
    }, [tipoPerfil, especialidadePrincipalId])

    useEffect(() => {
        if (passo === 1) {
            setDocOk(null)
            setVerificandoDoc(false)
        }
    }, [passo])

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
        const r = await verificarDocumentoDisponivel(cpfCnpj)
        setVerificandoDoc(false)
        if (r.ok) {
            setDocOk(true)
            setErro('')
            return true
        }
        if (r.motivo === 'duplicado') {
            setDocOk(false)
            setErro(r.erro || '')
            return false
        }
        setDocOk(null)
        if (r.motivo === 'erro' && r.erro) setErro(r.erro)
        return false
    }

    const buscarCep = async () => {
        const digits = String(cep || '').replace(/\D/g, '')
        if (digits.length !== 8) return
        try {
            const r = await buscarEnderecoPorCep(digits)
            setEndereco((e) => ({
                ...e,
                logradouro: r.logradouro || e.logradouro,
                bairro: r.bairro || e.bairro,
                cidade: r.localidade || e.cidade,
                uf: r.uf || e.uf,
            }))
        } catch (e) {
            setErro(e?.message || 'CEP não encontrado.')
        }
    }

    const avancar = async () => {
        setErro('')
        if (passo === 0) {
            if (!tipoPerfil) {
                setErro('Selecione o tipo de cadastro.')
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
            const ok = await verificarDocumentoDisponivel(cpfCnpj)
            if (!ok.ok) throw new Error(ok.erro)

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
            <div className="fcred_public_wrap fcred_public_page">
                <div className="fcred_public_card">
                    <h1>Solicitação enviada</h1>
                    <p>Recebemos seus dados. A equipe Emerdog entrará em contacto para concluir o credenciamento.</p>
                </div>
            </div>
        )
    }

    return (
        <div className="fcred_public_wrap fcred_public_page">
            <div className="fcred_public_card">
                <header className="fcred_public_header">
                    <h1>{config?.titulo || 'Cadastro de parceiros'}</h1>
                    <p className="fcred_public_step">
                        Passo {passo + 1} de {totalPassos}
                    </p>
                </header>

                {loading && <p>A carregar formulário…</p>}
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
                        }}
                        docOk={docOk}
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
                        setCep={setCep}
                        onBuscarCep={buscarCep}
                        endereco={endereco}
                        setEndereco={setEndereco}
                        especialidades={especialidades}
                        cidadesAtende={cidadesAtende}
                        onCidadesAtendeChange={setCidadesAtende}
                        vetsPendentes={vetsPendentes}
                        onVetsPendentesChange={setVetsPendentes}
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
