# API da Rede Credenciada

Guia para a equipe que reconstrói o site público da Emerdog. Você não precisa conhecer o EmerLAB: basta saber que ele é o cadastro oficial dos **credenciados** (clínicas, profissionais e lojas que atendem os clientes da Emerdog) e que esta API entrega esse cadastro, só leitura, já no formato certo para o site.

Leia antes o [README](README.md) (autenticação, erros, limites). Referência completa de cada rota: [openapi.json](openapi.json) ou https://api.emerlab.com.br/docs.

## Resumo

| Rota                                | O que devolve                                                         |
| ----------------------------------- | --------------------------------------------------------------------- |
| `GET /v1/rede/filtros`              | UFs, cidades por UF, especialidades e planos, para montar os filtros   |
| `GET /v1/rede/credenciados`         | Lista paginada, com filtros                                           |
| `GET /v1/rede/credenciados/{id}`    | Um credenciado                                                        |

- URL base: `https://api.emerlab.com.br` (sem `/api`).
- Chave: **chave da rede** (`emer_rede_…`, escopo `rede:ler`). Pode ficar no código do site; ela só funciona a partir das origens cadastradas.
- O navegador envia o cabeçalho `Origin` sozinho. Em `curl` ou em código de servidor, envie-o à mão (`-H "Origin: https://www.exemplo.com.br"`).

## Quem é um "credenciado"

É um prestador **ativo** cuja situação no cadastro é **"Credenciado"**. Situações como "Descredenciado" e "Não credenciado" nunca entram, mesmo que contenham a palavra. Um credenciado que muda de situação sai da API na próxima atualização do cache (poucos minutos; veja [Cache](#cache)).

## O objeto `credenciado`

Exemplo (dados fictícios):

```json
{
  "id": 123,
  "nome": "Clínica Veterinária Exemplo",
  "tipo": "local",
  "especialidade_principal": "Clínica",
  "especialidades_secundarias": ["Fisioterapeuta", "Integrativa"],
  "contatos": {
    "telefone": "(51) 3000-0000",
    "celular": "(51) 90000-0000",
    "whatsapp_url": "https://wa.me/5551900000000"
  },
  "cidade_principal": { "nome": "Porto Alegre", "uf": "RS" },
  "cidades_atende": [
    { "nome": "Porto Alegre", "uf": "RS" },
    { "nome": "Canoas", "uf": "RS" }
  ],
  "endereco": {
    "logradouro": "Rua das Flores",
    "numero": "100",
    "complemento": "Sala 2",
    "bairro": "Centro Histórico",
    "cidade": "Porto Alegre",
    "uf": "RS",
    "cep": "90000-000",
    "texto": "Rua das Flores, 100 — Centro Histórico — Porto Alegre/RS"
  },
  "procedimentos": [
    { "categoria": "Consultas", "itens": [{ "codigo": "CONS-001", "nome": "Consulta clínica", "nome_alternativo": null }] },
    { "categoria": "Sessões", "itens": [{ "codigo": "SESS-002", "nome": "Sessão de Fisioterapia", "nome_alternativo": "Fisioterapia canina" }] }
  ],
  "descontos": {
    "itens": [{ "nome": "Banho e tosa", "grupo": "Serviços", "percentual": 10, "percentual_max": 15 }],
    "observacoes": "Desconto válido mediante apresentação da carteirinha."
  }
}
```

Regras que ajudam a desenhar a tela:

- **`id`** é o identificador no EmerLAB e é estável: use-o em links e em chaves de lista.
- **`tipo`** reflete a especialidade **principal**: `local` (clínica, hospital, loja…) ou `especialidade` (profissional).
- **`endereco`** vem preenchido quando o credenciado tem **qualquer** especialidade do tipo *Local*, principal **ou secundária**; caso contrário é `null`. Por isso um fisioterapeuta (`tipo: "especialidade"`) com "Clínica" como secundária **tem** endereço. O tipo *Local* inclui Clínica 24h, Clínica, Consultório, Hospital, Laboratório, Farmácia, PetShop, Comércio, Banho e Tosa, Crematório, Hotel, Recreação e Adestramento. Trate sempre `endereco === null`.
- **`endereco.texto`** é o endereço já montado em uma linha; os demais campos servem se você preferir montar o seu. Qualquer campo pode ser `null`.
- **`contatos`**: `telefone`, `celular` e `whatsapp_url` podem ser `null`. `whatsapp_url` só existe se há um número válido.
- **`cidades_atende`** é a lista "cidades que atende" do cadastro, além da `cidade_principal`. Um veterinário vinculado a uma clínica herda as cidades da clínica.
- **`procedimentos`** vêm agrupados por categoria (a categoria `null` agrupa os sem categoria e vem por último). `nome_alternativo` é como o credenciado chama o procedimento, quando difere do padrão.
- **`descontos.itens`**: `percentual` é o desconto (ou o mínimo da faixa) e `percentual_max` o máximo da faixa; `percentual_max` pode ser `null`. Ambos são números em pontos percentuais (10 = 10%).
- Tudo que não está nesta lista **não** é devolvido: a API monta cada objeto campo a campo. Não há CPF/CNPJ, PIX, e-mail interno, situação cadastral nem observações internas.

## Card → campo da API

Mapa do card atual da página `/rede-credenciada/` para os campos da API:

| Elemento do card                                              | Campo da API                                                                                         |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Etiqueta principal (ex.: "Fisioterapeuta")                    | `especialidade_principal`                                                                            |
| Etiquetas secundárias (ex.: "Clínica", "Integrativa")         | `especialidades_secundarias` (lista, não texto separado por vírgula)                                 |
| Título                                                        | `nome`                                                                                               |
| "Cidade: Caxias do Sul, RS" ou "Cidades: A, B, C · RS"        | `cidade_principal` e `cidades_atende` (cada item traz `nome` e `uf`)                                  |
| Endereço (só em alguns cards, os de tipo local)               | `endereco.texto` (ou `endereco.logradouro`, `numero`, `bairro`…); `null` quando não há               |
| Telefone                                                      | `contatos.telefone` e `contatos.celular`                                                             |
| Botão "Entre em contato" (WhatsApp)                           | `contatos.whatsapp_url`                                                                              |
| Botão "Ver detalhes do credenciado"                           | Os dados completos **já vêm na lista**; abra o detalhe na própria tela. Para link direto, `GET /v1/rede/credenciados/{id}` |
| Detalhe: procedimentos por categoria (ex.: SESSÕES → …)       | `procedimentos[].categoria` e `procedimentos[].itens[]` (`codigo`, `nome`, `nome_alternativo`)       |
| Desconto (novo, o site atual não mostra)                      | `descontos.itens[]` (`nome`, `grupo`, `percentual`, `percentual_max`) e `descontos.observacoes`      |
| Filtro "Estado"                                               | `filtros.ufs`                                                                                        |
| Filtro "Cidade" (depende do estado)                           | `filtros.cidades[uf]`                                                                                |
| Filtro "Especialidade"                                        | `filtros.especialidades[]` (`id`, `nome`, `tipo`)                                                    |
| Filtro de plano (novo)                                        | `filtros.planos[]` (`id`, `chave`, `nome`)                                                           |
| "547 credenciados encontrados" / "Mostrando 1–18 de 547"      | Cabeçalho `X-Total-Count` e `pagina`/`por_pagina` (veja a ressalva em [Paginação e total](#paginação-e-total)) |

## Filtros em cascata: UF → cidade → especialidade → plano

`GET /v1/rede/filtros` traz tudo o que o site precisa para montar os seletores com **uma** chamada:

```json
{
  "ufs": ["MG", "PR", "RS"],
  "cidades": { "MG": ["Belo Horizonte"], "PR": ["Curitiba"], "RS": ["Canoas", "Porto Alegre"] },
  "especialidades": [
    { "id": 2, "nome": "Clínica", "tipo": "Local" },
    { "id": 12, "nome": "Fisioterapeuta", "tipo": "Especialidade" }
  ],
  "planos": [
    { "id": 1, "chave": "basico", "nome": "Básico" },
    { "id": 2, "chave": "classico", "nome": "Clássico" },
    { "id": 3, "chave": "avancado", "nome": "Avançado" },
    { "id": 4, "chave": "ultra", "nome": "Ultra" }
  ]
}
```

- Só aparecem UFs, cidades e especialidades que **têm pelo menos um credenciado** (nada de opção que resulta em lista vazia). Isso vale para cada filtro isolado; a combinação de dois filtros ainda pode dar zero.
- `cidades` é um objeto indexado por UF; ao escolher o estado, mostre `cidades[uf]`.
- `especialidades` é uma lista única (não depende de UF nem de cidade). `tipo` é `Local` ou `Especialidade`.
- `planos` são os 4 planos da hierarquia, do Básico ao Ultra.

Passos do fluxo:

1. Ao abrir a página, chame `GET /v1/rede/filtros` e preencha UF. Carregue `GET /v1/rede/credenciados` sem filtros para a primeira lista.
2. Ao escolher a UF, preencha a cidade com `filtros.cidades[uf]` e limpe a cidade anterior.
3. Ao clicar em "Buscar", chame `GET /v1/rede/credenciados?uf=RS&cidade=Porto%20Alegre&especialidade=12&plano=classico&pagina=1`. Todos os filtros são opcionais e se combinam.
4. Ao mudar qualquer filtro, volte para a `pagina=1`.

### Parâmetros de `GET /v1/rede/credenciados`

| Parâmetro       | Exemplo        | O que faz                                                                                                                                  |
| --------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `uf`            | `RS`           | Credenciados com alguma cidade nessa UF                                                                                                    |
| `cidade`        | `Porto Alegre` | Casa a cidade principal **ou** qualquer cidade que atende. Sem acento e sem diferenciar maiúsculas. "Porto Alegre e Região" casa com "Porto Alegre" |
| `especialidade` | `12` ou `Clínica` | Id (da lista de filtros) ou nome. Casa a especialidade principal ou as secundárias                                                      |
| `tipo`          | `local`        | `local`: tem alguma especialidade do tipo Local (principal ou secundária). `especialidade`: não tem nenhuma. Outro valor: 400 `tipo_invalido` |
| `plano`         | `classico`     | Opcional. Id ou chave (`basico`, `classico`, `avancado`, `ultra`). Veja abaixo                                                              |
| `q`             | `clinica`      | Busca por nome (sem acento; todas as palavras precisam aparecer)                                                                            |
| `pagina`        | `1`            | Começa em 1                                                                                                                                 |
| `por_pagina`    | `18`           | De 1 a 100; padrão 18                                                                                                                       |

**Filtro de plano.** É opcional. Quando enviado:

- restringe aos credenciados que atendem alguma cidade em que o plano tem tabela de valores;
- corta os procedimentos de cada credenciado pela hierarquia: **Básico ⊂ Clássico ⊂ Avançado ⊂ Ultra** (o Clássico inclui os procedimentos do Básico, o Avançado os do Clássico e assim por diante);
- "Apenas Loja" não é um plano de atendimento e devolve `400 plano_invalido`, assim como qualquer valor desconhecido.

Sem `plano`, a busca é só por cidade e cada credenciado traz todos os seus procedimentos. A página de detalhe (`/credenciados/{id}`) também traz todos os procedimentos.

## Paginação e total

- `pagina` começa em 1; `por_pagina` vai de 1 a 100 e o padrão é 18 (o mesmo do site atual). `por_pagina=0` hoje não dá erro: vira 18.
- A ordem é por nome e depois por id, estável entre páginas.
- O total de credenciados (de todas as páginas) vem no cabeçalho `X-Total-Count`.

**Atenção, no navegador:** o servidor ainda não inclui `X-Total-Count` entre os cabeçalhos liberados por CORS (`Access-Control-Expose-Headers`). Em `fetch` entre domínios, `response.headers.get('X-Total-Count')` devolve `null`. Enquanto isso não muda, para o contador "Mostrando 1–18 de N" você tem duas saídas:

1. **Servidor do site** (renderização no servidor, rota de API do próprio site, função de borda): lê o cabeçalho sem restrição de CORS, só precisa enviar o `Origin` à mão.
2. **Sem total:** use "carregar mais" ou "próxima página" e considere que há mais resultados enquanto a página vier cheia (`itens.length === por_pagina`).

O código de exemplo abaixo já faz a segunda e usa o total quando ele existir.

## Exemplos

### curl

```bash
# Filtros
curl "https://api.emerlab.com.br/v1/rede/filtros" \
  -H "Authorization: Bearer emer_rede_EXEMPLO_NAO_E_UMA_CHAVE" \
  -H "Origin: https://www.exemplo.com.br"

# Lista: Porto Alegre, plano Clássico, 18 por página
curl -i "https://api.emerlab.com.br/v1/rede/credenciados?cidade=Porto%20Alegre&plano=classico&pagina=1&por_pagina=18" \
  -H "Authorization: Bearer emer_rede_EXEMPLO_NAO_E_UMA_CHAVE" \
  -H "Origin: https://www.exemplo.com.br"

# Um credenciado
curl "https://api.emerlab.com.br/v1/rede/credenciados/123" \
  -H "X-Api-Key: emer_rede_EXEMPLO_NAO_E_UMA_CHAVE" \
  -H "Origin: https://www.exemplo.com.br"
```

`-i` mostra os cabeçalhos (`X-Total-Count`, `Cache-Control`, `X-RateLimit-*`).

### fetch

```js
const BASE = 'https://api.emerlab.com.br'
const CHAVE = 'emer_rede_EXEMPLO_NAO_E_UMA_CHAVE' // no site real, a chave da rede cadastrada para a sua origem

async function chamar(caminho, params = {}) {
    const url = new URL(BASE + caminho)
    for (const [k, v] of Object.entries(params)) {
        if (v !== '' && v != null) url.searchParams.set(k, v)
    }
    const resposta = await fetch(url, { headers: { Authorization: `Bearer ${CHAVE}` } })
    if (!resposta.ok) {
        const { erro } = await resposta.json().catch(() => ({ erro: { codigo: 'desconhecido', mensagem: '' } }))
        const e = new Error(erro.mensagem || `HTTP ${resposta.status}`)
        e.codigo = erro.codigo
        e.status = resposta.status
        e.retryAfter = Number(resposta.headers.get('Retry-After')) || null // legível no navegador
        throw e
    }
    return {
        dados: await resposta.json(),
        total: Number(resposta.headers.get('X-Total-Count')) || null, // null no navegador, por ora
    }
}

const filtros = (await chamar('/v1/rede/filtros')).dados
const { dados: pagina1 } = await chamar('/v1/rede/credenciados', {
    uf: 'RS',
    cidade: 'Porto Alegre',
    especialidade: 12,
    plano: 'classico',
    pagina: 1,
    por_pagina: 18,
})
```

Não envie `Origin` no `fetch` do navegador: o navegador o define e não permite alterar.

### React

Hook com cascata de filtros, paginação e tratamento de erro:

```jsx
import { useEffect, useState } from 'react'

const BASE = 'https://api.emerlab.com.br'
const CHAVE = import.meta.env.VITE_EMERLAB_CHAVE_REDE // chave da rede (pública), não a de pagamentos
const POR_PAGINA = 18

async function chamar(caminho, params = {}, signal) {
    const url = new URL(BASE + caminho)
    Object.entries(params).forEach(([k, v]) => v !== '' && v != null && url.searchParams.set(k, v))
    const r = await fetch(url, { headers: { Authorization: `Bearer ${CHAVE}` }, signal })
    if (!r.ok) throw new Error((await r.json().catch(() => null))?.erro?.mensagem || `HTTP ${r.status}`)
    return { dados: await r.json(), total: Number(r.headers.get('X-Total-Count')) || null }
}

export function RedeCredenciada() {
    const [filtros, setFiltros] = useState(null)
    const [form, setForm] = useState({ uf: '', cidade: '', especialidade: '', plano: '' })
    const [pagina, setPagina] = useState(1)
    const [resultado, setResultado] = useState({ itens: [], total: null, carregando: true, erro: null })

    useEffect(() => {
        chamar('/v1/rede/filtros').then((r) => setFiltros(r.dados)).catch(() => setFiltros({ ufs: [], cidades: {}, especialidades: [], planos: [] }))
    }, [])

    useEffect(() => {
        const ctrl = new AbortController()
        setResultado((r) => ({ ...r, carregando: true, erro: null }))
        chamar('/v1/rede/credenciados', { ...form, pagina, por_pagina: POR_PAGINA }, ctrl.signal)
            .then(({ dados, total }) => setResultado({ itens: dados, total, carregando: false, erro: null }))
            .catch((e) => e.name !== 'AbortError' && setResultado({ itens: [], total: null, carregando: false, erro: e.message }))
        return () => ctrl.abort()
    }, [form, pagina])

    const mudar = (campo) => (e) => {
        const valor = e.target.value
        setPagina(1) // qualquer filtro novo volta para a primeira página
        setForm((f) => ({ ...f, [campo]: valor, ...(campo === 'uf' ? { cidade: '' } : {}) }))
    }

    if (!filtros) return <p>Carregando…</p>
    const temMais = resultado.total ? pagina * POR_PAGINA < resultado.total : resultado.itens.length === POR_PAGINA

    return (
        <section>
            <select value={form.uf} onChange={mudar('uf')}>
                <option value="">Todos os estados</option>
                {filtros.ufs.map((uf) => <option key={uf}>{uf}</option>)}
            </select>
            <select value={form.cidade} onChange={mudar('cidade')} disabled={!form.uf}>
                <option value="">Todas as cidades</option>
                {(filtros.cidades[form.uf] || []).map((c) => <option key={c}>{c}</option>)}
            </select>
            <select value={form.especialidade} onChange={mudar('especialidade')}>
                <option value="">Todas as especialidades</option>
                {filtros.especialidades.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
            <select value={form.plano} onChange={mudar('plano')}>
                <option value="">Qualquer plano</option>
                {filtros.planos.map((p) => <option key={p.id} value={p.chave}>{p.nome}</option>)}
            </select>

            {resultado.erro && <p role="alert">{resultado.erro}</p>}
            {resultado.total && <p>{resultado.total} credenciados encontrados</p>}
            {resultado.itens.map((c) => (
                <article key={c.id}>
                    {c.especialidade_principal && <span>{c.especialidade_principal}</span>}
                    {c.especialidades_secundarias.map((s) => <span key={s}>{s}</span>)}
                    <h3>{c.nome}</h3>
                    <p>{c.cidades_atende.length > 1 ? 'Cidades: ' : 'Cidade: '}{[c.cidade_principal, ...c.cidades_atende].filter(Boolean).map((x) => x.nome).filter((n, i, a) => a.indexOf(n) === i).join(', ')}</p>
                    {c.endereco && <p>{c.endereco.texto}</p>}
                    {c.contatos.telefone && <p>{c.contatos.telefone}</p>}
                    {c.contatos.whatsapp_url && <a href={c.contatos.whatsapp_url}>Entre em contato</a>}
                </article>
            ))}
            <button disabled={pagina === 1} onClick={() => setPagina(pagina - 1)}>Anterior</button>
            <button disabled={!temMais} onClick={() => setPagina(pagina + 1)}>Próxima</button>
        </section>
    )
}
```

## Cache

As respostas da rede trazem `Cache-Control: public, s-maxage=300, stale-while-revalidate=3600`:

- A borda (CDN) guarda cada resposta por **5 minutos**; depois disso pode servir a versão antiga por até 1 hora enquanto busca uma nova em segundo plano. Uma alteração no cadastro pode demorar alguns minutos para aparecer, e o servidor também guarda os dados em memória por 5 minutos.
- Isso protege o EmerLAB (e o seu limite por minuto): chamadas repetidas com os mesmos parâmetros quase nunca chegam ao servidor.
- Recomendações para o site:
  - Mantenha os **mesmos parâmetros na mesma ordem** para aproveitar o cache da borda (a URL é a chave do cache).
  - Chame `/v1/rede/filtros` **uma vez por carregamento** de página (ou guarde em `sessionStorage`); ele muda raramente.
  - Para páginas indexáveis (SEO), prefira gerar no servidor do site (SSG/SSR com revalidação de poucos minutos), em vez de chamar a API do navegador de cada visitante.
  - Faça *debounce* em campo de busca (`q`), por exemplo 300 ms, e cancele chamadas antigas (`AbortController`).
  - Em 429, espere `Retry-After` segundos antes de tentar de novo.
- Uma chave revogada pode ainda receber, **do cache**, dados públicos por até 5 minutos; veja o [README](README.md#quanto-tempo-leva-para-revogar-ou-editar-uma-chave).

## Erros comuns

| Sintoma                                             | Causa provável                                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `403 origem_nao_permitida`                          | O endereço do site (esquema + host + porta) não está nas origens da chave, ou a chamada não tem `Origin` (curl/servidor) |
| Erro de CORS no console, sem corpo                  | A origem não está cadastrada em nenhuma chave ativa (nesse caso o servidor não envia `Access-Control-Allow-Origin`) |
| `401 chave_invalida`                                | Chave errada, copiada com espaço, revogada ou expirada                                             |
| `400 plano_invalido`                                | `plano` fora de `basico`, `classico`, `avancado`, `ultra` (ou id deles); "Apenas Loja" não vale     |
| `404 credenciado_nao_encontrado`                    | `id` inexistente ou o credenciado deixou de estar credenciado                                       |
| `429 limite_excedido`                               | Mais de 120 chamadas por minuto (padrão); veja `Retry-After`                                        |
| Lista vazia com `200`                               | Nenhum credenciado atende à combinação de filtros, ou a página pedida está além do fim              |

A lista completa de códigos está no [README](README.md#erros).
