import React, { useEffect, useMemo, useState } from 'react'
import PermissoesCascade from './PermissoesCascade'
import { Button, EmptyState, Input } from '../../../components/ui'
import { confirmarAcao } from '../../../lib/dialogos.js'
import { assinaturaAcl } from '../../../lib/permissionCatalog'
import { diffPermissoes, linhasDoDiff } from '../../../lib/permissoesNiveis'
import {
    SETORES_PADRAO,
    contarFerramentasDoSetor,
    permissoesPadraoDoSetor,
    slugSetor,
} from '../../../lib/setores'

const NOVO_ID = '__novo__'

function rascunhoDe(setor) {
    return {
        id: setor.id,
        nome: setor.nome || '',
        descricao: setor.descricao || '',
        ordem: setor.ordem ?? 99,
        permissions: { ...setor.permissions },
    }
}

function setorEmBranco() {
    return { id: NOVO_ID, nome: '', descricao: '', ordem: 99, permissions: permissoesPadraoDoSetor({ id: 'x', grupos: { inicio: 'ver' } }) }
}

/**
 * Subaba «Setores» de Acessos e permissões: o que cada setor acessa (preset de permissões).
 * O setor é um ponto de partida: vincular o setor a um usuário copia estas permissões para o perfil dele, que
 * depois pode ser ajustado individualmente. Alterar o setor NÃO muda quem já foi vinculado.
 */
export default function SetoresAcessos({ setores, usuarios, tabelaAusente, carregando, onSalvar, onExcluir }) {
    const [selecionadoId, setSelecionadoId] = useState(setores[0]?.id || '')
    // já nasce preenchido com o primeiro setor (sem um quadro vazio antes do efeito)
    const [rascunho, setRascunho] = useState(() => (setores[0] ? rascunhoDe(setores[0]) : null))
    const [ocupado, setOcupado] = useState(false)

    const selecionado = useMemo(
        () => (selecionadoId === NOVO_ID ? setorEmBranco() : setores.find((s) => s.id === selecionadoId) || null),
        [setores, selecionadoId],
    )

    // carrega o rascunho ao trocar de setor (ou quando a lista muda e não há edição pendente)
    useEffect(() => {
        if (!selecionado) {
            setRascunho(null)
            return
        }
        setRascunho((atual) => {
            if (atual && atual.id === selecionado.id && alterado(selecionado, atual)) return atual
            return rascunhoDe(selecionado)
        })
    }, [selecionado])

    const mudou = Boolean(selecionado && rascunho && alterado(selecionado, rascunho))
    const novo = selecionadoId === NOVO_ID

    const diff = useMemo(
        () => (selecionado && rascunho ? diffPermissoes(selecionado.permissions, rascunho.permissions) : []),
        [selecionado, rascunho],
    )

    const vinculados = useMemo(
        () => (usuarios || []).filter((u) => (u.setores || []).includes(selecionadoId)),
        [usuarios, selecionadoId],
    )

    const confirmarDescarte = async () => {
        if (!mudou) return true
        return confirmarAcao({
            titulo: 'Descartar alterações do setor?',
            mensagem: `As alterações em «${rascunho?.nome || 'novo setor'}» ainda não foram salvas.`,
            confirmar: 'Descartar',
            cancelar: 'Continuar editando',
            perigo: true,
        })
    }

    const escolher = async (id) => {
        if (id === selecionadoId) return
        if (!(await confirmarDescarte())) return
        setSelecionadoId(id)
    }

    const salvar = async () => {
        if (!rascunho || !mudou) return
        if (!rascunho.nome.trim()) return
        if (diff.length > 0) {
            const linhas = linhasDoDiff(diff)
            const mostrar = linhas.slice(0, 12)
            const sensivel = diff.some((d) => d.sensivel)
            const ok = await confirmarAcao({
                titulo: sensivel ? 'Confirmar alterações sensíveis no setor?' : `Salvar o setor «${rascunho.nome}»?`,
                mensagem: [
                    ...mostrar,
                    linhas.length > mostrar.length ? `… e mais ${linhas.length - mostrar.length}` : '',
                    '',
                    'Quem já está vinculado ao setor não muda: a alteração vale para os próximos vínculos.',
                ]
                    .filter((x, i) => x !== '' || i > 0)
                    .join('\n'),
                confirmar: 'Salvar setor',
                cancelar: 'Revisar',
                perigo: sensivel,
            })
            if (!ok) return
        }
        setOcupado(true)
        try {
            const salvo = await onSalvar({
                id: novo ? slugSetor(rascunho.nome) : rascunho.id,
                nome: rascunho.nome.trim(),
                descricao: rascunho.descricao.trim(),
                ordem: novo ? 99 : rascunho.ordem,
                permissions: rascunho.permissions,
            })
            if (salvo?.id) setSelecionadoId(salvo.id)
        } finally {
            setOcupado(false)
        }
    }

    const excluir = async () => {
        if (!selecionado || selecionado.padrao || novo) return
        const ok = await confirmarAcao({
            titulo: `Excluir o setor «${selecionado.nome}»?`,
            mensagem:
                vinculados.length > 0
                    ? `${vinculados.length} ${vinculados.length === 1 ? 'usuário está vinculado' : 'usuários estão vinculados'} a este setor. As permissões deles não mudam; só o vínculo some.`
                    : 'Esta ação não pode ser desfeita.',
            confirmar: 'Excluir setor',
            cancelar: 'Manter',
            perigo: true,
        })
        if (!ok) return
        setOcupado(true)
        try {
            await onExcluir(selecionado.id)
            setSelecionadoId(setores.find((s) => s.id !== selecionado.id)?.id || '')
        } finally {
            setOcupado(false)
        }
    }

    const restaurarPadrao = () => {
        const def = SETORES_PADRAO.find((s) => s.id === rascunho?.id)
        if (!def) return
        setRascunho((r) => ({ ...r, permissions: permissoesPadraoDoSetor(def), nome: def.nome, descricao: def.descricao }))
    }

    const novoSetor = async () => {
        if (selecionadoId === NOVO_ID) return
        if (!(await confirmarDescarte())) return
        setSelecionadoId(NOVO_ID)
    }

    const lista = novo ? [...setores, { ...setorEmBranco(), nome: rascunho?.nome || 'Novo setor' }] : setores

    return (
        <section className="gerenciamento_acessos_layout ga_setores">
            <aside className="gerenciamento_acessos_card gerenciamento_acessos_lista_card">
                <div className="gerenciamento_acessos_lista_header">
                    <div className="gerenciamento_acessos_lista_titulo">
                        <h2>Setores</h2>
                        <span className="gerenciamento_acessos_count">{setores.length}</span>
                    </div>
                    <Button variant="secondary" onClick={() => void novoSetor()} disabled={ocupado || carregando}>
                        + Novo setor
                    </Button>
                </div>
                <div className="gerenciamento_acessos_lista">
                    {lista.map((s) => {
                        const ativo = s.id === selecionadoId
                        const n = (usuarios || []).filter((u) => (u.setores || []).includes(s.id)).length
                        return (
                            <button
                                key={s.id}
                                type="button"
                                className={`gerenciamento_acessos_usuario ga_setor_item ${ativo ? 'is-active' : ''}`}
                                onClick={() => void escolher(s.id)}
                                aria-current={ativo ? 'true' : undefined}
                            >
                                <span className="gerenciamento_acessos_avatar" aria-hidden="true">
                                    {String(s.nome || '?').slice(0, 2).toUpperCase()}
                                </span>
                                <span className="gerenciamento_acessos_usuario_txt">
                                    <strong>{s.nome}</strong>
                                    <span className="gerenciamento_acessos_usuario_email">
                                        {contarFerramentasDoSetor(s.id === selecionadoId && rascunho ? rascunho.permissions : s.permissions)}{' '}
                                        ferramentas · {n} {n === 1 ? 'usuário' : 'usuários'}
                                    </span>
                                </span>
                            </button>
                        )
                    })}
                </div>
            </aside>

            <section className="gerenciamento_acessos_card gerenciamento_acessos_painel">
                {tabelaAusente ? (
                    <p className="gerenciamento_acessos_hint gerenciamento_acessos_hint_aviso" role="status">
                        A tabela de setores ainda não existe no banco. Você pode ver os setores padrão, mas para salvar
                        alterações é preciso executar <code>supabase/migrations/20261107120000_setores_acesso.sql</code>.
                    </p>
                ) : null}

                {!rascunho ? (
                    <EmptyState title="Selecione um setor" description="Escolha um setor na lista para ver e editar o que ele acessa." />
                ) : (
                    <>
                        <div className="gerenciamento_acessos_painel_head">
                            <div className="gerenciamento_acessos_painel_identidade">
                                <h2>{rascunho.nome || 'Novo setor'}</h2>
                                <p>
                                    {novo
                                        ? 'Defina o nome e o que este setor pode acessar.'
                                        : selecionado?.padrao
                                          ? 'Setor padrão do EmerLAB'
                                          : 'Setor personalizado'}
                                </p>
                            </div>
                        </div>

                        <div className="gerenciamento_acessos_painel_body">
                            <div className="gerenciamento_acessos_form gerenciamento_acessos_form_compact">
                                <Input
                                    label="Nome do setor"
                                    value={rascunho.nome}
                                    onChange={(e) => setRascunho((r) => ({ ...r, nome: e.target.value }))}
                                    maxLength={60}
                                    disabled={ocupado}
                                />
                                <Input
                                    label="Descrição (opcional)"
                                    value={rascunho.descricao}
                                    onChange={(e) => setRascunho((r) => ({ ...r, descricao: e.target.value }))}
                                    maxLength={240}
                                    disabled={ocupado}
                                />
                            </div>

                            <p className="gerenciamento_acessos_hint">
                                O setor é um <strong>ponto de partida</strong>: ao vincular um setor a uma pessoa, estas
                                permissões são copiadas para o perfil dela, que continua ajustável individualmente.
                                Alterar o setor não muda quem já foi vinculado.
                            </p>

                            <PermissoesCascade
                                permissions={rascunho.permissions}
                                onChange={(permissions) => setRascunho((r) => ({ ...r, permissions }))}
                                disabled={ocupado}
                                gruposIniciaisAbertos={false}
                            />

                            <div className="ga_setor_vinculados">
                                <h3>Pessoas vinculadas</h3>
                                {vinculados.length === 0 ? (
                                    <p className="gerenciamento_acessos_hint">Ninguém está vinculado a este setor ainda.</p>
                                ) : (
                                    <ul className="ga_setor_chips">
                                        {vinculados.map((u) => (
                                            <li key={u.id}>{u.name || u.email}</li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>

                        <div className="gerenciamento_acessos_painel_footer">
                            <span
                                className={`gerenciamento_acessos_pendencias${mudou ? ' is-pendente' : ''}`}
                                role="status"
                                aria-live="polite"
                            >
                                {mudou ? 'Alterações não salvas' : 'Nenhuma alteração pendente'}
                            </span>
                            {!novo && selecionado?.padrao ? (
                                <Button variant="ghost" onClick={restaurarPadrao} disabled={ocupado}>
                                    Restaurar padrão
                                </Button>
                            ) : null}
                            {!novo && !selecionado?.padrao ? (
                                <Button variant="danger" onClick={() => void excluir()} disabled={ocupado}>
                                    Excluir setor
                                </Button>
                            ) : null}
                            <Button
                                variant="secondary"
                                onClick={() => setRascunho(rascunhoDe(selecionado))}
                                disabled={ocupado || !mudou}
                            >
                                Descartar
                            </Button>
                            <Button
                                onClick={() => void salvar()}
                                disabled={ocupado || tabelaAusente || !mudou || !rascunho.nome.trim()}
                            >
                                {ocupado ? 'Salvando…' : 'Salvar setor'}
                            </Button>
                        </div>
                    </>
                )}
            </section>
        </section>
    )
}

function alterado(original, rascunho) {
    return (
        String(original.nome || '') !== String(rascunho.nome || '') ||
        String(original.descricao || '') !== String(rascunho.descricao || '') ||
        assinaturaAcl(original.permissions) !== assinaturaAcl(rascunho.permissions)
    )
}
