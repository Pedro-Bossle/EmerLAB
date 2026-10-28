# Graph Report - zap-emerlab  (2026-10-28)

## Corpus Check
- 71 files · ~73,468 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 3 file(s) not represented in the graph (top: .example 1, (none) 1, .css 1)

## Summary
- 585 nodes · 1834 edges · 18 communities (17 shown, 1 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `34066c07`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- getEnv
- package.json
- Chat.jsx
- wati.js
- api
- router.js
- handle
- Painel.jsx
- aceitarConvite
- Mensagem.jsx
- Perfil.jsx
- quemRealiza.js
- zap.emerlab
- vercel.json
- Icone
- db
- email.js

## God Nodes (most connected - your core abstractions)
1. `handle()` - 52 edges
2. `Icone()` - 51 edges
3. `db()` - 42 edges
4. `Painel()` - 42 edges
5. `react` - 34 edges
6. `getEnv()` - 34 edges
7. `Chat()` - 34 edges
8. `ok()` - 32 edges
9. `HttpError` - 31 edges
10. `api()` - 28 edges

## Surprising Connections (you probably didn't know these)
- `handler()` --calls--> `handle()`  [EXTRACTED]
  api/zap.js → server/router.js
- `carregarBase()` --calls--> `normCodigo()`  [EXTRACTED]
  server/quemRealiza.js → src/regras.js
- `servicosNaCidade()` --calls--> `normCodigo()`  [EXTRACTED]
  server/quemRealiza.js → src/regras.js
- `normalizarContato()` --calls--> `normalizarWaId()`  [EXTRACTED]
  server/router.js → src/util.js
- `fundirMeta()` --calls--> `normalizarWaId()`  [EXTRACTED]
  server/router.js → src/util.js

## Import Cycles
- None detected.

## Communities (18 total, 1 thin omitted)

### Community 0 - "getEnv"
Cohesion: 0.31
Nodes (7): emailConfigurado(), enviarEmail(), envFaltando(), getEnv(), normalizeResendApiKey(), enviarConvite(), segredoConvite()

### Community 1 - "package.json"
Cohesion: 0.06
Nodes (34): dependencies, lucide-react@^1.61.0, react@^19.2.4, react-dom@^19.2.4, simple-icons@^16.36.0, @supabase/supabase-js@^2.105.1, devDependencies, concurrently@^9.2.1 (+26 more)

### Community 2 - "Chat.jsx"
Cohesion: 0.07
Nodes (64): aoConexao(), aoExpirar(), api(), ApiError, arquivoParaBase64(), registrarAoExpirar(), App(), Admin() (+56 more)

### Community 3 - "wati.js"
Cohesion: 0.14
Nodes (39): adicionarTag(), atribuirAtendente(), atribuirAtendenteV3(), atribuirEquipe(), atualizarAtributos(), atualizarStatus(), baixarMidia(), cache (+31 more)

### Community 4 - "api"
Cohesion: 0.11
Nodes (17): Alternar(), Configuracoes(), Segmentado(), Instrucoes(), mod, SECOES, criar(), esconder() (+9 more)

### Community 5 - "router.js"
Cohesion: 0.06
Nodes (68): aguardaHumano(), alvoWatiOk, anexarRespostasCitadas(), anuncioDe(), apelidosDe(), aplicarStatusDoHistorico(), atendenteDoHistorico(), ATRIBUTOS_BUSCA (+60 more)

### Community 6 - "handle"
Cohesion: 0.19
Nodes (30): alvoWati(), atribuirHandler(), atributoDaFicha(), canalDe(), chaveAtributo(), comAlvoWati(), comConversaWati(), contextoHandler() (+22 more)

### Community 7 - "Painel.jsx"
Cohesion: 0.08
Nodes (58): itensDeAtendimento(), transferir(), emLimiteWati(), registrarAoConexao(), ATALHOS, comMod(), emCampo(), haSobreposicao() (+50 more)

### Community 8 - "aceitarConvite"
Cohesion: 0.21
Nodes (16): assinar(), compararSeguro(), conferirSenha(), criarToken(), hashSenha(), impressao(), lerToken(), aceitarConvite() (+8 more)

### Community 9 - "Mensagem.jsx"
Cohesion: 0.22
Nodes (16): urlMidia(), Citacao(), Falha(), Mensagem(), Midia(), nomeDoArquivo(), ROTULO_ARQUIVO, ROTULO_CITA (+8 more)

### Community 10 - "Perfil.jsx"
Cohesion: 0.16
Nodes (18): municipiosPorUf(), UFS_BRASIL, CAMPOS_WATI, carregarMunicipios(), igual(), municipiosCache, OPCOES_TIPO, Perfil() (+10 more)

### Community 11 - "quemRealiza.js"
Cohesion: 0.32
Nodes (12): carregarBase(), cidadeCompativel(), CLINICAS, credenciadosNaCidade(), enderecoNaCidade(), ESPECIALIDADES_ESTABELECIMENTO, linhaCredenciado(), norm() (+4 more)

### Community 12 - "zap.emerlab"
Cohesion: 0.22
Nodes (8): Como rodar localmente, Deploy (Vercel), Estrutura, Instagram e Messenger, O que tem, Sobre o login "da WATI", Webhook (recomendado), zap.emerlab

### Community 13 - "vercel.json"
Cohesion: 0.22
Nodes (8): maxDuration, buildCommand, framework, functions, api/zap.js, headers, outputDirectory, rewrites

### Community 14 - "Icone"
Cohesion: 0.06
Nodes (69): react, EditorEmail(), FORMATOS, tamanhoLegivel(), EnviarTemplate(), nomesEm(), ondeAparece(), substituir() (+61 more)

### Community 15 - "db"
Cohesion: 0.17
Nodes (29): config, handler(), segredoAleatorio(), buscarUsuarioPorEmail(), buscarUsuarioPorId(), db(), DbError, idsDepartamentos() (+21 more)

### Community 17 - "email.js"
Cohesion: 0.38
Nodes (8): BRAND, envelopeHtml(), escapeHtml(), host(), montarEmailConvite(), primeiroNome(), LOGO_AZUL, LOGO_BRANCO

## Knowledge Gaps
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `Icone` to `package.json`, `Chat.jsx`, `api`, `Painel.jsx`, `Mensagem.jsx`, `Perfil.jsx`?**
  _High betweenness centrality (0.082) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.06153846153846154 - nodes in this community are weakly interconnected._
- **Why does `normalizarWaId()` connect `handle` to `Painel.jsx`, `router.js`, `Icone`, `db`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Should `Chat.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.06582952815829528 - nodes in this community are weakly interconnected._
- **Why does `Icone()` connect `Icone` to `Mensagem.jsx`, `Chat.jsx`, `Perfil.jsx`, `Painel.jsx`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Should `wati.js` be split into smaller, more focused modules?**
  _Cohesion score 0.14268292682926828 - nodes in this community are weakly interconnected._
- **Should `api` be split into smaller, more focused modules?**
  _Cohesion score 0.1111111111111111 - nodes in this community are weakly interconnected._