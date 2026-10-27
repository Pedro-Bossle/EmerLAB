# Graph Report - zap-emerlab  (2026-10-26)

## Corpus Check
- 54 files · ~34,731 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 3 file(s) not represented in the graph (top: .example 1, (none) 1, .css 1)

## Summary
- 392 nodes · 1174 edges · 14 communities (13 shown, 1 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `999bb5a6`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- regras.js
- package.json
- Admin.jsx
- wati.js
- App.jsx
- router.js
- exigirConversa
- Painel.jsx
- lerCorpo
- ok
- zap.emerlab
- vercel.json
- handle

## God Nodes (most connected - your core abstractions)
1. `handle()` - 48 edges
2. `Painel()` - 34 edges
3. `getEnv()` - 31 edges
4. `HttpError` - 29 edges
5. `Icone()` - 29 edges
6. `ok()` - 28 edges
7. `api()` - 28 edges
8. `react` - 27 edges
9. `db()` - 27 edges
10. `Chat()` - 26 edges

## Surprising Connections (you probably didn't know these)
- `handler()` --calls--> `handle()`  [EXTRACTED]
  api/zap.js → server/router.js
- `enviarTextoHandler()` --calls--> `preencherVariaveis()`  [EXTRACTED]
  server/router.js → src/variaveis.js
- `validarResposta()` --calls--> `lerRegras()`  [EXTRACTED]
  server/router.js → src/regras.js
- `listarConversas()` --indirect_call--> `ok()`  [INFERRED]
  server/router.js → server/db.js
- `listarTagsSugestao()` --indirect_call--> `ok()`  [INFERRED]
  server/router.js → server/db.js

## Import Cycles
- None detected.

## Communities (14 total, 1 thin omitted)

### Community 0 - "regras.js"
Cohesion: 0.35
Nodes (10): avaliarRegras(), CHAVES, lerRegras(), localBate(), NAO, norm(), regraBate(), SIM (+2 more)

### Community 1 - "package.json"
Cohesion: 0.05
Nodes (33): dependencies, lucide-react, react, react-dom, simple-icons, @supabase/supabase-js, devDependencies, concurrently (+25 more)

### Community 2 - "Admin.jsx"
Cohesion: 0.07
Nodes (54): react, aoConexao(), aoExpirar(), api(), ApiError, arquivoParaBase64(), registrarAoConexao(), urlMidia() (+46 more)

### Community 3 - "wati.js"
Cohesion: 0.10
Nodes (47): BRAND, emailConfigurado(), envelopeHtml(), enviarEmail(), escapeHtml(), host(), montarEmailConvite(), primeiroNome() (+39 more)

### Community 4 - "App.jsx"
Cohesion: 0.25
Nodes (12): react-dom, registrarAoExpirar(), App(), CriarSenha(), Login(), aplicarTema(), DESTAQUES, modoEfetivo() (+4 more)

### Community 5 - "router.js"
Cohesion: 0.11
Nodes (25): cache, municipiosPorUf(), UFS_BRASIL, ATRIBUTOS_BUSCA, ATRIBUTOS_FICHA, buscarContatosWhatsapp(), CANAL_PREFIXO, escolherParaVerificar() (+17 more)

### Community 6 - "exigirConversa"
Cohesion: 0.20
Nodes (20): alvoWati(), atributoDaFicha(), canalDe(), chaveAtributo(), chaveRegra(), contextoHandler(), departamentoHandler(), enviarArquivoHandler() (+12 more)

### Community 7 - "Painel.jsx"
Cohesion: 0.07
Nodes (61): itensDeAtendimento(), transferir(), ATALHOS, comMod(), emCampo(), haSobreposicao(), MAC, MOD (+53 more)

### Community 8 - "lerCorpo"
Cohesion: 0.18
Nodes (17): assinar(), compararSeguro(), conferirSenha(), criarToken(), hashSenha(), impressao(), lerToken(), aceitarConvite() (+9 more)

### Community 9 - "ok"
Cohesion: 0.24
Nodes (16): segredoAleatorio(), buscarUsuarioPorEmail(), buscarUsuarioPorId(), db(), DbError, idsDepartamentos(), ok(), atribuirHandler() (+8 more)

### Community 12 - "zap.emerlab"
Cohesion: 0.22
Nodes (8): Como rodar localmente, Deploy (Vercel), Estrutura, Instagram e Messenger, O que tem, Sobre o login "da WATI", Webhook (recomendado), zap.emerlab

### Community 13 - "vercel.json"
Cohesion: 0.22
Nodes (8): maxDuration, buildCommand, framework, functions, api/zap.js, headers, outputDirectory, rewrites

### Community 15 - "handle"
Cohesion: 0.22
Nodes (15): config, handler(), departamentosDaResposta(), exigirAdmin(), gravarResposta(), handle(), HttpError, importarRespostas() (+7 more)

## Knowledge Gaps
- **1 isolated node(s):** `concurrently`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 90 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `Admin.jsx` to `package.json`, `App.jsx`, `Painel.jsx`?**
  _High betweenness centrality (0.101) - this node is a cross-community bridge._
- **What connects `concurrently` to the rest of the system?**
  _1 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.05263157894736842 - nodes in this community are weakly interconnected._
- **Why does `lerRegras()` connect `regras.js` to `Admin.jsx`, `router.js`, `handle`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Should `Admin.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.0711849957374254 - nodes in this community are weakly interconnected._
- **Why does `@supabase/supabase-js` connect `package.json` to `ok`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Should `wati.js` be split into smaller, more focused modules?**
  _Cohesion score 0.1013277428371768 - nodes in this community are weakly interconnected._