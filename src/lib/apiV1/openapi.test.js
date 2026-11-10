import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { carregarRotas, ESCOPO_JWT_ACCESS_MANAGE, listarRotasRegistradas } from '../../../api/_lib/apiV1/roteador.js'
import { gerarHtml } from '../../../scripts/api-docs-gerar.mjs'

const raiz = fileURLToPath(new URL('../../../', import.meta.url))
// Normaliza CRLF: em Windows o Git pode converter as quebras de linha na cópia de trabalho.
const ler = (rel) => readFileSync(join(raiz, rel), 'utf8').replaceAll('\r\n', '\n')
const METODOS = ['get', 'post', 'put', 'patch', 'delete']

const spec = JSON.parse(ler('docs/api/openapi.json'))
const chave = (metodo, caminho) => `${String(metodo).toUpperCase()} ${caminho}`

async function rotasPublicas() {
    await carregarRotas()
    return listarRotasRegistradas()
        .filter((r) => r.escopo !== ESCOPO_JWT_ACCESS_MANAGE)
        .map((r) => chave(r.metodo, `/v1${r.padrao}`))
}

function arquivos(dir) {
    const saida = []
    for (const nome of readdirSync(join(raiz, dir))) {
        const rel = `${dir}/${nome}`
        if (statSync(join(raiz, rel)).isDirectory()) saida.push(...arquivos(rel))
        else if (/\.(md|json|html)$/.test(nome)) saida.push(rel)
    }
    return saida
}

describe('OpenAPI x roteador', () => {
    it('é OpenAPI 3.1 e declara a URL base canônica', () => {
        expect(spec.openapi).toMatch(/^3\.1\./)
        expect(spec.servers[0].url).toBe('https://api.emerlab.com.br')
    })

    it('toda rota pública registrada aparece no arquivo', async () => {
        const doc = new Set()
        for (const [caminho, item] of Object.entries(spec.paths)) {
            for (const m of METODOS) if (item[m]) doc.add(chave(m, caminho))
        }
        const faltando = (await rotasPublicas()).filter((r) => !doc.has(r))
        expect(faltando).toEqual([])
    })

    it('todo caminho do arquivo existe no roteador e nenhuma rota de administração é documentada', async () => {
        const registradas = new Set(await rotasPublicas())
        const sobrando = []
        for (const [caminho, item] of Object.entries(spec.paths)) {
            expect(caminho.startsWith('/v1/')).toBe(true)
            expect(caminho.startsWith('/v1/admin')).toBe(false)
            for (const m of METODOS) if (item[m] && !registradas.has(chave(m, caminho))) sobrando.push(chave(m, caminho))
        }
        expect(sobrando).toEqual([])
    })

    it('cada operação tem segurança, resposta de sucesso e resposta de erro', () => {
        for (const [caminho, item] of Object.entries(spec.paths)) {
            for (const m of METODOS.filter((x) => item[x])) {
                const op = item[m]
                const nome = chave(m, caminho)
                expect(op.operationId, nome).toBeTruthy()
                expect(op.security?.length, nome).toBeGreaterThan(0)
                expect(Object.keys(op.responses).some((c) => c.startsWith('2')), nome).toBe(true)
                expect(op.responses['401'] || op.responses.default, nome).toBeTruthy()
            }
        }
    })
})

describe('arquivos de documentação', () => {
    const docs = [...arquivos('docs/api'), ...arquivos('public/api-docs')]

    it('existem os guias e a página', () => {
        for (const f of ['docs/api/README.md', 'docs/api/rede-credenciada.md', 'docs/api/pagamentos.md', 'public/api-docs/index.html']) {
            expect(existsSync(join(raiz, f)), f).toBe(true)
        }
    })

    it('nenhum arquivo contém algo parecido com uma chave real', () => {
        for (const f of docs) expect(ler(f), f).not.toMatch(/emer_(rede|pag)_[A-Za-z0-9]{32}/)
    })

    it('os documentos novos não citam identificadores nem hosts internos do banco', () => {
        for (const f of docs.filter((x) => !/especificacao-design|plano-implementacao/.test(x))) {
            expect(ler(f), f).not.toMatch(/supabase\.co|service_role|SERVICE_ROLE/i)
        }
    })

    it('os exemplos usam a URL base canônica, sem o prefixo /api', () => {
        for (const f of ['docs/api/README.md', 'docs/api/rede-credenciada.md', 'docs/api/pagamentos.md']) {
            expect(ler(f), f).not.toMatch(/https:\/\/api\.emerlab\.com\.br\/api\/v1/)
        }
    })

    it('public/api-docs/openapi.json é idêntico a docs/api/openapi.json', () => {
        expect(ler('public/api-docs/openapi.json')).toBe(ler('docs/api/openapi.json'))
    })

    it('public/api-docs/index.html está atualizado com o gerador (npm run api-docs)', () => {
        expect(ler('public/api-docs/index.html')).toBe(gerarHtml(spec))
    })

    it('a página não depende de script nem de arquivo fora de /api-docs/', () => {
        const html = ler('public/api-docs/index.html')
        expect(html).not.toMatch(/<script/i)
        expect(html).not.toMatch(/(src|href)="https?:\/\//i)
        const locais = [...html.matchAll(/(?:src|href)="(\/[^"#]*)"/g)].map((m) => m[1])
        for (const l of locais) expect(l.startsWith('/api-docs/'), l).toBe(true)
    })
})
