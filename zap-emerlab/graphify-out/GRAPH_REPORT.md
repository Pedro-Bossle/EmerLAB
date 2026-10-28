# Graph Report - zap-emerlab  (2026-10-28)

## Corpus Check
- 61 files · ~60,171 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 3 file(s) not represented in the graph (top: .example 1, (none) 1, .css 1)

## Summary
- 494 nodes · 1550 edges · 15 communities (13 shown, 2 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e8a09254`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- verificarNaWati
- package.json
- Admin.jsx
- wati.js
- react
- router.js
- exigirConversa
- Painel.jsx
- db
- quemRealiza.js
- ibge.js
- zap.emerlab
- vercel.json
- handle

## God Nodes (most connected - your core abstractions)
1. `handle()` - 52 edges
2. `Painel()` - 39 edges
3. `db()` - 38 edges
4. `Chat()` - 34 edges
5. `Icone()` - 34 edges
6. `getEnv()` - 33 edges
7. `ok()` - 31 edges
8. `react` - 30 edges
9. `HttpError` - 30 edges
10. `api()` - 28 edges

## Surprising Connections (you probably didn't know these)
- `handler()` --calls--> `handle()`  [EXTRACTED]
  api/zap.js → server/router.js
- `carregarBase()` --calls--> `normCodigo()`  [EXTRACTED]
  server/quemRealiza.js → src/regras.js
- `servicosNaCidade()` --calls--> `normCodigo()`  [EXTRACTED]
  server/quemRealiza.js → src/regras.js
- `lerIdConversa()` --calls--> `normalizarWaId()`  [EXTRACTED]
  server/router.js → src/util.js
- `comAlvoWati()` --calls--> `normalizarWaId()`  [EXTRACTED]
  server/router.js → src/util.js

## Import Cycles
- None detected.

## Communities (15 total, 2 thin omitted)

### Community 0 - "verificarNaWati"
Cohesion: 0.15
Nodes (24): anexarRespostasCitadas(), anuncioDe(), aplicarStatusDoHistorico(), atendenteDoHistorico(), departamentoDaWati(), emDaMensagemWati(), escolherParaVerificar(), extensao() (+16 more)

### Community 1 - "package.json"
Cohesion: 0.06
Nodes (34): dependencies, lucide-react@^1.61.0, react@^19.2.4, react-dom@^19.2.4, simple-icons@^16.36.0, @supabase/supabase-js@^2.105.1, devDependencies, concurrently@^9.2.1 (+26 more)

### Community 2 - "Admin.jsx"
Cohesion: 0.07
Nodes (58): arquivoParaBase64(), Admin(), CampoRegras(), comAtalhosUnicos(), Departamentos(), DEPTO_VAZIO, ImportarRespostas(), ImportarWati() (+50 more)

### Community 3 - "wati.js"
Cohesion: 0.09
Nodes (51): BRAND, emailConfigurado(), envelopeHtml(), enviarEmail(), escapeHtml(), host(), montarEmailConvite(), primeiroNome() (+43 more)

### Community 4 - "react"
Cohesion: 0.09
Nodes (33): react, aoConexao(), aoExpirar(), api(), ApiError, emLimiteWati(), registrarAoExpirar(), App() (+25 more)

### Community 5 - "router.js"
Cohesion: 0.10
Nodes (34): aguardaHumano(), alvoWati(), alvoWatiOk, apelidosDe(), ATRIBUTOS_BUSCA, ATRIBUTOS_FICHA, buscarContatosWhatsapp(), CANAL_PREFIXO (+26 more)

### Community 6 - "exigirConversa"
Cohesion: 0.29
Nodes (20): atribuirHandler(), atributoDaFicha(), canalDe(), chaveAtributo(), comAlvoWati(), contextoHandler(), departamentoHandler(), enviarArquivoHandler() (+12 more)

### Community 7 - "Painel.jsx"
Cohesion: 0.06
Nodes (87): itensDeAtendimento(), transferir(), registrarAoConexao(), urlMidia(), ATALHOS, comMod(), emCampo(), haSobreposicao() (+79 more)

### Community 8 - "db"
Cohesion: 0.12
Nodes (35): assinar(), compararSeguro(), conferirSenha(), criarToken(), hashSenha(), impressao(), lerToken(), segredoAleatorio() (+27 more)

### Community 9 - "quemRealiza.js"
Cohesion: 0.30
Nodes (13): carregarBase(), catalogoProcedimentos(), cidadeCompativel(), CLINICAS, credenciadosNaCidade(), enderecoNaCidade(), ESPECIALIDADES_ESTABELECIMENTO, linhaCredenciado() (+5 more)

### Community 12 - "zap.emerlab"
Cohesion: 0.22
Nodes (8): Como rodar localmente, Deploy (Vercel), Estrutura, Instagram e Messenger, O que tem, Sobre o login "da WATI", Webhook (recomendado), zap.emerlab

### Community 13 - "vercel.json"
Cohesion: 0.22
Nodes (8): maxDuration, buildCommand, framework, functions, api/zap.js, headers, outputDirectory, rewrites

### Community 15 - "handle"
Cohesion: 0.21
Nodes (13): config, handler(), municipiosPorUf(), departamentosDaResposta(), exigirAdmin(), gravarResposta(), handle(), importarRespostas() (+5 more)

## Knowledge Gaps
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `react` to `package.json`, `Admin.jsx`, `Painel.jsx`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Should `verificarNaWati` be split into smaller, more focused modules?**
  _Cohesion score 0.14855072463768115 - nodes in this community are weakly interconnected._
- **Why does `normalizarWaId()` connect `router.js` to `verificarNaWati`, `react`, `exigirConversa`, `Painel.jsx`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.06153846153846154 - nodes in this community are weakly interconnected._
- **Why does `getEnv()` connect `wati.js` to `db`, `verificarNaWati`, `router.js`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Should `Admin.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.07242063492063493 - nodes in this community are weakly interconnected._
- **Should `wati.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09497882637628555 - nodes in this community are weakly interconnected._