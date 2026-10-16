import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    DEFAULT_INVITED_PERMISSIONS,
    normalizarProfileAcesso,
    normalizarPermissions,
    setStoredAccessProfile,
} from '../../../lib/accessControl'
import PermissoesCascade from './PermissoesCascade'
import { filtrarPorTermoBusca, normalizarTextoBusca } from '../../../lib/prestadorCadastroHelpers'
import {
    EMERMARKETING_GROUP_ID,
    EMERMARKETING_URL_PADRAO,
    PERMISSION_CATALOG,
    aclKey,
    aplicarFerramentaAcl,
    hasAcl,
    syncLegacyFromAcl,
} from '../../../lib/permissionCatalog'
import {
    urlEmerMarketing,
    usuarioSomenteEmerMarketing,
} from '../../../lib/emermarketingAccess'
import { supabase } from '../../../lib/supabase'
import { useAutoDismiss } from '../../../lib/toastUi.js'
import './GerenciamentoAcessos.css'
import './PermissoesCascade.css'
import {
    Button,
    EmptyState,
    Input,
    LoadingState,
    Modal,
    PageHeader,
    buttonClassName,
} from '../../../components/ui'
import {
    PASSWORD_MIN_LENGTH,
    textoAjudaPoliticaSenha,
    validarPoliticaSenha,
} from '../../../lib/passwordPolicy'

const PASSOS_CONVITE = [
    { id: 1, label: 'Conta' },
    { id: 2, label: 'Destino' },
    { id: 3, label: 'Permissões' },
]

const DESTINOS_CONVITE = [
    {
        id: 'emerlab',
        titulo: 'EmerLAB',
        desc: 'Credenciamento, compras, contratos e demais ferramentas.',
    },
    {
        id: 'emermarketing',
        titulo: 'EmerMarketing',
        desc: 'Só o app de marketing. O e-mail leva ao login do marketing.',
    },
    {
        id: 'ambos',
        titulo: 'Ambos',
        desc: 'EmerLAB e portal EmerMarketing no mesmo usuário.',
    },
]

function contarFerramentasComAcesso(permissions) {
    let total = 0
    let comAcesso = 0
    for (const grupo of PERMISSION_CATALOG) {
        for (const tool of grupo.tools) {
            total += 1
            if (tool.actions.some((action) => hasAcl(permissions, tool.id, action))) {
                comAcesso += 1
            }
        }
    }
    return { comAcesso, total }
}

const permissoesPadraoNovoUsuario = () =>
    normalizarPermissions({ permissions: { ...DEFAULT_INVITED_PERMISSIONS } })

function limparPermissoesEmermarketing(permissions = {}) {
    let next = { ...permissions }
    const grupo = PERMISSION_CATALOG.find((g) => g.id === EMERMARKETING_GROUP_ID)
    for (const tool of grupo?.tools || []) {
        for (const action of tool.actions || []) {
            next[aclKey(tool.id, action)] = false
        }
    }
    return syncLegacyFromAcl(next)
}

function permissoesSomenteEmermarketing() {
    let p = {}
    p = aplicarFerramentaAcl(p, 'emermarketing.app', 'read', true)
    p = aplicarFerramentaAcl(p, 'emermarketing.app', 'update', true)
    p = aplicarFerramentaAcl(p, 'emermarketing.dashboard', 'read', true)
    return syncLegacyFromAcl(p)
}

function permissoesEmerlabComMarketing(base = permissoesPadraoNovoUsuario()) {
    let p = limparPermissoesEmermarketing(base)
    p = aplicarFerramentaAcl(p, 'emermarketing.app', 'read', true)
    p = aplicarFerramentaAcl(p, 'emermarketing.dashboard', 'read', true)
    return syncLegacyFromAcl(p)
}

/** @param {'emerlab' | 'emermarketing' | 'ambos'} destino */
function permissoesParaDestinoConvite(destino) {
    if (destino === 'emermarketing') return permissoesSomenteEmermarketing()
    if (destino === 'ambos') return permissoesEmerlabComMarketing()
    return limparPermissoesEmermarketing(permissoesPadraoNovoUsuario())
}

function formatarDataLog(iso) {
    if (!iso) return '—'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return String(iso)
    return d.toLocaleString('pt-BR')
}

function badgeSenhaUsuario(usuario) {
    if (usuario.forcePasswordChangeReason === 'admin') return 'Troca exigida'
    if (usuario.forcePasswordChangeReason === 'expired') return 'Senha expirada'
    if (usuario.forcePasswordChange) return 'Troca pendente'
    return null
}

const GerenciamentoAcessos = () => {
    const [usuarios, setUsuarios] = useState([])
    const [usuarioSelecionadoId, setUsuarioSelecionadoId] = useState('')
    const [usuarioAtualId, setUsuarioAtualId] = useState('')
    const [loading, setLoading] = useState(false)
    const [mensagem, setMensagem] = useState('')
    const [erro, setErro] = useState('')
    const [busca, setBusca] = useState('')

    useAutoDismiss(Boolean(mensagem || erro), () => {
        setMensagem('')
        setErro('')
    })

    const [abaDetalhe, setAbaDetalhe] = useState('permissoes')
    const [mostrarConvite, setMostrarConvite] = useState(false)
    const [passoConvite, setPassoConvite] = useState(1)
    /** 'invite' = email de convite | 'create' = criar com senha imediata */
    const [modoNovoUsuario, setModoNovoUsuario] = useState('create')
    const [destinoConvite, setDestinoConvite] = useState('emerlab')
    const [logs, setLogs] = useState([])
    const [logsAviso, setLogsAviso] = useState('')
    const [logsLoading, setLogsLoading] = useState(false)
    const [erroPasso, setErroPasso] = useState('')
    const [convite, setConvite] = useState({
        name: '',
        email: '',
        password: '',
        passwordConfirm: '',
        permissions: permissoesParaDestinoConvite('emerlab'),
    })
    const [edicao, setEdicao] = useState(null)

    const usuarioSelecionado = useMemo(
        () => usuarios.find((usuario) => String(usuario.id) === String(usuarioSelecionadoId)) || null,
        [usuarios, usuarioSelecionadoId],
    )

    const resumoPermissoesConvite = useMemo(
        () => contarFerramentasComAcesso(convite.permissions),
        [convite.permissions],
    )

    const resumoPermissoesEdicao = useMemo(
        () => (edicao ? contarFerramentasComAcesso(edicao.permissions) : { comAcesso: 0, total: 0 }),
        [edicao],
    )

    const usuariosFiltrados = useMemo(() => {
        const termo = busca
        if (!String(termo || '').trim()) return usuarios
        return usuarios.filter((usuario) => {
            const blob = normalizarTextoBusca(`${usuario.name || ''} ${usuario.email || ''}`)
            return filtrarPorTermoBusca(blob, termo)
        })
    }, [busca, usuarios])

    const linkMarketing = urlEmerMarketing() || EMERMARKETING_URL_PADRAO

    const chamarAdminUsers = async (payload) => {
        const refreshed = await supabase.auth.refreshSession()
        const session =
            refreshed.data?.session ||
            (await supabase.auth.getSession()).data?.session
        const token = session?.access_token
        if (!token) throw new Error('Sessão expirada. Faça login novamente.')

        const resp = await fetch('/api/admin-users', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                ...payload,
                redirectTo: `${window.location.origin}/alterar-senha?from=recovery`,
            }),
        })

        const raw = await resp.text()
        let json = {}
        try {
            json = raw ? JSON.parse(raw) : {}
        } catch {
            json = {}
        }
        if (!resp.ok || json?.ok === false) {
            const detalhe =
                json?.error ||
                (raw && !raw.trim().startsWith('<') ? raw.slice(0, 240) : '') ||
                `Falha na operação administrativa (HTTP ${resp.status}).`
            throw new Error(detalhe)
        }
        return json
    }

    const mostrarMensagem = (texto) => {
        setErro('')
        setMensagem(texto)
    }

    const mostrarErro = (texto) => {
        setMensagem('')
        setErro(texto)
    }

    const carregarUsuarios = async () => {
        setLoading(true)
        try {
            const { data: userData } = await supabase.auth.getUser()
            setUsuarioAtualId(userData?.user?.id || '')

            const json = await chamarAdminUsers({ action: 'list' })
            const lista = (json.profiles || []).map((profile) => normalizarProfileAcesso(profile))
            setUsuarios(lista)
            setUsuarioSelecionadoId((prev) => prev || lista[0]?.id || '')
        } catch (error) {
            mostrarErro(error.message)
        } finally {
            setLoading(false)
        }
    }

    const carregarLogs = useCallback(async (userId) => {
        if (!userId) {
            setLogs([])
            setLogsAviso('')
            return
        }
        setLogsLoading(true)
        try {
            const json = await chamarAdminUsers({ action: 'listAudit', userId, limit: 100 })
            setLogs(json.logs || [])
            setLogsAviso(json.aviso || '')
        } catch (error) {
            setLogs([])
            setLogsAviso('')
            mostrarErro(error.message)
        } finally {
            setLogsLoading(false)
        }
    }, [])

    useEffect(() => {
        carregarUsuarios()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        if (!usuarioSelecionado) {
            setEdicao(null)
            return
        }
        setEdicao({
            id: usuarioSelecionado.id,
            name: usuarioSelecionado.name || '',
            email: usuarioSelecionado.email || '',
            permissions: { ...usuarioSelecionado.permissions },
            disableIdleLogout: Boolean(usuarioSelecionado.disableIdleLogout),
        })
    }, [usuarioSelecionado])

    useEffect(() => {
        if (abaDetalhe === 'historico' && edicao?.id) {
            carregarLogs(edicao.id)
        }
    }, [abaDetalhe, edicao?.id, carregarLogs])

    const alterarPermissoesConvite = (permissions) => {
        setConvite((atual) => ({ ...atual, permissions }))
    }

    const alterarPermissoesEdicao = (permissions) => {
        setEdicao((atual) => {
            if (!atual) return atual
            return { ...atual, permissions }
        })
    }

    const renderPermissoes = (permissions, onChange, usuarioId = '', opts = {}) => (
        <PermissoesCascade
            permissions={permissions}
            onChange={onChange}
            disabled={loading}
            usuarioId={usuarioId}
            usuarioAtualId={usuarioAtualId}
            gruposIniciaisAbertos={opts.gruposIniciaisAbertos !== false}
            grupoIds={opts.grupoIds || null}
            excluirGrupoIds={opts.excluirGrupoIds || null}
        />
    )

    const resetFormNovoUsuario = () => {
        setDestinoConvite('emerlab')
        setPassoConvite(1)
        setErroPasso('')
        setConvite({
            name: '',
            email: '',
            password: '',
            passwordConfirm: '',
            permissions: permissoesParaDestinoConvite('emerlab'),
        })
        setModoNovoUsuario('create')
    }

    const fecharConvite = () => {
        if (loading) return
        setMostrarConvite(false)
        resetFormNovoUsuario()
    }

    const escolherDestinoConvite = (destino) => {
        setDestinoConvite(destino)
        setConvite((atual) => ({
            ...atual,
            permissions: permissoesParaDestinoConvite(destino),
        }))
    }

    const abrirNovoUsuario = (modo = 'create') => {
        resetFormNovoUsuario()
        setModoNovoUsuario(modo)
        setPassoConvite(1)
        setMostrarConvite(true)
    }

    const validarPasso1 = () => {
        if (!String(convite.name || '').trim()) {
            setErroPasso('Informe o nome completo.')
            return false
        }
        if (!String(convite.email || '').trim()) {
            setErroPasso('Informe o e-mail de login.')
            return false
        }
        if (modoNovoUsuario === 'create') {
            const check = validarPoliticaSenha(convite.password)
            if (!check.ok) {
                setErroPasso(check.error || textoAjudaPoliticaSenha())
                return false
            }
            if (convite.password !== convite.passwordConfirm) {
                setErroPasso('A confirmação de senha não confere.')
                return false
            }
        }
        setErroPasso('')
        return true
    }

    const avancarPasso = () => {
        if (passoConvite === 1 && !validarPasso1()) return
        setErroPasso('')
        setPassoConvite((p) => Math.min(3, p + 1))
    }

    const voltarPasso = () => {
        setErroPasso('')
        setPassoConvite((p) => Math.max(1, p - 1))
    }

    const salvarNovoUsuario = async (event) => {
        event.preventDefault()
        if (!validarPasso1()) {
            setPassoConvite(1)
            return
        }

        setLoading(true)
        try {
            const modo = modoNovoUsuario
            const json =
                modo === 'create'
                    ? await chamarAdminUsers({
                          action: 'createUser',
                          name: convite.name,
                          email: convite.email,
                          password: convite.password,
                          permissions: convite.permissions,
                      })
                    : await chamarAdminUsers({
                          action: 'invite',
                          name: convite.name,
                          email: convite.email,
                          permissions: convite.permissions,
                      })

            const profile = normalizarProfileAcesso(json.profile)
            setUsuarios((atuais) => {
                const semDuplicado = atuais.filter((item) => String(item.id) !== String(profile.id))
                return [...semDuplicado, profile].sort((a, b) =>
                    String(a.name).localeCompare(String(b.name), 'pt-BR'),
                )
            })
            setUsuarioSelecionadoId(profile.id)
            resetFormNovoUsuario()
            setMostrarConvite(false)
            setAbaDetalhe('permissoes')
            const soMkt = usuarioSomenteEmerMarketing(profile.permissions)
            if (modo === 'create') {
                mostrarMensagem(
                    soMkt
                        ? `Usuário criado (EmerMarketing). Login em ${linkMarketing}.`
                        : 'Usuário criado. Já pode fazer login com o e-mail e a senha definidos.',
                )
            } else {
                mostrarMensagem(
                    soMkt
                        ? `Convite enviado com link do EmerMarketing (${linkMarketing}).`
                        : 'Convite enviado por e-mail com senha temporária. No primeiro acesso será preciso definir uma senha nova.',
                )
            }
        } catch (error) {
            mostrarErro(error.message)
        } finally {
            setLoading(false)
        }
    }

    const salvarUsuario = async () => {
        if (!edicao) return
        setLoading(true)
        try {
            const json = await chamarAdminUsers({
                action: 'updateProfile',
                userId: edicao.id,
                name: edicao.name,
                email: edicao.email,
                permissions: edicao.permissions,
                disableIdleLogout: Boolean(edicao.disableIdleLogout),
            })
            const profile = normalizarProfileAcesso(json.profile)
            setUsuarios((atuais) =>
                atuais.map((item) => (String(item.id) === String(profile.id) ? profile : item)),
            )
            if (String(profile.id) === String(usuarioAtualId)) setStoredAccessProfile(profile)
            if (abaDetalhe === 'historico') await carregarLogs(profile.id)
            mostrarMensagem('Alterações salvas.')
        } catch (error) {
            mostrarErro(error.message)
        } finally {
            setLoading(false)
        }
    }

    const excluirUsuario = async () => {
        if (!edicao?.id) return
        if (String(edicao.id) === String(usuarioAtualId)) {
            mostrarErro('Você não pode excluir sua própria conta.')
            return
        }
        const rotulo = edicao.name || edicao.email || edicao.id
        const confirmar = window.confirm(
            `Excluir permanentemente «${rotulo}»?\n\nRemove o login e o perfil. Esta ação não pode ser desfeita.`,
        )
        if (!confirmar) return

        setLoading(true)
        try {
            await chamarAdminUsers({ action: 'deleteUser', userId: edicao.id })
            const idRemovido = edicao.id
            setUsuarios((atuais) => {
                const restantes = atuais.filter((item) => String(item.id) !== String(idRemovido))
                setUsuarioSelecionadoId((sel) => {
                    if (String(sel) !== String(idRemovido)) return sel
                    return restantes[0]?.id || ''
                })
                return restantes
            })
            setEdicao(null)
            setLogs([])
            mostrarMensagem('Usuário excluído.')
        } catch (error) {
            mostrarErro(error.message)
        } finally {
            setLoading(false)
        }
    }

    const redefinirSenha = async () => {
        if (!edicao?.email) {
            mostrarErro('Informe e salve um e-mail válido antes de redefinir a senha.')
            return
        }
        setLoading(true)
        try {
            await chamarAdminUsers({ action: 'reset', email: edicao.email })
            if (abaDetalhe === 'historico') await carregarLogs(edicao.id)
            mostrarMensagem('Link de redefinição de senha enviado por e-mail.')
        } catch (error) {
            mostrarErro(error.message)
        } finally {
            setLoading(false)
        }
    }

    const alternarExigirTrocaSenha = async () => {
        if (!edicao?.id) {
            mostrarErro('Selecione um usuário.')
            return
        }
        const motivo = usuarioSelecionado?.forcePasswordChangeReason
        const forcar = motivo !== 'admin'
        if (forcar) {
            const rotulo = edicao.name || edicao.email || edicao.id
            const confirmar = window.confirm(
                `Exigir troca de senha no próximo acesso de «${rotulo}»?`,
            )
            if (!confirmar) return
        }

        setLoading(true)
        try {
            const json = await chamarAdminUsers({
                action: 'forcePasswordChange',
                userId: edicao.id,
                force: forcar,
            })
            const profile = normalizarProfileAcesso(
                json.profile || {
                    ...usuarioSelecionado,
                    force_password_change: forcar,
                },
            )
            setUsuarios((atuais) =>
                atuais.map((item) =>
                    String(item.id) === String(profile.id) ? { ...item, ...profile } : item,
                ),
            )
            if (abaDetalhe === 'historico') await carregarLogs(edicao.id)
            mostrarMensagem(
                json?.message ||
                    (forcar
                        ? 'Troca de senha exigida no próximo acesso.'
                        : 'Exigência de troca de senha cancelada.'),
            )
        } catch (error) {
            mostrarErro(error.message)
        } finally {
            setLoading(false)
        }
    }

    const tabsDetalhe = [
        { id: 'permissoes', label: 'EmerLAB' },
        { id: 'emermarketing', label: 'Marketing' },
        { id: 'conta', label: 'Conta' },
        { id: 'historico', label: 'Histórico' },
    ]

    const tituloModal =
        modoNovoUsuario === 'create' ? 'Criar usuário' : 'Convidar usuário'
    const descModal =
        modoNovoUsuario === 'create'
            ? 'Conta pronta com senha — a pessoa já pode entrar.'
            : 'Envia e-mail com senha temporária. No primeiro acesso será preciso trocar a senha.'

    const destinoLabel =
        DESTINOS_CONVITE.find((d) => d.id === destinoConvite)?.titulo || destinoConvite

    return (
        <main className="el-page gerenciamento_acessos">
            <PageHeader
                kicker="Administrativo"
                title="Acessos e permissões"
                description="Convide ou crie usuários e defina o que cada um pode ver e alterar."
                actions={
                    <div className="gerenciamento_acessos_header_acoes">
                        <button
                            type="button"
                            className={buttonClassName({ variant: 'secondary', size: 'md' })}
                            onClick={() => abrirNovoUsuario('invite')}
                            disabled={loading}
                        >
                            Convidar
                        </button>
                        <button
                            type="button"
                            className={buttonClassName({ variant: 'primary', size: 'md' })}
                            onClick={() => abrirNovoUsuario('create')}
                            disabled={loading}
                        >
                            Criar usuário
                        </button>
                        <button
                            type="button"
                            className={buttonClassName({ variant: 'ghost', size: 'md' })}
                            onClick={carregarUsuarios}
                            disabled={loading}
                            aria-label="Atualizar lista de usuários"
                        >
                            Atualizar
                        </button>
                    </div>
                }
            />

            {(mensagem || erro) && (
                <div
                    className={`gerenciamento_acessos_alerta ${erro ? 'is-error' : 'is-success'}`}
                    role="status"
                >
                    {erro || mensagem}
                </div>
            )}

            <section className="gerenciamento_acessos_layout">
                <aside className="gerenciamento_acessos_card gerenciamento_acessos_lista_card">
                    <div className="gerenciamento_acessos_lista_header">
                        <div className="gerenciamento_acessos_lista_titulo">
                            <h2>Usuários</h2>
                            <span className="gerenciamento_acessos_count">
                                {usuariosFiltrados.length}
                                {busca.trim() ? ` de ${usuarios.length}` : ''}
                            </span>
                        </div>
                        <Input
                            type="search"
                            value={busca}
                            onChange={(event) => setBusca(event.target.value)}
                            placeholder="Buscar nome ou e-mail"
                            aria-label="Buscar usuários"
                        />
                    </div>
                    <div className="gerenciamento_acessos_lista">
                        {loading && usuarios.length === 0 ? (
                            <LoadingState label="Carregando usuários…" />
                        ) : null}
                        {usuariosFiltrados.map((usuario) => {
                            const badge = badgeSenhaUsuario(usuario)
                            const ativo = String(usuario.id) === String(usuarioSelecionadoId)
                            return (
                                <button
                                    key={usuario.id}
                                    type="button"
                                    className={`gerenciamento_acessos_usuario ${ativo ? 'is-active' : ''}`}
                                    onClick={() => {
                                        setUsuarioSelecionadoId(usuario.id)
                                        setMostrarConvite(false)
                                    }}
                                    aria-current={ativo ? 'true' : undefined}
                                >
                                    <strong>{usuario.name || 'Sem nome'}</strong>
                                    <span>{usuario.email || usuario.id}</span>
                                    <div className="gerenciamento_acessos_usuario_meta">
                                        {badge ? (
                                            <em className="gerenciamento_acessos_usuario_badge">{badge}</em>
                                        ) : null}
                                        {usuario.disableIdleLogout ? (
                                            <em className="gerenciamento_acessos_usuario_badge is-muted">
                                                Sem logoff
                                            </em>
                                        ) : null}
                                        {usuarioSomenteEmerMarketing(usuario.permissions) ? (
                                            <em className="gerenciamento_acessos_usuario_badge is-mkt">
                                                Marketing
                                            </em>
                                        ) : null}
                                    </div>
                                </button>
                            )
                        })}
                        {!loading && usuariosFiltrados.length === 0 && (
                            <EmptyState
                                title="Nenhum usuário encontrado"
                                description={
                                    busca.trim()
                                        ? 'Ajuste a busca ou limpe o filtro.'
                                        : 'Crie ou convide o primeiro usuário.'
                                }
                                action={
                                    !busca.trim() ? (
                                        <Button onClick={() => abrirNovoUsuario('create')}>
                                            Criar usuário
                                        </Button>
                                    ) : null
                                }
                            />
                        )}
                    </div>
                </aside>

                <section className="gerenciamento_acessos_card gerenciamento_acessos_painel">
                    {!edicao ? (
                        loading ? (
                            <LoadingState label="Carregando…" />
                        ) : (
                            <EmptyState
                                title="Selecione um usuário"
                                description="Escolha alguém na lista à esquerda para ver e editar permissões."
                            />
                        )
                    ) : (
                        <>
                            <div className="gerenciamento_acessos_painel_head">
                                <div className="gerenciamento_acessos_painel_identidade">
                                    <h2>{edicao.name || 'Usuário'}</h2>
                                    <p>{edicao.email || 'Sem e-mail'}</p>
                                    {(abaDetalhe === 'permissoes' ||
                                        abaDetalhe === 'emermarketing') && (
                                        <span className="gerenciamento_acessos_convite_resumo">
                                            {resumoPermissoesEdicao.comAcesso} de{' '}
                                            {resumoPermissoesEdicao.total} ferramentas
                                        </span>
                                    )}
                                </div>
                                <nav className="gerenciamento_acessos_tabs" aria-label="Seções do usuário">
                                    {tabsDetalhe.map((tab) => (
                                        <button
                                            key={tab.id}
                                            type="button"
                                            className={abaDetalhe === tab.id ? 'is-active' : ''}
                                            onClick={() => setAbaDetalhe(tab.id)}
                                            aria-current={abaDetalhe === tab.id ? 'page' : undefined}
                                        >
                                            {tab.label}
                                        </button>
                                    ))}
                                </nav>
                            </div>

                            <div className="gerenciamento_acessos_painel_body">
                                {abaDetalhe === 'permissoes' && (
                                    <>
                                        <p className="gerenciamento_acessos_hint">
                                            Marque o que a pessoa pode ver e alterar no EmerLAB. «Ver»
                                            sozinho bloqueia criar, editar e excluir.
                                        </p>
                                        {renderPermissoes(
                                            edicao.permissions,
                                            alterarPermissoesEdicao,
                                            edicao.id,
                                            { excluirGrupoIds: [EMERMARKETING_GROUP_ID] },
                                        )}
                                    </>
                                )}

                                {abaDetalhe === 'emermarketing' && (
                                    <>
                                        <p className="gerenciamento_acessos_hint">
                                            «Acesso ao portal» libera o link e a entrada no app. Sem
                                            módulos específicos, todas as telas do marketing ficam
                                            liberadas. «Auditoria» libera a aba no EmerLAB.
                                        </p>
                                        {renderPermissoes(
                                            edicao.permissions,
                                            alterarPermissoesEdicao,
                                            edicao.id,
                                            {
                                                grupoIds: [EMERMARKETING_GROUP_ID],
                                                gruposIniciaisAbertos: true,
                                            },
                                        )}
                                    </>
                                )}

                                {abaDetalhe === 'conta' && (
                                    <div className="gerenciamento_acessos_conta">
                                        <section className="gerenciamento_acessos_conta_bloco">
                                            <h3>Perfil</h3>
                                            <div className="gerenciamento_acessos_form gerenciamento_acessos_form_compact">
                                                <Input
                                                    label="Nome"
                                                    type="text"
                                                    value={edicao.name}
                                                    onChange={(event) =>
                                                        setEdicao((atual) => ({
                                                            ...atual,
                                                            name: event.target.value,
                                                        }))
                                                    }
                                                    disabled={loading}
                                                />
                                                <Input
                                                    label="E-mail (login)"
                                                    type="email"
                                                    value={edicao.email || ''}
                                                    onChange={(event) =>
                                                        setEdicao((atual) => ({
                                                            ...atual,
                                                            email: event.target.value,
                                                        }))
                                                    }
                                                    placeholder="usuario@emerdog.com.br"
                                                    disabled={loading}
                                                />
                                            </div>
                                            <label className="gerenciamento_acessos_opcao_check">
                                                <input
                                                    type="checkbox"
                                                    checked={Boolean(edicao.disableIdleLogout)}
                                                    onChange={(event) =>
                                                        setEdicao((atual) => ({
                                                            ...atual,
                                                            disableIdleLogout: event.target.checked,
                                                        }))
                                                    }
                                                    disabled={loading}
                                                />
                                                <span>
                                                    <strong>Manter sessão sem logoff por inatividade</strong>
                                                    <small>
                                                        Use só em monitores ou postos dedicados. A senha
                                                        ainda deve ser renovada a cada 90 dias.
                                                    </small>
                                                </span>
                                            </label>
                                        </section>

                                        <section className="gerenciamento_acessos_conta_bloco">
                                            <h3>Senha</h3>
                                            {usuarioSelecionado?.forcePasswordChangeReason ===
                                            'admin' ? (
                                                <p className="gerenciamento_acessos_hint gerenciamento_acessos_hint_aviso">
                                                    No próximo login esta pessoa deverá definir uma nova
                                                    senha (exigência do administrador).
                                                </p>
                                            ) : null}
                                            {usuarioSelecionado?.forcePasswordChangeReason ===
                                            'expired' ? (
                                                <p className="gerenciamento_acessos_hint gerenciamento_acessos_hint_aviso">
                                                    Senha com mais de 90 dias — a troca será exigida no
                                                    próximo acesso.
                                                </p>
                                            ) : null}
                                            <div className="gerenciamento_acessos_acoes gerenciamento_acessos_acoes_conta">
                                                <Button
                                                    variant="secondary"
                                                    onClick={redefinirSenha}
                                                    disabled={loading || !edicao.email}
                                                >
                                                    Enviar link de redefinição
                                                </Button>
                                                <Button
                                                    variant="secondary"
                                                    onClick={alternarExigirTrocaSenha}
                                                    disabled={loading}
                                                >
                                                    {usuarioSelecionado?.forcePasswordChangeReason ===
                                                    'admin'
                                                        ? 'Cancelar troca no próximo acesso'
                                                        : 'Exigir troca no próximo acesso'}
                                                </Button>
                                            </div>
                                        </section>

                                        <section className="gerenciamento_acessos_conta_bloco is-danger">
                                            <h3>Zona de risco</h3>
                                            <p className="gerenciamento_acessos_hint">
                                                Excluir remove o login. Posts e alterações do marketing
                                                não são apagados.
                                            </p>
                                            <Button
                                                variant="danger"
                                                onClick={excluirUsuario}
                                                disabled={
                                                    loading ||
                                                    String(edicao.id) === String(usuarioAtualId)
                                                }
                                            >
                                                Excluir usuário
                                            </Button>
                                        </section>
                                    </div>
                                )}

                                {abaDetalhe === 'historico' && (
                                    <div className="gerenciamento_acessos_log">
                                        {logsLoading && <LoadingState label="Carregando histórico…" />}
                                        {!logsLoading && logsAviso && (
                                            <EmptyState title="Aviso" description={logsAviso} />
                                        )}
                                        {!logsLoading && !logsAviso && logs.length === 0 && (
                                            <EmptyState
                                                title="Sem registros"
                                                description="Ainda não há eventos de acesso para este usuário."
                                            />
                                        )}
                                        {!logsLoading &&
                                            logs.map((item) => (
                                                <article
                                                    key={item.id}
                                                    className="gerenciamento_acessos_log_item"
                                                >
                                                    <time dateTime={item.created_at}>
                                                        {formatarDataLog(item.created_at)}
                                                    </time>
                                                    <strong>{item.summary || item.action}</strong>
                                                    <span>
                                                        {item.actor_name || 'Sistema'}
                                                        {item.action ? ` · ${item.action}` : ''}
                                                    </span>
                                                </article>
                                            ))}
                                    </div>
                                )}
                            </div>

                            {(abaDetalhe === 'permissoes' ||
                                abaDetalhe === 'emermarketing' ||
                                abaDetalhe === 'conta') && (
                                <div className="gerenciamento_acessos_painel_footer">
                                    <Button
                                        variant="primary"
                                        onClick={salvarUsuario}
                                        disabled={loading}
                                    >
                                        {loading
                                            ? 'Salvando…'
                                            : abaDetalhe === 'conta'
                                              ? 'Salvar conta'
                                              : abaDetalhe === 'emermarketing'
                                                ? 'Salvar Marketing'
                                                : 'Salvar permissões'}
                                    </Button>
                                </div>
                            )}
                        </>
                    )}
                </section>
            </section>

            <Modal
                open={mostrarConvite}
                onClose={fecharConvite}
                title={tituloModal}
                description={descModal}
                size="xl"
                className="gerenciamento_acessos_modal_kit"
                footer={
                    <>
                        {passoConvite > 1 ? (
                            <Button variant="secondary" onClick={voltarPasso} disabled={loading}>
                                Voltar
                            </Button>
                        ) : (
                            <Button variant="ghost" onClick={fecharConvite} disabled={loading}>
                                Cancelar
                            </Button>
                        )}
                        {passoConvite < 3 ? (
                            <Button variant="primary" onClick={avancarPasso} disabled={loading}>
                                Continuar
                            </Button>
                        ) : (
                            <Button
                                variant="primary"
                                type="submit"
                                form="ga-form-convite"
                                disabled={loading}
                            >
                                {loading
                                    ? modoNovoUsuario === 'create'
                                        ? 'Criando…'
                                        : 'Enviando…'
                                    : modoNovoUsuario === 'create'
                                      ? 'Criar usuário'
                                      : 'Enviar convite'}
                            </Button>
                        )}
                    </>
                }
            >
                <ol className="gerenciamento_acessos_wizard_steps" aria-label="Etapas">
                    {PASSOS_CONVITE.map((passo) => {
                        const estado =
                            passo.id < passoConvite
                                ? 'is-done'
                                : passo.id === passoConvite
                                  ? 'is-current'
                                  : ''
                        return (
                            <li key={passo.id} className={estado}>
                                <span className="gerenciamento_acessos_wizard_num" aria-hidden="true">
                                    {passo.id < passoConvite ? '✓' : passo.id}
                                </span>
                                <span>{passo.label}</span>
                            </li>
                        )
                    })}
                </ol>

                {erroPasso ? (
                    <p className="gerenciamento_acessos_alerta is-error" role="alert">
                        {erroPasso}
                    </p>
                ) : null}

                <form
                    id="ga-form-convite"
                    className="gerenciamento_acessos_form gerenciamento_acessos_form_convite"
                    onSubmit={salvarNovoUsuario}
                >
                    {passoConvite === 1 && (
                        <div className="gerenciamento_acessos_wizard_pane">
                            <div
                                className="gerenciamento_acessos_modo_tabs"
                                role="tablist"
                                aria-label="Como criar o acesso"
                            >
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={modoNovoUsuario === 'create'}
                                    className={modoNovoUsuario === 'create' ? 'is-active' : ''}
                                    onClick={() => setModoNovoUsuario('create')}
                                    disabled={loading}
                                >
                                    Criar com senha
                                    <small>Acesso imediato</small>
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={modoNovoUsuario === 'invite'}
                                    className={modoNovoUsuario === 'invite' ? 'is-active' : ''}
                                    onClick={() => setModoNovoUsuario('invite')}
                                    disabled={loading}
                                >
                                    Convidar por e-mail
                                    <small>Senha temporária</small>
                                </button>
                            </div>

                            <div className="gerenciamento_acessos_convite_campos">
                                <Input
                                    label="Nome completo"
                                    type="text"
                                    value={convite.name}
                                    onChange={(event) =>
                                        setConvite((atual) => ({
                                            ...atual,
                                            name: event.target.value,
                                        }))
                                    }
                                    placeholder="Ex.: Ana Silva"
                                    required
                                    disabled={loading}
                                    autoFocus
                                />
                                <Input
                                    label="E-mail (login)"
                                    type="email"
                                    value={convite.email}
                                    onChange={(event) =>
                                        setConvite((atual) => ({
                                            ...atual,
                                            email: event.target.value,
                                        }))
                                    }
                                    placeholder="nome@emerdog.com.br"
                                    required
                                    disabled={loading}
                                />
                                {modoNovoUsuario === 'create' && (
                                    <>
                                        <Input
                                            label="Senha inicial"
                                            type="password"
                                            value={convite.password}
                                            onChange={(event) =>
                                                setConvite((atual) => ({
                                                    ...atual,
                                                    password: event.target.value,
                                                }))
                                            }
                                            hint={textoAjudaPoliticaSenha()}
                                            required
                                            minLength={PASSWORD_MIN_LENGTH}
                                            autoComplete="new-password"
                                            disabled={loading}
                                        />
                                        <Input
                                            label="Confirmar senha"
                                            type="password"
                                            value={convite.passwordConfirm}
                                            onChange={(event) =>
                                                setConvite((atual) => ({
                                                    ...atual,
                                                    passwordConfirm: event.target.value,
                                                }))
                                            }
                                            placeholder="Repita a senha"
                                            required
                                            minLength={PASSWORD_MIN_LENGTH}
                                            autoComplete="new-password"
                                            disabled={loading}
                                        />
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {passoConvite === 2 && (
                        <div className="gerenciamento_acessos_wizard_pane">
                            <p className="gerenciamento_acessos_hint">
                                Contas só de marketing recebem o link de login do EmerMarketing (
                                {linkMarketing}).
                            </p>
                            <div
                                className="gerenciamento_acessos_destino_grid"
                                role="radiogroup"
                                aria-label="Destino do acesso"
                            >
                                {DESTINOS_CONVITE.map((opt) => (
                                    <button
                                        key={opt.id}
                                        type="button"
                                        role="radio"
                                        aria-checked={destinoConvite === opt.id}
                                        className={`gerenciamento_acessos_destino_card${
                                            destinoConvite === opt.id ? ' is-active' : ''
                                        }`}
                                        onClick={() => escolherDestinoConvite(opt.id)}
                                        disabled={loading}
                                    >
                                        <strong>{opt.titulo}</strong>
                                        <span>{opt.desc}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {passoConvite === 3 && (
                        <div className="gerenciamento_acessos_wizard_pane">
                            <div className="gerenciamento_acessos_convite_bloco_head">
                                <div>
                                    <h3>Ajuste fino — {destinoLabel}</h3>
                                    <p>
                                        Dá para alterar depois na ficha do usuário. Padrão já aplicado
                                        conforme o destino.
                                    </p>
                                </div>
                                <span className="gerenciamento_acessos_convite_resumo">
                                    {resumoPermissoesConvite.comAcesso} de{' '}
                                    {resumoPermissoesConvite.total} ferramentas
                                </span>
                            </div>

                            {destinoConvite !== 'emermarketing' ? (
                                <div className="gerenciamento_acessos_convite_perms">
                                    <h4 className="gerenciamento_acessos_convite_subtitulo">EmerLAB</h4>
                                    {renderPermissoes(convite.permissions, alterarPermissoesConvite, '', {
                                        gruposIniciaisAbertos: false,
                                        excluirGrupoIds: [EMERMARKETING_GROUP_ID],
                                    })}
                                </div>
                            ) : null}

                            {destinoConvite !== 'emerlab' ? (
                                <div className="gerenciamento_acessos_convite_perms gerenciamento_acessos_convite_emermarketing">
                                    <h4 className="gerenciamento_acessos_convite_subtitulo">
                                        EmerMarketing
                                    </h4>
                                    <p className="gerenciamento_acessos_hint">
                                        {destinoConvite === 'emermarketing'
                                            ? 'Portal liberado. Sem módulos específicos, todas as telas ficam disponíveis.'
                                            : 'Sem estas permissões a pessoa não vê o link nem entra no marketing.'}
                                    </p>
                                    {renderPermissoes(convite.permissions, alterarPermissoesConvite, '', {
                                        gruposIniciaisAbertos: true,
                                        grupoIds: [EMERMARKETING_GROUP_ID],
                                    })}
                                </div>
                            ) : null}
                        </div>
                    )}
                </form>
            </Modal>
        </main>
    )
}

export default GerenciamentoAcessos
