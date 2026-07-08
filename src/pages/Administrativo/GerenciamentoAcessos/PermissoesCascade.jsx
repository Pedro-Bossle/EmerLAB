import React, { useState } from 'react'
import './PermissoesCascade.css'
import {
    ACL_ACTIONS,
    PERMISSION_CATALOG,
    aclKey,
    aplicarFerramentaAcl,
    aplicarGrupoAcl,
    hasAcl,
    syncLegacyFromAcl,
} from '../../../lib/permissionCatalog'

function grupoTemAcao(permissions, grupo, action) {
    return grupo.tools.every((tool) => {
        if (!tool.actions.includes(action)) return true
        return hasAcl(permissions, tool.id, action)
    })
}

function grupoAlgumaAcao(permissions, grupo, action) {
    return grupo.tools.some((tool) => tool.actions.includes(action) && hasAcl(permissions, tool.id, action))
}

function aplicarDesligarLeitura(perms, toolId, meta) {
    let next = { ...perms }
    for (const action of meta.actions) {
        next[aclKey(toolId, action)] = false
    }
    return syncLegacyFromAcl(next)
}

export default function PermissoesCascade({ permissions, onChange, disabled, usuarioId = '', usuarioAtualId = '' }) {
    const [abertos, setAbertos] = useState(() =>
        Object.fromEntries(PERMISSION_CATALOG.map((g) => [g.id, true])),
    )

    const toggleGrupo = (groupId, action) => {
        const grupo = PERMISSION_CATALOG.find((g) => g.id === groupId)
        if (!grupo) return
        const todosLigados = grupoTemAcao(permissions, grupo, action)
        const valor = !todosLigados
        onChange(aplicarGrupoAcl(permissions, groupId, action, valor))
    }

    const toggleFerramenta = (toolId, action) => {
        const meta = PERMISSION_CATALOG.flatMap((g) => g.tools).find((t) => t.id === toolId)
        if (!meta) return
        if (
            String(usuarioId) === String(usuarioAtualId) &&
            toolId === 'admin.acessos'
        ) {
            return
        }
        const ligado = hasAcl(permissions, toolId, action)
        const valor = !ligado
        let next = aplicarFerramentaAcl(permissions, toolId, action, valor)
        if (!valor && action === 'read') {
            next = aplicarDesligarLeitura(next, toolId, meta)
        }
        onChange(next)
    }

    return (
        <div className='permissoes_cascade'>
            <div className='permissoes_cascade_legenda' aria-hidden='true'>
                <span className='permissoes_cascade_tool_col'>Ferramenta</span>
                {ACL_ACTIONS.map((a) => (
                    <span key={a.id} className='permissoes_cascade_acao_col'>
                        {a.label}
                    </span>
                ))}
            </div>
            {PERMISSION_CATALOG.map((grupo) => {
                const aberto = abertos[grupo.id]
                return (
                    <section key={grupo.id} className='permissoes_cascade_grupo'>
                        <header className='permissoes_cascade_grupo_header'>
                            <button
                                type='button'
                                className='permissoes_cascade_grupo_toggle'
                                onClick={() => setAbertos((s) => ({ ...s, [grupo.id]: !s[grupo.id] }))}
                                aria-expanded={aberto}
                            >
                                {aberto ? '▾' : '▸'} {grupo.label}
                            </button>
                            <div className='permissoes_cascade_grupo_acoes'>
                                {ACL_ACTIONS.map((acao) => {
                                    const aplicavel = grupo.tools.some((t) => t.actions.includes(acao.id))
                                    if (!aplicavel) {
                                        return <span key={acao.id} className='permissoes_cascade_acao_col is-empty' />
                                    }
                                    const todos = grupoTemAcao(permissions, grupo, acao.id)
                                    const alguns = grupoAlgumaAcao(permissions, grupo, acao.id)
                                    return (
                                        <label
                                            key={acao.id}
                                            className={`permissoes_cascade_acao_col permissoes_cascade_grupo_check ${alguns && !todos ? 'is-indeterminate' : ''}`}
                                            title={`${acao.label} — todo o grupo ${grupo.label}`}
                                        >
                                            <input
                                                type='checkbox'
                                                checked={todos}
                                                disabled={disabled}
                                                ref={(el) => {
                                                    if (el) el.indeterminate = alguns && !todos
                                                }}
                                                onChange={() => toggleGrupo(grupo.id, acao.id)}
                                            />
                                        </label>
                                    )
                                })}
                            </div>
                        </header>
                        {aberto && (
                            <div className='permissoes_cascade_corpo'>
                                {grupo.tools.map((tool) => {
                                    const bloqueiaSelfAdmin =
                                        String(usuarioId) === String(usuarioAtualId) &&
                                        tool.id === 'admin.acessos'
                                    return (
                                        <div key={tool.id} className='permissoes_cascade_linha'>
                                            <div className='permissoes_cascade_tool_col'>
                                                <strong>{tool.label}</strong>
                                                <small>{tool.descricao}</small>
                                            </div>
                                            {ACL_ACTIONS.map((acao) => {
                                                const suporta = tool.actions.includes(acao.id)
                                                if (!suporta) {
                                                    return (
                                                        <span
                                                            key={acao.id}
                                                            className='permissoes_cascade_acao_col is-na'
                                                            aria-hidden='true'
                                                        >
                                                            —
                                                        </span>
                                                    )
                                                }
                                                return (
                                                    <label key={acao.id} className='permissoes_cascade_acao_col'>
                                                        <input
                                                            type='checkbox'
                                                            checked={hasAcl(permissions, tool.id, acao.id)}
                                                            disabled={disabled || bloqueiaSelfAdmin}
                                                            onChange={() => toggleFerramenta(tool.id, acao.id)}
                                                            aria-label={`${acao.label} — ${tool.label}`}
                                                        />
                                                    </label>
                                                )
                                            })}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </section>
                )
            })}
            <p className='permissoes_cascade_nota'>
                <strong>Adicionar</strong> em impressão e PDFs equivale a gerar/exportar documentos. Alterações aqui são validadas no servidor.
            </p>
        </div>
    )
}
