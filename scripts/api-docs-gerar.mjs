/**
 * Gera a página estática da documentação da API pública (public/api-docs/index.html) a partir de docs/api/openapi.json.
 * Também copia o openapi.json para public/api-docs/, de onde a página o oferece para download.
 *
 * Uso: npm run api-docs
 * A página não usa JavaScript (a política de segurança do site só aceita scripts do próprio domínio) e só aponta para
 * arquivos de /api-docs/, porque em https://api.emerlab.com.br/docs o endereço relativo não acompanha a pasta.
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ORIGEM_EXEMPLO = 'https://www.exemplo.com.br'
const CHAVE_REDE = 'emer_rede_EXEMPLO_NAO_E_UMA_CHAVE'
const CHAVE_PAG = 'emer_pag_EXEMPLO_NAO_E_UMA_CHAVE'

const esc = (t) =>
    String(t ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')

const slug = (t) =>
    String(t)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')

/** Markdown mínimo usado nas descrições: `código`, **negrito**, listas com "- " e parágrafos. */
function inline(t) {
    return esc(t)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}
function bloco(texto) {
    const partes = String(texto || '')
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
    return partes
        .map((p) => {
            const linhas = p.split('\n')
            if (linhas.every((l) => l.startsWith('- '))) {
                return `<ul>${linhas.map((l) => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>`
            }
            return `<p>${linhas.map(inline).join('<br>')}</p>`
        })
        .join('\n')
}

const json = (v) => esc(JSON.stringify(v, null, 2))

function resolver(spec, ref) {
    return ref.replace('#/', '').split('/').reduce((o, k) => o?.[k], spec)
}

function exemploParametro(p) {
    if (p.example !== undefined) return p.example
    if (p.schema?.default !== undefined) return p.schema.default
    return undefined
}

function curlDe(spec, caminho, metodo, op) {
    const rede = op.tags?.includes('Rede credenciada')
    const base = spec.servers[0].url
    let url = base + caminho
    const query = []
    for (const p of op.parameters || []) {
        const ex = exemploParametro(p)
        const par = p.$ref ? resolver(spec, p.$ref) : p
        if (par.in === 'path') url = url.replace(`{${par.name}}`, encodeURIComponent(String(exemploParametro(par) ?? par.name)))
        else if (par.in === 'query' && ex !== undefined && ['uf', 'cidade', 'plano', 'mes', 'ano', 'pago'].includes(par.name)) {
            query.push(`${par.name}=${encodeURIComponent(String(ex))}`)
        }
    }
    if (query.length && metodo === 'get') url += `?${query.join('&')}`
    const linhas = [`curl${metodo === 'get' ? '' : ` -X ${metodo.toUpperCase()}`} "${url}"`]
    linhas.push(`  -H "Authorization: Bearer ${rede ? CHAVE_REDE : CHAVE_PAG}"`)
    if (rede) linhas.push(`  -H "Origin: ${ORIGEM_EXEMPLO}"`)
    const corpo = op.requestBody?.content?.['application/json']?.example
    if (corpo !== undefined) {
        linhas.push('  -H "Content-Type: application/json"')
        linhas.push(`  -d '${JSON.stringify(corpo)}'`)
    }
    return linhas.join(' \\\n')
}

function tabelaParametros(spec, op) {
    const lista = (op.parameters || []).map((p) => (p.$ref ? resolver(spec, p.$ref) : p))
    if (!lista.length) return ''
    const linhas = lista
        .map((p) => {
            const tipo = p.schema?.enum ? p.schema.enum.join(' | ') : p.schema?.type || ''
            return `<tr><td><code>${esc(p.name)}</code></td><td>${esc(p.in === 'path' ? 'caminho' : 'query')}${p.required ? ' · obrigatório' : ''}</td><td>${esc(tipo)}</td><td>${inline(p.description || '')}</td></tr>`
        })
        .join('')
    return `<h4>Parâmetros</h4><div class="rolavel"><table><thead><tr><th>Nome</th><th>Onde</th><th>Tipo</th><th>Descrição</th></tr></thead><tbody>${linhas}</tbody></table></div>`
}

function respostas(spec, op) {
    const itens = Object.entries(op.responses).map(([codigo, r0]) => {
        const r = r0.$ref ? resolver(spec, r0.$ref) : r0
        const media = r.content?.['application/json']
        let exemplo = media?.example
        if (exemplo === undefined && media?.examples) {
            exemplo = Object.values(media.examples)
                .map((e) => e.value)
                .at(0)
        }
        const cab = Object.keys(r.headers || {})
        const ok = codigo.startsWith('2')
        const detalhe = ok && exemplo !== undefined ? `<pre><code>${json(exemplo)}</code></pre>` : ''
        const cabecalhos = ok && cab.length ? `<p class="mini">Cabeçalhos: ${cab.map((c) => `<code>${esc(c)}</code>`).join(', ')}</p>` : ''
        return `<tr class="${ok ? 'ok' : 'erro'}"><td><code>${esc(codigo)}</code></td><td>${inline(r.description || '')}${cabecalhos}${detalhe}</td></tr>`
    })
    return `<h4>Respostas</h4><div class="rolavel"><table><thead><tr><th>HTTP</th><th>Significado</th></tr></thead><tbody>${itens.join('')}</tbody></table></div>`
}

function operacao(spec, caminho, metodo, op) {
    const id = slug(op.operationId)
    const corpo = op.requestBody?.content?.['application/json']
    return `<details class="op" id="${id}">
<summary><span class="met met-${metodo}">${metodo.toUpperCase()}</span> <code>${esc(caminho)}</code> <span class="resumo">${esc(op.summary)}</span></summary>
<div class="conteudo">
${bloco(op.description)}
${tabelaParametros(spec, op)}
${corpo ? `<h4>Corpo (JSON)</h4><pre><code>${json(corpo.example)}</code></pre>` : ''}
<h4>Exemplo</h4>
<pre><code>${esc(curlDe(spec, caminho, metodo, op))}</code></pre>
${respostas(spec, op)}
</div>
</details>`
}

const CODIGOS = [
    ['chave_invalida', '401', 'Chave ausente, desconhecida, revogada ou expirada (as quatro dão a mesma resposta).'],
    ['escopo_insuficiente', '403', 'A chave existe, mas não tem o escopo da rota.'],
    ['origem_nao_permitida', '403', 'Chave da rede: cabeçalho Origin ausente ou fora da lista. Chave de pagamentos: qualquer requisição com Origin.'],
    ['ip_nao_permitido', '403', 'A chave tem lista de IPs e o IP de origem não está nela (recurso opcional e hoje sem uso).'],
    ['rota_nao_encontrada', '404', 'Caminho ou método que não existe.'],
    ['limite_excedido', '429', 'Limite por minuto da chave excedido; veja Retry-After.'],
    ['payload_grande', '413', 'Corpo da requisição acima do teto da rota (256 KB; cerca de 4,4 MiB no comprovante).'],
    ['corpo_invalido', '400', 'O corpo não é um objeto JSON válido.'],
    ['tipo_invalido', '400', 'Filtro tipo diferente de local ou especialidade.'],
    ['plano_invalido', '400', 'Filtro plano desconhecido ou "Apenas Loja".'],
    ['credenciado_nao_encontrado', '404', 'Credenciado inexistente ou fora da rede.'],
    ['parametro_invalido', '400', 'Filtro malformado (mes, ano, pago, prestador_id, notificar_prestador).'],
    ['registro_nao_encontrado', '404', 'Registro de pagamento inexistente.'],
    ['data_pagamento_invalida', '400', 'data_pagamento fora do formato AAAA-MM-DD.'],
    ['valor_invalido', '400', 'valor ausente ou não positivo.'],
    ['motivo_obrigatorio', '400', 'Desfazer pagamento sem motivo de 5 caracteres ou mais.'],
    ['arquivo_obrigatorio', '400', 'arquivo_base64 ausente.'],
    ['arquivo_invalido', '422', 'Base64 inválido, arquivo vazio ou que não é PDF, PNG ou JPEG.'],
    ['arquivo_grande', '413', 'Arquivo acima de 3 MB decodificado.'],
    ['prestador_sem_email', '422', 'notificar_prestador=true e o prestador não tem e-mail.'],
    ['nao_esta_pago', '409', 'Desfazer pagamento de um registro que não está pago.'],
    ['registro_sem_relatorio', '409', 'Comprovante em registro sem relatório de repasse (limitação atual).'],
    ['comprovante_em_processamento', '409', 'Mesmo comprovante enviado há menos de 45 s; repita depois de Retry-After.'],
    ['comprovante_inconsistente', '500', 'O servidor não terminou de forma consistente; repita a chamada.'],
    ['erro_interno', '500', 'Falha inesperada no servidor.'],
]

function secoesGuia() {
    const linhasErro = CODIGOS.map(([c, h, d]) => `<tr><td><code>${c}</code></td><td>${h}</td><td>${esc(d)}</td></tr>`).join('')
    return `<section id="comecar">
<h2>Começar</h2>
<p>Uma chave de API é gerada por um administrador do EmerLAB (menu Administrativo &gt; API) e entregue por canal seguro. Há dois tipos:</p>
<ul>
<li><strong>Chave da rede</strong> (<code>emer_rede_…</code>, escopo <code>rede:ler</code>): vai no navegador do site. É pública por natureza e se protege pela origem permitida e pelo limite de requisições.</li>
<li><strong>Chave de pagamentos</strong> (<code>emer_pag_…</code>, escopos <code>pagamentos:ler</code> e <code>pagamentos:escrever</code>): só servidor a servidor. Qualquer requisição com cabeçalho <code>Origin</code> é recusada (403).</li>
</ul>
<p>URL base: <code>https://api.emerlab.com.br</code>, rotas <code>/v1/…</code> (sem <code>/api</code>). As mesmas rotas existem em <code>/api/v1/…</code> no domínio principal do EmerLAB.</p>
<pre><code>curl "https://api.emerlab.com.br/v1/rede/filtros" \\
  -H "Authorization: Bearer ${CHAVE_REDE}" \\
  -H "Origin: ${ORIGEM_EXEMPLO}"</code></pre>
</section>
<section id="autenticacao">
<h2>Autenticação e origens</h2>
<ul>
<li>Envie a chave em <code>Authorization: Bearer &lt;chave&gt;</code> ou em <code>X-Api-Key</code>.</li>
<li>Chave da rede: a requisição precisa de um <code>Origin</code> igual a uma origem cadastrada na chave. O navegador envia sozinho; em <code>curl</code> ou no servidor, envie você mesmo.</li>
<li>Origens são exatas: <code>https://host</code> ou <code>https://host:porta</code>, sem caminho e sem curinga. Para desenvolvimento local também valem <code>http://localhost</code> e <code>http://127.0.0.1</code>, com porta opcional.</li>
<li>Chave revogada ou editada leva até 30 segundos para parar (ou começar) a valer. As respostas da rede ficam em cache na borda por até 5 minutos: uma chave revogada ainda pode receber dados públicos do cache nesse período.</li>
</ul>
</section>
<section id="cors">
<h2>CORS</h2>
<p>Só <code>GET</code>, <code>POST</code> e <code>OPTIONS</code>. O cabeçalho <code>Access-Control-Allow-Origin</code> só é enviado para origens cadastradas em alguma chave ativa. Os cabeçalhos legíveis pelo navegador são <code>Retry-After</code>, <code>X-RateLimit-Limit</code> e <code>X-RateLimit-Remaining</code>. Atenção: <code>X-Total-Count</code> ainda não consta dessa lista, então o navegador não o enxerga em chamadas entre domínios (veja o guia da rede credenciada).</p>
</section>
<section id="limites">
<h2>Limites e paginação</h2>
<ul>
<li>Limite por chave por minuto: 120 (rede) e 60 (pagamentos) por padrão, ajustável por chave. Cabeçalhos <code>X-RateLimit-Limit</code> e <code>X-RateLimit-Remaining</code> em cada resposta. Ao exceder: 429 <code>limite_excedido</code> com <code>Retry-After</code> (segundos).</li>
<li>O contador é por instância do servidor; sob carga o limite efetivo pode ser maior que o configurado.</li>
<li>Listas: <code>pagina</code> (padrão 1) e <code>por_pagina</code> (padrão 18, de 1 a 100; 0 também vira 18). O total vem em <code>X-Total-Count</code>. Ordem por nome e depois id (rede) ou do mais recente ao mais antigo (pagamentos).</li>
</ul>
</section>
<section id="erros">
<h2>Erros</h2>
<p>Todo erro tem o corpo <code>{ "erro": { "codigo": "…", "mensagem": "…" } }</code>. Trate pelo <code>codigo</code>; a <code>mensagem</code> é para humanos.</p>
<div class="rolavel"><table><thead><tr><th>Código</th><th>HTTP</th><th>Quando</th></tr></thead><tbody>${linhasErro}</tbody></table></div>
</section>
<section id="credenciado-definicao">
<h2>Regras da rede credenciada</h2>
<ul>
<li><strong>Credenciado</strong> é o prestador ativo com situação "Credenciado". Situações como "Descredenciado" e "Não credenciado" nunca entram.</li>
<li><strong>Cidade:</strong> casa a cidade principal ou qualquer cidade que o credenciado atende; "Porto Alegre e Região" casa com "Porto Alegre".</li>
<li><strong>Endereço</strong> só vem quando o credenciado tem alguma especialidade do tipo Local (principal ou secundária: clínica 24h, clínica, consultório, hospital, laboratório, farmácia, petshop, comércio, banho e tosa, crematório, hotel, recreação, adestramento); senão é <code>null</code>.</li>
<li><strong>Plano</strong> (opcional) restringe às cidades em que o plano tem tabela e corta procedimentos pela hierarquia Básico ⊂ Clássico ⊂ Avançado ⊂ Ultra. "Apenas Loja" devolve 400.</li>
</ul>
</section>
<section id="pagamentos-regras">
<h2>Regras dos pagamentos</h2>
<ul>
<li>Fluxo: listar registros, marcar como pago, anexar o comprovante. A API só altera a flag <code>pago</code> do registro.</li>
<li>Marcar como pago é idempotente (<code>ja_estava_pago: true</code>). O mesmo comprovante (mesmo SHA-256) no mesmo registro devolve o existente (<code>ja_existia: true</code>); repetido em menos de 45 s, 409 <code>comprovante_em_processamento</code>.</li>
<li>O comprovante é enviado em JSON (<code>arquivo_base64</code>), PDF, PNG ou JPEG, até 3 MB.</li>
<li><strong>Limitação atual:</strong> registro sem relatório de repasse aceita "marcar pago", mas o comprovante devolve 409 <code>registro_sem_relatorio</code> até uma mudança no banco prevista para a próxima versão.</li>
<li>As respostas nunca incluem chave PIX, e-mails nem caminhos de arquivo, e não têm cache.</li>
</ul>
</section>`
}

const CSS = `:root{--bg:#fafaf7;--fg:#1d2327;--mudo:#5b6670;--card:#fff;--borda:#dcdfe3;--acento:#0b5cad;--codigo:#f0f2f4;--ok:#1a7f45;--erro:#b3261e}
@media (prefers-color-scheme:dark){:root:not([data-tema="claro"]){--bg:#14181c;--fg:#e6e9ec;--mudo:#9aa5ae;--card:#1b2127;--borda:#2f373e;--acento:#6cb2f5;--codigo:#232b32;--ok:#4cc38a;--erro:#f2877f}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header,main,footer{max-width:60rem;margin:0 auto;padding:0 16px}
header{padding-top:32px}
h1{font-size:1.8rem;margin:0 0 4px}
h2{font-size:1.35rem;margin:2rem 0 .5rem;border-bottom:1px solid var(--borda);padding-bottom:.3rem}
h3{font-size:1.1rem;margin:1.6rem 0 .5rem}
h4{font-size:.95rem;margin:1rem 0 .3rem;color:var(--mudo);text-transform:uppercase;letter-spacing:.04em}
a{color:var(--acento)}
code{background:var(--codigo);padding:.08em .35em;border-radius:4px;font:.88em ui-monospace,SFMono-Regular,Consolas,monospace}
pre{background:var(--codigo);padding:12px;border-radius:8px;overflow-x:auto;margin:.4rem 0}
pre code{background:none;padding:0;font-size:.82rem}
nav{display:flex;flex-wrap:wrap;gap:6px 14px;margin:12px 0;padding:10px 0;border-block:1px solid var(--borda);font-size:.92rem}
.mudo,.mini{color:var(--mudo)}
.mini{font-size:.85rem;margin:.3rem 0}
.rolavel{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:.9rem}
th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--borda);padding:6px 8px}
th{color:var(--mudo);font-weight:600}
details.op{background:var(--card);border:1px solid var(--borda);border-radius:10px;margin:10px 0}
details.op>summary{cursor:pointer;padding:10px 12px;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center}
details.op>summary:focus-visible{outline:2px solid var(--acento);outline-offset:2px}
.resumo{color:var(--mudo)}
.conteudo{padding:0 12px 12px}
.met{font-weight:700;font-size:.78rem;padding:2px 8px;border-radius:6px;color:#fff;background:#0b5cad}
.met-post{background:#1a7f45}.met-delete{background:#b3261e}
tr.ok td:first-child{color:var(--ok)}tr.erro td:first-child{color:var(--erro)}
footer{padding-bottom:48px;color:var(--mudo);font-size:.9rem}
@media (max-width:520px){h1{font-size:1.5rem}}`

/** HTML completo da página de documentação para o OpenAPI informado. Determinístico (sem data nem aleatoriedade). */
export function gerarHtml(spec) {
    const porTag = new Map(spec.tags.map((t) => [t.name, []]))
    for (const [caminho, item] of Object.entries(spec.paths)) {
        for (const metodo of ['get', 'post', 'put', 'patch', 'delete']) {
            const op = item[metodo]
            if (op) porTag.get(op.tags[0]).push(operacao(spec, caminho, metodo, op))
        }
    }
    const secoesTags = spec.tags
        .map((t) => `<section id="${slug(t.name)}"><h2>${esc(t.name)}</h2>${bloco(t.description)}${porTag.get(t.name).join('\n')}</section>`)
        .join('\n')
    const nav = [
        ['comecar', 'Começar'],
        ['autenticacao', 'Autenticação'],
        ['cors', 'CORS'],
        ['limites', 'Limites'],
        ['erros', 'Erros'],
        ['rede-credenciada', 'Rede credenciada'],
        ['pagamentos', 'Pagamentos'],
    ]
        .map(([id, nome]) => `<a href="#${id}">${nome}</a>`)
        .join('\n')
    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>API pública do EmerLAB</title>
<style>${CSS}</style>
</head>
<body>
<header>
<h1>${esc(spec.info.title)}</h1>
<p class="mudo">Versão ${esc(spec.info.version)} · ${esc(spec.info.summary)}</p>
<p>URL base: <code>${esc(spec.servers[0].url)}</code> · <a href="/api-docs/openapi.json">openapi.json</a> (OpenAPI ${esc(spec.openapi)}, para Postman, Swagger e geração de cliente)</p>
<nav aria-label="Seções">
${nav}
</nav>
</header>
<main>
${secoesGuia()}
${secoesTags}
</main>
<footer>
<p>Gerado a partir de <code>docs/api/openapi.json</code>. Os exemplos usam chaves e dados fictícios. Os guias completos (README, rede credenciada e pagamentos) estão em <code>docs/api/</code> no repositório do EmerLAB.</p>
</footer>
</body>
</html>
`
}

function principal() {
    const origem = new URL('../docs/api/openapi.json', import.meta.url)
    const destinoJson = new URL('../public/api-docs/openapi.json', import.meta.url)
    const destinoHtml = new URL('../public/api-docs/index.html', import.meta.url)
    const spec = JSON.parse(readFileSync(origem, 'utf8'))
    copyFileSync(origem, destinoJson)
    writeFileSync(destinoHtml, gerarHtml(spec), 'utf8')
    console.log('Gerado: public/api-docs/index.html e public/api-docs/openapi.json')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) principal()
