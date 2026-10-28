// Ações sobre uma conversa usadas pelo cabeçalho do chat e pelo menu de botão direito da lista.
// `acao(rota, body, mensagemDeSucesso, camposAtualizados)` faz o POST em /conversas/:id/:rota.

export async function transferir(conversa, { departamentoId, email }, acao) {
    const mudouDepto = departamentoId !== (conversa.departamentoId || '')
    if (mudouDepto) {
        await acao('departamento', { departamentoId: departamentoId || null }, 'Departamento atualizado.', { departamentoId: departamentoId || null, atendenteEmail: null })
    }
    // trocar de departamento já zera o atendente no servidor
    if (mudouDepto ? Boolean(email) : email !== (conversa.atendenteEmail || '')) {
        await acao('atribuir', { email: email || null }, email ? 'Conversa transferida.' : 'Conversa devolvida à fila.', { atendenteEmail: email || null })
    }
}

// Itens de status/atribuição conforme o estado da conversa (mesma ordem do menu do chat)
export function itensDeAtendimento(conversa, usuarioEmail, { acao, aoTransferir, admin = false }) {
    const minha = String(conversa.atendenteEmail || '').toLowerCase() === String(usuarioEmail || '').toLowerCase()
    // bloqueada: só o admin mexe, e a única ação é desbloquear (volta a aberta na WATI)
    if (conversa.bloqueada) {
        return [admin && { rotulo: 'Desbloquear contato', acao: () => acao('status', { status: 'aberta' }, 'Contato desbloqueado.', { status: 'aberta', bloqueada: false }) }]
    }
    const bloquear = () => {
        if (!confirm('Bloquear este contato na WATI? Ele deixa de conseguir falar com a empresa até ser desbloqueado.')) return
        return acao('status', { status: 'bloqueada' }, 'Contato bloqueado.', { status: 'resolvida', bloqueada: true })
    }
    return [
        !minha && { rotulo: 'Assumir conversa', acao: () => acao('atribuir', {}, 'Conversa atribuída a você.', { atendenteEmail: usuarioEmail }) },
        { rotulo: 'Transferir…', acao: aoTransferir },
        conversa.status !== 'resolvida' && { rotulo: 'Marcar como resolvida', acao: () => acao('status', { status: 'resolvida' }, 'Conversa resolvida.', { status: 'resolvida' }) },
        conversa.status !== 'pendente' && { rotulo: 'Marcar como pendente', acao: () => acao('status', { status: 'pendente' }, 'Conversa marcada como pendente.', { status: 'pendente' }) },
        conversa.status !== 'aberta' && { rotulo: 'Reabrir conversa', acao: () => acao('status', { status: 'aberta' }, 'Conversa reaberta.', { status: 'aberta' }) },
        minha && { rotulo: 'Soltar conversa (voltar à fila)', acao: () => acao('atribuir', { email: null }, 'Conversa devolvida à fila.', { atendenteEmail: null }) },
        admin && { rotulo: 'Bloquear contato…', acao: bloquear },
    ]
}
