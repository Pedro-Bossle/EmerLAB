// Variáveis dinâmicas das mensagens ({{nome}}, {{uf}}…) — mesma lista no editor, no Composer e no servidor
export const VARIAVEIS = [
    ['nome', 'Nome do contato'],
    ['primeiro_nome', 'Primeiro nome do contato'],
    ['atendente', 'Nome de quem está enviando'],
    ['telefone', 'Telefone do contato'],
    ['tipo', 'Tipo do contato (atributo da WATI)'],
    ['uf', 'UF do contato (atributo da WATI)'],
    ['cidade', 'Cidade do contato (atributo da WATI)'],
]

const PADRAO = new RegExp(`\\{\\{\\s*(${VARIAVEIS.map(([k]) => k).join('|')})\\s*\\}\\}`, 'gi')

// manterVazias: deixa {{chave}} no texto quando o valor ainda não é conhecido (ex.: atributos ainda carregando)
export function preencherVariaveis(texto, ctx, { manterVazias = false } = {}) {
    return String(texto).replace(PADRAO, (marca, k) => {
        const chave = k.toLowerCase()
        const valor = chave === 'primeiro_nome' ? String(ctx.nome || '').split(' ')[0] : ctx[chave]
        if (!valor && manterVazias) return marca
        return valor ?? ''
    })
}
