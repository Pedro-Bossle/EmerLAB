// ETag para as respostas que o painel consulta o tempo todo (lista de conversas e mensagens do chat).
// O navegador reenvia If-None-Match; se o conteúdo não mudou, o servidor responde 304 sem corpo
// e só a transferência de dados diminui (a função ainda roda para montar a resposta).
// `private, no-cache`: o navegador guarda a resposta mas sempre revalida; `Vary: Cookie` separa o cache por sessão,
// então outro login nunca recebe a resposta guardada do anterior.
import { createHash } from 'node:crypto'

export function etagDe(texto) {
    return `W/"${createHash('sha1').update(texto).digest('base64url')}"`
}

/** If-None-Match pode trazer vários valores (`W/"a", W/"b"`) ou `*`. */
export function etagConfere(cabecalho, etag) {
    if (!cabecalho) return false
    const lista = String(cabecalho).split(',').map((s) => s.trim())
    return lista.includes('*') || lista.includes(etag)
}

/** Responde 200 com ETag, ou 304 sem corpo quando o navegador já tem a mesma versão. */
export function enviarComEtag(req, res, corpo) {
    const texto = JSON.stringify(corpo ?? {})
    const etag = etagDe(texto)
    res.setHeader('ETag', etag)
    res.setHeader('Cache-Control', 'private, no-cache')
    res.setHeader('Vary', 'Cookie')
    if (etagConfere(req.headers?.['if-none-match'], etag)) {
        res.statusCode = 304
        res.end()
        return
    }
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(texto)
}
