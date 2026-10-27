// Atalhos de teclado no padrão do WhatsApp Web: Ctrl+Alt no Windows/Linux, Cmd+Ctrl no Mac
export const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
export const MOD = MAC ? ['⌘', 'Ctrl'] : ['Ctrl', 'Alt']

// Ctrl+Alt (ou Cmd+Ctrl). O AltGr do teclado ABNT2 também chega como Ctrl+Alt, mas gera outra tecla
// (AltGr+E = "°"), então comparar por e.key evita disparar atalho enquanto se digita.
export function comMod(e) {
    return MAC ? e.metaKey && e.ctrlKey : e.ctrlKey && e.altKey && !e.metaKey
}

export function teclaDe(e) {
    return e.key.length === 1 ? e.key.toLowerCase() : e.key
}

// Foco num campo de texto: atalhos de letra solta não valem ali
export function emCampo(el) {
    if (!el) return false
    const tag = el.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

// Modal, menu ou painel aberto: o Esc é dele, não da conversa
export function haSobreposicao() {
    return Boolean(document.querySelector('[role="dialog"], [role="menu"]'))
}

// Lista exibida em "Atalhos de teclado" (Ctrl+/); "mod" vira Ctrl+Alt ou ⌘+Ctrl
export const ATALHOS = [
    ['Geral', [
        [['mod', 'N'], 'Nova conversa'],
        [['mod', '/'], 'Pesquisar conversas'],
        [['mod', 'Shift', ']'], 'Próxima conversa'],
        [['mod', 'Shift', '['], 'Conversa anterior'],
        [['mod', ','], 'Configurações'],
        [['mod', 'Shift', 'U'], 'Marcar conversa aberta como não lida'],
        [['Ctrl', '/'], 'Mostrar atalhos de teclado'],
        [['Esc'], 'Fechar conversa / cancelar'],
    ]],
    ['Na conversa', [
        [['mod', 'E'], 'Painel de emojis'],
        [['mod', 'R'], 'Respostas rápidas'],
        [['/'], 'Buscar resposta rápida no campo'],
        [['Enter'], 'Enviar (ou Ctrl+Enter, conforme Configurações)'],
        [['Shift', 'Enter'], 'Nova linha'],
        [['Ctrl', 'V'], 'Colar imagem ou arquivo para enviar'],
        [['mod', 'Shift', 'A'], 'Assumir conversa'],
        [['mod', 'Shift', 'R'], 'Marcar como resolvida'],
    ]],
]
