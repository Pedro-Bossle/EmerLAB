import React from 'react'
import './GerenciarTabelasModal.css'

/**
 * Modal «Gerenciar tabelas»: lista à esquerda, edição à direita.
 */
export default function GerenciarTabelasModal({
    onClose,
    somenteLeitura,
    onNovaCidade,
    cidadesOrdenadas,
    ordenarGerenciador,
    indicadorOrdenacaoGerenciador,
    idCidadeEmEdicao,
    emModoNova = false,
    onSelecionarCidade,
    onAcessarCidade,
    onEditarCidade,
    onDuplicarCidade,
    onExcluirCidade,
    onBaixarExcelCidade,
    exportandoExcelCidadeId = null,
    colunaProcedimentos = false,
    edicaoAberta = false,
    painelDireito,
}) {
    return (
        <div className='manager_modal_overlay' onClick={onClose}>
            <div
                className={`manager_modal manager_modal_split${edicaoAberta ? '' : ' manager_modal_list_only'}`}
                onClick={(event) => event.stopPropagation()}
                role='dialog'
                aria-labelledby='gerenciar-tabelas-titulo'
            >
                <div className='manager_modal_header'>
                    <h3 id='gerenciar-tabelas-titulo'>Gerenciar tabelas</h3>
                    <div className='manager_header_actions'>
                        {!somenteLeitura && (
                            <button
                                type='button'
                                className='manager_add_city_btn'
                                onClick={onNovaCidade}
                                title='Adicionar nova tabela'
                            >
                                ＋ Nova tabela
                            </button>
                        )}
                        <button type='button' className='manager_close_btn' onClick={onClose} title='Fechar'>
                            x
                        </button>
                    </div>
                </div>

                <div className={`manager_split_body${edicaoAberta ? ' is-editing' : ' is-list-only'}`}>
                    <aside className='manager_split_list'>
                        <p className='manager_split_list_title'>Tabelas cadastradas</p>
                        <div className='manager_table_wrap manager_table_wrap_inset'>
                            <table className='manager_table manager_table_compact'>
                                <colgroup>
                                    <col className='col_uf' />
                                    <col className='col_nome' />
                                    {colunaProcedimentos && <col className='col_proc' />}
                                    <col className='col_acoes' />
                                </colgroup>
                                <thead>
                                    <tr>
                                        <th className='col_uf' onClick={() => ordenarGerenciador('uf')}>
                                            UF{indicadorOrdenacaoGerenciador('uf')}
                                        </th>
                                        <th className='col_nome' onClick={() => ordenarGerenciador('nome')}>
                                            Tabela{indicadorOrdenacaoGerenciador('nome')}
                                        </th>
                                        {colunaProcedimentos && (
                                            <th
                                                className='col_proc'
                                                onClick={() => ordenarGerenciador('procedimentosAtivos')}
                                            >
                                                Procedimentos
                                                {indicadorOrdenacaoGerenciador('procedimentosAtivos')}
                                            </th>
                                        )}
                                        <th className='col_acoes' aria-label='Ações'>
                                            Ações
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {cidadesOrdenadas.map((cidade) => {
                                        const selecionada =
                                            edicaoAberta &&
                                            !emModoNova &&
                                            idCidadeEmEdicao != null &&
                                            Number(idCidadeEmEdicao) === Number(cidade.id)
                                        return (
                                            <tr
                                                key={`manager-${cidade.id}`}
                                                className={selecionada ? 'is-selected' : ''}
                                                onClick={() => onSelecionarCidade(cidade)}
                                                title='Clique para editar'
                                            >
                                                <td className='col_uf'>{cidade.uf || '—'}</td>
                                                <td className='col_nome'>{cidade.nome}</td>
                                                {colunaProcedimentos && (
                                                    <td className='col_proc'>{cidade.procedimentosAtivos}</td>
                                                )}
                                                <td className='col_acoes' onClick={(e) => e.stopPropagation()}>
                                                    <div className='manager_actions'>
                                                        <button
                                                            type='button'
                                                            className='manager_icon_btn'
                                                            onClick={() => onAcessarCidade(cidade.id)}
                                                            title='Acessar tabela'
                                                        >
                                                            👁️
                                                        </button>
                                                        <button
                                                            type='button'
                                                            className='manager_icon_btn'
                                                            onClick={() => onEditarCidade(cidade)}
                                                            title='Editar'
                                                        >
                                                            ✏️
                                                        </button>
                                                        <button
                                                            type='button'
                                                            className='manager_icon_btn'
                                                            onClick={() => onDuplicarCidade(cidade)}
                                                            title='Duplicar'
                                                        >
                                                            📄
                                                        </button>
                                                        {onBaixarExcelCidade && (
                                                            <button
                                                                type='button'
                                                                className='manager_icon_btn manager_icon_btn_excel'
                                                                disabled={
                                                                    Number(cidade.procedimentosAtivos || 0) === 0 ||
                                                                    Number(exportandoExcelCidadeId) === Number(cidade.id)
                                                                }
                                                                onClick={() => onBaixarExcelCidade(cidade)}
                                                                title='Baixar tabela em Excel (.xlsx)'
                                                            >
                                                                {Number(exportandoExcelCidadeId) === Number(cidade.id)
                                                                    ? '…'
                                                                    : '📊'}
                                                            </button>
                                                        )}
                                                        {!somenteLeitura && (
                                                            <button
                                                                type='button'
                                                                className='manager_icon_btn danger'
                                                                onClick={(event) =>
                                                                    onExcluirCidade(cidade, {
                                                                        ignorarConfirmacao: event.shiftKey,
                                                                    })
                                                                }
                                                                title='Excluir'
                                                            >
                                                                🗑️
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </aside>

                    <section
                        className='manager_split_edit'
                        aria-label='Edição da tabela'
                        aria-hidden={!edicaoAberta}
                    >
                        {edicaoAberta ? painelDireito : null}
                    </section>
                </div>
            </div>
        </div>
    )
}
