import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import adminUsersHandler from '../api/admin-users.js'
import emailHandler from '../api/email.js'
import auditLogsHandler from '../api/audit-logs.js'
import repasseMensalHandler from '../api/_lib/repasseMensalHandler.js'
import rcPdfHandler from '../api/rc-pdf.js'
import consultaCnpjHandler from '../api/consulta-cnpj.js'
import geocodePrestadorHandler from '../api/geocode-prestador.js'
import clicksignProxyHandler from '../src/lib/clicksign/clicksignProxyHandler.js'
import { nodeHandler as ibgeMunicipiosHandler } from '../api/ibge-municipios.js'
import { nodeHandler as cepLookupHandler } from '../api/cep-lookup.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: path.join(root, '.env') })
dotenv.config({ path: path.join(root, '.env.local'), override: true })

const PORT = Number(process.env.API_PORT || 3000)

const server = http.createServer(async (req, res) => {
    try {
        const requestUrl = req.url || '/'
        const pathname = new URL(requestUrl, 'http://127.0.0.1').pathname

        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const rawBuf = Buffer.concat(chunks)
        const raw = rawBuf.toString('utf-8')

        if (pathname.startsWith('/api/clicksign')) {
            const reqLike = {
                method: req.method,
                headers: req.headers,
                body: raw,
                url: requestUrl,
            }
            const resLike = {
                statusCode: 200,
                headers: {},
                setHeader(name, value) {
                    this.headers[name] = value
                    res.setHeader(name, value)
                },
                status(code) {
                    this.statusCode = code
                    res.statusCode = code
                    return this
                },
                json(payload) {
                    if (!res.getHeader('Content-Type')) {
                        res.setHeader('Content-Type', 'application/json; charset=utf-8')
                    }
                    res.statusCode = this.statusCode
                    res.end(JSON.stringify(payload))
                },
                send(payload) {
                    res.statusCode = this.statusCode
                    res.end(payload)
                },
            }
            await clicksignProxyHandler(reqLike, resLike)
            return
        }

        let body = {}
        if (raw) {
            try {
                body = JSON.parse(raw)
            } catch {
                body = {}
            }
        }

        const handlers = {
            '/api/admin-users': adminUsersHandler,
            '/api/email': emailHandler,
            '/api/audit-logs': auditLogsHandler,
            '/api/repasse-mensal': repasseMensalHandler,
            '/api/rc-pdf': rcPdfHandler,
            '/api/consulta-cnpj': consultaCnpjHandler,
            '/api/geocode-prestador': geocodePrestadorHandler,
            '/api/ibge-municipios': ibgeMunicipiosHandler,
            '/api/cep-lookup': cepLookupHandler,
        }
        const ehApiV1 = pathname === '/api/v1' || pathname.startsWith('/api/v1/')
        const handler = ehApiV1 ? emailHandler : handlers[pathname]

        if (!handler) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: 'Rota não encontrada.' }))
            return
        }

        let urlDoHandler = requestUrl
        if (ehApiV1) {
            // Mesma reescrita do vercel.json: /api/v1/<resto>?q -> /api/email?_fn=api-v1&_path=<resto>&q
            const u = new URL(requestUrl, 'http://localhost')
            const params = new URLSearchParams({ _fn: 'api-v1', _path: pathname.replace(/^\/api\/v1\/?/, '') })
            for (const [k, v] of u.searchParams.entries()) params.append(k, v)
            urlDoHandler = `/api/email?${params.toString()}`
        }
        const reqLike = { method: req.method, headers: req.headers, body, url: urlDoHandler }
        const resLike = {
            statusCode: 200,
            headers: {},
            setHeader(name, value) {
                this.headers[name] = value
                res.setHeader(name, value)
            },
            status(code) {
                this.statusCode = code
                res.statusCode = code
                return this
            },
            json(payload) {
                if (!res.getHeader('Content-Type')) {
                    res.setHeader('Content-Type', 'application/json; charset=utf-8')
                }
                res.statusCode = this.statusCode
                res.end(JSON.stringify(payload))
            },
            send(payload) {
                res.statusCode = this.statusCode
                res.end(payload)
            },
            end() {
                res.statusCode = this.statusCode
                res.end()
            },
        }

        await handler(reqLike, resLike)
    } catch (error) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: error?.message || 'Falha na API local.' }))
    }
})

server.listen(PORT, () => {
    console.log(`API local pronta em http://localhost:${PORT}`)
})
