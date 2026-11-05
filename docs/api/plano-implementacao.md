# API pública da Rede Credenciada e API de Pagamentos — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar `/api/v1` com a rede credenciada (leitura, para o site novo), pagamentos (servidor a servidor), chaves de API com tela de gestão e a documentação para a equipe do site.

**Architecture:** Um roteador único `api/_lib/apiV1/roteador.js`, multiplexado em `api/email.js` por `?_fn=api-v1` (padrão do `repasse-mensal`) e exposto por reescritas `/api/v1/*`. Regras puras e testáveis ficam em `src/lib/apiV1/` (o vitest só roda `src/**`); acesso ao banco e HTTP ficam em `api/_lib/apiV1/`. Autenticação por chave (hash SHA-256) com escopos, origem e limite; a tela de chaves usa a API interna com JWT.

**Tech Stack:** Node (funções Vercel), Supabase (service role só no servidor), React 18 + Vite (tela), Vitest.

**Spec:** `docs/api/especificacao-design.md`

## Global Constraints

- Prefixo `/api/v1`; JSON UTF-8; datas ISO 8601; erros `{ "erro": { "codigo", "mensagem" } }`.
- Chaves: `emer_rede_<32 caracteres>` e `emer_pag_<32 caracteres>`; só o hash SHA-256 é guardado; a chave inteira aparece uma única vez.
- Escopos: `rede:ler`, `pagamentos:ler`, `pagamentos:escrever`. Chave `pagamentos:*` recusa requisição com cabeçalho `Origin` (403). Chave `rede:ler` exige `Origin` dentro de `origens_permitidas`.
- Limites padrão: 120 req/min (rede) e 60 req/min (pagamentos). `por_pagina` padrão 18, máximo 100.
- Comprovante: PDF, PNG ou JPG, até 3 MB; bucket `repasse-documentos`, caminho `AAAA-MM/<relatorio>/comprovante/`.
- Endereço só para especialidade do tipo `Local`. Nunca sair CPF/CNPJ, PIX, e-mail, situação, observações internas.
- Credenciado = prestador `ativo` com situação cuja descrição contém `CREDENCIAD` (`situacaoDescricaoEhCredenciado`).
- Plano "Apenas Loja" não é aceito no filtro `plano`.
- A única mudança em `pagamentos_registros` é a flag `pago`. `notificar_prestador` é falso por padrão.
- Texto de interface e documentação em português; chaves de exemplo sempre fictícias.
- Migração e deploy fora do horário de pico (Supabase Micro). Não commitar nem dar push sem o Pedro pedir; o push vai por cherry-pick para a `main` (a branch de trabalho pode ter commits alheios).

## Review Focus

1. Município com variações ("Porto Alegre e Região", acento, caixa) deve casar com "Porto Alegre".
2. Veterinário vinculado a clínica sem cidade própria deve herdar a da clínica, sem duplicar o card.
3. Credenciado sem procedimentos, sem descontos ou sem telefone devolve listas vazias e `null`, nunca erro.
4. `pagina` além do fim devolve lista vazia com `X-Total-Count` correto; `por_pagina` acima de 100 vira 100.
5. Marcar pago duas vezes, ou enviar o mesmo comprovante duas vezes, não duplica evento nem linha.
6. Chave revogada, expirada ou de outro escopo é recusada em até 30 s; erro nunca revela se a chave existe.
7. Comprovante com extensão falsa (arquivo que não é PDF/imagem) ou acima de 3 MB é recusado.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20261105120000_api_chaves.sql` | tabela `api_chaves` + RLS |
| `src/lib/apiV1/chaves.js` | gerar/hash/validar chave, escopo, origem, expiração (puro) |
| `src/lib/apiV1/redeRegras.js` | cidades do credenciado, filtros, corte por plano, objeto público (puro) |
| `src/lib/apiV1/pagamentosRegras.js` | validação de comprovante, idempotência (puro) |
| `api/_lib/apiV1/roteador.js` | roteamento, autenticação, CORS, limites, erros |
| `api/_lib/apiV1/redeDados.js` | leitura em lote do Supabase + cache de 5 min |
| `api/_lib/apiV1/redeRotas.js` | `credenciados`, `credenciados/{id}`, `filtros` |
| `api/_lib/apiV1/pagamentosRotas.js` | rotas de pagamentos |
| `api/_lib/apiV1/chavesAdminRotas.js` | CRUD de chaves (JWT, `access.manage`) |
| `src/pages/Configuracoes/ChavesApi/ConfigChavesApi.jsx` | tela de gestão |
| `docs/api/*.md`, `docs/api/openapi.json`, `public/api-docs/index.html` | documentação |
| testes: `src/lib/apiV1/*.test.js` | vitest |

---

### Task 1: Tabela de chaves e biblioteca de chaves

**Files:**
- Create: `supabase/migrations/20261105120000_api_chaves.sql`, `src/lib/apiV1/chaves.js`
- Test: `src/lib/apiV1/chaves.test.js`

**Interfaces:**
- Produces: `gerarChave(tipo: 'rede'|'pag'): { chave: string, prefixo: string, hash: string }`; `hashChave(chave: string): string`; `autorizarChave(linha: LinhaChave|null, { escopo, origem, agora }): { ok: true } | { ok: false, status: 401|403, codigo: string }`; `ESCOPOS: readonly string[]`.
- `LinhaChave` = `{ id, nome, prefixo, escopos: string[], origens_permitidas: string[], limite_por_minuto: number, ips_permitidos: string[], expira_em: string|null, revogada_em: string|null }`.

- [ ] **Step 1: Escrever os testes que falham** em `chaves.test.js`:
  - `gerarChave('rede')` devolve `chave` começando com `emer_rede_` (42 caracteres no total), `prefixo` = 8 primeiros caracteres da chave e `hash` = 64 hex; duas chaves geradas são diferentes.
  - `hashChave` é determinístico e igual ao `hash` devolvido por `gerarChave`.
  - `autorizarChave(null, …)` → `{ ok:false, status:401, codigo:'chave_invalida' }`.
  - Revogada ou com `expira_em` no passado → 401 `chave_invalida`.
  - Escopo ausente → 403 `escopo_insuficiente`.
  - `rede:ler` com `origem` fora da lista, ou sem `origem` → 403 `origem_nao_permitida`.
  - `pagamentos:escrever` com qualquer `origem` presente → 403 `origem_nao_permitida`; sem `origem` → ok.
  - `ips_permitidos` preenchido e IP fora da lista → 403 `ip_nao_permitido`.
- [ ] **Step 2: Rodar `npx vitest run src/lib/apiV1/chaves.test.js`** e ver falhar (módulo não existe).
- [ ] **Step 3: Implementar `chaves.js`** com `node:crypto` (`randomBytes` base62 para os 32 caracteres, SHA-256 hex). `autorizarChave` recebe também `ip` em `{ escopo, origem, ip, agora }`.
- [ ] **Step 4: Escrever a migração** `api_chaves` conforme a seção 5 da especificação (`id uuid pk default gen_random_uuid()`, `hash text unique not null`, demais colunas, `enable row level security`, nenhuma política, `revoke all … from anon, authenticated`). Aplicar com `mcp__claude_ai_Supabase__apply_migration` só fora do horário de pico.
- [ ] **Step 5: Rodar os testes e ver passar.**
- [ ] **Step 6: Commit** `feat(api): tabela e biblioteca de chaves de API`.

---

### Task 2: Roteador `/api/v1` (autenticação, CORS, limites, erros)

**Files:**
- Create: `api/_lib/apiV1/roteador.js`
- Modify: `api/email.js` (despacho `_fn === 'api-v1'`), `vercel.json` (reescrita `"/api/v1/:path*" → "/api/email?_fn=api-v1&_path=:path*"`)
- Test: `src/lib/apiV1/roteador.test.js` (banco e `serverAuth` simulados no padrão de `apiRepasseMensal.test.js`)

**Interfaces:**
- Consumes: `autorizarChave`, `hashChave` (Task 1); `createSupabaseAdminClient`, `getClientIp`, `readJsonBodyLimited`, `responderSePayloadGrande` de `src/lib/api/serverAuth.js`; `consumirRateLimit` de `src/lib/api/rateLimit.js`.
- Produces: `export default async function apiV1Handler(req, res)`; `export function registrarRota(metodo: string, padrao: string, escopo: string|null, fn: (ctx) => Promise<{ status?: number, corpo: any, headers?: object }>)` e `ctx = { admin, chave, params, query, body, req }`; `class ErroApi(status, codigo, mensagem)`.

- [ ] **Step 1: Testes que falham:**
  - Sem cabeçalho de chave → 401 `{ erro:{ codigo:'chave_invalida' } }`; chave desconhecida → mesmo 401.
  - Rota inexistente com chave válida → 404 `rota_nao_encontrada`.
  - `OPTIONS` com `Origin` permitido → 204 com `Access-Control-Allow-Origin` igual à origem; origem não permitida → sem esse cabeçalho.
  - Estouro do limite por minuto → 429 com `Retry-After` e `X-RateLimit-Remaining: 0`.
  - Chave válida atualiza `ultimo_uso_em` no máximo 1 vez por minuto por chave.
  - Cache de 30 s: chave revogada no banco é recusada depois de expirar o cache (relógio simulado).
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar o roteador:** extrai a chave de `Authorization: Bearer` ou `X-Api-Key`; busca por `hash` com cache em memória de 30 s; chama `autorizarChave`; aplica `consumirRateLimit('apiv1:<id>')` com o `limite_por_minuto` da chave; roteia por `_path` (padrões com `{id}`); `ErroApi` vira o JSON de erro; qualquer outro erro vira 500 `erro_interno` sem detalhe.
- [ ] **Step 4: Ligar em `api/email.js` e `vercel.json`;** acrescentar `/api/v1/` ao `connect-src`/CSP apenas se necessário (a CSP atual é do app, não da API).
- [ ] **Step 5: Rodar os testes e ver passar.**
- [ ] **Step 6: Commit** `feat(api): roteador /api/v1 com autenticação por chave`.

---

### Task 3: Regras puras da rede credenciada

**Files:**
- Create: `src/lib/apiV1/redeRegras.js`
- Test: `src/lib/apiV1/redeRegras.test.js`

**Interfaces:**
- Produces:
  - `type BaseRede = { prestadores, situacoes, estabelecimentos, procedimentos, prestadorProcedimentos, prestadorCidades, cidadesCredenciamento, especialidades, beneficios, prestadorBeneficios, beneficiosObs, planos, planosCidade }` (linhas cruas do Supabase, formas já usadas em `quemRealiza.js`).
  - `montarCredenciados(base: BaseRede): Credenciado[]` — só credenciados ativos; vets vinculados herdam cidades/UF da clínica.
  - `filtrarCredenciados(lista: Credenciado[], f: { uf?, cidade?, especialidade?, tipo?, plano?, q? }): Credenciado[]`.
  - `paraPublico(c: Credenciado, opcoes?: { planoId?: number }): CredenciadoPublico` — objeto da seção 6.3 da especificação.
  - `normalizarMunicipio(texto: string): string` ("porto alegre e regiao" → "porto alegre").
- Consumes: `situacaoDescricaoEhCredenciado` (`src/lib/prestadorCadastroHelpers.js`); `mapearPlanos`, `obterPlanoIdsPermitidosDesdeBase`, `procedimentoPertenceAoPlanoSelecionado` (`src/lib/planosHierarquia.js`).

- [ ] **Step 1: Investigar a regra de procedimentos por plano.** Ler `src/lib/impressaoPlanos/carregarLinhasImpressaoPlanos.js` e reutilizar a mesma regra para decidir quais procedimentos pertencem a um plano; registrar a decisão em comentário no topo de `redeRegras.js`. Se a regra não for reaproveitável, parar e perguntar ao Pedro.
- [ ] **Step 2: Testes que falham** (dados mínimos montados no próprio teste):
  - Prestador com situação "Credenciado" e ativo entra; inativo ou com situação "Cancelado" não entra.
  - `cidade: 'porto alegre'` casa prestador com `endereco_cidade: 'Porto Alegre e Região'`; casa também prestador cuja lista `prestador_cidades` inclui Porto Alegre; não casa quando só outra UF tem o nome.
  - Vet vinculado a clínica sem endereço próprio herda cidade/UF da clínica e aparece uma única vez.
  - `paraPublico` de tipo `Local` traz `endereco` com `texto` não vazio; de tipo `Especialidade` traz `endereco: null`.
  - `paraPublico` nunca contém as chaves `cpf_cnpj`, `chave_pix`, `email`, `situacao_id`, `obs` (varrer o JSON serializado).
  - Credenciado sem procedimentos/descontos/telefone → `procedimentos: []`, `descontos: { itens: [], observacoes: null }`, `contatos.telefone: null`.
  - Descontos só com `incluir = true`, com `percentual` e `percentual_max` numéricos.
  - `plano: 'basico'` mantém só credenciados de cidades do plano e só procedimentos permitidos pela hierarquia; `plano: 'apenas_loja'` lança `ErroValidacao('plano_invalido')`.
  - `especialidade` casa a primária e as secundárias.
- [ ] **Step 3: Rodar e ver falhar.**
- [ ] **Step 4: Implementar** reaproveitando a normalização de município do `zap-emerlab/server/quemRealiza.js` (copiar a lógica pura e citar a origem; o Zap não entra no bundle do app).
- [ ] **Step 5: Rodar e ver passar.**
- [ ] **Step 6: Commit** `feat(api): regras da rede credenciada para a API pública`.

---

### Task 4: Leitura em lote, cache e rotas da rede

**Files:**
- Create: `api/_lib/apiV1/redeDados.js`, `api/_lib/apiV1/redeRotas.js`
- Test: `src/lib/apiV1/redeRotas.test.js`

**Interfaces:**
- Consumes: `registrarRota`, `ErroApi` (Task 2); `montarCredenciados`, `filtrarCredenciados`, `paraPublico` (Task 3).
- Produces: `carregarBaseRede(admin): Promise<BaseRede>` (paginação de 1000 em 1000, cache de 5 min por instância, junta chamadas simultâneas); rotas `GET /rede/credenciados`, `GET /rede/credenciados/{id}`, `GET /rede/filtros`.

- [ ] **Step 1: Testes que falham** (via `apiV1Handler` com banco simulado):
  - `GET /rede/credenciados?uf=RS&cidade=Caxias do Sul` → 200, `X-Total-Count`, `Cache-Control: public, s-maxage=300, stale-while-revalidate=3600`, itens no formato público.
  - `por_pagina=500` vira 100; `pagina` acima do fim → `[]` com `X-Total-Count` correto.
  - Chave sem `rede:ler` → 403.
  - `GET /rede/credenciados/{id}` inexistente ou não credenciado → 404 `credenciado_nao_encontrado`.
  - `GET /rede/filtros` devolve `ufs`, `cidades` (por UF, só cidades com credenciados), `especialidades` e `planos` (sem "Apenas Loja").
  - Duas chamadas seguidas leem o banco uma vez só (contador de leituras).
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** `carregarBaseRede` com `memo` equivalente ao de `zap-emerlab/server/cache.js` (copiar o padrão: chave, validade, junção de chamadas em voo, sem cache de erro) e as rotas.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** `feat(api): rotas da rede credenciada`.

---

### Task 5: Rotas de pagamentos

**Files:**
- Create: `src/lib/apiV1/pagamentosRegras.js`, `api/_lib/apiV1/pagamentosRotas.js`
- Test: `src/lib/apiV1/pagamentosRotas.test.js` (reaproveitar o banco simulado e os mocks de `resendMail`/`repasseEmails` de `apiRepasseMensal.test.js`)

**Interfaces:**
- Produces: `validarComprovante({ nome, tipoMime, bytes }): { ext: 'pdf'|'png'|'jpg' }` (lança `ErroValidacao('arquivo_invalido'|'arquivo_grande')`); `hashArquivo(buf: Buffer): string` (sha256 hex); rotas:
  - `GET /pagamentos/registros` (`mes`, `ano`, `pago`, `prestador_id`), `GET /pagamentos/registros/{id}`
  - `POST /pagamentos/registros/{id}/pago`, `DELETE /pagamentos/registros/{id}/pago`
  - `POST /pagamentos/registros/{id}/comprovantes`
- Consumes: `registrarRota`, `ErroApi`; `evento()` e `enviarComprovante` do `repasseMensalHandler.js` — **extrair para módulo compartilhado** `api/_lib/repasseComprovante.js` com `gravarComprovante(admin, { registro, relatorio|null, path, data_pagamento, valor, forma, autor, notificar })` usado pelo fluxo interno e pela API, sem mudar o comportamento atual (os testes existentes de `apiRepasseMensal.test.js` devem continuar passando).

- [ ] **Step 1: Testes que falham:**
  - `pago` marca `pagamentos_registros.pago = true`, grava evento com autor `api:<nome da chave>` e não altera nenhuma outra coluna do registro (comparar o objeto antes/depois).
  - `pago` repetido → 200 `{ ja_estava_pago: true }` e nenhum evento novo.
  - `POST …/comprovantes` multipart e JSON `arquivo_base64`: grava em `repasse_comprovantes` e no storage, no caminho `AAAA-MM/<relatorio>/comprovante/`; marca pago; **não** envia e-mail quando `notificar_prestador` é falso; envia quando verdadeiro.
  - Mesmo arquivo (hash) no mesmo registro → devolve o comprovante existente, sem nova linha.
  - Arquivo `.exe` renomeado para `.pdf` (bytes não começam com `%PDF`) → 422 `arquivo_invalido`; arquivo de 3 MB + 1 byte → 413 `arquivo_grande`.
  - Registro sem relatório de repasse: `pago` funciona; comprovante grava com `relatorio_id` nulo.
  - `DELETE …/pago` sem `motivo` (menos de 5 caracteres) → 400; com motivo remove o comprovante e desmarca `pago`.
  - Chave só com `pagamentos:ler` em rota de escrita → 403.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Refatorar o fluxo interno** para usar `gravarComprovante`; rodar `npx vitest run src/lib/repasse/apiRepasseMensal.test.js` e ver tudo passar antes de seguir.
- [ ] **Step 4: Implementar as rotas;** `multipart` lido com limite de 3 MB (usar o parser que o projeto já tiver; se não houver, aceitar só JSON base64 e documentar).
- [ ] **Step 5: Rodar todos os testes de pagamentos e ver passar.**
- [ ] **Step 6: Commit** `feat(api): rotas de pagamentos (pago e comprovantes)`.

---

### Task 6: Administração das chaves (API interna + tela)

**Files:**
- Create: `api/_lib/apiV1/chavesAdminRotas.js`, `src/pages/Configuracoes/ChavesApi/ConfigChavesApi.jsx`, `src/lib/apiV1/chavesAdminApi.js`
- Modify: `src/App.jsx` (rota `/configuracoes/chaves-api`, `PrivateRoute permission="access.manage"`), `src/lib/navConfig.js` e `src/lib/permissionCatalog.js` (item de menu, seguindo o padrão de `impressao-etiquetas`)
- Test: `src/lib/apiV1/chavesAdminRotas.test.js`

**Interfaces:**
- Produces: `POST /api/v1/admin/chaves` (criar; devolve a chave completa **uma vez**), `GET /api/v1/admin/chaves` (sem hash), `PATCH /api/v1/admin/chaves/{id}` (nome, escopos, origens, limite, IPs, expiração), `POST /api/v1/admin/chaves/{id}/revogar`, `POST /api/v1/admin/chaves/{id}/girar` (revoga e cria igual). Autenticação por **JWT** com `PERMISSION_KEYS.ACCESS_MANAGE` (`validarJwtComPermissao`), não por chave de API.
- Cliente: `chavesAdminApi.js` exporta `listarChaves()`, `criarChave(dados)`, `editarChave(id, dados)`, `revogarChave(id)`, `girarChave(id)`.

- [ ] **Step 1: Testes que falham:**
  - Criar com escopo `rede:ler` sem `origens_permitidas` → 400.
  - Criar devolve `chave` completa; `GET` seguinte não contém `chave` nem `hash`.
  - Sem `access.manage` → 403.
  - `revogar` define `revogada_em`; a mesma chave passa a falhar em `/rede/filtros` (integração com o roteador, após expirar o cache de 30 s simulado).
  - `girar` devolve chave nova com os mesmos escopos e deixa a antiga revogada.
  - Criar, revogar e girar gravam em `audit_logs`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar as rotas internas.**
- [ ] **Step 4: Implementar a tela** no padrão visual das outras telas de Configurações (usar os componentes de `src/components/ui`): tabela de chaves (nome, prefixo, escopos, último uso, estado), modal "Nova chave" e, depois de criar, um aviso "Copie agora; ela não será exibida novamente" com botão copiar.
- [ ] **Step 5: Rodar `npx vitest run`, `npx eslint` nos arquivos novos e `npx vite build`;** ver tudo passar.
- [ ] **Step 6: Commit** `feat(api): administração de chaves de API`.

---

### Task 7: Documentação e página `/api-docs`

**Files:**
- Create: `docs/api/README.md`, `docs/api/rede-credenciada.md`, `docs/api/pagamentos.md`, `docs/api/openapi.json`, `public/api-docs/index.html`
- Test: `src/lib/apiV1/openapi.test.js`

**Interfaces:**
- Consumes: as rotas das Tasks 4, 5 e 6.
- Produces: especificação OpenAPI 3.1 e guias descritos na seção 8 da especificação.

- [ ] **Step 1: Teste que falha:** `openapi.test.js` lê `docs/api/openapi.json` e confere que (a) todo `path` + método registrado com `registrarRota` aparece no arquivo e (b) todo `path` do arquivo existe no roteador; (c) nenhum exemplo contém `emer_rede_` ou `emer_pag_` seguido de 32 caracteres reais (exemplos usam `emer_rede_EXEMPLO…`).
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Escrever os documentos** em português, para quem não conhece o EmerLAB: autenticação, erros, limites, paginação, CORS e origens; em `rede-credenciada.md` incluir a tabela **card → campo da API** da seção 2 da especificação, o fluxo de filtros em cascata (UF → cidade → especialidade → plano) e exemplos `curl`, `fetch` e React; em `pagamentos.md` o fluxo listar → marcar pago → anexar, idempotência e erros. Gerar respostas de exemplo a partir de dados fictícios.
- [ ] **Step 4: Página `public/api-docs/index.html`** estática (sem login) que renderiza o `openapi.json` e o guia; liberar `/api-docs` no `vercel.json` (a reescrita `/((?!api/|email/).*)` já exclui `api/`, então a página usa `/api-docs/` como pasta pública e precisa ficar fora do fallback do `index.html`).
- [ ] **Step 5: Rodar o teste e ver passar.**
- [ ] **Step 6: Commit** `docs(api): guias, OpenAPI e página de documentação`.

---

### Task 8: Verificação com a base real e implantação

**Files:**
- Create: `scripts/api-v1-verificar.mjs` (leitura, imprime contagens; não grava)

- [ ] **Step 1: Comparar contagens** com a base real: total de credenciados da API versus os 640 prestadores ativos e os 547 do site atual; listar a diferença por motivo (situação, inativo) e relatar ao Pedro.
- [ ] **Step 2: Conferir amostras:** `Caxias do Sul`, `Porto Alegre`, `Curitiba` com e sem `plano`; confirmar contra a tela Credenciamento → Quem realiza que cidade principal e cidades que atende batem.
- [ ] **Step 3: Aplicar a migração** `api_chaves` fora do horário de pico (Supabase Micro) e conferir `get_advisors` (segurança) sem alerta novo.
- [ ] **Step 4: Publicar** (cherry-pick para a `main`, só quando o Pedro pedir) e conferir o deploy com `mcp__claude_ai_Vercel__list_deployments`.
- [ ] **Step 5: Gerar as chaves de produção** pela tela, testar com `curl` (`/rede/filtros`, `/rede/credenciados?cidade=…`, e `pago`/comprovante num registro de teste) e entregar à equipe do site e ao financeiro por canal seguro.
- [ ] **Step 6: Reportar** ao Pedro o resultado de cada passo, incluindo o que não foi testado.
