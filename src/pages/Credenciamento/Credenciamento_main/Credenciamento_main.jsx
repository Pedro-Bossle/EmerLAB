import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PERMISSION_KEYS, getStoredAccessProfile, hasPermission, hasStoredDevTools, hasStoredExclusaoPermanenteCredenciamento, normalizarProfileAcesso, setStoredAccessProfile } from '../../../lib/accessControl'
import { useDevToolsUi } from '../../../lib/devToolsUi'
import { filtrarPorTermoBusca, normalizarTextoBusca, patchCredenciadoEmSeTransicao, resolverCidadePrincipalNome } from '../../../lib/prestadorCadastroHelpers'
import {
    montarEstabelecimentoPorVeterinarioDeListas,
    resolverLocalidadeEfetivaPrestador } from '../../../lib/prestadorLocalidadeVinculo.js'
import { supabase } from '../../../lib/supabase'
import './Credenciamento_main.css'
import CampoBuscaComLimpar from '../../../components/CampoBuscaComLimpar/CampoBuscaComLimpar.jsx'
import { solicitarGeocodePrestador } from '../../../lib/credenciamento/solicitarGeocodePrestador'
import { sincronizarCardKanbanComSituacao } from '../../../lib/credKanban.js'
import { excluirPrestadorPermanentemente } from '../../../lib/exclusaoPermanenteCredenciamento.js'
import { useConfirmacaoExclusaoAutoDismiss } from '../../../lib/toastUi.js'
import CredenciamentoMainAlert from '../../../components/Toast/CredenciamentoMainAlert.jsx'
import { PageHeader } from '../../../components/ui'
import SelectMunicipioBusca from '../../../components/SelectMunicipioBusca/SelectMunicipioBusca.jsx'

const normalizarTexto = (texto) =>
    String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase()

const formatarData = (valor) => {
    if (!valor) return '-'
    const data = new Date(valor)
    if (Number.isNaN(data.getTime())) return '-'
    return data.toLocaleDateString('pt-BR')
}

const formatarMesAno = (valor) => {
    if (!valor) return ''
    const data = new Date(valor)
    if (Number.isNaN(data.getTime())) return ''
    return data.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

const tipoEspecialidadeNormalizado = (valor) => {
    const txt = normalizarTexto(valor)
    if (txt.includes('LOCAL')) return 'LOCAL'
    if (txt.includes('ESPECIALIDADE')) return 'ESPECIALIDADE'
    return '-'
}

const ESPECIALIDADES_VINCULO_CLINICA_IDS = new Set([1, 2, 3, 5]) // Clinica 24h, Clinica, Consultorio, Laboratorio

const estabelecimentoVinculavel = (item) => {
    if (!item) return false
    return ESPECIALIDADES_VINCULO_CLINICA_IDS.has(Number(item.especialidade_id))
}

const formatarTelefoneEntrada = (valor) => {
    const digitos = String(valor || '').replace(/\D/g, '').slice(0, 11)
    if (digitos.length === 0) return ''
    if (digitos.length <= 2) return `(${digitos}`
    if (digitos.length <= 6) return `(${digitos.slice(0, 2)}) ${digitos.slice(2)}`
    if (digitos.length <= 10) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`
    return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`
}

const classeCorSituacao = (descricao) => {
    const txt = normalizarTexto(descricao)
    if (txt.includes('OK MINUTA') || txt === 'OK' || (txt.includes('OK') && txt.includes('MINUTA'))) return 'credenciamento_situacao_ok_minuta'
    if (txt.includes('ASSINATURA')) return 'credenciamento_situacao_assinatura'
    if (txt.includes('CREDENCIADO')) return 'credenciamento_situacao_credenciado'
    if (txt.includes('CANCELADO')) return 'credenciamento_situacao_cancelado'
    return ''
}

const Credenciamento_main = () => {
    const [loading, setLoading] = useState(false)
    const [erro, setErro] = useState('')
    const [somenteLeitura, setSomenteLeitura] = useState(() => {
        const profile = getStoredAccessProfile()
        return profile ? !hasPermission(profile, PERMISSION_KEYS.CREDENCIAMENTO_EDIT) : false
    })
    const [headerCompacto, setHeaderCompacto] = useState(false)
    const [expandedRowId, setExpandedRowId] = useState(null)

    const [prestadores, setPrestadores] = useState([])
    const [cidades, setCidades] = useState([])
    const [situacoes, setSituacoes] = useState([])
    const [especialidades, setEspecialidades] = useState([])
    const [prestadorCidades, setPrestadorCidades] = useState([])
    const [prestadorEspecialidades, setPrestadorEspecialidades] = useState([])
    const [prestadorEstabelecimentos, setPrestadorEstabelecimentos] = useState([])
    const [permiteLerPrestadorEstabelecimentos, setPermiteLerPrestadorEstabelecimentos] = useState(true)

    const [termoBusca1, setTermoBusca1] = useState('')
    const [termoBusca2, setTermoBusca2] = useState('')
    const [filtroSituacao, setFiltroSituacao] = useState('')
    const [filtroPdf, setFiltroPdf] = useState('todos')
    const [filtroSite, setFiltroSite] = useState('todos')
    const [filtroMapa, setFiltroMapa] = useState('todos')
    const [filtroDia, setFiltroDia] = useState('todos')

    const [ordenacao, setOrdenacao] = useState({ coluna: 'data_atualizacao', direcao: 'desc' })
    const [ordenacaoAtiva, setOrdenacaoAtiva] = useState(false)
    const [itensPorPagina, setItensPorPagina] = useState(20)
    const [paginaAtual, setPaginaAtual] = useState(1)
    const [paginaAlvoInput, setPaginaAlvoInput] = useState('1')
    const [confirmacaoExclusao, setConfirmacaoExclusao] = useState(null)

    useConfirmacaoExclusaoAutoDismiss(confirmacaoExclusao, setConfirmacaoExclusao)
    const [prestadorEditandoId, setPrestadorEditandoId] = useState(null)
    const scrollPosAntesSalvarRef = useRef(0)

    const [modalAberto, setModalAberto] = useState(false)
    const [novoNome, setNovoNome] = useState('')
    const [novoTelefone, setNovoTelefone] = useState('')
    const [novoCidadePrincipal, setNovoCidadePrincipal] = useState('')
    const [novoEndereco, setNovoEndereco] = useState('')
    const [novoModalidade, setNovoModalidade] = useState('')
    const [novaSituacaoId, setNovaSituacaoId] = useState('')
    const [novaEspecialidadePrincipalId, setNovaEspecialidadePrincipalId] = useState('')
    const [especialidadeSecundariaInput, setEspecialidadeSecundariaInput] = useState('')
    const [especialidadesSecundariasSelecionadas, setEspecialidadesSecundariasSelecionadas] = useState([])
    const [novoPdf, setNovoPdf] = useState(false)
    const [novoSite, setNovoSite] = useState(false)
    const [novoMapa, setNovoMapa] = useState(false)
    const [novoAtendeEmClinica, setNovoAtendeEmClinica] = useState(false)
    const [switchClinicaAlterado, setSwitchClinicaAlterado] = useState(false)
    const [estabelecimentosSelecionados, setEstabelecimentosSelecionados] = useState([])
    const [estabelecimentoInput, setEstabelecimentoInput] = useState('')
    const [cidadeSecundariaInput, setCidadeSecundariaInput] = useState('')
    const [cidadesSecundariasSelecionadas, setCidadesSecundariasSelecionadas] = useState([])
    const [cidadesSecundariasNovas, setCidadesSecundariasNovas] = useState([])
    const { ui: devToolsUi, toggleColuna } = useDevToolsUi()
    const podeDevTool = hasStoredDevTools()
    const podeExclusaoPermanente = hasStoredExclusaoPermanenteCredenciamento()
    const colProc = devToolsUi.colunasProcessos

    const mostrarColunaPdf = podeDevTool && colProc.pdf
    const mostrarColunaSite = podeDevTool && colProc.site
    const mostrarColunaMapa = podeDevTool && colProc.mapa

    const totalColunasTabela = useMemo(() => {
        let n = 7
        if (mostrarColunaPdf) n += 1
        if (mostrarColunaSite) n += 1
        if (mostrarColunaMapa) n += 1
        if (!somenteLeitura) n += 1
        return n
    }, [mostrarColunaPdf, mostrarColunaSite, mostrarColunaMapa, somenteLeitura])

    const cidadePorId = useMemo(() => new Map(cidades.map((cidade) => [Number(cidade.id), cidade])), [cidades])
    const situacaoPorId = useMemo(() => new Map(situacoes.map((situacao) => [Number(situacao.id), situacao])), [situacoes])
    const especialidadePorId = useMemo(
        () => new Map(especialidades.map((especialidade) => [Number(especialidade.id), especialidade])),
        [especialidades]
    )

    const especialidadePrincipalSelecionada = useMemo(
        () => especialidades.find((item) => Number(item.id) === Number(novaEspecialidadePrincipalId)) || null,
        [especialidades, novaEspecialidadePrincipalId]
    )
    const tipoEspecialidadeAuto = useMemo(
        () => tipoEspecialidadeNormalizado(especialidadePrincipalSelecionada?.tipo || ''),
        [especialidadePrincipalSelecionada]
    )

    const carregarBase = useCallback(async () => {
        try {
            setLoading(true)
            setErro('')
            const [
                { data: prestadoresData, error: errPrestadores },
                { data: cidadesData, error: errCidades },
                { data: situacoesData, error: errSituacoes },
                { data: especialidadesData, error: errEspecialidades },
                { data: prestadorCidadesData, error: errPrestadorCidades },
                { data: prestadorEspecialidadesData, error: errPrestadorEspecialidades },
                { data: prestadorEstabelecimentosData, error: errPrestadorEstabelecimentos },
            ] = await Promise.all([
                supabase
                    .from('prestadores')
                    .select(
                        'id, nome, tipo, telefone, cidade_id, endereco, cep, endereco_logradouro, endereco_numero, endereco_bairro, endereco_cidade, endereco_uf, modalidade, especialidade_id, situacao_id, no_sistema, tem_pdf, no_site, no_mapa, data_cadastro, data_atualizacao, ativo'
                    )
                    .eq('ativo', true),
                supabase.from('cidades_credenciamento').select('id, nome').order('nome', { ascending: true }),
                supabase.from('situacoes').select('id, descricao, ordem, ativo').eq('ativo', true).order('ordem'),
                supabase.from('especialidades').select('id, nome, tipo').order('nome'),
                supabase.from('prestador_cidades').select('prestador_id, cidade_id, principal'),
                supabase.from('prestador_especialidades').select('prestador_id, especialidade_id, principal'),
                supabase.from('prestador_estabelecimentos').select('veterinario_id, estabelecimento_id, principal'),
            ])

            const erros = [
                errPrestadores?.message,
                errCidades?.message,
                errSituacoes?.message,
                errEspecialidades?.message,
                errPrestadorCidades?.message,
                errPrestadorEspecialidades?.message,
            ].filter(Boolean)
            if (erros.length) {
                setErro(`Erro ao carregar credenciamento: ${erros.join(' | ')}`)
                return
            }
            if (errPrestadorEstabelecimentos) {
                setPermiteLerPrestadorEstabelecimentos(false)
            } else {
                setPermiteLerPrestadorEstabelecimentos(true)
            }

            setPrestadores(prestadoresData || [])
            setCidades(cidadesData || [])
            setSituacoes(situacoesData || [])
            setEspecialidades(especialidadesData || [])
            setPrestadorCidades(prestadorCidadesData || [])
            setPrestadorEspecialidades(prestadorEspecialidadesData || [])
            setPrestadorEstabelecimentos(prestadorEstabelecimentosData || [])
        } catch (error) {
            setErro(`Falha inesperada ao carregar dados: ${error?.message || error}`)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        carregarBase()
    }, [carregarBase])

    useEffect(() => {
        const carregarPermissoes = async () => {
            const { data: authData } = await supabase.auth.getUser()
            const userId = authData?.user?.id
            if (!userId) return
            let { data, error } = await supabase
                .from('profiles')
                .select('id, name, email, permissions')
                .eq('id', userId)
                .single()
            if (error && String(error.message || '').includes('email')) {
                const fallback = await supabase
                    .from('profiles')
                    .select('id, name, permissions')
                    .eq('id', userId)
                    .single()
                data = fallback.data
                error = fallback.error
            }
            if (!error) {
                const profile = normalizarProfileAcesso(data)
                setStoredAccessProfile(profile)
                setSomenteLeitura(!hasPermission(profile, PERMISSION_KEYS.CREDENCIAMENTO_EDIT))
            }
        }
        carregarPermissoes()
    }, [])

    useEffect(() => {
        const onScroll = () => setHeaderCompacto(window.scrollY > 22)
        onScroll()
        window.addEventListener('scroll', onScroll, { passive: true })
        return () => window.removeEventListener('scroll', onScroll)
    }, [])

    useEffect(() => {
        setPaginaAtual(1)
    }, [termoBusca1, termoBusca2, filtroSituacao, filtroPdf, filtroSite, filtroMapa, filtroDia, itensPorPagina])

    const linhasCompletas = useMemo(() => {
        const prestadorPorId = new Map(prestadores.map((prestador) => [Number(prestador.id), prestador]))
        const cidadesPorPrestador = new Map()
        prestadorCidades.forEach((item) => {
            const chave = Number(item.prestador_id)
            if (!cidadesPorPrestador.has(chave)) cidadesPorPrestador.set(chave, [])
            cidadesPorPrestador.get(chave).push(item)
        })

        const especialidadesPorPrestador = new Map()
        prestadorEspecialidades.forEach((item) => {
            const chave = Number(item.prestador_id)
            if (!especialidadesPorPrestador.has(chave)) especialidadesPorPrestador.set(chave, [])
            especialidadesPorPrestador.get(chave).push(item)
        })

        const estabelecimentosPorVeterinario = new Map()
        prestadorEstabelecimentos.forEach((item) => {
            const chave = Number(item.veterinario_id)
            if (!estabelecimentosPorVeterinario.has(chave)) estabelecimentosPorVeterinario.set(chave, [])
            estabelecimentosPorVeterinario.get(chave).push(item)
        })

        const estabelecimentoPorVeterinario = montarEstabelecimentoPorVeterinarioDeListas(
            prestadores,
            prestadorEstabelecimentos,
        )

        return prestadores.map((prestador) => {
            const { prestador: pLoc, prestadorIdCidades } = resolverLocalidadeEfetivaPrestador(
                prestador,
                estabelecimentoPorVeterinario,
            )
            const cidadesDoPrestador =
                cidadesPorPrestador.get(prestadorIdCidades) || cidadesPorPrestador.get(Number(prestador.id)) || []
            const cidadePrincipalRel = cidadesDoPrestador.find((item) => item.principal)
            const cidadePrincipalId = Number(pLoc.cidade_id || cidadePrincipalRel?.cidade_id || 0)
            const cidadePrincipalNome =
                resolverCidadePrincipalNome(pLoc, {
                    mapaCidadeNomePorId: cidadePorId,
                    relacoesCidades: cidadesDoPrestador }) || '-'
            const cidadesSecundarias = cidadesDoPrestador
                .filter((item) => !item.principal && Number(item.cidade_id) !== cidadePrincipalId)
                .map((item) => cidadePorId.get(Number(item.cidade_id))?.nome)
                .filter(Boolean)

            const especialidadesDoPrestador = especialidadesPorPrestador.get(Number(prestador.id)) || []
            const especialidadePrincipalRel = especialidadesDoPrestador.find((item) => item.principal)
            const especialidadePrincipalId = Number(prestador.especialidade_id || especialidadePrincipalRel?.especialidade_id || 0)
            const especialidadePrincipalObj = especialidadePorId.get(especialidadePrincipalId)
            const especialidadePrincipalNome = especialidadePrincipalObj?.nome || '-'
            const tipoEspecialidade = tipoEspecialidadeNormalizado(especialidadePrincipalObj?.tipo || '')
            const especialidadesExtras = especialidadesDoPrestador
                .filter((item) => !item.principal && Number(item.especialidade_id) !== especialidadePrincipalId)
                .map((item) => especialidadePorId.get(Number(item.especialidade_id))?.nome)
                .filter(Boolean)

            const estabelecimentosVinculados = (estabelecimentosPorVeterinario.get(Number(prestador.id)) || [])
                .map((rel) => prestadorPorId.get(Number(rel.estabelecimento_id)))
                .filter(Boolean)
            const telefonesVinculados = [...new Set(estabelecimentosVinculados.map((item) => String(item.telefone || '').trim()).filter(Boolean))]
            const modalidadesVinculadas = [...new Set(estabelecimentosVinculados.map((item) => String(item.nome || '').trim()).filter(Boolean))]
            const telefoneVinculado = telefonesVinculados.join(' | ')
            const modalidadeVinculada = modalidadesVinculadas.join(' | ')
            const possuiVinculoClinica = estabelecimentosVinculados.length > 0

            const diaRef = prestador.data_atualizacao || prestador.data_cadastro || null
            const chaveMes = diaRef ? `${new Date(diaRef).getFullYear()}-${String(new Date(diaRef).getMonth() + 1).padStart(2, '0')}` : ''

            return {
                ...prestador,
                cidadePrincipalNome,
                cidadesSecundarias,
                especialidadePrincipalNome,
                especialidadesExtras,
                tipoEspecialidade,
                situacaoDescricao: situacaoPorId.get(Number(prestador.situacao_id))?.descricao || '-',
                telefoneEfetivo: possuiVinculoClinica ? telefoneVinculado || prestador.telefone || '' : prestador.telefone || '',
                modalidadeEfetiva: possuiVinculoClinica ? modalidadeVinculada || prestador.modalidade || '' : prestador.modalidade || '',
                possuiVinculoClinica,
                diaRef,
                chaveMes }
        })
    }, [prestadores, prestadorCidades, prestadorEspecialidades, prestadorEstabelecimentos, cidadePorId, especialidadePorId, situacaoPorId])

    const opcoesFiltroMes = useMemo(() => {
        const mapa = new Map()
        linhasCompletas.forEach((item) => {
            if (!item.chaveMes) return
            if (!mapa.has(item.chaveMes)) mapa.set(item.chaveMes, formatarMesAno(item.diaRef))
        })
        return [...mapa.entries()]
            .sort((a, b) => (a[0] < b[0] ? 1 : -1))
            .map(([valor, label]) => ({ valor, label }))
    }, [linhasCompletas])

    const linhasFiltradas = useMemo(() => {
        const passaTriBool = (filtro, valor) => (filtro === 'todos' ? true : filtro === 'sim' ? !!valor : !valor)
        return linhasCompletas.filter((item) => {
            const pilhaBusca = normalizarTextoBusca(
                [
                    item.nome,
                    item.cidadePrincipalNome,
                    item.cidadesSecundarias.join(' '),
                    item.especialidadePrincipalNome,
                    item.especialidadesExtras.join(' '),
                    item.modalidadeEfetiva,
                ]
                    .filter(Boolean)
                    .join(' '),
            )
            if (!filtrarPorTermoBusca(pilhaBusca, termoBusca1)) return false
            if (!filtrarPorTermoBusca(pilhaBusca, termoBusca2)) return false
            if (filtroSituacao && String(item.situacao_id) !== String(filtroSituacao)) return false
            if (!passaTriBool(filtroPdf, item.tem_pdf)) return false
            if (!passaTriBool(filtroSite, item.no_site)) return false
            if (!passaTriBool(filtroMapa, item.no_mapa)) return false
            if (filtroDia !== 'todos' && item.chaveMes !== filtroDia) return false
            return true
        })
    }, [
        linhasCompletas,
        termoBusca1,
        termoBusca2,
        filtroSituacao,
        filtroPdf,
        filtroSite,
        filtroMapa,
        filtroDia,
    ])

    const temFiltroAtivo = useMemo(
        () =>
            !!(
                termoBusca1.trim() ||
                termoBusca2.trim() ||
                filtroSituacao ||
                filtroPdf !== 'todos' ||
                filtroSite !== 'todos' ||
                filtroMapa !== 'todos' ||
                filtroDia !== 'todos'
            ),
        [termoBusca1, termoBusca2, filtroSituacao, filtroPdf, filtroSite, filtroMapa, filtroDia]
    )

    const linhasOrdenadas = useMemo(() => {
        if (!temFiltroAtivo && !ordenacaoAtiva) return linhasFiltradas
        const resultado = [...linhasFiltradas]
        const { coluna, direcao } = ordenacao
        const fator = direcao === 'asc' ? 1 : -1
        resultado.sort((a, b) => {
            const av = coluna === 'enderecoModalidade' ? [a.endereco, a.modalidade].filter(Boolean).join(' ') : a[coluna]
            const bv = coluna === 'enderecoModalidade' ? [b.endereco, b.modalidade].filter(Boolean).join(' ') : b[coluna]
            if (coluna === 'diaRef' || coluna === 'data_atualizacao') {
                return ((av ? new Date(av).getTime() : 0) - (bv ? new Date(bv).getTime() : 0)) * fator
            }
            if (typeof av === 'boolean' || typeof bv === 'boolean') return (Number(!!av) - Number(!!bv)) * fator
            return String(av || '').localeCompare(String(bv || ''), 'pt-BR', { sensitivity: 'base' }) * fator
        })
        return resultado
    }, [linhasFiltradas, ordenacao, temFiltroAtivo, ordenacaoAtiva])

    const totalPaginas = Math.max(1, Math.ceil(linhasOrdenadas.length / Number(itensPorPagina || 20)))
    const paginaAjustada = Math.min(Math.max(1, paginaAtual), totalPaginas)
    useEffect(() => {
        setPaginaAlvoInput(String(paginaAjustada))
    }, [paginaAjustada])

    const irParaPagina = () => {
        const paginaDesejada = Number(String(paginaAlvoInput || '').replace(/\D/g, ''))
        if (!paginaDesejada) return setPaginaAlvoInput(String(paginaAjustada))
        setPaginaAtual(Math.min(totalPaginas, Math.max(1, paginaDesejada)))
    }

    const linhasPaginadas = useMemo(() => {
        const inicio = (paginaAjustada - 1) * Number(itensPorPagina || 20)
        return linhasOrdenadas.slice(inicio, inicio + Number(itensPorPagina || 20))
    }, [linhasOrdenadas, paginaAjustada, itensPorPagina])

    const opcoesCidadesSecundarias = useMemo(() => {
        const cidadesSecundariasNovasNorm = cidadesSecundariasNovas.map((nome) => normalizarTexto(nome))
        return cidades
            .filter((cidade) => normalizarTexto(cidade.nome) !== normalizarTexto(novoCidadePrincipal))
            .filter((cidade) => !cidadesSecundariasSelecionadas.includes(Number(cidade.id)))
            .filter((cidade) => !cidadesSecundariasNovasNorm.includes(normalizarTexto(cidade.nome)))
    }, [cidades, novoCidadePrincipal, cidadesSecundariasSelecionadas, cidadesSecundariasNovas])

    const especialidadesSecundariasSugeridas = useMemo(() => {
        const termo = normalizarTexto(especialidadeSecundariaInput)
        return especialidades
            .filter((item) => Number(item.id) !== Number(novaEspecialidadePrincipalId))
            .filter((item) => !especialidadesSecundariasSelecionadas.includes(Number(item.id)))
            .filter((item) => !termo || normalizarTexto(item.nome).includes(termo))
            .slice(0, 8)
    }, [especialidadeSecundariaInput, especialidades, novaEspecialidadePrincipalId, especialidadesSecundariasSelecionadas])

    const cidadePrincipalObj = useMemo(
        () => cidades.find((item) => normalizarTexto(item.nome) === normalizarTexto(novoCidadePrincipal)) || null,
        [cidades, novoCidadePrincipal]
    )

    const estabelecimentosLocaisDaCidade = useMemo(() => {
        if (!cidadePrincipalObj?.id) return []
        return linhasCompletas.filter(
            (item) =>
                Number(item.cidade_id) === Number(cidadePrincipalObj.id) &&
                Number(item.id) !== Number(prestadorEditandoId || 0) &&
                estabelecimentoVinculavel(item)
        )
    }, [linhasCompletas, cidadePrincipalObj, prestadorEditandoId])

    const estabelecimentosSugeridos = useMemo(() => {
        const termo = normalizarTexto(estabelecimentoInput)
        return estabelecimentosLocaisDaCidade
            .filter((item) => !estabelecimentosSelecionados.includes(Number(item.id)))
            .filter((item) => !termo || normalizarTexto(item.nome).includes(termo))
            .slice(0, 8)
    }, [estabelecimentoInput, estabelecimentosLocaisDaCidade, estabelecimentosSelecionados])

    const estabelecimentosSelecionadosDados = useMemo(
        () =>
            estabelecimentosSelecionados
                .map((id) => estabelecimentosLocaisDaCidade.find((item) => Number(item.id) === Number(id)))
                .filter(Boolean),
        [estabelecimentosSelecionados, estabelecimentosLocaisDaCidade]
    )

    const telefoneAutoClinica = useMemo(
        () =>
            estabelecimentosSelecionadosDados
                .map((item) => item.telefone)
                .filter(Boolean)
                .join(' | '),
        [estabelecimentosSelecionadosDados]
    )

    const modalidadeAutoClinica = useMemo(
        () =>
            estabelecimentosSelecionadosDados
                .map((item) => item.nome)
                .filter(Boolean)
                .join(' | '),
        [estabelecimentosSelecionadosDados]
    )

    const handleOrdenar = (coluna) => {
        setOrdenacaoAtiva(true)
        setOrdenacao((anterior) =>
            anterior.coluna !== coluna
                ? { coluna, direcao: 'asc' }
                : { coluna, direcao: anterior.direcao === 'asc' ? 'desc' : 'asc' }
        )
    }
    const indicadorOrdenacao = (coluna) => (ordenacao.coluna !== coluna ? '' : ordenacao.direcao === 'asc' ? ' ▲' : ' ▼')

    const resetarModal = () => {
        setModalAberto(false)
        setPrestadorEditandoId(null)
        setNovoNome('')
        setNovoTelefone('')
        setNovoCidadePrincipal('')
        setNovoEndereco('')
        setNovoModalidade('')
        setNovaSituacaoId('')
        setNovaEspecialidadePrincipalId('')
        setEspecialidadeSecundariaInput('')
        setEspecialidadesSecundariasSelecionadas([])
        setNovoPdf(false)
        setNovoSite(false)
        setNovoMapa(false)
        setNovoAtendeEmClinica(false)
        setSwitchClinicaAlterado(false)
        setEstabelecimentosSelecionados([])
        setEstabelecimentoInput('')
        setCidadeSecundariaInput('')
        setCidadesSecundariasSelecionadas([])
        setCidadesSecundariasNovas([])
    }

    const adicionarCidadeSecundaria = (cidadeId) => {
        const idNum = Number(cidadeId)
        if (!idNum || cidadesSecundariasSelecionadas.includes(idNum)) return
        setCidadesSecundariasSelecionadas((anteriores) => [...anteriores, idNum])
        setCidadeSecundariaInput('')
    }
    const removerCidadeSecundaria = (cidadeId) =>
        setCidadesSecundariasSelecionadas((anteriores) => anteriores.filter((id) => id !== Number(cidadeId)))

    const adicionarCidadeSecundariaNova = (nomeCidade) => {
        const nome = String(nomeCidade || '').trim()
        if (!nome) return
        const nomeNorm = normalizarTexto(nome)
        const jaExistePorId = cidadesSecundariasSelecionadas.some(
            (cidadeId) => normalizarTexto(cidadePorId.get(Number(cidadeId))?.nome || '') === nomeNorm
        )
        const jaExisteNova = cidadesSecundariasNovas.some((cidade) => normalizarTexto(cidade) === nomeNorm)
        const ehCidadePrincipal = normalizarTexto(novoCidadePrincipal) === nomeNorm
        if (jaExistePorId || jaExisteNova || ehCidadePrincipal) return
        setCidadesSecundariasNovas((anteriores) => [...anteriores, nome])
        setCidadeSecundariaInput('')
    }

    const removerCidadeSecundariaNova = (nomeCidade) =>
        setCidadesSecundariasNovas((anteriores) => anteriores.filter((cidade) => normalizarTexto(cidade) !== normalizarTexto(nomeCidade)))

    const adicionarEspecialidadeSecundaria = (especialidadeId) => {
        const idNum = Number(especialidadeId)
        if (!idNum || especialidadesSecundariasSelecionadas.includes(idNum)) return
        if (idNum === Number(novaEspecialidadePrincipalId)) return
        setEspecialidadesSecundariasSelecionadas((anteriores) => [...anteriores, idNum])
        setEspecialidadeSecundariaInput('')
    }

    const removerEspecialidadeSecundaria = (especialidadeId) =>
        setEspecialidadesSecundariasSelecionadas((anteriores) => anteriores.filter((id) => id !== Number(especialidadeId)))

    const adicionarEstabelecimento = (prestadorId) => {
        const idNum = Number(prestadorId)
        if (!idNum || estabelecimentosSelecionados.includes(idNum)) return
        setEstabelecimentosSelecionados((anteriores) => [...anteriores, idNum])
        setEstabelecimentoInput('')
    }

    const removerEstabelecimento = (prestadorId) =>
        setEstabelecimentosSelecionados((anteriores) => anteriores.filter((id) => id !== Number(prestadorId)))

    const escolherCidadeSecundaria = (valor) => {
        const v = String(valor || '').trim()
        if (!v) return
        const porId = cidades.find((c) => String(c.id) === v)
        if (porId) adicionarCidadeSecundaria(porId.id)
        else adicionarCidadeSecundariaNova(v)
    }

    const obterOuCriarCidadePorNome = async (nomeCidade) => {
        const nome = String(nomeCidade || '').trim()
        if (!nome) return null
        const existente = cidades.find((cidade) => normalizarTexto(cidade.nome) === normalizarTexto(nome))
        if (existente) return existente
        const { data, error } = await supabase
            .from('cidades_credenciamento')
            .insert({ nome })
            .select('id, nome')
            .single()
        if (error) throw new Error(`Erro ao criar cidade "${nome}": ${error.message}`)
        if (data?.id) {
            setCidades((anteriores) => {
                const jaExiste = anteriores.some((cidade) => Number(cidade.id) === Number(data.id))
                if (jaExiste) return anteriores
                return [...anteriores, data].sort((a, b) =>
                    String(a?.nome || '').localeCompare(String(b?.nome || ''), 'pt-BR', { sensitivity: 'base' })
                )
            })
        }
        return data
    }

    const atualizarCampoPrestador = async (prestadorId, campos) => {
        if (somenteLeitura) return
        const idNum = Number(prestadorId)
        const atual = prestadores.find((p) => Number(p.id) === idNum)
        const patchExtra =
            campos.situacao_id !== undefined
                ? patchCredenciadoEmSeTransicao(atual?.situacao_id, campos.situacao_id, situacoes)
                : {}
        const payload = { ...campos, ...patchExtra, data_atualizacao: new Date().toISOString() }
        const { error } = await supabase
            .from('prestadores')
            .update(payload)
            .eq('id', idNum)
        if (error) {
            setErro(`Falha ao atualizar registro: ${error.message}`)
            return
        }
        setPrestadores((anteriores) =>
            anteriores.map((item) => (Number(item.id) === idNum ? { ...item, ...payload } : item))
        )
        if (campos.situacao_id !== undefined) {
            try {
                await sincronizarCardKanbanComSituacao(idNum, campos.situacao_id, { situacoes })
            } catch {
                /* sync Kanban opcional */
            }
        }
    }

    const alternarCampoBooleano = (event, item, campo) => {
        event.stopPropagation()
        if (somenteLeitura) return
        if (event.target instanceof HTMLInputElement) return
        atualizarCampoPrestador(item.id, { [campo]: !item[campo] })
    }

    const abrirConfirmacaoExclusao = (mensagem, onConfirmar) => {
        setConfirmacaoExclusao({ mensagem, onConfirmar })
    }

    const excluirPrestador = async (prestadorId, opcoes = {}) => {
        if (somenteLeitura) return
        const idNum = Number(prestadorId)
        const executarExclusao = async () => {
            const { error } = await supabase
                .from('prestadores')
                .update({ ativo: false, data_atualizacao: new Date().toISOString() })
                .eq('id', idNum)
            if (error) {
                setErro(`Falha ao excluir registro: ${error.message}`)
                return
            }
            setPrestadores((anteriores) => anteriores.filter((item) => Number(item.id) !== idNum))
            setExpandedRowId((atual) => (Number(atual) === idNum ? null : atual))
        }
        if (opcoes.ignorarConfirmacao) {
            await executarExclusao()
            return
        }
        abrirConfirmacaoExclusao('Deseja excluir este cadastro?', executarExclusao)
    }

    const excluirPrestadorPermanente = async (prestadorId, opcoes = {}) => {
        if (!podeExclusaoPermanente) return
        const idNum = Number(prestadorId)
        const executarExclusao = async () => {
            try {
                await excluirPrestadorPermanentemente(idNum)
                setPrestadores((anteriores) => anteriores.filter((item) => Number(item.id) !== idNum))
                setExpandedRowId((atual) => (Number(atual) === idNum ? null : atual))
            } catch (e) {
                setErro(e?.message || String(e))
            }
        }
        const mensagem = `Apagar PERMANENTEMENTE o cadastro #${idNum} do banco de dados?\n\nRemove vínculos, procedimentos e a ficha. Esta ação não pode ser desfeita.`
        if (opcoes.ignorarConfirmacao) {
            await executarExclusao()
            return
        }
        abrirConfirmacaoExclusao(mensagem, executarExclusao)
    }

    const abrirModalEdicao = async (item) => {
        if (somenteLeitura) return
        const idNum = Number(item.id)
        setPrestadorEditandoId(idNum)
        setModalAberto(true)
        setNovoNome(item.nome || '')
        setNovoTelefone(item.telefone ? formatarTelefoneEntrada(item.telefone) : '')
        setNovoCidadePrincipal(cidadePorId.get(Number(item.cidade_id))?.nome || '')
        setNovoEndereco(item.endereco || '')
        setNovoModalidade(item.modalidade || '')
        setNovaSituacaoId(item.situacao_id ? String(item.situacao_id) : '')
        setNovaEspecialidadePrincipalId(item.especialidade_id ? String(item.especialidade_id) : '')
        setNovoPdf(!!item.tem_pdf)
        setNovoSite(!!item.no_site)
        setNovoMapa(!!item.no_mapa)
        let estabelecimentosVinculados = prestadorEstabelecimentos
            .filter((rel) => Number(rel.veterinario_id) === idNum)
            .sort((a, b) => Number(b.principal) - Number(a.principal))
            .map((rel) => Number(rel.estabelecimento_id))
        if (permiteLerPrestadorEstabelecimentos) {
            const { data, error } = await supabase
                .from('prestador_estabelecimentos')
                .select('veterinario_id, estabelecimento_id, principal')
                .eq('veterinario_id', idNum)
            if (!error && Array.isArray(data)) {
                estabelecimentosVinculados = data
                    .sort((a, b) => Number(b.principal) - Number(a.principal))
                    .map((rel) => Number(rel.estabelecimento_id))
                setPrestadorEstabelecimentos((anteriores) => [
                    ...anteriores.filter((rel) => Number(rel.veterinario_id) !== idNum),
                    ...data,
                ])
            } else if (error) {
                setPermiteLerPrestadorEstabelecimentos(false)
            }
        }
        setNovoAtendeEmClinica(estabelecimentosVinculados.length > 0)
        setSwitchClinicaAlterado(false)
        setEstabelecimentosSelecionados([...new Set(estabelecimentosVinculados)])
        setEstabelecimentoInput('')
        const cidadesSec = prestadorCidades
            .filter((rel) => Number(rel.prestador_id) === idNum && !rel.principal)
            .map((rel) => Number(rel.cidade_id))
        setCidadesSecundariasSelecionadas([...new Set(cidadesSec)])
        const especialidadesSec = prestadorEspecialidades
            .filter((rel) => Number(rel.prestador_id) === idNum && !rel.principal)
            .map((rel) => Number(rel.especialidade_id))
        setEspecialidadesSecundariasSelecionadas([...new Set(especialidadesSec)])
        setCidadeSecundariaInput('')
        setEspecialidadeSecundariaInput('')
        setCidadesSecundariasNovas([])
        setCidadePrincipalEmFoco(false)
    }

    const salvarNovoPrestador = async () => {
        if (somenteLeitura) return setErro('Seu perfil tem acesso somente leitura para credenciamento.')
        if (!novoNome.trim()) return setErro('Nome e obrigatorio.')
        if (!novoCidadePrincipal.trim()) return setErro('Cidade principal e obrigatoria.')
        if (!novaEspecialidadePrincipalId) return setErro('Especialidade principal e obrigatoria.')

        const tipoAtual = tipoEspecialidadeAuto
        const tipoEspecialidadeSelecionada = String(especialidadePrincipalSelecionada?.tipo || '').trim()
        const tipoParaSalvar = tipoAtual !== '-' ? tipoAtual : tipoEspecialidadeSelecionada
        if (!tipoParaSalvar) return setErro('A especialidade principal selecionada nao possui tipo definido.')
        if (tipoAtual === 'LOCAL' && !novoEndereco.trim()) return setErro('Para tipo LOCAL, o endereco e obrigatorio.')
        if (tipoAtual === 'ESPECIALIDADE' && !novoAtendeEmClinica && !novoModalidade.trim()) {
            return setErro('Para tipo ESPECIALIDADE, a modalidade e obrigatoria.')
        }
        if (tipoAtual === 'ESPECIALIDADE' && novoAtendeEmClinica && !modalidadeAutoClinica.trim()) {
            return setErro('Selecione a clínica/local para preencher modalidade automaticamente.')
        }
        if (novoAtendeEmClinica && estabelecimentosSelecionados.length === 0) {
            return setErro('Selecione pelo menos uma clínica/local para o veterinario.')
        }

        try {
            const emEdicao = !!prestadorEditandoId
            scrollPosAntesSalvarRef.current = window.scrollY || 0
            if (!emEdicao) setLoading(true)
            setErro('')

            const cidadePrincipalObj = await obterOuCriarCidadePorNome(novoCidadePrincipal)

            const payload = {
                nome: novoNome.trim(),
                tipo: tipoParaSalvar,
                telefone: (novoAtendeEmClinica ? telefoneAutoClinica : novoTelefone).trim() || null,
                cidade_id: Number(cidadePrincipalObj.id),
                endereco: tipoAtual === 'LOCAL' ? novoEndereco.trim() : null,
                modalidade: novoAtendeEmClinica
                    ? null
                    : tipoAtual === 'ESPECIALIDADE'
                        ? novoModalidade.trim() || null
                        : null,
                especialidade_id: Number(novaEspecialidadePrincipalId),
                situacao_id: novaSituacaoId ? Number(novaSituacaoId) : null,
                tem_pdf: !!novoPdf,
                no_site: !!novoSite,
                no_mapa: !!novoMapa,
                data_atualizacao: new Date().toISOString(),
                ...(emEdicao
                    ? patchCredenciadoEmSeTransicao(
                          prestadores.find((p) => Number(p.id) === Number(prestadorEditandoId))?.situacao_id,
                          novaSituacaoId,
                          situacoes,
                      )
                    : patchCredenciadoEmSeTransicao(null, novaSituacaoId, situacoes)),
            }
            if (novoAtendeEmClinica) payload.telefone = null
            let prestadorId = Number(prestadorEditandoId || 0)
            if (emEdicao) {
                const { error: erroUpdate } = await supabase.from('prestadores').update(payload).eq('id', prestadorId)
                if (erroUpdate) return setErro(`Nao foi possivel atualizar: ${erroUpdate.message}`)
            } else {
                const { data: inserido, error: erroInsert } = await supabase.from('prestadores').insert(payload).select('id').single()
                if (erroInsert) return setErro(`Nao foi possivel salvar: ${erroInsert.message}`)
                prestadorId = Number(inserido?.id)
            }

            if (emEdicao) {
                await supabase.from('prestador_cidades').delete().eq('prestador_id', prestadorId)
                await supabase.from('prestador_especialidades').delete().eq('prestador_id', prestadorId)
            }
            const cidadesSecundariasIds = [...cidadesSecundariasSelecionadas]
            for (const nomeCidade of cidadesSecundariasNovas) {
                const cidadeObj = await obterOuCriarCidadePorNome(nomeCidade)
                if (!cidadeObj?.id) continue
                const cidadeIdNum = Number(cidadeObj.id)
                if (!cidadesSecundariasIds.includes(cidadeIdNum)) cidadesSecundariasIds.push(cidadeIdNum)
            }
            const cidadesPayload = [{ prestador_id: prestadorId, cidade_id: Number(cidadePrincipalObj.id), principal: true }]
            for (const cidadeId of cidadesSecundariasIds) {
                if (Number(cidadeId) === Number(cidadePrincipalObj.id)) continue
                const cidadeObj = cidadePorId.get(Number(cidadeId))
                if (!cidadeObj && Number(cidadeId) !== Number(cidadePrincipalObj.id)) {
                    cidadesPayload.push({ prestador_id: prestadorId, cidade_id: Number(cidadeId), principal: false })
                    continue
                }
                if (!cidadeObj) continue
                cidadesPayload.push({ prestador_id: prestadorId, cidade_id: Number(cidadeObj.id), principal: false })
            }
            if (cidadesPayload.length) {
                await supabase.from('prestador_cidades').upsert(cidadesPayload, {
                    onConflict: 'prestador_id,cidade_id',
                    ignoreDuplicates: true })
            }

            const payloadEspecialidades = [{
                prestador_id: prestadorId,
                especialidade_id: Number(novaEspecialidadePrincipalId),
                principal: true }]
            if (especialidadesSecundariasSelecionadas.length) {
                const payloadEspecialidadesSec = especialidadesSecundariasSelecionadas.map((especialidadeId) => ({
                    prestador_id: prestadorId,
                    especialidade_id: Number(especialidadeId),
                    principal: false }))
                payloadEspecialidades.push(...payloadEspecialidadesSec)
            }
            await supabase.from('prestador_especialidades').insert(payloadEspecialidades)
            let payloadEstabelecimentos = []
            if (emEdicao) {
                if (switchClinicaAlterado) {
                    await supabase.from('prestador_estabelecimentos').delete().eq('veterinario_id', prestadorId)
                    payloadEstabelecimentos = novoAtendeEmClinica
                        ? estabelecimentosSelecionados.map((estabelecimentoId, idx) => ({
                            veterinario_id: prestadorId,
                            estabelecimento_id: Number(estabelecimentoId),
                            principal: idx === 0 }))
                        : []
                    if (payloadEstabelecimentos.length) {
                        await supabase.from('prestador_estabelecimentos').insert(payloadEstabelecimentos)
                    }
                }
            } else {
                payloadEstabelecimentos = novoAtendeEmClinica
                    ? estabelecimentosSelecionados.map((estabelecimentoId, idx) => ({
                        veterinario_id: prestadorId,
                        estabelecimento_id: Number(estabelecimentoId),
                        principal: idx === 0 }))
                    : []
                if (payloadEstabelecimentos.length) {
                    await supabase.from('prestador_estabelecimentos').insert(payloadEstabelecimentos)
                }
            }

            if (emEdicao) {
                setPrestadores((anteriores) =>
                    anteriores.map((item) => (Number(item.id) === prestadorId ? { ...item, ...payload } : item))
                )
                setPrestadorCidades((anteriores) => [
                    ...anteriores.filter((item) => Number(item.prestador_id) !== prestadorId),
                    ...cidadesPayload,
                ])
                setPrestadorEspecialidades((anteriores) => [
                    ...anteriores.filter((item) => Number(item.prestador_id) !== prestadorId),
                    ...payloadEspecialidades,
                ])
                if (switchClinicaAlterado) {
                    setPrestadorEstabelecimentos((anteriores) => [
                        ...anteriores.filter((item) => Number(item.veterinario_id) !== prestadorId),
                        ...payloadEstabelecimentos,
                    ])
                }
                requestAnimationFrame(() => {
                    window.scrollTo({ top: scrollPosAntesSalvarRef.current, behavior: 'auto' })
                })
            } else {
                await carregarBase()
                setOrdenacao({ coluna: 'data_atualizacao', direcao: 'desc' })
                setPaginaAtual(1)
            }
            if (tipoAtual === 'LOCAL' && prestadorId) {
                solicitarGeocodePrestador(prestadorId)
            }
            if (prestadorId && novaSituacaoId) {
                try {
                    await sincronizarCardKanbanComSituacao(prestadorId, novaSituacaoId, { situacoes })
                } catch {
                    /* sync Kanban opcional */
                }
            }
            resetarModal()
        } catch (error) {
            setErro(error?.message || `Erro ao salvar: ${error}`)
        } finally {
            if (!prestadorEditandoId) setLoading(false)
        }
    }

    return (
        <div className='el-legacy-wrap credenciamento_main'>
            <PageHeader kicker="Credenciamento" title="Principal" />

            <header className={`credenciamento_main_header ${headerCompacto ? 'is-compact' : ''}`}>
                <h2>Filtros</h2>
                <div className='credenciamento_main_filters'>
                    <div className='credenciamento_main_filters_layout'>
                        <div className='credenciamento_main_filters_selectors'>
                            <div className='credenciamento_main_filters_row'>
                                <div className='credenciamento_main_filter_item credenciamento_main_filter_busca'>
                                    <p>Busca</p>
                                    <CampoBuscaComLimpar
                                        className='credenciamento_main_input'
                                        placeholder='Nome, especialidade, cidades ou tipos'
                                        value={termoBusca1}
                                        onChange={(event) => setTermoBusca1(event.target.value)}
                                    />
                                </div>
                                <div className='credenciamento_main_filter_item credenciamento_main_filter_busca'>
                                    <p>Refinar busca</p>
                                    <CampoBuscaComLimpar
                                        className='credenciamento_main_input'
                                        placeholder='Refinar busca (2º critério)'
                                        value={termoBusca2}
                                        onChange={(event) => setTermoBusca2(event.target.value)}
                                    />
                                </div>
                                <div className='credenciamento_main_filter_item'>
                                    <p>Situação</p>
                                    <select className='credenciamento_main_select' value={filtroSituacao} onChange={(e) => setFiltroSituacao(e.target.value)}>
                                        <option value=''>Todas</option>
                                        {situacoes.map((situacao) => (
                                            <option key={`sit-filtro-${situacao.id}`} value={situacao.id}>
                                                {situacao.descricao}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div className='credenciamento_main_filters_row'>
                                {mostrarColunaPdf && (
                                    <div className='credenciamento_main_filter_item'>
                                        <p>PDF</p>
                                        <select className='credenciamento_main_select' value={filtroPdf} onChange={(e) => setFiltroPdf(e.target.value)}>
                                            <option value='todos'>Todos</option>
                                            <option value='sim'>Com PDF</option>
                                            <option value='nao'>Sem PDF</option>
                                        </select>
                                    </div>
                                )}
                                {mostrarColunaSite && (
                                    <div className='credenciamento_main_filter_item'>
                                        <p>Site</p>
                                        <select className='credenciamento_main_select' value={filtroSite} onChange={(e) => setFiltroSite(e.target.value)}>
                                            <option value='todos'>Todos</option>
                                            <option value='sim'>No site</option>
                                            <option value='nao'>Fora do site</option>
                                        </select>
                                    </div>
                                )}
                                {mostrarColunaMapa && (
                                    <div className='credenciamento_main_filter_item'>
                                        <p>Mapa</p>
                                        <select className='credenciamento_main_select' value={filtroMapa} onChange={(e) => setFiltroMapa(e.target.value)}>
                                            <option value='todos'>Todos</option>
                                            <option value='sim'>No mapa</option>
                                            <option value='nao'>Fora do mapa</option>
                                        </select>
                                    </div>
                                )}
                                <div className='credenciamento_main_filter_item'>
                                    <p>Dia</p>
                                    <select className='credenciamento_main_select' value={filtroDia} onChange={(e) => setFiltroDia(e.target.value)}>
                                        <option value='todos'>Todos</option>
                                        {opcoesFiltroMes.map((opcao) => (
                                            <option key={`mes-${opcao.valor}`} value={opcao.valor}>
                                                {opcao.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            {podeDevTool && (
                            <div className='credenciamento_main_colunas_toggle' role='group' aria-label='Dev Tool — colunas extras'>
                                <span className='credenciamento_main_colunas_toggle_label'>Dev · colunas:</span>
                                <label className='credenciamento_main_colunas_toggle_item'>
                                    <input
                                        type='checkbox'
                                        checked={colProc.pdf}
                                        onChange={() => toggleColuna('processos', 'pdf')}
                                    />
                                    PDF
                                </label>
                                <label className='credenciamento_main_colunas_toggle_item'>
                                    <input
                                        type='checkbox'
                                        checked={colProc.site}
                                        onChange={() => toggleColuna('processos', 'site')}
                                    />
                                    Site
                                </label>
                                <label className='credenciamento_main_colunas_toggle_item'>
                                    <input
                                        type='checkbox'
                                        checked={colProc.mapa}
                                        onChange={() => toggleColuna('processos', 'mapa')}
                                    />
                                    Mapa
                                </label>
                            </div>
                            )}
                        </div>
                        <div className='credenciamento_main_filters_actions'>
                            {!somenteLeitura && (
                                <button
                                    type='button'
                                    className='credenciamento_main_action_btn'
                                    onClick={() => {
                                        resetarModal()
                                        setModalAberto(true)
                                    }}
                                >
                                    ＋ Novo cadastro
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            <CredenciamentoMainAlert message={erro} onClose={() => setErro('')} role="alert" />
            {somenteLeitura && (
                <CredenciamentoMainAlert
                    message="Perfil com acesso somente leitura: filtros e pesquisa liberados, edição bloqueada."
                    role="status"
                    persist
                />
            )}

            <div className='credenciamento_main_table_container overflow-x-auto'>
                {loading ? (
                    <p>Carregando...</p>
                ) : (
                    <>
                        <table
                            className={`table_main${!mostrarColunaPdf && !mostrarColunaSite && !mostrarColunaMapa ? ' cred_table_sem_flags' : ''}`}
                        >
                            <thead>
                                <tr>
                                    <th className='table_header' onClick={() => handleOrdenar('nome')}>Nome{indicadorOrdenacao('nome')}</th>
                                    <th className='table_header' onClick={() => handleOrdenar('cidadePrincipalNome')}>Cidade{indicadorOrdenacao('cidadePrincipalNome')}</th>
                                    <th className='table_header' onClick={() => handleOrdenar('especialidadePrincipalNome')}>Especialidade{indicadorOrdenacao('especialidadePrincipalNome')}</th>
                                    <th className='table_header' onClick={() => handleOrdenar('telefone')}>Telefone{indicadorOrdenacao('telefone')}</th>
                                    <th className='table_header cred_col_endereco' onClick={() => handleOrdenar('enderecoModalidade')}>Endereço/Modalidade{indicadorOrdenacao('enderecoModalidade')}</th>
                                    <th className='table_header cred_col_situacao' onClick={() => handleOrdenar('situacaoDescricao')}>Situação{indicadorOrdenacao('situacaoDescricao')}</th>
                                    {mostrarColunaPdf && (
                                        <th className='table_header cred_col_flag' onClick={() => handleOrdenar('tem_pdf')}>
                                            PDF{indicadorOrdenacao('tem_pdf')}
                                        </th>
                                    )}
                                    {mostrarColunaSite && (
                                        <th className='table_header cred_col_flag' onClick={() => handleOrdenar('no_site')}>
                                            Site{indicadorOrdenacao('no_site')}
                                        </th>
                                    )}
                                    {mostrarColunaMapa && (
                                        <th className='table_header cred_col_flag' onClick={() => handleOrdenar('no_mapa')}>
                                            Mapa{indicadorOrdenacao('no_mapa')}
                                        </th>
                                    )}
                                    <th className='table_header cred_col_dia' onClick={() => handleOrdenar('diaRef')}>Dia{indicadorOrdenacao('diaRef')}</th>
                                    {!somenteLeitura && <th className='table_header cred_col_excluir'>Excluir</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {linhasPaginadas.map((item) => (
                                    <React.Fragment key={`cred-row-${item.id}`}>
                                        <tr
                                            className='credenciamento_main_clickrow'
                                            onClick={() => setExpandedRowId((atual) => (Number(atual) === Number(item.id) ? null : Number(item.id)))}
                                        >
                                            <td
                                                className='table_text_left credenciamento_main_nome_click'
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    if (somenteLeitura) return
                                                    abrirModalEdicao(item)
                                                }}
                                            >
                                                {item.nome}
                                            </td>
                                            <td className='table_text_left'>{item.cidadePrincipalNome}</td>
                                            <td className='table_text_left'>{item.especialidadePrincipalNome}</td>
                                            <td className='table_text_left'>{item.telefoneEfetivo ? formatarTelefoneEntrada(item.telefoneEfetivo) : '-'}</td>
                                            <td className='table_text_left cred_col_endereco'>{[item.endereco, item.modalidadeEfetiva].filter(Boolean).join(' | ') || '-'}</td>
                                            <td onClick={(e) => e.stopPropagation()} className='cred_col_situacao'>
                                                <select
                                                    className={`credenciamento_inline_select credenciamento_inline_select_situacao ${classeCorSituacao(
                                                        situacaoPorId.get(Number(item.situacao_id))?.descricao || ''
                                                    )}`}
                                                    value={item.situacao_id || ''}
                                                    disabled={somenteLeitura}
                                                    onChange={(e) =>
                                                        atualizarCampoPrestador(item.id, {
                                                            situacao_id: e.target.value ? Number(e.target.value) : null })
                                                    }
                                                >
                                                    <option value=''>-</option>
                                                    {situacoes.map((situacao) => (
                                                        <option key={`sit-inline-${item.id}-${situacao.id}`} value={situacao.id}>
                                                            {situacao.descricao}
                                                        </option>
                                                    ))}
                                                </select>
                                            </td>
                                            {mostrarColunaPdf && (
                                                <td
                                                    onClick={(e) => alternarCampoBooleano(e, item, 'tem_pdf')}
                                                    className={`cred_col_flag ${!item.tem_pdf ? 'credenciamento_checkbox_false' : ''}`}
                                                >
                                                    <input
                                                        type='checkbox'
                                                        checked={!!item.tem_pdf}
                                                        disabled={somenteLeitura}
                                                        onClick={(e) => e.stopPropagation()}
                                                        onChange={(e) => atualizarCampoPrestador(item.id, { tem_pdf: e.target.checked })}
                                                    />
                                                </td>
                                            )}
                                            {mostrarColunaSite && (
                                                <td
                                                    onClick={(e) => alternarCampoBooleano(e, item, 'no_site')}
                                                    className={`cred_col_flag ${!item.no_site ? 'credenciamento_checkbox_false' : ''}`}
                                                >
                                                    <input
                                                        type='checkbox'
                                                        checked={!!item.no_site}
                                                        disabled={somenteLeitura}
                                                        onClick={(e) => e.stopPropagation()}
                                                        onChange={(e) => atualizarCampoPrestador(item.id, { no_site: e.target.checked })}
                                                    />
                                                </td>
                                            )}
                                            {mostrarColunaMapa && (
                                                <td
                                                    onClick={(e) => alternarCampoBooleano(e, item, 'no_mapa')}
                                                    className={`cred_col_flag ${!item.no_mapa ? 'credenciamento_checkbox_false' : ''}`}
                                                >
                                                    <input
                                                        type='checkbox'
                                                        checked={!!item.no_mapa}
                                                        disabled={somenteLeitura}
                                                        onClick={(e) => e.stopPropagation()}
                                                        onChange={(e) => atualizarCampoPrestador(item.id, { no_mapa: e.target.checked })}
                                                    />
                                                </td>
                                            )}
                                            <td className='cred_col_dia'>{formatarData(item.diaRef)}</td>
                                            {!somenteLeitura && (
                                                <td onClick={(e) => e.stopPropagation()} className='credenciamento_main_actions_cell cred_col_excluir'>
                                                    <button
                                                        type='button'
                                                        className='table_delete_btn'
                                                        onClick={(event) =>
                                                            excluirPrestador(item.id, { ignorarConfirmacao: event.shiftKey })
                                                        }
                                                        title='Excluir cadastro, SHIFT = Excluir rápido'
                                                    >
                                                        🗑️
                                                    </button>
                                                    {podeExclusaoPermanente ? (
                                                        <button
                                                            type='button'
                                                            className='table_delete_btn cred_delete_btn_permanent'
                                                            onClick={(event) =>
                                                                excluirPrestadorPermanente(item.id, {
                                                                    ignorarConfirmacao: event.shiftKey })
                                                            }
                                                            title='Apagar do banco permanentemente, SHIFT = sem confirmação'
                                                        >
                                                            ⚠️
                                                        </button>
                                                    ) : null}
                                                </td>
                                            )}
                                        </tr>

                                        {Number(expandedRowId) === Number(item.id) && (
                                            <tr className='credenciamento_main_detail_row'>
                                                <td colSpan={totalColunasTabela}>
                                                    <div className='credenciamento_main_detail_box'>
                                                        <p>
                                                            <strong>Outras cidades:</strong> {item.cidadesSecundarias.join(', ') || 'Nenhuma'}
                                                        </p>
                                                        <p>
                                                            <strong>Outras especialidades:</strong>{' '}
                                                            {item.especialidadesExtras.join(', ') || 'Nenhuma'}
                                                        </p>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))}
                                {!loading && linhasPaginadas.length === 0 && (
                                    <tr>
                                        <td colSpan={totalColunasTabela}>Nenhum prestador encontrado.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>

                        {linhasOrdenadas.length > 0 && (
                            <div className='credenciamento_main_paginacao'>
                                <div className='credenciamento_main_paginacao_info'>
                                    Exibindo <strong>{(paginaAjustada - 1) * itensPorPagina + 1}-{Math.min(paginaAjustada * itensPorPagina, linhasOrdenadas.length)}</strong> de <strong>{linhasOrdenadas.length}</strong>
                                </div>
                                <div className='credenciamento_main_paginacao_controles'>
                                    <div className='credenciamento_main_paginacao_grupo'>
                                        <label className='credenciamento_main_paginacao_label'>
                                            Por página
                                            <select className='credenciamento_main_select' value={itensPorPagina} onChange={(e) => setItensPorPagina(Number(e.target.value))}>
                                                <option value={20}>20</option>
                                                <option value={30}>30</option>
                                                <option value={40}>40</option>
                                                <option value={100}>100</option>
                                            </select>
                                        </label>
                                    </div>
                                    <div className='credenciamento_main_paginacao_grupo credenciamento_main_paginacao_grupo--nav'>
                                        <button type='button' className='credenciamento_main_action_btn secondary' onClick={() => setPaginaAtual((anterior) => Math.max(1, anterior - 1))} disabled={paginaAjustada <= 1}>Anterior</button>
                                        <span className='credenciamento_main_paginacao_page'>Página {paginaAjustada} de {totalPaginas}</span>
                                        <button type='button' className='credenciamento_main_action_btn secondary' onClick={() => setPaginaAtual((anterior) => Math.min(totalPaginas, anterior + 1))} disabled={paginaAjustada >= totalPaginas}>Próxima</button>
                                    </div>
                                    <div className='credenciamento_main_paginacao_grupo credenciamento_main_paginacao_grupo--ir'>
                                        <label className='credenciamento_main_paginacao_label credenciamento_main_paginacao_ir_label'>
                                            Ir para
                                            <input
                                                type='text'
                                                inputMode='numeric'
                                                className='credenciamento_main_input credenciamento_main_paginacao_ir_input'
                                                value={paginaAlvoInput}
                                                onChange={(e) => setPaginaAlvoInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') irParaPagina()
                                                }}
                                            />
                                        </label>
                                        <button type='button' className='credenciamento_main_action_btn secondary' onClick={irParaPagina}>Ir</button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {modalAberto && (
                <div className='credenciamento_modal_backdrop' onClick={resetarModal}>
                    <div className='credenciamento_modal' onClick={(event) => event.stopPropagation()}>
                        <h3>{prestadorEditandoId ? 'Editar cadastro de credenciamento' : 'Novo cadastro de credenciamento'}</h3>
                        <div className='credenciamento_modal_grid'>
                            <label>
                                <span>Nome *</span>
                                <input type='text' value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
                            </label>
                            <label>
                                <span>Especialidade principal *</span>
                                <select value={novaEspecialidadePrincipalId} onChange={(e) => setNovaEspecialidadePrincipalId(e.target.value)}>
                                    <option value=''>Selecionar</option>
                                    {especialidades.map((especialidade) => (
                                        <option key={`esp-principal-${especialidade.id}`} value={especialidade.id}>
                                            {especialidade.nome}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label>
                                <span>Telefone</span>
                                <input
                                    type='text'
                                    value={novoAtendeEmClinica ? formatarTelefoneEntrada(telefoneAutoClinica) : novoTelefone}
                                    onChange={(e) => setNovoTelefone(formatarTelefoneEntrada(e.target.value))}
                                    placeholder='(00)0.0000-0000'
                                    readOnly={novoAtendeEmClinica}
                                />
                            </label>
                            <label>
                                <span>Cidade principal *</span>
                                <SelectMunicipioBusca
                                    value={novoCidadePrincipal}
                                    valueKey="nome"
                                    options={cidades}
                                    creatable
                                    createLabel={(q) => `Adicionar nova cidade: ${q}`}
                                    onChange={setNovoCidadePrincipal}
                                    placeholder="Digite ou selecione"
                                    aria-label="Cidade principal"
                                />
                            </label>

                            <label>
                                <span>Situação</span>
                                <select value={novaSituacaoId} onChange={(e) => setNovaSituacaoId(e.target.value)}>
                                    <option value=''>Selecionar</option>
                                    {situacoes.map((situacao) => (
                                        <option key={`sit-add-${situacao.id}`} value={situacao.id}>
                                            {situacao.descricao}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label>
                                <span>Atende em clínica?</span>
                                <button
                                    type='button'
                                    role='switch'
                                    aria-checked={novoAtendeEmClinica}
                                    className={`credenciamento_switch ${novoAtendeEmClinica ? 'is-on' : 'is-off'}`}
                                    onClick={() => {
                                        setSwitchClinicaAlterado(true)
                                        setNovoAtendeEmClinica((anterior) => !anterior)
                                        setEstabelecimentosSelecionados([])
                                        setEstabelecimentoInput('')
                                    }}
                                >
                                    <span className='credenciamento_switch_track'>
                                        <span className='credenciamento_switch_knob' />
                                    </span>
                                    <span className='credenciamento_switch_label'>
                                        {novoAtendeEmClinica ? 'Sim' : 'Nao'}
                                    </span>
                                </button>
                            </label>
                            {tipoEspecialidadeAuto === 'LOCAL' && (
                                <label className='credenciamento_modal_full'>
                                    <span>Endereço *</span>
                                    <input type='text' value={novoEndereco} onChange={(e) => setNovoEndereco(e.target.value)} />
                                </label>
                            )}
                            {tipoEspecialidadeAuto === 'ESPECIALIDADE' && (
                                <label className='credenciamento_modal_full'>
                                    <span>Modalidade *</span>
                                    <input
                                        type='text'
                                        value={novoAtendeEmClinica ? modalidadeAutoClinica : novoModalidade}
                                        onChange={(e) => setNovoModalidade(e.target.value)}
                                        readOnly={novoAtendeEmClinica}
                                    />
                                </label>
                            )}

                            {novoAtendeEmClinica && (
                                <label className='credenciamento_modal_full'>
                                    <span>Clínica</span>
                                    <input
                                        type='text'
                                        value={estabelecimentoInput}
                                        placeholder={
                                            cidadePrincipalObj
                                                ? 'Digite para buscar e clique para adicionar'
                                                : 'Selecione a cidade principal primeiro'
                                        }
                                        onChange={(e) => setEstabelecimentoInput(e.target.value)}
                                        disabled={!cidadePrincipalObj}
                                    />
                                    {estabelecimentosSugeridos.length > 0 && estabelecimentoInput.trim() && (
                                        <div className='credenciamento_modal_sugestoes'>
                                            {estabelecimentosSugeridos.map((item) => (
                                                <button
                                                    type='button'
                                                    key={`estab-sug-${item.id}`}
                                                    onClick={() => adicionarEstabelecimento(item.id)}
                                                >
                                                    {item.nome}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    <div className='credenciamento_modal_tags'>
                                        {estabelecimentosSelecionadosDados.map((item) => (
                                            <span key={`tag-estab-${item.id}`} className='credenciamento_modal_tag'>
                                                {item.nome}
                                                <button type='button' onClick={() => removerEstabelecimento(item.id)}>x</button>
                                            </span>
                                        ))}
                                    </div>
                                </label>
                            )}

                            <label className='credenciamento_modal_full'>
                                <span>Cidades secundárias (tags)</span>
                                <SelectMunicipioBusca
                                    value={cidadeSecundariaInput}
                                    valueKey="id"
                                    options={opcoesCidadesSecundarias}
                                    creatable
                                    createLabel={(q) => `Adicionar nova cidade: ${q}`}
                                    onChange={escolherCidadeSecundaria}
                                    placeholder="Buscar e adicionar cidade"
                                    aria-label="Cidades secundárias"
                                />
                                <div className='credenciamento_modal_tags'>
                                    {cidadesSecundariasSelecionadas.map((cidadeId) => (
                                        <span key={`tag-cidade-${cidadeId}`} className='credenciamento_modal_tag'>
                                            {cidadePorId.get(Number(cidadeId))?.nome || cidadeId}
                                            <button type='button' onClick={() => removerCidadeSecundaria(cidadeId)}>x</button>
                                        </span>
                                    ))}
                                    {cidadesSecundariasNovas.map((nomeCidade) => (
                                        <span key={`tag-cidade-nova-${nomeCidade}`} className='credenciamento_modal_tag'>
                                            {nomeCidade}
                                            <button type='button' onClick={() => removerCidadeSecundariaNova(nomeCidade)}>x</button>
                                        </span>
                                    ))}
                                </div>
                            </label>

                            <label className='credenciamento_modal_full'>
                                <span>Especialidades secundárias (tags)</span>
                                <input
                                    type='text'
                                    value={especialidadeSecundariaInput}
                                    placeholder='Digite para buscar e clique para adicionar'
                                    onChange={(e) => setEspecialidadeSecundariaInput(e.target.value)}
                                />
                                {especialidadesSecundariasSugeridas.length > 0 && especialidadeSecundariaInput.trim() && (
                                    <div className='credenciamento_modal_sugestoes'>
                                        {especialidadesSecundariasSugeridas.map((especialidade) => (
                                            <button
                                                type='button'
                                                key={`esp-sug-${especialidade.id}`}
                                                onClick={() => adicionarEspecialidadeSecundaria(especialidade.id)}
                                            >
                                                {especialidade.nome}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <div className='credenciamento_modal_tags'>
                                    {especialidadesSecundariasSelecionadas.map((especialidadeId) => (
                                        <span key={`tag-especialidade-${especialidadeId}`} className='credenciamento_modal_tag'>
                                            {especialidadePorId.get(Number(especialidadeId))?.nome || especialidadeId}
                                            <button type='button' onClick={() => removerEspecialidadeSecundaria(especialidadeId)}>x</button>
                                        </span>
                                    ))}
                                </div>
                            </label>
                        </div>

                        <div className='credenciamento_modal_checks'>
                            <label className={!novoPdf ? 'credenciamento_checkbox_false' : ''}>
                                <input type='checkbox' checked={novoPdf} onChange={(e) => setNovoPdf(e.target.checked)} />
                                PDF
                            </label>
                            <label className={!novoSite ? 'credenciamento_checkbox_false' : ''}>
                                <input type='checkbox' checked={novoSite} onChange={(e) => setNovoSite(e.target.checked)} />
                                Site
                            </label>
                            <label className={!novoMapa ? 'credenciamento_checkbox_false' : ''}>
                                <input type='checkbox' checked={novoMapa} onChange={(e) => setNovoMapa(e.target.checked)} />
                                Mapa
                            </label>
                        </div>

                        <div className='credenciamento_modal_actions'>
                            <button type='button' className='credenciamento_main_action_btn' onClick={salvarNovoPrestador}>
                                {prestadorEditandoId ? 'Atualizar' : 'Salvar'}
                            </button>
                            <button type='button' className='credenciamento_main_action_btn secondary' onClick={resetarModal}>Cancelar</button>
                        </div>

                    </div>
                </div>
            )}

            {confirmacaoExclusao && (
                <div className='credenciamento_confirm_toast' role='alertdialog' aria-live='assertive'>
                    <div className='credenciamento_confirm_text'>
                        <strong>Confirmar exclusão</strong>
                        <span>{confirmacaoExclusao.mensagem}</span>
                    </div>
                    <div className='credenciamento_confirm_actions'>
                        <button
                            type='button'
                            className='credenciamento_confirm_btn danger'
                            onClick={async () => {
                                const acao = confirmacaoExclusao.onConfirmar
                                setConfirmacaoExclusao(null)
                                await acao()
                            }}
                        >
                            Confirmar
                        </button>
                        <button type='button' className='credenciamento_confirm_btn' onClick={() => setConfirmacaoExclusao(null)}>
                            Cancelar
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

export default Credenciamento_main
