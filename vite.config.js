import path from 'node:path'
import dotenv from 'dotenv'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import consultaCnpjHandler from './api/consulta-cnpj.js'
import cepLookupHandler from './api/cep-lookup.js'
import mapOsmHandler from './api/map-osm.js'
import prospectosOsmColetarHandler from './api/prospectos-osm-coletar.js'
import clicksignProxyHandler from './src/lib/clicksign/clicksignProxyHandler.js'
import clicksignDownloadHandler from './api/clicksign-download.js'
import adminUsersHandler from './api/admin-users.js'
import auditLogsHandler from './api/audit-logs.js'
import aitestHandler from './api/aitest.js'

/** Mesma ordem de prioridade aproximada do Vite para ficheiros .env (envDir = raiz do projeto). */
function carregarEnvParaProcesso(envDir, mode) {
    const dir = envDir || process.cwd()
    dotenv.config({ path: path.join(dir, '.env') })
    dotenv.config({ path: path.join(dir, '.env.local'), override: true })
    if (mode) {
        dotenv.config({ path: path.join(dir, `.env.${mode}`), override: true })
        dotenv.config({ path: path.join(dir, `.env.${mode}.local`), override: true })
    }
    const merged = loadEnv(mode || 'development', dir, '')
    const tok = (merged.CLICKSIGN_ACCESS_TOKEN || merged.CLICKSIGN_TOKEN || '').trim()
    const base = (merged.CLICKSIGN_API_BASE || '').trim()
    if (tok) process.env.CLICKSIGN_ACCESS_TOKEN = tok
    if (base) process.env.CLICKSIGN_API_BASE = base
}

/** Em dev, atende /api/nominatim-search e /api/overpass-poi (handler unificado map-osm). */
function mapOsmDevPlugin() {
    return {
        name: 'map-osm-dev',
        enforce: 'pre',
        configureServer(server) {
            carregarEnvParaProcesso(server.config.envDir, server.config.mode)
            server.middlewares.use(async (req, res, next) => {
                const url = req.url || ''
                if (!url.startsWith('/api/nominatim-search') && !url.startsWith('/api/overpass-poi')) {
                    next()
                    return
                }
                const reqLike = { method: req.method || 'GET', url, headers: req.headers || {} }
                const resLike = {
                    statusCode: 200,
                    setHeader(name, value) {
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
                }
                try {
                    await mapOsmHandler(reqLike, resLike)
                } catch (e) {
                    res.statusCode = 502
                    res.setHeader('Content-Type', 'application/json; charset=utf-8')
                    res.end(
                        JSON.stringify({
                            error: e?.message || 'Falha na consulta OSM (Nominatim/Overpass).',
                            codigo: 'proxy_error',
                        }),
                    )
                }
            })
        },
    }
}

/** Em dev, POST /api/prospectos-osm-coletar e GET /api/prospectos-gemini-status */
function prospectosOsmColetarDevPlugin() {
    return {
        name: 'prospectos-osm-coletar-dev',
        enforce: 'pre',
        configureServer(server) {
            carregarEnvParaProcesso(server.config.envDir, server.config.mode)
            server.middlewares.use(async (req, res, next) => {
                const url = req.url || ''
                if (
                    !url.startsWith('/api/prospectos-osm-coletar') &&
                    !url.startsWith('/api/prospectos-gemini-status')
                ) {
                    next()
                    return
                }
                const method = req.method || (url.startsWith('/api/prospectos-gemini-status') ? 'GET' : 'POST')
                let body = {}
                if (method !== 'GET' && method !== 'HEAD') {
                    const chunks = []
                    for await (const ch of req) chunks.push(ch)
                    const raw = Buffer.concat(chunks).toString('utf8')
                    try {
                        if (raw.trim()) body = JSON.parse(raw)
                    } catch {
                        body = {}
                    }
                }
                const reqLike = {
                    method,
                    url,
                    headers: req.headers || {},
                    body,
                }
                const resLike = {
                    statusCode: 200,
                    setHeader(name, value) {
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
                }
                try {
                    await prospectosOsmColetarHandler(reqLike, resLike)
                } catch (e) {
                    res.statusCode = 502
                    res.setHeader('Content-Type', 'application/json; charset=utf-8')
                    res.end(JSON.stringify({ error: e?.message || 'Falha na coleta.' }))
                }
            })
        },
    }
}

/** Em dev, atende /api/cep-lookup no Vite. */
function cepLookupDevPlugin() {
    return {
        name: 'cep-lookup-dev',
        enforce: 'pre',
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                const url = req.url || ''
                if (!url.startsWith('/api/cep-lookup')) {
                    next()
                    return
                }
                const reqLike = { method: req.method || 'GET', url, headers: req.headers || {} }
                const resLike = {
                    statusCode: 200,
                    setHeader(name, value) {
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
                }
                try {
                    await cepLookupHandler(reqLike, resLike)
                } catch (e) {
                    res.statusCode = 502
                    res.setHeader('Content-Type', 'application/json; charset=utf-8')
                    res.end(JSON.stringify({ error: e?.message || 'Falha na consulta CEP.' }))
                }
            })
        },
    }
}

/** Em dev/preview, atende /api/consulta-cnpj no próprio Vite (sem precisar de dev:api na porta 3000). */
function consultaCnpjDevPlugin() {
    return {
        name: 'consulta-cnpj-dev',
        enforce: 'pre',
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                const url = req.url || ''
                if (!url.startsWith('/api/consulta-cnpj')) {
                    next()
                    return
                }
                const reqLike = {
                    method: req.method || 'GET',
                    url,
                    headers: req.headers || {},
                }
                const resLike = {
                    statusCode: 200,
                    setHeader(name, value) {
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
                }
                try {
                    await consultaCnpjHandler(reqLike, resLike)
                } catch (e) {
                    res.statusCode = 502
                    res.setHeader('Content-Type', 'application/json; charset=utf-8')
                    res.end(JSON.stringify({ error: e?.message || 'Falha na consulta CNPJ.' }))
                }
            })
        },
    }
}

/** Em dev, atende /api/admin-users no Vite (código sempre atual; evita API antiga na porta 3000). */
function adminUsersDevPlugin() {
    return {
        name: 'admin-users-dev',
        enforce: 'pre',
        configureServer(server) {
            carregarEnvParaProcesso(server.config.envDir, server.config.mode)
            server.middlewares.use(async (req, res, next) => {
                const url = req.url || ''
                if (!url.startsWith('/api/admin-users')) {
                    next()
                    return
                }
                const method = req.method || 'POST'
                let body = {}
                if (method !== 'GET' && method !== 'HEAD') {
                    const chunks = []
                    try {
                        for await (const ch of req) chunks.push(ch)
                        const raw = Buffer.concat(chunks).toString('utf8')
                        if (raw.trim()) body = JSON.parse(raw)
                    } catch {
                        body = {}
                    }
                }
                const reqLike = {
                    method,
                    url,
                    headers: req.headers || {},
                    body,
                }
                const resLike = {
                    statusCode: 200,
                    setHeader(name, value) {
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
                }
                try {
                    await adminUsersHandler(reqLike, resLike)
                } catch (e) {
                    res.statusCode = 502
                    res.setHeader('Content-Type', 'application/json; charset=utf-8')
                    res.end(JSON.stringify({ error: e?.message || 'Falha na API admin-users.' }))
                }
            })
        },
    }
}

/** Em dev, atende GET/POST /api/aitest no Vite. */
function aitestDevPlugin() {
    return {
        name: 'aitest-dev',
        enforce: 'pre',
        configureServer(server) {
            carregarEnvParaProcesso(server.config.envDir, server.config.mode)
            server.middlewares.use(async (req, res, next) => {
                const url = req.url || ''
                if (!url.startsWith('/api/aitest')) {
                    next()
                    return
                }
                const method = req.method || 'GET'
                let body = {}
                if (method !== 'GET' && method !== 'HEAD') {
                    const chunks = []
                    try {
                        for await (const ch of req) chunks.push(ch)
                        const raw = Buffer.concat(chunks).toString('utf8')
                        if (raw.trim()) body = JSON.parse(raw)
                    } catch {
                        body = {}
                    }
                }
                const reqLike = {
                    method,
                    url,
                    headers: req.headers || {},
                    body,
                }
                const resLike = {
                    statusCode: 200,
                    setHeader(name, value) {
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
                }
                try {
                    await aitestHandler(reqLike, resLike)
                } catch (e) {
                    res.statusCode = 502
                    res.setHeader('Content-Type', 'application/json; charset=utf-8')
                    res.end(JSON.stringify({ error: e?.message || 'Falha na API aitest.' }))
                }
            })
        },
    }
}

/** Em dev, atende /api/audit-logs no Vite. */
function auditLogsDevPlugin() {
    return {
        name: 'audit-logs-dev',
        enforce: 'pre',
        configureServer(server) {
            carregarEnvParaProcesso(server.config.envDir, server.config.mode)
            server.middlewares.use(async (req, res, next) => {
                const url = req.url || ''
                if (!url.startsWith('/api/audit-logs')) {
                    next()
                    return
                }
                const method = req.method || 'POST'
                let body = {}
                if (method !== 'GET' && method !== 'HEAD') {
                    const chunks = []
                    try {
                        for await (const ch of req) chunks.push(ch)
                        const raw = Buffer.concat(chunks).toString('utf8')
                        if (raw.trim()) body = JSON.parse(raw)
                    } catch {
                        body = {}
                    }
                }
                const reqLike = {
                    method,
                    url,
                    headers: req.headers || {},
                    body,
                }
                const resLike = {
                    statusCode: 200,
                    setHeader(name, value) {
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
                }
                try {
                    await auditLogsHandler(reqLike, resLike)
                } catch (e) {
                    res.statusCode = 502
                    res.setHeader('Content-Type', 'application/json; charset=utf-8')
                    res.end(JSON.stringify({ error: e?.message || 'Falha na API audit-logs.' }))
                }
            })
        },
    }
}

function clicksignDevPlugin() {
    return {
        name: 'clicksign-proxy-dev',
        enforce: 'pre',
        configureServer(server) {
            carregarEnvParaProcesso(server.config.envDir, server.config.mode)
            const tok = (process.env.CLICKSIGN_ACCESS_TOKEN || process.env.CLICKSIGN_TOKEN || '').trim()
            if (!tok) {
                server.config.logger.warn(
                    `[clicksign] Sem token: defina CLICKSIGN_ACCESS_TOKEN em .env.local (pasta envDir: ${server.config.envDir}) e reinicie o Vite.`,
                )
            }

            server.middlewares.use(async (req, res, next) => {
                const url = req.url || ''
                if (url.startsWith('/api/clicksign-download')) {
                    const method = req.method || 'GET'
                    const reqLike = { method, url, headers: req.headers || {} }
                    const resLike = {
                        statusCode: 200,
                        setHeader(name, value) {
                            res.setHeader(name, value)
                        },
                        status(code) {
                            this.statusCode = code
                            res.statusCode = code
                            return this
                        },
                        end(body) {
                            res.statusCode = this.statusCode
                            res.end(body)
                        },
                        json(payload) {
                            if (!res.getHeader('Content-Type')) {
                                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                            }
                            res.statusCode = this.statusCode
                            res.end(JSON.stringify(payload))
                        },
                    }
                    try {
                        await clicksignDownloadHandler(reqLike, resLike)
                    } catch (e) {
                        res.statusCode = 502
                        res.setHeader('Content-Type', 'application/json; charset=utf-8')
                        res.end(JSON.stringify({ error: e?.message || 'Falha no download Clicksign.' }))
                    }
                    return
                }
                if (!url.startsWith('/api/clicksign')) {
                    next()
                    return
                }
                const method = req.method || 'GET'
                let rawBody = ''
                if (method !== 'GET' && method !== 'HEAD') {
                    const chunks = []
                    try {
                        for await (const ch of req) chunks.push(ch)
                        rawBody = Buffer.concat(chunks).toString('utf8')
                    } catch {
                        rawBody = ''
                    }
                }
                const reqLike = {
                    method,
                    url,
                    headers: req.headers || {},
                    body: rawBody,
                }
                const resLike = {
                    statusCode: 200,
                    setHeader(name, value) {
                        res.setHeader(name, value)
                    },
                    status(code) {
                        this.statusCode = code
                        res.statusCode = code
                        return this
                    },
                    end(body) {
                        res.statusCode = this.statusCode
                        res.end(body)
                    },
                    json(payload) {
                        if (!res.getHeader('Content-Type')) {
                            res.setHeader('Content-Type', 'application/json; charset=utf-8')
                        }
                        res.statusCode = this.statusCode
                        res.end(JSON.stringify(payload))
                    },
                }
                try {
                    await clicksignProxyHandler(reqLike, resLike)
                } catch (e) {
                    res.statusCode = 502
                    res.setHeader('Content-Type', 'application/json; charset=utf-8')
                    res.end(JSON.stringify({ error: e?.message || 'Falha no proxy Clicksign.' }))
                }
            })
        },
    }
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
    if (command === 'serve') {
        const env = loadEnv(mode, process.cwd(), '')
        if (env.CNPJ_CACHE_DAYS) process.env.CNPJ_CACHE_DAYS = env.CNPJ_CACHE_DAYS
        if (env.RECEITAWS_CACHE_DAYS) process.env.RECEITAWS_CACHE_DAYS = env.RECEITAWS_CACHE_DAYS
        const clickTok = (env.CLICKSIGN_ACCESS_TOKEN || env.CLICKSIGN_TOKEN || '').trim()
        if (clickTok) process.env.CLICKSIGN_ACCESS_TOKEN = clickTok
        if (env.CLICKSIGN_API_BASE) process.env.CLICKSIGN_API_BASE = env.CLICKSIGN_API_BASE
    }

    return {
        // Dev local sempre na raiz. Em build, usa base do Vercel ou do GitHub Pages.
        base: command === 'serve' ? '/' : process.env.VERCEL ? '/' : '/EmerLAB/',
        plugins: [
            command === 'serve' ? consultaCnpjDevPlugin() : null,
            command === 'serve' ? cepLookupDevPlugin() : null,
            command === 'serve' ? mapOsmDevPlugin() : null,
            command === 'serve' ? prospectosOsmColetarDevPlugin() : null,
            command === 'serve' ? adminUsersDevPlugin() : null,
            command === 'serve' ? auditLogsDevPlugin() : null,
            command === 'serve' ? aitestDevPlugin() : null,
            command === 'serve' ? clicksignDevPlugin() : null,
            react(),
        ].filter(Boolean),
        server: {
            proxy: {
                '/api/rc-pdf': 'http://localhost:3000',
                '/api/consulta-cnpj': 'http://localhost:3000',
                '/api/geocode-prestador': 'http://localhost:3000',
            },
        },
        optimizeDeps: {
            include: ['exceljs'],
        },
        test: {
            environment: 'node',
            include: ['src/**/*.test.{js,jsx,ts,tsx}'],
        },
    }
})
