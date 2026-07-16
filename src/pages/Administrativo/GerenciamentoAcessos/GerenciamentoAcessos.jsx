import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    DEFAULT_INVITED_PERMISSIONS,
    normalizarProfileAcesso,
    normalizarPermissions,
    setStoredAccessProfile } from '../../../lib/accessControl'
import PermissoesCascade from './PermissoesCascade'
import { filtrarPorTermoBusca, normalizarTextoBusca } from '../../../lib/prestadorCadastroHelpers'
import { supabase } from '../../../lib/supabase'
import { useAutoDismiss } from '../../../lib/toastUi.js'
import './GerenciamentoAcessos.css'
import './PermissoesCascade.css'

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
    const [logs, setLogs] = useState([])
    const [logsAviso, setLogsAviso] = useState('')
    const [logsLoading, setLogsLoading] = useState(false)
    const [convite, setConvite] = useState({
        name: '',
        email: '',
        permissions: permissoesPadraoNovoUsuario() })
    const [edicao, setEdicao] = useState(null)

    const usuarioSelecionado = useMemo(
        () => usuarios.find((usuario) => String(usuario.id) === String(usuarioSelecionadoId)) || null,
        [usuarios, usuarioSelecionadoId],
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
        const { data } = await supabase.auth.getSession()
        const token = data?.session?.access_token
        if (!token) throw new Error('Sessão expirada. Faça login novamente.')

        const resp = await fetch('/api/admin-users', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}` },
            body: JSON.stringify({
                ...payload,
                redirectTo: window.location.origin }) })

        const json = await resp.json().catch(() => ({}))
        if (!resp.ok || json?.ok === false) {
            throw new Error(json?.error || 'Falha na operação administrativa.')
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

    const renderPermissoes = (permissions, onChange, usuarioId = '') => (
        <PermissoesCascade
            permissions={permissions}
            onChange={onChange}
            disabled={loading}
            usuarioId={usuarioId}
            usuarioAtualId={usuarioAtualId}
        />
    )

    const convidarUsuario = async (event) => {
        event.preventDefault()
        setLoading(true)
        try {
            const json = await chamarAdminUsers({
                action: 'invite',
                name: convite.name,
                email: convite.email,
                permissions: convite.permissions })
            const profile = normalizarProfileAcesso(json.profile)
            setUsuarios((atuais) => {
                const semDuplicado = atuais.filter((item) => String(item.id) !== String(profile.id))
                return [...semDuplicado, profile].sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'))
            })
            setUsuarioSelecionadoId(profile.id)
            setConvite({ name: '', email: '', permissions: permissoesPadraoNovoUsuario() })
            setMostrarConvite(false)
            setAbaDetalhe('permissoes')
            mostrarMensagem(json.conviteEnviado ? 'Convite enviado.' : 'Usuário existente: reset de acesso enviado e perfil atualizado.')
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
        <main className='gerenciamento_acessos'>
            <header className='gerenciamento_acessos_header'>
                <div>
                    <p className='gerenciamento_acessos_kicker'>Administrativo</p>
                    <h1>Gerenciamento de Acessos</h1>
                    <p>Convites, permissões, email, senha e histórico por usuário.</p>
                </div>
                <div className='gerenciamento_acessos_header_acoes'>
                    <button type='button' className='is-ghost' onClick={() => setMostrarConvite(true)} disabled={loading}>
                        Convidar usuário
                    </button>
                    <button type='button' onClick={carregarUsuarios} disabled={loading}>
                        Atualizar
                    </button>
                </div>
            </header>

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
                                    <div className='gerenciamento_acessos_acoes'>
                                        <button type='button' className='is-primary' onClick={salvarUsuario} disabled={loading}>
                                            Salvar permissões
                                        </button>
                                    </div>
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
                    onClick={() => !loading && setMostrarConvite(false)}
                >
                    <div
                        className='gerenciamento_acessos_card gerenciamento_acessos_modal'
                        role='dialog'
                        aria-labelledby='ga-convite-title'
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className='gerenciamento_acessos_modal_head'>
                            <h2 id='ga-convite-title'>Convidar usuário</h2>
                            <button type='button' className='is-ghost' onClick={() => setMostrarConvite(false)} disabled={loading}>
                                Fechar
                            </button>
                        </div>
                        <form className='gerenciamento_acessos_form' onSubmit={convidarUsuario}>
                            <label>
                                Nome
                                <input
                                    type='text'
                                    value={convite.name}
                                    onChange={(event) => setConvite((atual) => ({ ...atual, name: event.target.value }))}
                                    required
                                    disabled={loading}
                                />
                            </label>
                            <label>
                                Email
                                <input
                                    type='email'
                                    value={convite.email}
                                    onChange={(event) => setConvite((atual) => ({ ...atual, email: event.target.value }))}
                                    required
                                    disabled={loading}
                                />
                            </label>
                            {renderPermissoes(convite.permissions, alterarPermissoesConvite)}
                            <div className='gerenciamento_acessos_acoes'>
                                <button type='button' onClick={() => setMostrarConvite(false)} disabled={loading}>
                                    Cancelar
                                </button>
                                <button type='submit' className='is-primary' disabled={loading}>
                                    Enviar convite
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
