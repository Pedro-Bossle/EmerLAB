# Graph Report - zap-emerlab  (2026-10-28)

## Corpus Check
- 61 files · ~63,028 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 3 file(s) not represented in the graph (top: .example 1, (none) 1, .css 1)

## Summary
- 509 nodes · 1609 edges · 16 communities (15 shown, 1 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0535c4cf`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- webhook
- package.json
- Chat.jsx
- wati.js
- react
- router.js
- exigirConversa
- Painel.jsx
- aceitarConvite
- Mensagem.jsx
- Perfil.jsx
- quemRealiza.js
- zap.emerlab
- vercel.json
- db

## God Nodes (most connected - your core abstractions)
1. `handle()` - 52 edges
2. `db()` - 40 edges
3. `Painel()` - 40 edges
4. `Icone()` - 36 edges
5. `Chat()` - 34 edges
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
- `comConversaWati()` --calls--> `normalizarWaId()`  [EXTRACTED]
  server/router.js → src/util.js

## Import Cycles
- None detected.

## Communities (16 total, 1 thin omitted)

### Community 0 - "webhook"
Cohesion: 0.24
Nodes (13): alvoWati(), enviarUmaVez(), lembrarConversaWati(), listarMensagensWati(), mesmaTag(), metaConversa(), respostaHumanaWati(), sincronizarTags() (+5 more)

### Community 1 - "package.json"
Cohesion: 0.06
Nodes (34): dependencies, lucide-react@^1.61.0, react@^19.2.4, react-dom@^19.2.4, simple-icons@^16.36.0, @supabase/supabase-js@^2.105.1, devDependencies, concurrently@^9.2.1 (+26 more)

### Community 2 - "Chat.jsx"
Cohesion: 0.08
Nodes (58): arquivoParaBase64(), Admin(), CampoRegras(), comAtalhosUnicos(), Departamentos(), DEPTO_VAZIO, ImportarRespostas(), ImportarWati() (+50 more)

### Community 3 - "wati.js"
Cohesion: 0.09
Nodes (54): BRAND, emailConfigurado(), envelopeHtml(), enviarEmail(), escapeHtml(), host(), montarEmailConvite(), primeiroNome() (+46 more)

### Community 4 - "react"
Cohesion: 0.09
Nodes (30): aoConexao(), aoExpirar(), api(), ApiError, registrarAoExpirar(), App(), MOD, Alternar() (+22 more)

### Community 5 - "router.js"
Cohesion: 0.08
Nodes (52): municipiosPorUf(), aguardaHumano(), alvoWatiOk, anexarRespostasCitadas(), anuncioDe(), apelidosDe(), aplicarStatusDoHistorico(), atendenteDoHistorico() (+44 more)

### Community 6 - "exigirConversa"
Cohesion: 0.18
Nodes (30): config, handler(), atribuirHandler(), atributoDaFicha(), canalDe(), chaveAtributo(), comAlvoWati(), comConversaWati() (+22 more)

### Community 7 - "Painel.jsx"
Cohesion: 0.08
Nodes (60): react, itensDeAtendimento(), transferir(), emLimiteWati(), registrarAoConexao(), ATALHOS, comMod(), emCampo() (+52 more)

### Community 8 - "aceitarConvite"
Cohesion: 0.21
Nodes (16): assinar(), compararSeguro(), conferirSenha(), criarToken(), hashSenha(), impressao(), lerToken(), aceitarConvite() (+8 more)

### Community 9 - "Mensagem.jsx"
Cohesion: 0.19
Nodes (18): urlMidia(), Citacao(), Falha(), Mensagem(), Midia(), nomeDoArquivo(), ROTULO_ARQUIVO, ROTULO_CITA (+10 more)

### Community 10 - "Perfil.jsx"
Cohesion: 0.17
Nodes (17): UFS_BRASIL, CAMPOS_WATI, carregarMunicipios(), igual(), municipiosCache, OPCOES_TIPO, Perfil(), tipoCanonico() (+9 more)

### Community 11 - "quemRealiza.js"
Cohesion: 0.30
Nodes (13): carregarBase(), catalogoProcedimentos(), cidadeCompativel(), CLINICAS, credenciadosNaCidade(), enderecoNaCidade(), ESPECIALIDADES_ESTABELECIMENTO, linhaCredenciado() (+5 more)

### Community 12 - "zap.emerlab"
Cohesion: 0.22
Nodes (8): Como rodar localmente, Deploy (Vercel), Estrutura, Instagram e Messenger, O que tem, Sobre o login "da WATI", Webhook (recomendado), zap.emerlab

### Community 13 - "vercel.json"
Cohesion: 0.22
Nodes (8): maxDuration, buildCommand, framework, functions, api/zap.js, headers, outputDirectory, rewrites

### Community 15 - "db"
Cohesion: 0.15
Nodes (24): segredoAleatorio(), buscarUsuarioPorEmail(), buscarUsuarioPorId(), db(), DbError, idsDepartamentos(), ok(), criarUsuario() (+16 more)

## Knowledge Gaps
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `Painel.jsx` to `package.json`, `Chat.jsx`, `react`, `Mensagem.jsx`, `Perfil.jsx`?**
  _High betweenness centrality (0.072) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.06153846153846154 - nodes in this community are weakly interconnected._
- **Why does `normalizarWaId()` connect `webhook` to `router.js`, `exigirConversa`, `Painel.jsx`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Should `Chat.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.07505827505827506 - nodes in this community are weakly interconnected._
- **Why does `getEnv()` connect `wati.js` to `aceitarConvite`, `webhook`, `router.js`, `db`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Should `wati.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09016393442622951 - nodes in this community are weakly interconnected._
- **Should `react` be split into smaller, more focused modules?**
  _Cohesion score 0.09371980676328502 - nodes in this community are weakly interconnected._