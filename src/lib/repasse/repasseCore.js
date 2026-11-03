/**
 * Repasse mensal — regras puras compartilhadas entre navegador e API (docs/repasse-mensal.md).
 * Sem dependências de Node/DOM.
 */

export const STATUS_RELATORIO = {
    nao_enviado: 'Não enviado',
    agendado: 'Agendado',
    enviado: 'Enviado',
    visualizado: 'Visualizado',
    aprovado: 'Aprovado',
    documento_em_revisao: 'Documento em revisão',
    documento_devolvido: 'Documento devolvido',
    reprovado: 'Reprovado',
    tratado: 'Reprovação tratada',
}

export const TIPOS_REPASSE_ROTULO = { rpa: 'RPA', rpa_sd: 'RPA s/desc.', nota: 'Nota fiscal', boleto: 'Boleto' }

/**
 * Competência escrita nos e-mails do relatório: sempre o mês anterior ao atual, do primeiro ao último dia
 * (ex.: em novembro/2026 → «01/10/2026 a 31/10/2026»). Usa o fuso de Brasília para virar o mês à meia-noite local.
 */
export function periodoMesAnteriorLabel(agora = new Date(), timeZone = 'America/Sao_Paulo') {
    const partes = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(agora)
    const ano = Number(partes.find((p) => p.type === 'year').value)
    const mes = Number(partes.find((p) => p.type === 'month').value)
    const a = mes === 1 ? ano - 1 : ano
    const m = mes === 1 ? 12 : mes - 1
    const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate()
    const mm = String(m).padStart(2, '0')
    return `01/${mm}/${a} a ${String(ultimo).padStart(2, '0')}/${mm}/${a}`
}

export const rotuloStatusRelatorio = (s) => STATUS_RELATORIO[s] || s || '—'

/** `AAAA-MM` → competência é do novo modelo (>= competência inicial). Anteriores = legado. */
export function ehCompetenciaNovoModelo(mes, ano, competenciaInicial = '2026-10') {
    const m = /^(\d{4})-(\d{2})$/.exec(String(competenciaInicial || ''))
    if (!m) return false
    return Number(ano) * 12 + Number(mes) >= Number(m[1]) * 12 + Number(m[2])
}

const centavos = (n) => Math.round(Number(n) * 100)

/**
 * Valida o valor do documento (NF/boleto) contra o repasse (§4.3):
 * igual ao pago pelo tutor → erro (vermelho); só diferente do repasse → aviso (amarelo).
 */
export function avaliarValorDocumento(valorDocumento, totalRepasse, totalTutor) {
    if (valorDocumento == null || !Number.isFinite(Number(valorDocumento))) return { nivel: 'erro_invalido' }
    const v = centavos(valorDocumento)
    if (v === centavos(totalRepasse)) return { nivel: 'ok' }
    // Só acusa «valor do tutor» quando o tutor é diferente do repasse e não é zero.
    if (centavos(totalTutor) > 0 && v === centavos(totalTutor)) return { nivel: 'erro_tutor' }
    return { nivel: 'aviso_diferente', diferenca: (v - centavos(totalRepasse)) / 100 }
}

/** Texto de `{instrucao_tipo}` do e-mail (§4.2). */
export function instrucaoPorTipo(tipo, valorFormatado) {
    if (tipo === 'nota') return `anexe a nota fiscal no valor de ${valorFormatado}`
    if (tipo === 'boleto') return `anexe o boleto no valor de ${valorFormatado}`
    return 'é só aprovar o relatório'
}

/** Substitui {variaveis}; desconhecidas ficam como estão. */
export function aplicarVariaveis(texto, vars) {
    return String(texto || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

/**
 * Horários de envio dentro de uma janela (§9).
 * - `iguais`: intervalos iguais entre `inicio` e `fim`.
 * - `aleatoria`: instantes aleatórios ordenados, com intervalo mínimo `minGapMs` (padrão 20 s).
 * `rand` injetável para testes. Retorna Date[] ordenadas.
 */
export function distribuirHorarios({ n, inicio, fim, ordem = 'aleatoria', minGapMs = 20_000, rand = Math.random }) {
    const t0 = new Date(inicio).getTime()
    const t1 = new Date(fim).getTime()
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) throw new Error('Janela de envio inválida.')
    if (n <= 0) return []
    if (n === 1) return [new Date(t0)]
    const span = t1 - t0
    if (span < (n - 1) * minGapMs) {
        throw new Error('A janela é curta demais para o intervalo mínimo de 20 s entre e-mails.')
    }
    if (ordem === 'iguais') {
        return Array.from({ length: n }, (_, i) => new Date(Math.round(t0 + (span * i) / (n - 1))))
    }
    // Sorteia dentro do espaço que sobra depois de reservar o intervalo mínimo entre todos.
    const folga = span - (n - 1) * minGapMs
    const base = Array.from({ length: n }, () => rand() * folga).sort((a, b) => a - b)
    return base.map((b, i) => new Date(Math.round(t0 + b + i * minGapMs)))
}

/** Valida o arquivo de documento/comprovante (extensão e tamanho). */
export function validarArquivoRepasse({ nome, tamanho, tipos = ['pdf', 'xml', 'png', 'jpg', 'jpeg'] }) {
    const ext = String(nome || '').toLowerCase().split('.').pop()
    if (!tipos.includes(ext)) return `Formato não aceito. Use: ${tipos.join(', ').toUpperCase()}.`
    if (!Number.isFinite(tamanho) || tamanho <= 0) return 'Arquivo vazio.'
    if (tamanho > 10 * 1024 * 1024) return 'O arquivo passa de 10 MB.'
    return null
}

/** Mensagem pronta de reprovação (WhatsApp/e-mail). */
export function mensagemReprovacao({ prestador, competencia, observacao }) {
    return `Olá! Sou ${prestador} e não concordo com o relatório de repasse de ${competencia}. O que precisa ser ajustado: ${observacao}`
}

/** Link do WhatsApp com texto pronto. */
export function linkWhatsapp(numero, texto) {
    return `https://wa.me/${String(numero || '').replace(/\D/g, '')}?text=${encodeURIComponent(texto || '')}`
}
