// HTML de e-mail com só a formatação básica (negrito, itálico, sublinhado, listas, parágrafos e links). Usado no
// editor da prévia e, na integração com o Graph, também para mostrar e-mails recebidos: tudo o mais vira texto.

const PERMITIDAS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'P', 'BR', 'DIV', 'A', 'BLOCKQUOTE'])
const LINK_SEGURO = /^(https?:|mailto:)/i

function copiar(origem, destino, doc) {
    for (const no of origem.childNodes) {
        if (no.nodeType === Node.TEXT_NODE) {
            destino.appendChild(doc.createTextNode(no.textContent))
            continue
        }
        if (no.nodeType !== Node.ELEMENT_NODE) continue
        if (!PERMITIDAS.has(no.tagName)) {
            // tag não permitida (script, style, img…): some a tag, fica o texto de dentro, se for conteúdo
            if (!['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT'].includes(no.tagName)) copiar(no, destino, doc)
            continue
        }
        const el = doc.createElement(no.tagName)
        if (no.tagName === 'A') {
            const href = no.getAttribute('href') || ''
            if (LINK_SEGURO.test(href.trim())) {
                el.setAttribute('href', href.trim())
                el.setAttribute('target', '_blank')
                el.setAttribute('rel', 'noopener noreferrer')
            }
        }
        copiar(no, el, doc)
        destino.appendChild(el)
    }
}

export function limparHtml(html) {
    const origem = new DOMParser().parseFromString(String(html || ''), 'text/html').body
    const doc = document.implementation.createHTMLDocument('')
    const destino = doc.createElement('div')
    copiar(origem, destino, doc)
    return destino.innerHTML
}
