import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    DEFAULT_INVITED_PERMISSIONS,
    normalizarProfileAcesso,
    normalizarPermissions,
    setStoredAccessProfile } from '../../../lib/accessControl'
import PermissoesCascade from './PermissoesCascade'
import { filtrarPorTermoBusca, normalizarTextoBusca } from '../../../lib/prestadorCadastroHelpers'
import { PERMISSION_CATALOG, hasAcl } from '../../../lib/permissionCatalog'
import { supabase } from '../../../lib/supabase'
import { useAutoDismiss } from '../../../lib/toastUi.js'
import './GerenciamentoAcessos.css'
import './PermissoesCascade.css'
import { PageHeader } from '../../../components/ui'

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

const permissoesPadraoNovoUsuario = () => normalizarPermissions({ permissions: { ...DEFAULT_INVITED_PERMISSIONS } })

function formatarDataLog(iso) {
    if (!iso) return '—'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return String(iso)
    return d.toLocaleString('pt-BR')
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
    /** 'invite' = email de convite | 'create' = criar com senha imediata */
    const [modoNovoUsuario, setModoNovoUsuario] = useState('create')
    const [logs, setLogs] = useState([])
    const [logsAviso, setLogsAviso] = useState('')
    const [logsLoading, setLogsLoading] = useState(false)
    const [convite, setConvite] = useState({
        name: '',
        email: '',
        password: '',
        passwordConfirm: '',
        permissions: permissoesPadraoNovoUsuario() })
    const [edicao, setEdicao] = useState(null)

    const usuarioSelecionado = useMemo(
        () => usuarios.find((usuario) => String(usuario.id) === String(usuarioSelecionadoId)) || null,
        [usuarios, usuarioSelecionadoId],
    )

    const resumoPermissoesConvite = useMemo(
        () => contarFerramentasComAcesso(convite.permissions),
        [convite.permissions],
    )

    const usuariosFiltrados = useMemo(() => {
        const termo = busca
        if (!String(termo || '').trim()) return usuarios
        return usuarios.filter((usuario) => {
            const blob = normalizarTextoBusca(`${usuario.name || ''} ${usuario.email || ''}`)
            return filtrarPorTermoBusca(blob, termo)
        })
    }, [busca, usuarios])

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
                redirectTo: `${window.location.origin}/`,
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
            permissions: { ...usuarioSelecionado.permissions } })
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
        />
    )

    const resetFormNovoUsuario = () => {
        setConvite({
            name: '',
            email: '',
            password: '',
            passwordConfirm: '',
            permissions: permissoesPadraoNovoUsuario(),
        })
        setModoNovoUsuario('create')
    }

    const abrirNovoUsuario = (modo = 'create') => {
        setModoNovoUsuario(modo)
        setMostrarConvite(true)
    }

    const salvarNovoUsuario = async (event) => {
        event.preventDefault()
        if (modoNovoUsuario === 'create') {
            if (convite.password.length < 8) {
                mostrarErro('A senha deve ter pelo menos 8 caracteres.')
                return
            }
            if (convite.password !== convite.passwordConfirm) {
                mostrarErro('A confirmação de senha não confere.')
                return
            }
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
                return [...semDuplicado, profile].sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'))
            })
            setUsuarioSelecionadoId(profile.id)
            resetFormNovoUsuario()
            setMostrarConvite(false)
            setAbaDetalhe('permissoes')
            if (modo === 'create') {
                mostrarMensagem('Usuário criado. Já pode fazer login com o email e a senha definidos.')
            } else {
                mostrarMensagem(
                    json.conviteEnviado
                        ? 'Convite enviado.'
                        : 'Usuário existente: reset de acesso enviado e perfil atualizado.',
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
                permissions: edicao.permissions })
            const profile = normalizarProfileAcesso(json.profile)
            setUsuarios((atuais) => atuais.map((item) => (String(item.id) === String(profile.id) ? profile : item)))
            if (String(profile.id) === String(usuarioAtualId)) setStoredAccessProfile(profile)
            if (abaDetalhe === 'historico') await carregarLogs(profile.id)
            mostrarMensagem('Perfil, email e permissões salvos.')
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
            `Excluir permanentemente «${rotulo}»?\n\nRemove o login (Auth) e o perfil. Esta ação não pode ser desfeita.`,
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
            mostrarErro('Informe e salve um email válido antes de redefinir a senha.')
            return
        }
        setLoading(true)
        try {
            await chamarAdminUsers({ action: 'reset', email: edicao.email })
            if (abaDetalhe === 'historico') await carregarLogs(edicao.id)
            mostrarMensagem('Link de redefinição de senha enviado por email.')
        } catch (error) {
            mostrarErro(error.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <main className='el-page gerenciamento_acessos'>
            <PageHeader
                kicker="Administrativo"
                title="Gerenciamento de Acessos"
                description="Criar usuários, convites, permissões, email, senha e histórico."
                actions={
                    <div className='gerenciamento_acessos_header_acoes'>
                        <button type='button' className='is-ghost' onClick={() => abrirNovoUsuario('create')} disabled={loading}>
                            Criar usuário
                        </button>
                        <button type='button' onClick={carregarUsuarios} disabled={loading}>
                            Atualizar
                        </button>
                    </div>
                }
            />

            {(mensagem || erro) && (
                <div className={`gerenciamento_acessos_alerta ${erro ? 'is-error' : 'is-success'}`}>{erro || mensagem}</div>
            )}

            <section className='gerenciamento_acessos_layout'>
                <aside className='gerenciamento_acessos_card gerenciamento_acessos_lista_card'>
                    <div className='gerenciamento_acessos_lista_header'>
                        <h2>Usuários</h2>
                        <input
                            type='search'
                            value={busca}
                            onChange={(event) => setBusca(event.target.value)}
                            placeholder='Buscar nome ou email'
                        />
                    </div>
                    <div className='gerenciamento_acessos_lista'>
                        {usuariosFiltrados.map((usuario) => (
                            <button
                                key={usuario.id}
                                type='button'
                                className={`gerenciamento_acessos_usuario ${String(usuario.id) === String(usuarioSelecionadoId) ? 'is-active' : ''}`}
                                onClick={() => {
                                    setUsuarioSelecionadoId(usuario.id)
                                    setMostrarConvite(false)
                                }}
                            >
                                <strong>{usuario.name || 'Sem nome'}</strong>
                                <span>{usuario.email || usuario.id}</span>
                            </button>
                        ))}
                        {!loading && usuariosFiltrados.length === 0 && (
                            <p className='gerenciamento_acessos_vazio'>Nenhum usuário encontrado.</p>
                        )}
                    </div>
                </aside>

                <section className='gerenciamento_acessos_card gerenciamento_acessos_painel'>
                    {!edicao ? (
                        <p className='gerenciamento_acessos_vazio'>Selecione um usuário na lista.</p>
                    ) : (
                        <>
                            <div className='gerenciamento_acessos_painel_head'>
                                <h2>{edicao.name || 'Usuário'}</h2>
                                <nav className='gerenciamento_acessos_tabs' aria-label='Seções do usuário'>
                                    <button
                                        type='button'
                                        className={abaDetalhe === 'permissoes' ? 'is-active' : ''}
                                        onClick={() => setAbaDetalhe('permissoes')}
                                    >
                                        Permissões
                                    </button>
                                    <button
                                        type='button'
                                        className={abaDetalhe === 'conta' ? 'is-active' : ''}
                                        onClick={() => setAbaDetalhe('conta')}
                                    >
                                        Conta
                                    </button>
                                    <button
                                        type='button'
                                        className={abaDetalhe === 'historico' ? 'is-active' : ''}
                                        onClick={() => setAbaDetalhe('historico')}
                                    >
                                        Histórico
                                    </button>
                                </nav>
                            </div>

                            {abaDetalhe === 'permissoes' && (
                                <>
                                    {renderPermissoes(edicao.permissions, alterarPermissoesEdicao, edicao.id)}
                                    <button
                                        type='button'
                                        className='gerenciamento_acessos_salvar_flutuante is-primary'
                                        onClick={salvarUsuario}
                                        disabled={loading}
                                    >
                                        {loading ? 'Salvando…' : 'Salvar permissões'}
                                    </button>
                                </>
                            )}

                            {abaDetalhe === 'conta' && (
                                <>
                                    <div className='gerenciamento_acessos_form gerenciamento_acessos_form_compact'>
                                        <label>
                                            Nome no perfil
                                            <input
                                                type='text'
                                                value={edicao.name}
                                                onChange={(event) =>
                                                    setEdicao((atual) => ({ ...atual, name: event.target.value }))
                                                }
                                                disabled={loading}
                                            />
                                        </label>
                                        <label>
                                            Email (login)
                                            <input
                                                type='email'
                                                value={edicao.email || ''}
                                                onChange={(event) =>
                                                    setEdicao((atual) => ({ ...atual, email: event.target.value }))
                                                }
                                                placeholder='usuario@emerdog.com.br'
                                                disabled={loading}
                                            />
                                        </label>
                                    </div>
                                    <p className='gerenciamento_acessos_hint'>
                                        Somente «Ver» nas ferramentas bloqueia criar, editar e excluir linhas nas tabelas.
                                    </p>
                                    <div className='gerenciamento_acessos_acoes gerenciamento_acessos_acoes_conta'>
                                        <button type='button' onClick={redefinirSenha} disabled={loading || !edicao.email}>
                                            Redefinir senha
                                        </button>
                                        <button type='button' className='is-primary' onClick={salvarUsuario} disabled={loading}>
                                            Salvar conta
                                        </button>
                                        <button
                                            type='button'
                                            className='is-danger'
                                            onClick={excluirUsuario}
                                            disabled={loading || String(edicao.id) === String(usuarioAtualId)}
                                            title={
                                                String(edicao.id) === String(usuarioAtualId)
                                                    ? 'Não é possível excluir a si mesmo'
                                                    : 'Remove login e perfil'
                                            }
                                        >
                                            Excluir usuário
                                        </button>
                                    </div>
                                </>
                            )}

                            {abaDetalhe === 'historico' && (
                                <div className='gerenciamento_acessos_log'>
                                    {logsLoading && <p className='gerenciamento_acessos_vazio'>A carregar histórico…</p>}
                                    {!logsLoading && logsAviso && (
                                        <p className='gerenciamento_acessos_vazio'>{logsAviso}</p>
                                    )}
                                    {!logsLoading && !logsAviso && logs.length === 0 && (
                                        <p className='gerenciamento_acessos_vazio'>Nenhum registro para este usuário.</p>
                                    )}
                                    {!logsLoading &&
                                        logs.map((item) => (
                                            <article key={item.id} className='gerenciamento_acessos_log_item'>
                                                <time dateTime={item.created_at}>{formatarDataLog(item.created_at)}</time>
                                                <strong>{item.summary || item.action}</strong>
                                                <span>
                                                    {item.actor_name || 'Sistema'}
                                                    {item.action ? ` · ${item.action}` : ''}
                                                </span>
                                            </article>
                                        ))}
                                </div>
                            )}
                        </>
                    )}
                </section>
            </section>

            {mostrarConvite && (
                <div
                    className='gerenciamento_acessos_modal_backdrop'
                    role='presentation'
                    onClick={() => {
                        if (!loading) {
                            setMostrarConvite(false)
                            resetFormNovoUsuario()
                        }
                    }}
                >
                    <div
                        className='gerenciamento_acessos_card gerenciamento_acessos_modal gerenciamento_acessos_modal_convite'
                        role='dialog'
                        aria-labelledby='ga-convite-title'
                        aria-describedby='ga-convite-desc'
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className='gerenciamento_acessos_modal_head'>
                            <div>
                                <p className='gerenciamento_acessos_modal_kicker'>Novo acesso</p>
                                <h2 id='ga-convite-title'>
                                    {modoNovoUsuario === 'create' ? 'Criar usuário' : 'Convidar usuário'}
                                </h2>
                                <p id='ga-convite-desc' className='gerenciamento_acessos_modal_lead'>
                                    {modoNovoUsuario === 'create'
                                        ? 'Cria a conta já com senha — a pessoa pode entrar de imediato no login.'
                                        : 'Envia convite por email para a pessoa definir a própria senha.'}
                                </p>
                            </div>
                            <button
                                type='button'
                                className='gerenciamento_acessos_modal_close'
                                onClick={() => {
                                    setMostrarConvite(false)
                                    resetFormNovoUsuario()
                                }}
                                disabled={loading}
                                aria-label='Fechar'
                            >
                                ×
                            </button>
                        </div>

                        <div className='gerenciamento_acessos_modo_tabs' role='tablist' aria-label='Modo de criação'>
                            <button
                                type='button'
                                role='tab'
                                aria-selected={modoNovoUsuario === 'create'}
                                className={modoNovoUsuario === 'create' ? 'is-active' : ''}
                                onClick={() => setModoNovoUsuario('create')}
                                disabled={loading}
                            >
                                Criar com senha
                            </button>
                            <button
                                type='button'
                                role='tab'
                                aria-selected={modoNovoUsuario === 'invite'}
                                className={modoNovoUsuario === 'invite' ? 'is-active' : ''}
                                onClick={() => setModoNovoUsuario('invite')}
                                disabled={loading}
                            >
                                Convidar por email
                            </button>
                        </div>

                        <form className='gerenciamento_acessos_form gerenciamento_acessos_form_convite' onSubmit={salvarNovoUsuario}>
                            <section className='gerenciamento_acessos_convite_bloco' aria-labelledby='ga-convite-dados'>
                                <div className='gerenciamento_acessos_convite_bloco_head'>
                                    <span className='gerenciamento_acessos_convite_passo' aria-hidden='true'>1</span>
                                    <div>
                                        <h3 id='ga-convite-dados'>Dados da conta</h3>
                                        <p>
                                            {modoNovoUsuario === 'create'
                                                ? 'Nome, email e senha inicial de acesso.'
                                                : 'Nome e email usados no convite e no primeiro acesso.'}
                                        </p>
                                    </div>
                                </div>
                                <div className='gerenciamento_acessos_convite_campos'>
                                    <label>
                                        Nome completo
                                        <input
                                            type='text'
                                            value={convite.name}
                                            onChange={(event) =>
                                                setConvite((atual) => ({ ...atual, name: event.target.value }))
                                            }
                                            placeholder='Ex.: Ana Silva'
                                            required
                                            disabled={loading}
                                            autoFocus
                                        />
                                    </label>
                                    <label>
                                        Email (login)
                                        <input
                                            type='email'
                                            value={convite.email}
                                            onChange={(event) =>
                                                setConvite((atual) => ({ ...atual, email: event.target.value }))
                                            }
                                            placeholder='nome@emerdog.com.br'
                                            required
                                            disabled={loading}
                                        />
                                    </label>
                                    {modoNovoUsuario === 'create' && (
                                        <>
                                            <label>
                                                Senha inicial
                                                <input
                                                    type='password'
                                                    value={convite.password}
                                                    onChange={(event) =>
                                                        setConvite((atual) => ({
                                                            ...atual,
                                                            password: event.target.value,
                                                        }))
                                                    }
                                                    placeholder='Mínimo 8 caracteres'
                                                    required
                                                    minLength={8}
                                                    autoComplete='new-password'
                                                    disabled={loading}
                                                />
                                            </label>
                                            <label>
                                                Confirmar senha
                                                <input
                                                    type='password'
                                                    value={convite.passwordConfirm}
                                                    onChange={(event) =>
                                                        setConvite((atual) => ({
                                                            ...atual,
                                                            passwordConfirm: event.target.value,
                                                        }))
                                                    }
                                                    placeholder='Repita a senha'
                                                    required
                                                    minLength={8}
                                                    autoComplete='new-password'
                                                    disabled={loading}
                                                />
                                            </label>
                                        </>
                                    )}
                                </div>
                            </section>

                            <section className='gerenciamento_acessos_convite_bloco' aria-labelledby='ga-convite-perms'>
                                <div className='gerenciamento_acessos_convite_bloco_head'>
                                    <span className='gerenciamento_acessos_convite_passo' aria-hidden='true'>2</span>
                                    <div>
                                        <h3 id='ga-convite-perms'>O que essa pessoa poderá acessar?</h3>
                                        <p>
                                            Comece pelo essencial — dá para ajustar depois na ficha do usuário.
                                            Use a busca e Expandir/Recolher para navegar.
                                        </p>
                                    </div>
                                    <span className='gerenciamento_acessos_convite_resumo' title='Ferramentas com algum acesso marcado'>
                                        {resumoPermissoesConvite.comAcesso} de {resumoPermissoesConvite.total} ferramentas
                                    </span>
                                </div>
                                <div className='gerenciamento_acessos_convite_perms'>
                                    {renderPermissoes(convite.permissions, alterarPermissoesConvite, '', {
                                        gruposIniciaisAbertos: false,
                                    })}
                                </div>
                            </section>

                            <div className='gerenciamento_acessos_modal_footer'>
                                <button
                                    type='button'
                                    onClick={() => {
                                        setMostrarConvite(false)
                                        resetFormNovoUsuario()
                                    }}
                                    disabled={loading}
                                >
                                    Cancelar
                                </button>
                                <button type='submit' className='is-primary' disabled={loading}>
                                    {loading
                                        ? modoNovoUsuario === 'create'
                                            ? 'Criando…'
                                            : 'Enviando…'
                                        : modoNovoUsuario === 'create'
                                          ? 'Criar usuário'
                                          : 'Enviar convite'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </main>
    )
}

export default GerenciamentoAcessos
