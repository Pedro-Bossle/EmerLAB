import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
    PERMISSION_KEYS,
    getStoredAccessProfile,
    hasPermission,
    useStoredPermission,
} from '../../../lib/accessControl'
import { supabase } from '../../../lib/supabase'
import { buscarEnderecoPorCep } from '../../../lib/viacepClient'
import {
    TIPOS_REPASSE,
    TIPOS_CHAVE_PIX,
    acharSituacaoCredenciadoId,
    formatarCpfCnpjEntrada,
    formatarChavePixEntrada,
    inferirTipoPixDaChave,
    normalizarChavePixParaSalvar,
    normalizarCpfCnpjParaSalvar,
    tipoDocumentoCpfCnpj,
    formatarCrmvEntrada,
    formatarEmailEntrada,
    formatarTelefoneEntrada,
    normalizarCrmvParaSalvar,
    normalizarEmailParaSalvar,
    montarEnderecoUmaLinha,
    tipoEspecialidadePrestador,
} from '../../../lib/prestadorCadastroHelpers'
import ClinicasAtendeInput from './ClinicasAtendeInput.jsx'
import {
    carregarCodigosPrestadorProcedimentos,
    sincronizarPrestadorProcedimentos,
} from '../../../lib/prestadorProcedimentos.js'
import { UFS_BRASIL, buscarMunicipiosPorUf, resolverUfPorNomeMunicipio } from '../../../lib/ibgeLocalidades.js'
import PrestadorServicosAbas from './PrestadorServicosAbas.jsx'
import PrestadorHonorariosContratos from './PrestadorHonorariosContratos.jsx'
import MultiEspecialidadesInput from './MultiEspecialidadesInput.jsx'
import CidadesAtendeVirtualList from './CidadesAtendeVirtualList.jsx'
import VeterinariosVinculados from './VeterinariosVinculados.jsx'
import CredenciamentoDevToolsPerfil from './CredenciamentoDevToolsPerfil.jsx'
import { obterOuCriarCidadeCredenciamento } from '../../../lib/cidadesCredenciamento.js'
import { buscarDadosCNPJ } from '../../../lib/contratos/cnpjBizClient.js'
import { apenasDigitos } from '../../../lib/contratos/validarDocumentos.js'
import '../Credenciamento_main/Credenciamento_main.css'
import './CredenciamentoCadastro.css'

const COLS_PRESTADOR =
    'id, nome, tipo, telefone, celular, email, cpf_cnpj, crmv, cidade_id, endereco, modalidade, especialidade_id, situacao_id, cep, endereco_logradouro, endereco_numero, endereco_complemento, endereco_pais, endereco_uf, endereco_cidade, endereco_bairro, chave_pix, tipo_pix, tipo_repasse, ativo'

const COLS_PRESTADOR_SEM_TIPO_PIX =
    'id, nome, tipo, telefone, celular, email, cpf_cnpj, crmv, cidade_id, endereco, modalidade, especialidade_id, situacao_id, cep, endereco_logradouro, endereco_numero, endereco_complemento, endereco_pais, endereco_uf, endereco_cidade, endereco_bairro, chave_pix, tipo_repasse, ativo'

const ORDEM_CIDADES_STORAGE_PREFIX = 'emerdog_prestador_cidades_ordem_'

function lerOrdemCidadesAtende(prestadorId) {
    try {
        const raw = sessionStorage.getItem(`${ORDEM_CIDADES_STORAGE_PREFIX}${prestadorId}`)
        if (!raw) return null
        const arr = JSON.parse(raw)
        return Array.isArray(arr) ? arr.map(Number).filter(Boolean) : null
    } catch {
        return null
    }
}

function salvarOrdemCidadesAtende(prestadorId, cidades) {
    if (!prestadorId || !cidades?.length) return
    sessionStorage.setItem(
        `${ORDEM_CIDADES_STORAGE_PREFIX}${prestadorId}`,
        JSON.stringify(cidades.map((c) => c.cidadeId)),
    )
}

function ordenarCidadesAtendePorChave(itens, ordemIds) {
    if (!ordemIds?.length) return itens
    const mapa = new Map(itens.map((i) => [Number(i.cidadeId), i]))
    const out = []
    ordemIds.forEach((id) => {
        const item = mapa.get(Number(id))
        if (item) {
            out.push(item)
            mapa.delete(Number(id))
        }
    })
    mapa.forEach((item) => out.push(item))
    return out
}

const estadoVazio = () => ({
    nome: '',
    cpf_cnpj: '',
    situacao_id: '',
    telefone: '',
    celular: '',
    email: '',
    especialidade_id: '',
    crmv: '',
    cep: '',
    endereco_logradouro: '',
    endereco_numero: '',
    endereco_complemento: '',
    endereco_pais: 'Brasil',
    endereco_uf: '',
    endereco_cidade: '',
    endereco_bairro: '',
    chave_pix: '',
    tipo_pix: '',
    tipo_repasse: '',
    modalidade: '',
    cidade_id: '',
})

const CredenciamentoCadastroForm = () => {
    const { id: idParam } = useParams()
    const navigate = useNavigate()
    const isNovo = idParam === 'novo'
    const prestadorId = isNovo ? null : Number(idParam)

    const [loading, setLoading] = useState(!isNovo)
    const [salvando, setSalvando] = useState(false)
    const [erro, setErro] = useState('')
    const [form, setForm] = useState(estadoVazio)
    const [cidades, setCidades] = useState([])
    const [situacoes, setSituacoes] = useState([])
    const [especialidades, setEspecialidades] = useState([])
    const [prestadoresTodos, setPrestadoresTodos] = useState([])
    const [especialidadesSecundariasIds, setEspecialidadesSecundariasIds] = useState([])
    const [cidadesAtende, setCidadesAtende] = useState([])
    const [ufAtende, setUfAtende] = useState('RS')
    const [municipiosUf, setMunicipiosUf] = useState([])
    const [municipioIbgeId, setMunicipioIbgeId] = useState('')
    const [carregandoMunicipios, setCarregandoMunicipios] = useState(false)
    const [vetsVinculados, setVetsVinculados] = useState([])
    const [vetsPendentes, setVetsPendentes] = useState([])
    const [procSelecionados, setProcSelecionados] = useState([])
    const [laboratoriosSolicitacaoIds, setLaboratoriosSolicitacaoIds] = useState([])
    const [atendeEmClinica, setAtendeEmClinica] = useState(false)
    const [estabelecimentosSelecionados, setEstabelecimentosSelecionados] = useState([])
    const [cepLoading, setCepLoading] = useState(false)
    const [secaoMultiplasCidades, setSecaoMultiplasCidades] = useState(false)
    const [secaoVetsVinculados, setSecaoVetsVinculados] = useState(false)
    const ultimoCepBuscadoRef = useRef('')
    const mapaNomeAlternativoRef = useRef(new Map())

    const somenteLeitura = useMemo(() => {
        const profile = getStoredAccessProfile()
        return profile ? !hasPermission(profile, PERMISSION_KEYS.CREDENCIAMENTO_EDIT) : false
    }, [])

    const podeDevToolPerfil = useStoredPermission(PERMISSION_KEYS.DEV_TOOLS)
    const podeGerarContrato = useStoredPermission(PERMISSION_KEYS.CONTRATOS_EDIT)

    const nomeEspecialidadePrincipal = useMemo(() => {
        const esp = especialidades.find((e) => Number(e.id) === Number(form.especialidade_id))
        return esp?.nome || ''
    }, [especialidades, form.especialidade_id])

    const mostrarAtendeClinica = secaoMultiplasCidades

    const estabelecimentosSelecionadosDados = useMemo(
        () =>
            estabelecimentosSelecionados
                .map((id) => prestadoresTodos.find((p) => Number(p.id) === Number(id)))
                .filter(Boolean),
        [estabelecimentosSelecionados, prestadoresTodos],
    )

    const telefoneAutoClinica = useMemo(
        () =>
            estabelecimentosSelecionadosDados
                .map((p) => p.telefone)
                .filter(Boolean)
                .join(' | '),
        [estabelecimentosSelecionadosDados],
    )

    const modalidadeAutoClinica = useMemo(
        () =>
            estabelecimentosSelecionadosDados
                .map((p) => p.nome)
                .filter(Boolean)
                .join(' | '),
        [estabelecimentosSelecionadosDados],
    )

    const carregarBase = useCallback(async () => {
        const [c, s, e, p] = await Promise.all([
            supabase.from('cidades_credenciamento').select('id, nome').order('nome'),
            supabase.from('situacoes').select('id, descricao').eq('ativo', true).order('ordem'),
            supabase.from('especialidades').select('id, nome, tipo').order('nome'),
            supabase
                .from('prestadores')
                .select('id, nome, especialidade_id, crmv, cidade_id, telefone, tipo')
                .eq('ativo', true),
        ])
        setCidades(c.data || [])
        setSituacoes(s.data || [])
        setEspecialidades(e.data || [])
        setPrestadoresTodos(p.data || [])
    }, [])

    const carregarPrestador = useCallback(async () => {
        if (!prestadorId) return
        setLoading(true)
        setErro('')
        try {
            let { data, error } = await supabase.from('prestadores').select(COLS_PRESTADOR).eq('id', prestadorId).single()
            if (error && String(error.message || '').toLowerCase().includes('tipo_pix')) {
                const fallback = await supabase
                    .from('prestadores')
                    .select(COLS_PRESTADOR_SEM_TIPO_PIX)
                    .eq('id', prestadorId)
                    .single()
                data = fallback.data
                error = fallback.error
            }
            if (error) {
                setErro(error.message)
                return
            }
            let cidadeIdForm = data.cidade_id != null ? String(data.cidade_id) : ''
            if (data.endereco_cidade?.trim()) {
                const objEnd = await obterOuCriarCidadePorNome(data.endereco_cidade)
                if (objEnd?.id) cidadeIdForm = String(objEnd.id)
            }
            setForm({
                nome: data.nome || '',
                cpf_cnpj: data.cpf_cnpj ? formatarCpfCnpjEntrada(data.cpf_cnpj) : '',
                situacao_id: data.situacao_id != null ? String(data.situacao_id) : '',
                telefone: data.telefone || '',
                celular: data.celular || '',
                email: data.email ? formatarEmailEntrada(data.email) : '',
                especialidade_id: data.especialidade_id != null ? String(data.especialidade_id) : '',
                crmv: data.crmv ? formatarCrmvEntrada(data.crmv) : '',
                cep: data.cep || '',
                endereco_logradouro: data.endereco_logradouro || data.endereco || '',
                endereco_numero: data.endereco_numero || '',
                endereco_complemento: data.endereco_complemento || '',
                endereco_pais: data.endereco_pais || 'Brasil',
                endereco_uf: data.endereco_uf || '',
                endereco_cidade: data.endereco_cidade || '',
                endereco_bairro: data.endereco_bairro || '',
                tipo_pix: (() => {
                    const salvo = String(data.tipo_pix || '').toLowerCase()
                    if (salvo) return salvo
                    return inferirTipoPixDaChave(data.chave_pix)
                })(),
                chave_pix: (() => {
                    const bruto = data.chave_pix || ''
                    const tipo =
                        String(data.tipo_pix || '').toLowerCase() || inferirTipoPixDaChave(bruto)
                    return bruto ? formatarChavePixEntrada(bruto, tipo) : ''
                })(),
                tipo_repasse: data.tipo_repasse || '',
                modalidade: data.modalidade || '',
                cidade_id: cidadeIdForm,
            })
            ultimoCepBuscadoRef.current = String(data.cep || '').replace(/\D/g, '')

            const { data: pcs } = await supabase.from('prestador_cidades').select('cidade_id, principal').eq('prestador_id', prestadorId)
            const listaPc = pcs || []
            const idsC = []
            const vistosCidade = new Set()
            listaPc.forEach((r) => {
                const cid = Number(r.cidade_id)
                if (!cid || vistosCidade.has(cid)) return
                vistosCidade.add(cid)
                idsC.push(cid)
            })
            let mapaCid = new Map()
            if (idsC.length) {
                const { data: rowsC } = await supabase.from('cidades_credenciamento').select('id, nome').in('id', idsC)
                mapaCid = new Map((rowsC || []).map((c) => [Number(c.id), c.nome]))
            }
            const atendeBase = idsC.map((cid) => ({
                cidadeId: cid,
                nome: mapaCid.get(cid) || `Cidade #${cid}`,
                uf: '',
            }))
            const atende = await Promise.all(
                atendeBase.map(async (item) => {
                    if (item.uf) return item
                    const uf = await resolverUfPorNomeMunicipio(item.nome)
                    return { ...item, uf: uf || '' }
                }),
            )
            const ordemSalva = lerOrdemCidadesAtende(prestadorId)
            setCidadesAtende(ordenarCidadesAtendePorChave(atende, ordemSalva))

            const { data: peData } = await supabase
                .from('prestador_especialidades')
                .select('especialidade_id, principal')
                .eq('prestador_id', prestadorId)
            const secEsp = (peData || []).filter((r) => !r.principal).map((r) => Number(r.especialidade_id))
            setEspecialidadesSecundariasIds(secEsp)

            const { data: vets } = await supabase
                .from('prestador_estabelecimentos')
                .select('veterinario_id')
                .eq('estabelecimento_id', prestadorId)
            const idsVetsVinc = (vets || []).map((v) => Number(v.veterinario_id))
            setVetsVinculados(idsVetsVinc)
            setVetsPendentes([])

            const { data: peClinicas } = await supabase
                .from('prestador_estabelecimentos')
                .select('estabelecimento_id, principal')
                .eq('veterinario_id', prestadorId)
            const idsClin = [...new Set((peClinicas || []).map((r) => Number(r.estabelecimento_id)).filter(Boolean))]
            setEstabelecimentosSelecionados(idsClin)
            setAtendeEmClinica(idsClin.length > 0)
            setSecaoMultiplasCidades(listaPc.length > 0 || idsClin.length > 0)
            setSecaoVetsVinculados(idsVetsVinc.length > 0)

            try {
                const codigosProc = await carregarCodigosPrestadorProcedimentos(prestadorId)
                setProcSelecionados(codigosProc)
            } catch (errProc) {
                setErro((prev) =>
                    prev
                        ? `${prev}\nProcedimentos: ${errProc?.message || String(errProc)}`
                        : `Procedimentos: ${errProc?.message || String(errProc)}`,
                )
                setProcSelecionados([])
            }

            const { data: labsSol } = await supabase
                .from('prestador_laboratorios_solicitacao')
                .select('laboratorio_id')
                .eq('prestador_id', prestadorId)
            setLaboratoriosSolicitacaoIds((labsSol || []).map((r) => Number(r.laboratorio_id)))
        } finally {
            setLoading(false)
        }
    }, [prestadorId])

    useEffect(() => {
        void carregarBase()
    }, [carregarBase])

    useEffect(() => {
        if (!secaoMultiplasCidades || !ufAtende) return
        let cancel = false
        setCarregandoMunicipios(true)
        buscarMunicipiosPorUf(ufAtende)
            .then((lista) => {
                if (!cancel) {
                    setMunicipiosUf(lista)
                    setMunicipioIbgeId('')
                }
            })
            .catch(() => {
                if (!cancel) setMunicipiosUf([])
            })
            .finally(() => {
                if (!cancel) setCarregandoMunicipios(false)
            })
        return () => {
            cancel = true
        }
    }, [ufAtende, secaoMultiplasCidades])

    useEffect(() => {
        if (!isNovo) void carregarPrestador()
    }, [isNovo, carregarPrestador])

    useEffect(() => {
        if (!secaoMultiplasCidades) {
            setAtendeEmClinica(false)
            setEstabelecimentosSelecionados([])
        }
    }, [secaoMultiplasCidades])

    useEffect(() => {
        if (!secaoVetsVinculados) {
            setVetsPendentes([])
        }
    }, [secaoVetsVinculados])

    useEffect(() => {
        if (!isNovo || form.situacao_id || !situacoes.length) return
        const credId = acharSituacaoCredenciadoId(situacoes)
        if (credId) setForm((f) => ({ ...f, situacao_id: credId }))
    }, [isNovo, situacoes, form.situacao_id])

    const tituloForm = isNovo ? 'Novo prestador' : form.nome.trim() || 'Prestador'

    const setCampo = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }))

    const consultarCnpjNoPerfil = useCallback(async () => {
        if (somenteLeitura) return
        if (tipoDocumentoCpfCnpj(form.cpf_cnpj) !== 'CNPJ') return
        const digits = apenasDigitos(form.cpf_cnpj)
        if (digits.length !== 14) return
        try {
            const data = await buscarDadosCNPJ(form.cpf_cnpj)
            if (!data?.razaoSocial?.trim()) return
            setForm((f) => {
                if (apenasDigitos(f.cpf_cnpj) !== digits) return f
                const razao = String(data.razaoSocial).trim()
                const patch = { ...f, nome: razao }
                if (data.cep && !String(f.cep || '').trim()) {
                    const c = apenasDigitos(data.cep)
                    patch.cep = c.length === 8 ? `${c.slice(0, 5)}-${c.slice(5)}` : String(data.cep)
                }
                if (data.logradouro && !String(f.endereco_logradouro || '').trim()) {
                    patch.endereco_logradouro = data.logradouro
                }
                if (data.numero && !String(f.endereco_numero || '').trim()) patch.endereco_numero = data.numero
                if (data.complemento && !String(f.endereco_complemento || '').trim()) {
                    patch.endereco_complemento = data.complemento
                }
                if (data.bairro && !String(f.endereco_bairro || '').trim()) patch.endereco_bairro = data.bairro
                if (data.municipio && !String(f.endereco_cidade || '').trim()) patch.endereco_cidade = data.municipio
                if (data.uf && !String(f.endereco_uf || '').trim()) patch.endereco_uf = data.uf
                return patch
            })
        } catch {
            /* consulta opcional no blur; contrato refaz na geração */
        }
    }, [form.cpf_cnpj, somenteLeitura])

    const buscarCepPorDigitos = useCallback(
        async (digits) => {
            if (somenteLeitura || digits.length !== 8) return
            if (ultimoCepBuscadoRef.current === digits) return
            ultimoCepBuscadoRef.current = digits
            setCepLoading(true)
            setErro('')
            try {
                const end = await buscarEnderecoPorCep(digits)
                setForm((f) => ({
                    ...f,
                    cep: end.cep || f.cep,
                    endereco_logradouro: end.logradouro || f.endereco_logradouro,
                    endereco_bairro: end.bairro || f.endereco_bairro,
                    endereco_cidade: end.cidade || f.endereco_cidade,
                    endereco_uf: end.uf || f.endereco_uf,
                    endereco_pais: end.pais || 'Brasil',
                }))
            } catch (e) {
                ultimoCepBuscadoRef.current = ''
                setErro(e?.message || 'CEP não encontrado.')
            } finally {
                setCepLoading(false)
            }
        },
        [somenteLeitura],
    )

    useEffect(() => {
        const digits = String(form.cep || '').replace(/\D/g, '')
        if (digits.length < 8) {
            ultimoCepBuscadoRef.current = ''
            return
        }
        void buscarCepPorDigitos(digits)
    }, [form.cep, buscarCepPorDigitos])

    const adicionarCidadeAtende = async () => {
        if (somenteLeitura) return
        const mun = municipiosUf.find((m) => String(m.id) === String(municipioIbgeId))
        if (!mun) {
            setErro('Selecione a cidade na lista da UF.')
            return
        }
        const obj = await obterOuCriarCidadePorNome(mun.nome)
        if (!obj?.id) {
            setErro('Não foi possível registrar a cidade no credenciamento.')
            return
        }
        const cid = Number(obj.id)
        if (cidadesAtende.some((c) => c.cidadeId === cid)) {
            setErro('Esta cidade já está na lista.')
            return
        }
        setCidadesAtende((prev) => {
            const next = [...prev, { cidadeId: cid, nome: mun.nome, uf: ufAtende }]
            if (prev.length === 0) setCampo('cidade_id', String(cid))
            return next
        })
        setMunicipioIbgeId('')
        setErro('')
    }

    const removerCidadeAtende = (cidadeId) => {
        setCidadesAtende((prev) => {
            const next = prev.filter((c) => c.cidadeId !== cidadeId)
            if (Number(form.cidade_id) === Number(cidadeId) && next[0]) {
                setCampo('cidade_id', String(next[0].cidadeId))
            }
            return next
        })
    }

    const obterOuCriarCidadePorNome = async (nomeCidade) => {
        const nome = String(nomeCidade || '').trim()
        if (!nome) return null
        const existente = cidades.find((c) => c.nome.toLowerCase() === nome.toLowerCase())
        if (existente) return existente
        try {
            const row = await obterOuCriarCidadeCredenciamento(nome)
            if (!row?.id) return null
            setCidades((prev) => {
                if (prev.some((c) => Number(c.id) === Number(row.id))) return prev
                return [...prev, { id: row.id, nome: row.nome }]
            })
            return { id: row.id, nome: row.nome }
        } catch {
            return null
        }
    }

    const salvar = async () => {
        if (somenteLeitura) return
        if (!form.nome.trim()) {
            setErro('Nome é obrigatório.')
            return
        }
        if (!form.especialidade_id) {
            setErro('Especialização / tipo é obrigatória.')
            return
        }
        const esp = especialidades.find((e) => Number(e.id) === Number(form.especialidade_id))
        const tipoSalvar = String(esp?.tipo || form.tipo || '').trim() || 'ESPECIALIDADE'
        if (secaoMultiplasCidades && atendeEmClinica && estabelecimentosSelecionados.length === 0) {
            setErro('Selecione pelo menos uma clínica/local para o vínculo.')
            return
        }
        if (secaoMultiplasCidades && atendeEmClinica && !modalidadeAutoClinica.trim()) {
            setErro('Selecione a clínica/local para preencher a modalidade.')
            return
        }

        setSalvando(true)
        setErro('')
        try {
            let cidadePrincipalId = null
            if (form.endereco_cidade?.trim()) {
                const obj = await obterOuCriarCidadePorNome(form.endereco_cidade)
                if (obj?.id) cidadePrincipalId = Number(obj.id)
            }
            if (!cidadePrincipalId && form.cidade_id) cidadePrincipalId = Number(form.cidade_id)
            if (!cidadePrincipalId && cidadesAtende[0]) cidadePrincipalId = cidadesAtende[0].cidadeId

            const enderecoLegado = montarEnderecoUmaLinha(form)

            const usaClinica = secaoMultiplasCidades && atendeEmClinica

            const payload = {
                nome: form.nome.trim(),
                cpf_cnpj: normalizarCpfCnpjParaSalvar(form.cpf_cnpj),
                situacao_id: form.situacao_id ? Number(form.situacao_id) : null,
                telefone: (usaClinica ? telefoneAutoClinica : form.telefone).trim() || null,
                celular: form.celular.trim() || null,
                email: normalizarEmailParaSalvar(form.email),
                especialidade_id: Number(form.especialidade_id),
                crmv: normalizarCrmvParaSalvar(form.crmv),
                tipo: tipoSalvar,
                cep: form.cep.trim() || null,
                endereco_logradouro: form.endereco_logradouro.trim() || null,
                endereco_numero: form.endereco_numero.trim() || null,
                endereco_complemento: form.endereco_complemento.trim() || null,
                endereco_pais: form.endereco_pais.trim() || 'Brasil',
                endereco_uf: form.endereco_uf.trim() || null,
                endereco_cidade: form.endereco_cidade.trim() || null,
                endereco_bairro: form.endereco_bairro.trim() || null,
                endereco: enderecoLegado || null,
                chave_pix: normalizarChavePixParaSalvar(form.chave_pix, form.tipo_pix),
                tipo_pix: form.tipo_pix ? String(form.tipo_pix).toLowerCase() : null,
                tipo_repasse: form.tipo_repasse || null,
                modalidade: (usaClinica ? modalidadeAutoClinica : form.modalidade).trim() || null,
                cidade_id: cidadePrincipalId,
                ativo: true,
                data_atualizacao: new Date().toISOString(),
            }

            const erroColunaTipoPix = (err) =>
                String(err?.message || '')
                    .toLowerCase()
                    .includes('tipo_pix')

            let pid = prestadorId
            if (isNovo) {
                payload.data_cadastro = new Date().toISOString()
                let { data: ins, error: errIns } = await supabase.from('prestadores').insert(payload).select('id').single()
                if (errIns && erroColunaTipoPix(errIns)) {
                    const { tipo_pix: _t, ...semTipo } = payload
                    const retry = await supabase.from('prestadores').insert(semTipo).select('id').single()
                    ins = retry.data
                    errIns = retry.error
                }
                if (errIns) throw new Error(errIns.message)
                pid = Number(ins.id)
            } else {
                let { error: errUp } = await supabase.from('prestadores').update(payload).eq('id', pid)
                if (errUp && erroColunaTipoPix(errUp)) {
                    const { tipo_pix: _t, ...semTipo } = payload
                    const retry = await supabase.from('prestadores').update(semTipo).eq('id', pid)
                    errUp = retry.error
                }
                if (errUp) throw new Error(errUp.message)
            }

            await supabase.from('prestador_cidades').delete().eq('prestador_id', pid)
            if (secaoMultiplasCidades) {
                const cidadesPayload = []
                if (cidadesAtende.length) {
                    cidadesAtende.forEach((c) => {
                        cidadesPayload.push({
                            prestador_id: pid,
                            cidade_id: c.cidadeId,
                            principal: Number(c.cidadeId) === Number(cidadePrincipalId),
                        })
                    })
                } else if (cidadePrincipalId) {
                    cidadesPayload.push({ prestador_id: pid, cidade_id: cidadePrincipalId, principal: true })
                }
                if (cidadesPayload.length) {
                    await supabase.from('prestador_cidades').upsert(cidadesPayload, {
                        onConflict: 'prestador_id,cidade_id',
                        ignoreDuplicates: true,
                    })
                }
                salvarOrdemCidadesAtende(pid, cidadesAtende)
            }

            await supabase.from('prestador_especialidades').delete().eq('prestador_id', pid)
            const payloadEsp = [
                { prestador_id: pid, especialidade_id: Number(form.especialidade_id), principal: true },
            ]
            especialidadesSecundariasIds.forEach((eid) => {
                if (Number(eid) === Number(form.especialidade_id)) return
                payloadEsp.push({ prestador_id: pid, especialidade_id: Number(eid), principal: false })
            })
            await supabase.from('prestador_especialidades').insert(payloadEsp)

            if (secaoMultiplasCidades) {
                await supabase.from('prestador_estabelecimentos').delete().eq('veterinario_id', pid)
                if (atendeEmClinica && estabelecimentosSelecionados.length) {
                    const rowsEst = estabelecimentosSelecionados.map((estabelecimentoId, idx) => ({
                        veterinario_id: pid,
                        estabelecimento_id: Number(estabelecimentoId),
                        principal: idx === 0,
                    }))
                    const { error: errEst } = await supabase.from('prestador_estabelecimentos').insert(rowsEst)
                    if (errEst) throw new Error(errEst.message)
                }
            } else {
                await supabase.from('prestador_estabelecimentos').delete().eq('veterinario_id', pid)
            }

            if (secaoVetsVinculados) {
                const credIdVet = acharSituacaoCredenciadoId(situacoes)
                let idsVets = [...vetsVinculados.map(Number)]
                let cidadeVet = form.cidade_id ? Number(form.cidade_id) : null
                if (!cidadeVet && form.endereco_cidade) {
                    const obj = await obterOuCriarCidadePorNome(form.endereco_cidade)
                    if (obj?.id) cidadeVet = Number(obj.id)
                }

                for (const v of vetsPendentes) {
                    const esp = especialidades.find((e) => Number(e.id) === Number(v.especialidade_id))
                    const tipoV = String(esp?.tipo || 'ESPECIALIDADE').trim() || 'ESPECIALIDADE'
                    if (!cidadeVet) {
                        throw new Error('Defina a cidade da clínica antes de salvar veterinários pendentes.')
                    }
                    const { data: insV, error: errV } = await supabase
                        .from('prestadores')
                        .insert({
                            nome: v.nome.trim(),
                            crmv: normalizarCrmvParaSalvar(v.crmv),
                            especialidade_id: Number(v.especialidade_id),
                            tipo: tipoV,
                            cidade_id: cidadeVet,
                            situacao_id: credIdVet ? Number(credIdVet) : null,
                            ativo: true,
                            data_cadastro: new Date().toISOString(),
                            data_atualizacao: new Date().toISOString(),
                        })
                        .select('id')
                        .single()
                    if (errV) throw new Error(errV.message)
                    idsVets.push(Number(insV.id))
                }
                idsVets = [...new Set(idsVets.filter(Boolean))]

                await supabase.from('prestador_estabelecimentos').delete().eq('estabelecimento_id', pid)
                if (idsVets.length) {
                    const rows = idsVets.map((vid) => ({
                        veterinario_id: vid,
                        estabelecimento_id: pid,
                        principal: false,
                    }))
                    await supabase.from('prestador_estabelecimentos').insert(rows)
                }
                setVetsPendentes([])
            } else {
                await supabase.from('prestador_estabelecimentos').delete().eq('estabelecimento_id', pid)
            }

            await sincronizarPrestadorProcedimentos(pid, procSelecionados, mapaNomeAlternativoRef.current)
            const codigosAtualizados = await carregarCodigosPrestadorProcedimentos(pid)
            setProcSelecionados(codigosAtualizados)

            await supabase.from('prestador_laboratorios_solicitacao').delete().eq('prestador_id', pid)
            if (laboratoriosSolicitacaoIds.length) {
                const rowsLabs = [...new Set(laboratoriosSolicitacaoIds.map(Number).filter(Boolean))].map((lid) => ({
                    prestador_id: pid,
                    laboratorio_id: lid,
                }))
                const { error: errLabs } = await supabase.from('prestador_laboratorios_solicitacao').insert(rowsLabs)
                if (errLabs) throw new Error(errLabs.message)
            }

            navigate('/credenciamento/cadastro', { replace: true })
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setSalvando(false)
        }
    }

    if (loading) {
        return (
            <div className="pcad_page">
                <p className="pcad_muted">Carregando cadastro…</p>
            </div>
        )
    }

    return (
        <div className="credenciamento_main pcad_page pcad_form_page">
            <div className="pcad_form_top">
                <h1>{tituloForm}</h1>
            </div>

            {erro && (
                <div className="credenciamento_main_alert" role="alert">
                    {erro}
                </div>
            )}

            <div className="pcad_form_layout">
                <section className="pcad_card">
                    <h2>Perfil</h2>
                    <div className="pcad_row pcad_row4">
                        <label className="pcad_field">
                            CPF / CNPJ
                            <input
                                className="credenciamento_main_input"
                                value={form.cpf_cnpj}
                                onChange={(e) => setCampo('cpf_cnpj', formatarCpfCnpjEntrada(e.target.value))}
                                onBlur={(e) => {
                                    setCampo('cpf_cnpj', formatarCpfCnpjEntrada(e.target.value))
                                    void consultarCnpjNoPerfil()
                                }}
                                inputMode="numeric"
                                autoComplete="off"
                                placeholder={
                                    tipoDocumentoCpfCnpj(form.cpf_cnpj) === 'CNPJ'
                                        ? '00.000.000/0000-00'
                                        : '000.000.000-00'
                                }
                                maxLength={18}
                                disabled={somenteLeitura}
                            />
                        </label>
                        <label className="pcad_field">
                            {tipoDocumentoCpfCnpj(form.cpf_cnpj) === 'CNPJ' ? 'Razão social *' : 'Nome *'}
                            <input
                                className="credenciamento_main_input"
                                value={form.nome}
                                onChange={(e) => setCampo('nome', e.target.value)}
                                disabled={somenteLeitura}
                            />
                        </label>
                        <label className="pcad_field">
                            CRMV
                            <input
                                className="credenciamento_main_input"
                                value={form.crmv}
                                onChange={(e) => setCampo('crmv', formatarCrmvEntrada(e.target.value))}
                                disabled={somenteLeitura}
                            />
                        </label>
                        <label className="pcad_field">
                            Situação
                            <select
                                className="credenciamento_main_select"
                                value={form.situacao_id}
                                onChange={(e) => setCampo('situacao_id', e.target.value)}
                                disabled={somenteLeitura}
                            >
                                <option value="">—</option>
                                {situacoes.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.descricao}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                    <div className="pcad_row pcad_row4 pcad_row4_contact">
                        <label className="pcad_field">
                            Telefone
                            <input
                                className="credenciamento_main_input"
                                value={
                                    mostrarAtendeClinica && atendeEmClinica
                                        ? telefoneAutoClinica
                                        : form.telefone
                                }
                                onChange={(e) => setCampo('telefone', formatarTelefoneEntrada(e.target.value))}
                                readOnly={mostrarAtendeClinica && atendeEmClinica}
                                disabled={somenteLeitura}
                            />
                        </label>
                        <label className="pcad_field">
                            Celular
                            <input
                                className="credenciamento_main_input"
                                value={form.celular}
                                onChange={(e) => setCampo('celular', formatarTelefoneEntrada(e.target.value))}
                                disabled={somenteLeitura}
                            />
                        </label>
                        <label className="pcad_field">
                            E-mail
                            <input
                                type="email"
                                className="credenciamento_main_input"
                                value={form.email}
                                onChange={(e) => setCampo('email', formatarEmailEntrada(e.target.value))}
                                disabled={somenteLeitura}
                            />
                        </label>
                        <label className="pcad_field">
                            Modalidade
                            <input
                                className="credenciamento_main_input"
                                value={
                                    mostrarAtendeClinica && atendeEmClinica
                                        ? modalidadeAutoClinica
                                        : form.modalidade
                                }
                                onChange={(e) => setCampo('modalidade', e.target.value)}
                                readOnly={mostrarAtendeClinica && atendeEmClinica}
                                disabled={somenteLeitura}
                            />
                        </label>
                    </div>
                    <div className="pcad_row pcad_row_esp">
                        <label className="pcad_field">
                            Especialidade *
                            <select
                                className="credenciamento_main_select"
                                value={form.especialidade_id}
                                onChange={(e) => setCampo('especialidade_id', e.target.value)}
                                disabled={somenteLeitura}
                            >
                                <option value="">—</option>
                                {especialidades.map((e) => (
                                    <option key={e.id} value={e.id}>
                                        {e.nome}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <MultiEspecialidadesInput
                            layout="inline"
                            especialidades={especialidades}
                            principalId={form.especialidade_id}
                            secundariasIds={especialidadesSecundariasIds}
                            onChangeSecundarias={setEspecialidadesSecundariasIds}
                            disabled={somenteLeitura}
                        />
                    </div>
                </section>

                <section className="pcad_card">
                    <h2>Endereço</h2>
                    <div className="pcad_row pcad_row_end1">
                        <label className="pcad_field">
                            CEP
                            <input
                                className="credenciamento_main_input"
                                value={form.cep}
                                onChange={(e) => setCampo('cep', e.target.value)}
                                disabled={somenteLeitura || cepLoading}
                                placeholder="00000-000"
                                inputMode="numeric"
                                autoComplete="postal-code"
                                aria-busy={cepLoading}
                            />
                        </label>
                        <label className="pcad_field">
                            Endereço
                            <input
                                className="credenciamento_main_input"
                                value={form.endereco_logradouro}
                                onChange={(e) => setCampo('endereco_logradouro', e.target.value)}
                                disabled={somenteLeitura}
                            />
                        </label>
                        <label className="pcad_field">
                            Número
                            <input
                                className="credenciamento_main_input"
                                value={form.endereco_numero}
                                onChange={(e) => setCampo('endereco_numero', e.target.value)}
                                disabled={somenteLeitura}
                            />
                        </label>
                        <label className="pcad_field">
                            Complemento
                            <input
                                className="credenciamento_main_input"
                                value={form.endereco_complemento}
                                onChange={(e) => setCampo('endereco_complemento', e.target.value)}
                                disabled={somenteLeitura}
                            />
                        </label>
                    </div>
                    <div className="pcad_row pcad_row_end2">
                        <label className="pcad_field">
                            Bairro
                            <input
                                className="credenciamento_main_input"
                                value={form.endereco_bairro}
                                onChange={(e) => setCampo('endereco_bairro', e.target.value)}
                                disabled={somenteLeitura}
                            />
                        </label>
                        <label className="pcad_field">
                            Cidade
                            <input
                                className="credenciamento_main_input"
                                value={form.endereco_cidade}
                                onChange={(e) => setCampo('endereco_cidade', e.target.value)}
                                disabled={somenteLeitura}
                            />
                        </label>
                        <label className="pcad_field">
                            UF
                            <input
                                className="credenciamento_main_input"
                                value={form.endereco_uf}
                                onChange={(e) => setCampo('endereco_uf', e.target.value)}
                                disabled={somenteLeitura}
                            />
                        </label>
                        <label className="pcad_field">
                            País
                            <input
                                className="credenciamento_main_input"
                                value={form.endereco_pais}
                                onChange={(e) => setCampo('endereco_pais', e.target.value)}
                                disabled={somenteLeitura}
                            />
                        </label>
                    </div>
                </section>

                <section className="pcad_card">
                    <h2>Financeiro</h2>
                    <div className="pcad_row pcad_row_fin">
                        <label className="pcad_field">
                            Tipo de PIX
                            <select
                                className="credenciamento_main_select"
                                value={form.tipo_pix}
                                onChange={(e) => {
                                    setForm((prev) => ({
                                        ...prev,
                                        tipo_pix: e.target.value,
                                        chave_pix: '',
                                    }))
                                }}
                                disabled={somenteLeitura}
                            >
                                {TIPOS_CHAVE_PIX.map((t) => (
                                    <option key={t.value || 'vazio'} value={t.value}>
                                        {t.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="pcad_field">
                            Chave PIX
                            <input
                                className="credenciamento_main_input"
                                value={form.chave_pix}
                                disabled={somenteLeitura || !form.tipo_pix}
                                placeholder={
                                    form.tipo_pix === 'email'
                                        ? 'email@exemplo.com'
                                        : form.tipo_pix === 'telefone'
                                          ? '(00) 00000-0000'
                                          : form.tipo_pix === 'cpf'
                                            ? '000.000.000-00'
                                            : form.tipo_pix === 'cnpj'
                                              ? '00.000.000/0000-00'
                                              : 'Selecione o tipo de PIX'
                                }
                                onChange={(e) =>
                                    setCampo('chave_pix', formatarChavePixEntrada(e.target.value, form.tipo_pix))
                                }
                            />
                        </label>
                        <label className="pcad_field">
                            Nota / RPA
                            <select
                                className="credenciamento_main_select"
                                value={form.tipo_repasse}
                                onChange={(e) => setCampo('tipo_repasse', e.target.value)}
                                disabled={somenteLeitura}
                            >
                                {TIPOS_REPASSE.map((t) => (
                                    <option key={t.value || 'vazio'} value={t.value}>
                                        {t.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                </section>

                <section className="pcad_card pcad_card_full">
                    <h2>Serviços</h2>
                    {podeDevToolPerfil && (
                        <CredenciamentoDevToolsPerfil
                            prestadorId={prestadorId}
                            procSelecionados={procSelecionados}
                            onChangeSelecionados={setProcSelecionados}
                            somenteLeitura={somenteLeitura}
                        />
                    )}
                    <PrestadorServicosAbas
                        prestadorId={prestadorId}
                        somenteLeitura={somenteLeitura}
                        selecionadosInicial={procSelecionados}
                        onChangeSelecionados={setProcSelecionados}
                        onMapaNomeAlternativoChange={(mapa) => {
                            mapaNomeAlternativoRef.current = mapa
                        }}
                        laboratoriosSelecionadosInicial={laboratoriosSolicitacaoIds}
                        onChangeLaboratorios={setLaboratoriosSolicitacaoIds}
                        barraAcoes={
                            <PrestadorHonorariosContratos
                                prestadorId={prestadorId}
                                prestadorNome={form.nome}
                                codigosSelecionados={procSelecionados}
                                form={form}
                                nomeEspecialidade={nomeEspecialidadePrincipal}
                                podeGerarContrato={podeGerarContrato}
                                disabled={somenteLeitura || isNovo}
                            />
                        }
                    />
                </section>

                <section className="pcad_card">
                    <div className="pcad_card_head_switch">
                        <h2>Cidades que atende</h2>
                        <div className="pcad_card_head_switch_ctl">
                            <span className="pcad_card_head_switch_lbl">Múltiplas cidades</span>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={secaoMultiplasCidades}
                                className={`credenciamento_switch ${secaoMultiplasCidades ? 'is-on' : 'is-off'}`}
                                disabled={somenteLeitura}
                                onClick={() => setSecaoMultiplasCidades((v) => !v)}
                            >
                                <span className="credenciamento_switch_track">
                                    <span className="credenciamento_switch_knob" />
                                </span>
                                <span className="credenciamento_switch_label">{secaoMultiplasCidades ? 'Sim' : 'Não'}</span>
                            </button>
                        </div>
                    </div>
                    {secaoMultiplasCidades ? (
                        <>
                            <div className="pcad_row pcad_row_cidades">
                                <label className="pcad_field">
                                    UF
                                    <select
                                        className="credenciamento_main_select"
                                        value={ufAtende}
                                        onChange={(e) => setUfAtende(e.target.value)}
                                        disabled={somenteLeitura}
                                    >
                                        {UFS_BRASIL.map((u) => (
                                            <option key={u} value={u}>
                                                {u}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label className="pcad_field">
                                    Cidade
                                    <select
                                        className="credenciamento_main_select"
                                        value={municipioIbgeId}
                                        onChange={(e) => setMunicipioIbgeId(e.target.value)}
                                        disabled={somenteLeitura || carregandoMunicipios}
                                    >
                                        <option value="">{carregandoMunicipios ? 'Carregando…' : 'Selecione a cidade'}</option>
                                        {municipiosUf.map((m) => (
                                            <option key={m.id} value={m.id}>
                                                {m.nome}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <div className="pcad_field pcad_cidades_add_btn">
                                    <span className="pcad_field_label" aria-hidden="true">
                                        &nbsp;
                                    </span>
                                    <button
                                        type="button"
                                        className="credenciamento_main_action_btn"
                                        disabled={somenteLeitura}
                                        onClick={() => void adicionarCidadeAtende()}
                                    >
                                        Adicionar
                                    </button>
                                </div>
                            </div>
                            <CidadesAtendeVirtualList
                                itens={cidadesAtende}
                                onRemover={removerCidadeAtende}
                                somenteLeitura={somenteLeitura}
                            />
                            <div className="pcad_row pcad_row_atende_clinica">
                                <ClinicasAtendeInput
                                    layout="inline"
                                    prestadores={prestadoresTodos}
                                    prestadorAtualId={prestadorId}
                                    selecionadosIds={estabelecimentosSelecionados}
                                    onChangeSelecionados={setEstabelecimentosSelecionados}
                                    ativo={atendeEmClinica}
                                    onAtivoChange={setAtendeEmClinica}
                                    disabled={somenteLeitura}
                                />
                            </div>
                        </>
                    ) : (
                        <p className="pcad_muted pcad_secao_off_hint">Ative «Múltiplas cidades» para incluir cidades e vínculos com clínicas.</p>
                    )}
                </section>

                <section className="pcad_card">
                    <div className="pcad_card_head_switch">
                        <h2>Veterinários vinculados</h2>
                        <div className="pcad_card_head_switch_ctl">
                            <span className="pcad_card_head_switch_lbl">Vets vinculados</span>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={secaoVetsVinculados}
                                className={`credenciamento_switch ${secaoVetsVinculados ? 'is-on' : 'is-off'}`}
                                disabled={somenteLeitura}
                                onClick={() => setSecaoVetsVinculados((v) => !v)}
                            >
                                <span className="credenciamento_switch_track">
                                    <span className="credenciamento_switch_knob" />
                                </span>
                                <span className="credenciamento_switch_label">{secaoVetsVinculados ? 'Sim' : 'Não'}</span>
                            </button>
                        </div>
                    </div>
                    {secaoVetsVinculados ? (
                        <VeterinariosVinculados
                            estabelecimentoId={prestadorId}
                            cidadeIdClinica={form.cidade_id ? Number(form.cidade_id) : null}
                            situacoes={situacoes}
                            especialidades={especialidades}
                            prestadoresTodos={prestadoresTodos}
                            onPrestadoresAtualizados={setPrestadoresTodos}
                            vetsVinculados={vetsVinculados}
                            onChangeVetsVinculados={setVetsVinculados}
                            vetsPendentes={vetsPendentes}
                            onChangeVetsPendentes={setVetsPendentes}
                            somenteLeitura={somenteLeitura}
                            onErro={setErro}
                        />
                    ) : (
                        <p className="pcad_muted pcad_secao_off_hint">Ative «Vets vinculados» para gerenciar veterinários deste estabelecimento.</p>
                    )}
                </section>
            </div>

            <div className="pcad_form_footer">
                <button
                    type="button"
                    className="credenciamento_main_action_btn secondary pcad_footer_btn"
                    onClick={() => navigate('/credenciamento/cadastro')}
                >
                    Voltar
                </button>
                {!somenteLeitura && (
                    <button
                        type="button"
                        className="credenciamento_main_action_btn pcad_footer_btn"
                        disabled={salvando}
                        onClick={() => void salvar()}
                    >
                        {salvando ? 'Salvando…' : 'Salvar'}
                    </button>
                )}
            </div>
        </div>
    )
}

export default CredenciamentoCadastroForm