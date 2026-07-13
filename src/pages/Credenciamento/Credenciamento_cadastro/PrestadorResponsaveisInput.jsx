import React from 'react'
import { formatarEmailEntrada, formatarTelefoneEntrada } from '../../../lib/prestadorCadastroHelpers'
import './PrestadorVeterinarioExtras.css'

export {
    responsaveisParaPayload,
    responsaveisFromDbRows,
    responsaveisFromPayload,
} from '../../../lib/prestadorVeterinarioCadastro.js'

function linhaVazia() {
    return { key: Date.now() + Math.random(), nome: '', email: '', telefone: '' }
}

export default function PrestadorResponsaveisInput({
    lista = [],
    onChange,
    somenteLeitura,
    variant = 'cadastro',
    mostrarLead = true,
}) {
    const itens = lista?.length ? lista : [linhaVazia()]
    const isPublic = variant === 'public'

    const atualizar = (key, campo, valor) => {
        onChange?.(itens.map((r) => (r.key === key ? { ...r, [campo]: valor } : r)))
    }

    const adicionar = () => {
        onChange?.([...itens, linhaVazia()])
    }

    const remover = (key) => {
        const next = itens.filter((r) => r.key !== key)
        onChange?.(next.length ? next : [linhaVazia()])
    }

    const rowClass = isPublic ? 'fcred_grid fcred_grid_3 vet_resp_grid' : 'pcad_row pcad_row3'
    const fieldClass = isPublic ? 'fcred_field' : 'pcad_field'
    const inputProps = (props) =>
        isPublic ? props : { ...props, className: 'credenciamento_main_input' }

    const btnAddClass = isPublic
        ? 'fcred_btn secondary pcad_responsaveis_add'
        : 'credenciamento_main_action_btn secondary pcad_responsaveis_add'

    return (
        <div className="pcad_responsaveis">
            {mostrarLead && (
                <p className={isPublic ? 'fcred_public_muted vet_resp_lead' : 'pcad_muted'}>
                    Informe um ou mais responsáveis (nome, e-mail e telefone obrigatórios).
                </p>
            )}
            {itens.map((r, idx) => (
                <div key={r.key} className="pcad_responsavel_card">
                    <div className="pcad_responsavel_head">
                        <span className="pcad_responsavel_tit">Responsável {idx + 1}</span>
                        {!somenteLeitura && itens.length > 1 && (
                            <button type="button" className="pcad_responsavel_rem" onClick={() => remover(r.key)}>
                                Remover
                            </button>
                        )}
                    </div>
                    <div className={rowClass}>
                        <label className={fieldClass}>
                            <span>Nome *</span>
                            <input
                                {...inputProps({
                                    value: r.nome,
                                    disabled: somenteLeitura,
                                    autoComplete: 'name',
                                    onChange: (e) => atualizar(r.key, 'nome', e.target.value),
                                })}
                            />
                        </label>
                        <label className={fieldClass}>
                            <span>E-mail *</span>
                            <input
                                {...inputProps({
                                    value: r.email,
                                    disabled: somenteLeitura,
                                    autoComplete: 'email',
                                    onChange: (e) => atualizar(r.key, 'email', formatarEmailEntrada(e.target.value)),
                                })}
                            />
                        </label>
                        <label className={fieldClass}>
                            <span>Telefone *</span>
                            <input
                                {...inputProps({
                                    value: r.telefone,
                                    disabled: somenteLeitura,
                                    autoComplete: 'tel',
                                    onChange: (e) =>
                                        atualizar(r.key, 'telefone', formatarTelefoneEntrada(e.target.value)),
                                })}
                            />
                        </label>
                    </div>
                </div>
            ))}
            {!somenteLeitura && (
                <button type="button" className={btnAddClass} onClick={adicionar}>
                    Incluir outro responsável
                </button>
            )}
        </div>
    )
}
