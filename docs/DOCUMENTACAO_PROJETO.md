# EmerLAB (SFSC SUPERTOOL): documentação do projeto

> **EmerLAB** (Livro de Apoio Base) é a plataforma interna da Emerdog para gerir a rede de
> prestadores veterinários. Ela cobre tabelas de valores, credenciamento, prospecção, planos,
> compras, contratos (Clicksign), pagamentos e administração de acessos.
>
> Este documento é uma visão geral do projeto inteiro. Os guias específicos que já existem
> estão em [Documentação relacionada](#13-documentação-relacionada).

---

## Sumário

1. [Stack e visão geral](#1-stack-e-visão-geral)
2. [Estrutura de pastas](#2-estrutura-de-pastas)
3. [Como rodar localmente](#3-como-rodar-localmente)
4. [Scripts npm](#4-scripts-npm)
5. [Variáveis de ambiente](#5-variáveis-de-ambiente)
6. [Arquitetura](#6-arquitetura)
7. [Autenticação, sessão e permissões](#7-autenticação-sessão-e-permissões)
8. [Módulos funcionais e rotas](#8-módulos-funcionais-e-rotas)
9. [APIs de servidor (`api/`)](#9-apis-de-servidor-api)
10. [Supabase: banco, Edge Functions e SQL](#10-supabase-banco-edge-functions-e-sql)
11. [Integrações externas](#11-integrações-externas)
12. [Deploy, CI e testes](#12-deploy-ci-e-testes)
13. [Documentação relacionada](#13-documentação-relacionada)
14. [Convenções e observações](#14-convenções-e-observações)

---

## 1. Stack e visão geral

| Camada | Tecnologia |
|---|---|
| Front-end | React 19, React Router 7, Vite 8 (Rolldown), Tailwind CSS 3 e CSS por componente |
| Mapas | Leaflet / React-Leaflet, com OSM, Nominatim e Overpass |
| Banco / Auth / Storage / Realtime | Supabase (`@supabase/supabase-js`, `@supabase/ssr`) |
| Servidor | Funções serverless da Vercel (`api/*.js`) e Supabase Edge Functions (Deno, `supabase/functions`) |
| PDF | `jspdf` + `jspdf-autotable`, `pdf-lib`, `pdfjs-dist` (leitura); Puppeteer + `@sparticuz/chromium` (RC em PDF no servidor) |
| Planilhas | `exceljs`, `jszip` (KMZ) |
| IA | Google Gemini (`@google/genai`), só no servidor |
| E-mail | Resend |
| Microsoft 365 | MSAL (`@azure/msal-browser` / `msal-react`) com Graph para Outlook (agenda/tarefas) |
| Assinatura digital | Clicksign (API v3 por proxy no servidor) |
| Testes | Vitest |
| Lint | ESLint 9 (flat config) |

O projeto é escrito quase todo em **JavaScript (ESM)**. Os únicos arquivos TypeScript são
`src/lib/gemini/gemini.ts` e as Edge Functions (Deno).

---

## 2. Estrutura de pastas

```
.
├── api/                    # Funções serverless da Vercel (Node) e handlers de dev
│   └── _lib/               # Templates de e-mail, Resend, cron Emer-Radar, utilitários
├── docs/                   # Guias (segurança, IA, Resend, Emer-Radar) e este documento
├── public/                 # Estáticos (inclui public/email/** usado nos e-mails)
├── scripts/
│   ├── dev-api-server.mjs  # Servidor local das APIs (porta 3000)
│   ├── credenciamento/     # Exportar/importar/geocodificar prestadores, coleta OSM
│   ├── rc/                 # Geração da RC em PDF via CLI
│   └── sql/                # Scripts SQL avulsos (RLS, tabelas, correções) e READMEs
├── sql/                    # SQL adicional (categoria_limites_grupo.sql)
├── src/
│   ├── main.jsx            # Bootstrap: estilos + MsalAppProvider + App
│   ├── App.jsx             # Todas as rotas (React Router)
│   ├── assets/             # Moldes e fontes para PDFs (contratos, honorários, planos, RC)
│   ├── components/         # Layout, Sidebar, UI base, Outlook, BatePapo, Toasts...
│   ├── hooks/              # useGemini, useSfscExclusaoConfirm
│   ├── lib/                # Regras de negócio, clientes de API, PDF/Excel e ACL
│   ├── pages/              # Telas por módulo
│   └── styles/             # tailwind.css, global-styles.css
├── supabase/
│   ├── config.toml
│   ├── functions/          # Edge Functions (Deno) e _shared/
│   ├── migrations/         # Migrações versionadas (poucas, ver §10)
│   └── MIGRACAO_EDGE_FUNCTIONS.md
├── env.chaves.modelo       # Modelo das variáveis de ambiente (copiar para .env.local)
├── vercel.json             # Funções, rewrites e headers de segurança
└── vite.config.js          # Vite + plugins que servem /api/* em dev
```

### `src/lib`: organização

| Pasta/arquivo | Responsabilidade |
|---|---|
| `supabase.js`, `authSession.js`, `passwordPolicy.js`, `passwordRecovery.js` | Cliente Supabase, sessão, inatividade, política e recuperação de senha |
| `accessControl.js`, `permissionCatalog.js`, `navConfig.js`, `readOnlyGuard.js` | Permissões (ACL), catálogo de ferramentas, menu lateral e modo somente leitura |
| `api/` | Auth de rotas de servidor (`serverAuth.js`), roteamento Edge ↔ Vercel (`serverBackend.js`), rate limit, rewrites |
| `credenciamento/` | Emer-Radar, prospecção (OSM/Gemini/Maps), geocodificação, mapa, relatórios PDF, Kanban |
| `configuracoes/` | Conferência de laboratório (com Web Worker para Excel), etiquetas, importação/exportação de credenciados |
| `contratos/` | Consulta de CNPJ, máscaras, validação de documentos, geração do PDF de contrato |
| `clicksign/` | Cliente, proxy, upload, signatários e notificações de webhook |
| `impressaoPlanos/`, `impressaoHonorarios/`, `impressaoDescontos/`, `pdf/`, `rc/` | Geração de PDFs (planos, honorários, descontos, RC) |
| `gemini/gemini.ts` | Cliente global do Gemini (servidor): fallback de modelos, rate local, timeouts |
| `msal/` | Configuração MSAL e token do Microsoft Graph |
| `home*.js` | Afazeres, favoritos e bate-papo da Home |
| `pagamentos*.js`, `compras*.js`, `export*Excel.js` | Pagamentos, compras e exportações em Excel |

---

## 3. Como rodar localmente

1. `npm install`
2. Copie `env.chaves.modelo` para `.env.local` na raiz e preencha as chaves (o modelo traz comentários).
3. `npm run dev`: sobe o front Vite (porta 5173). Os plugins do `vite.config.js` já servem a
   maioria das rotas `/api/*` em dev (CNPJ, CEP, IBGE, OSM, prospectos, Clicksign,
   admin-users, e-mail, auditoria, cron Emer-Radar).
4. Opcional: `npm run dev:api` sobe um servidor de APIs separado em `http://localhost:3000`
   (RC em PDF, proxy Clicksign, CNPJ).
5. Opcional (Emer-Radar): rode o worker Python do repositório `teste-emeradar`
   (`python backend/main.py`, porta 8000). O Vite faz proxy de `/emeradar` para ele.

---

## 4. Scripts npm

| Script | O que faz |
|---|---|
| `dev` | Vite em modo desenvolvimento |
| `dev:api` | Servidor local de APIs (`scripts/dev-api-server.mjs`) |
| `build` | Build de produção em `dist/` |
| `preview` | Serve o build localmente |
| `lint` | ESLint |
| `test` / `test:watch` | Vitest (uma execução / modo watch) |
| `rc:pdf` | Gera a RC em PDF pela linha de comando |
| `prestadores:export-enderecos` | Exporta CSV com endereços dos credenciados ativos do tipo LOCAL |
| `prestadores:import-coordenadas` | Importa latitude/longitude a partir do CSV |
| `prestadores:geocode-primeira-carga` | Geocodifica prestadores direto no banco (aceita `--dry-run`) |
| `prospectos:coletar-osm` | Coleta prospectos OSM por cidade (`--cidade "X" --uf RS [--dry-run]`) |
| `supabase:secrets` | `supabase secrets set --env-file supabase/env.secrets` |
| `supabase:deploy-functions` | Deploy das Edge Functions |

---

## 5. Variáveis de ambiente

A referência completa, com comentários, está em `env.chaves.modelo`.
**Regra:** o prefixo `VITE_` só vale para valores públicos, porque eles vão para o bundle
do navegador. Chaves de servidor nunca levam `VITE_`, e o CI verifica isso.

### Front-end (públicas)

| Variável | Uso |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Cliente Supabase |
| `VITE_SUPABASE_EDGE_API` | `true` faz o front usar Edge Functions em vez de `/api/*` |
| `VITE_MSAL_CLIENT_ID`, `VITE_MSAL_TENANT_ID`, `VITE_MSAL_REDIRECT_URI` | Login Microsoft / Outlook |
| `VITE_EMERADAR_API_BASE`, `VITE_EMERADAR_DIRECT` | Endereço do worker Emer-Radar |
| `VITE_EMERMARKETING_URL` | Link do portal EmerMarketing |

### Servidor (secretas)

| Grupo | Variáveis |
|---|---|
| Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Clicksign | `CLICKSIGN_ACCESS_TOKEN`, `CLICKSIGN_API_BASE`, `CLICKSIGN_WEBHOOK_SECRET`, `CLICKSIGN_WEBHOOK_ALLOW_INSECURE_DEV` |
| Gemini / prospecção | `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_RPM`, `GEMINI_RPD`, `GEMINI_TIMEOUT_MS`, `PROSPECTOS_GEMINI_MAX`, `PROSPECTOS_COLETA_FONTE`, `PROSPECTOS_GEMINI_FALLBACK_OSM` |
| Resend / e-mail | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME`, `EMAIL_INTERNAL_SECRET` |
| Emer-Radar (GitHub Actions) | `EMER_RADAR_GITHUB_TOKEN`, `EMER_RADAR_GITHUB_REPO`, `EMER_RADAR_WORKFLOW_FILE` |
| Outros | `NOMINATIM_CONTACT_EMAIL`, `SITE_URL`, `CORS_ORIGINS` |

As Edge Functions leem os secrets de `supabase/env.secrets`, que fica fora do git (modelo em
`env.secrets.example`).

---

## 6. Arquitetura

```
Navegador (React SPA)
  │
  ├── Supabase JS ───────────► Postgres (RLS) · Auth · Storage · Realtime
  │
  ├── /api/* ────────────────► Vercel Serverless (Node)  ──► Clicksign, Resend, Gemini,
  │      (dev: plugins Vite)                                 BrasilAPI, Nominatim/Overpass,
  │                                                          GitHub Actions, Puppeteer
  │
  ├── functions/v1/* ────────► Supabase Edge Functions (Deno) — se VITE_SUPABASE_EDGE_API=true
  │
  ├── /emeradar/* ───────────► Worker Emer-Radar (Python, repositório externo)
  │
  └── MSAL ──────────────────► Microsoft Graph (Outlook: agenda e tarefas)
```

Pontos principais:

- **Roteamento de servidor:** `src/lib/api/serverBackend.js` decide se uma chamada vai para
  uma Edge Function ou para a rota legada `/api/*`, conforme `VITE_SUPABASE_EDGE_API`.
- **Limite de 12 funções do plano Hobby da Vercel:** várias rotas compartilham uma função só,
  por meio de rewrites em `vercel.json` com `?_route=` (tratados em `vercelUnifiedRoute.js`):
  - `/api/nominatim-search` e `/api/overpass-poi` → `api/map-osm.js`
  - `/api/prospectos-gemini-status` e `/api/gemini-rate` → `api/prospectos-osm-coletar.js`
  - `/api/emer-radar-cron` → `api/audit-logs.js`
  - `/api/clicksign/*` → `api/clicksign-catchall.js`
  - `cep-lookup` e `ibge-municipios` rodam como **Edge** da Vercel, fora desse limite.
- **SPA fallback:** qualquer rota que não seja `api/` nem `email/` é reescrita para `index.html`.
- **Headers de segurança** são aplicados globalmente em `vercel.json`.

---

## 7. Autenticação, sessão e permissões

### Autenticação

- Login com e-mail e senha pelo Supabase Auth (`pages/Login`).
- **Convite de usuários** e **recuperação de senha** passam por `api/admin-users.js`, que gera
  o link no Supabase Admin e manda o e-mail pelo Resend com os templates de
  `api/_lib/emailTemplates.js` (`invite`, `invite_existing`, `recovery`, `welcome`, `pipeline`).
- `/alterar-senha` fica fora do `PrivateRoute` de propósito: o link do e-mail cria a sessão
  de forma assíncrona.
- **Política de senha:** expira em 90 dias (`PASSWORD_MAX_AGE_DAYS`), e o admin pode forçar a
  troca (`force_password_change` no perfil).
- **Inatividade:** `SessionSecurity` e `authSession.js` monitoram o tempo ocioso, avisam o usuário e encerram a sessão.

### Autorização (ACL)

- O perfil (`profiles`) guarda um objeto `permissions`.
- `permissionCatalog.js` define o catálogo **grupo → ferramenta → ações**
  (`read`, `create`, `update`, `delete`). Cada chave persistida tem a forma `${toolId}.${acao}`,
  por exemplo `credenciamento.cadastro.read`.
- As chaves legadas (`supertabela.view`, `credenciamento.edit`, `access.manage`...) continuam
  aceitas e são derivadas da ACL por `syncLegacyFromAcl` / `expandLegacyToAcl`.
- `PrivateRoute` recebe `permission`, `screenPermission` e `toolId`, carrega sessão e perfil
  (`carregarSessaoEPerfilAcesso`) e redireciona quem não tem acesso.
- Quem só tem permissão de leitura fica em modo somente leitura (`readOnlyGuard.js`,
  `usuarioSomenteLeituraGlobal`).
- No servidor, `src/lib/api/serverAuth.js` valida o JWT do usuário e lê o perfil com a
  service role **depois** dessa validação.
- Toda alteração relevante vai para `audit_logs`, que aparece na tela Auditoria.

---

## 8. Módulos funcionais e rotas

Rotas públicas (sem login):

| Rota | Tela |
|---|---|
| `/` | Login |
| `/alterar-senha` | Definição/troca de senha |
| `/ser_parceiro`, `/credenciamento/cadastro-publico[/:slug]` | Formulário público de pré-cadastro de parceiros |

As rotas autenticadas usam o `Layout2` (sidebar, bottom nav, dock flutuante):

### Início
| Rota | Descrição |
|---|---|
| `/home` | Dashboard: atalhos e favoritos, **afazeres** (`home_tarefas`, com chat por tarefa e sincronização com Outlook), alertas de formulário e de Clicksign |

### Tabelas de Valores (Super-Tabela), permissão `supertabela.*`
| Rota | Descrição |
|---|---|
| `/supertabelamain` | Painel principal da Super-Tabela |
| `/supertabela/cidades` | Tabelas por cidade, vínculos com municípios IBGE e procedimentos locais |
| `/supertabela/planos` | Valores e procedimentos por plano |
| `/supertabela/procedimentos` | Cadastro de procedimentos e modo por categorias |
| `/supertabela/negociacoes` | Negociações/vínculos com prestadores e exportação em Excel |
| `/supertabeladoc` | Documentação interna da Super-Tabela |

### Credenciamento, permissão `credenciamento.*`
| Rota | Descrição |
|---|---|
| `/credenciamento/principal` | **Kanban** do funil de credenciamento (contato inicial → cadastro/pós), com menções, reuniões no Outlook e relatório |
| `/credenciamento/cadastro` e `/:id` | Lista e ficha do prestador: dados, especialidades, procedimentos, veterinários, responsáveis, certificados, benefícios/descontos, honorários/contratos e exportação em PDF |
| `/credenciamento/emer-radar` | **Emer-Radar**: prospecção (Google Maps + planos Petlove/Petlife/Doglife/Emerdog), fila do pipeline e cidades do tráfego. Substitui a coleta OSM antiga (`/credenciamento/prospectos-osm` redireciona para cá) |
| `/credenciamento/mapa` | Mapa dos credenciados LOCAL, com busca de POIs (Overpass) e troca de basemap |
| `/credenciamento/import-kmz` | Importa coordenadas de um KMZ do Google My Maps, casando pelo nome |
| `/credenciamento/quem-realiza` | Busca prestadores por UF, cidade e procedimentos |
| `/credenciamento/especialidades-cidade` | Gráfico e contagem de credenciados por especialidade |
| `/credenciamento/especialidades-rc` | Ordem e cadastro das especialidades no PDF da RC |
| `/credenciamento/formulario` | Configuração do formulário público (link e páginas do wizard) |
| `/credenciamento/formulario/entradas` | Inbox de pré-cadastros, com conversão em ficha |

### Configurações
| Rota | Descrição |
|---|---|
| `/configuracoes/importar-credenciados` | Upload de Excel (credenciado × procedimento) para revisar e vincular |
| `/configuracoes/exportar-credenciados` | Excel dos credenciados com seus procedimentos |
| `/configuracoes/conferencia-laboratorio` | Confere os relatórios mensais do laboratório e da Emerdog contra os valores negociados (regras, aliases de exames, Web Worker) |
| `/configuracoes/observacoes-honorarios` | Mensagens condicionais impressas no PDF de honorários |
| `/configuracoes/observacoes-planos` | Mensagens condicionais impressas no PDF de planos |
| `/configuracoes/impressao-etiquetas` | PDF de etiquetas Colacril CA4263 (A4, 14 por folha) a partir de PDF, Excel ou CSV |

### Planos, Compras, Contratos e Pagamentos
| Rota | Descrição |
|---|---|
| `/planos/impressao` | Seleciona procedimentos e gera o PDF do plano por cidade |
| `/compras/valor-venda` | Tabela de valores de venda |
| `/compras/orcamento` | Cálculo de orçamento para clientes |
| `/contratos/gerar` | Monta o contrato em PDF (dados do CNPJ via BrasilAPI) |
| `/contratos/clicksign` | Envelopes, signatários, upload, download e notificações do Clicksign |
| `/pagamentos/registro` | Folha mensal de pagamentos a prestadores, com exportação em Excel |
| `/pagamentos/resumo` | Pendências com nota/resposta enviada que ainda não foram pagas |

### Administrativo, permissão `access.manage`
| Rota | Descrição |
|---|---|
| `/administrativo/acessos` | Convites, permissões (ACL) e auditoria de usuários |
| `/administrativo/auditoria` | Logs imutáveis; abas Qualidade de dados (CNPJ, geocodificação, RC, duplicatas) e EmerMarketing (`mkt_audit_log`) |
| `/administrativo/qualidade` | Qualidade de dados |

Também fazem parte do app as **Ferramentas Dev** (`dev.tools`: colunas extras, exclusão por
lista), as permissões do **EmerMarketing** (portal externo) e o **Bate-papo/Emerzap**
(chat com criptografia no cliente, que hoje está desligado: `isBatePapoEnabled = () => false`).

---

## 9. APIs de servidor (`api/`)

| Arquivo | Rota(s) | Função |
|---|---|---|
| `admin-users.js` | `POST /api/admin-users` (`action`) | Convite, reenvio, recuperação/reset de senha, atualização de perfil (com auditoria) |
| `audit-logs.js` | `POST /api/audit-logs` (`action`); `/api/emer-radar-cron` | Listagem/exportação de logs, `recordAuth`, metadados, resumo semanal, logs do EmerMarketing; aciona o cron do Emer-Radar no GitHub Actions |
| `email.js` | `POST /api/email` | Envio pelo Resend (aceita `Bearer EMAIL_INTERNAL_SECRET` para chamadas do worker) |
| `rc-pdf.js` | `POST /api/rc-pdf` | Gera a RC em PDF com Puppeteer + Chromium (60 s) |
| `clicksign-catchall.js` | `/api/clicksign/*` | Proxy da API Clicksign com o token guardado no servidor |
| `clicksign-upload-document.js` | `POST` | Anexa ao envelope um PDF que já está no Storage (`clicksign-uploads`), contornando o limite de ~4,5 MB do body |
| `clicksign-download.js` | `GET ?envelopeId&documentId&variant` | Baixa/visualiza o PDF original ou o assinado |
| `clicksign-webhook.js` | `POST` | Recebe eventos de envelope (sign, close, auto_close, add/remove_signer) |
| `consulta-cnpj.js` | `GET ?cnpj=` | Proxy da BrasilAPI com cache em memória |
| `cep-lookup.js` | `GET ?cep=` | Proxy do ViaCEP (Edge) |
| `ibge-municipios.js` | `GET ?uf=` | Proxy do IBGE (Edge) |
| `map-osm.js` | `/api/nominatim-search`, `/api/overpass-poi` | Proxy unificado do Nominatim e do Overpass |
| `geocode-prestador.js` | `POST` | Geocodifica o endereço de um prestador (exige JWT) |
| `prospectos-osm-coletar.js` | `POST` (start/step), `/api/prospectos-gemini-status`, `/api/gemini-rate` | Coleta de prospectos assíncrona em etapas; status e uso do Gemini |

Arquivos de apoio em `api/_lib/`: `emailTemplates.js`, `emailBrand.js`, `emailLogoCid.js`
(logos embutidos via CID para o Outlook), `emailAssinaturas`, `resendMail.js`,
`emerRadarCronHandler.js` e `gerarSenhaTemporaria.js`.

As rotas usam rate limit em memória (`src/lib/api/rateLimit.js`, válido por instância) e
limite de tamanho no body JSON.

---

## 10. Supabase: banco, Edge Functions e SQL

### Edge Functions (`supabase/functions`)

| Function | Equivale a | JWT |
|---|---|---|
| `cep-lookup` | `/api/cep-lookup` | não |
| `consulta-cnpj` | `/api/consulta-cnpj` | não |
| `map-osm` (`?route=nominatim\|overpass`) | `/api/nominatim-search`, `/api/overpass-poi` | não |
| `geocode-prestador` | `/api/geocode-prestador` | sim |
| `prospectos-coletar` (`?route=gemini-status`) | `/api/prospectos-osm-coletar` | sim (status é público) |

O código compartilhado fica em `_shared/` (CORS, `requireUser`, `supabaseAdmin`, Gemini,
Nominatim, Overpass, jobs de prospecção). Continuam só na Vercel: `rc-pdf` (Chromium),
Clicksign e `admin-users`. O passo a passo está em `supabase/MIGRACAO_EDGE_FUNCTIONS.md`.

### Principais tabelas (por uso no código)

| Domínio | Tabelas |
|---|---|
| Prestadores | `prestadores`, `prestador_estabelecimentos`, `prestador_cidades`, `prestador_especialidades`, `prestador_procedimentos`, `prestador_responsaveis`, `prestador_certificados_conclusao`, `prestador_beneficios`, `prestador_beneficios_obs`, `prestador_laboratorios_solicitacao`, `veterinarios`, `negociacoes_vet` |
| Catálogos | `procedimentos`, `especialidades`, `categorias`, `situacoes`, `portes`, `beneficios_catalogo` |
| Cidades / tabelas de valores | `cidades`, `cidades_credenciamento`, `cidades_municipios_vinculo`, `city_registry`, `repasses`, `planos`, `planos_cidade`, `planos_config`, `servico_valor_venda` |
| Observações em PDFs | `honorarios_observacoes(_procedimentos)`, `planos_observacoes(_procedimentos)` |
| Kanban de credenciamento | `cred_kanban_cards`, `cred_kanban_meta`, `cred_kanban_mencoes` |
| Prospecção / Emer-Radar | `cred_prospectos_osm`, `cred_prospectos_maps`, `cred_trafego_cidades`, `cred_trafego_aparicoes`, `pipeline_queue` |
| Formulário público | `formulario_cred_config`, `formulario_cred_paginas`, `formulario_cred_pagina_categorias`, `formulario_cred_entradas` |
| Conferência de laboratório | `lab_conferencia_sessao`, `lab_exame_mapeamento`, `lab_exame_equivalencia`, `lab_pessoa_mapeamento` |
| Home / colaboração | `home_tarefas`, `home_tarefas_mensagens`, `home_bate_papo_*` |
| Clicksign | `clicksign_notificacoes_webhook`, `clicksign_notificacoes_user_dismissed` |
| Acesso / auditoria | `profiles`, `audit_logs`, `access_audit_log`, `mkt_audit_log`, `qualidade_dados_arquivados`, `app_settings` |

### SQL e migrações

- `supabase/migrations/` tem só 3 migrações versionadas (`audit_logs`, `home_tarefas`,
  `cidades_credenciamento_nome_uf`).
- A maior parte do schema e das políticas RLS está em **scripts avulsos** em `scripts/sql/*.sql`,
  aplicados à mão no SQL Editor do Supabase. Entre eles: `seguranca_rls_hardening.sql`,
  `home_bate_papo_v2.sql`, `cred_prospectos_*.sql`, `conferencia_laboratorio.sql` e
  `beneficios_descontos*.sql`. Os READMEs da mesma pasta explicam alguns desses fluxos.
- `supabase/clicksign_uploads_bucket.sql` cria o bucket do Storage usado no upload do Clicksign.

---

## 11. Integrações externas

| Serviço | Uso | Onde |
|---|---|---|
| **Supabase** | Banco, Auth, Storage, Realtime (notificações, Kanban) | `src/lib/supabase.js` |
| **Clicksign** | Envelopes e assinatura de contratos, webhooks | `src/lib/clicksign/`, `api/clicksign-*` |
| **Resend** | E-mails transacionais (convite, recuperação, pipeline) | `api/email.js`, `api/_lib/` · [docs/resend-email.md](resend-email.md) |
| **Google Gemini** | Coleta de prospectos assistida por IA | `src/lib/gemini/gemini.ts` · [docs/ia-desenvolvedor.md](ia-desenvolvedor.md) |
| **Emer-Radar** (worker Python, repositório `teste-emeradar`) | Scraping do Google Maps, fila do pipeline, cron via GitHub Actions (seg–sex, 18h BRT) | `src/lib/credenciamento/emerRadar*.js` · [docs/emer-radar.md](emer-radar.md) |
| **OpenStreetMap** (Nominatim/Overpass) | Geocodificação e POIs | `api/map-osm.js` |
| **BrasilAPI / ViaCEP / IBGE** | CNPJ, CEP, municípios | `api/consulta-cnpj.js`, `api/cep-lookup.js`, `api/ibge-municipios.js` |
| **Microsoft Graph (MSAL)** | Agenda e tarefas do Outlook, reuniões a partir do Kanban | `src/lib/msal/`, `src/components/Outlook/` |
| **EmerMarketing** | Portal externo; o EmerLAB controla o acesso e lê a auditoria | `emermarketing*.js` |

---

## 12. Deploy, CI e testes

### Deploy

- **Vercel** (principal): `vercel.json` define `buildCommand: npm run build`, `outputDirectory: dist`,
  `maxDuration` por função, `includeFiles` (fontes e moldes da RC, `public/email/**`), rewrites e headers.
- **Supabase Edge Functions**: `npm run supabase:secrets` e depois `npm run supabase:deploy-functions`.
- **GitHub Pages**: `.github/workflows/deploy-pages.yml` publica o build a cada push na `main`
  (as APIs de servidor não funcionam nesse alvo).

### CI (`.github/workflows/security.yml`)

- `npm audit --audit-level=high`
- Barra variáveis `VITE_` com nome de chave de servidor
- Barra `.env.local` commitado

### Testes

- `npm test` roda o Vitest. São 23 arquivos `*.test.js` ao lado do código em `src/lib`, cobrindo
  matching da conferência de laboratório, etiquetas, layout de relatórios PDF, Kanban (colagem,
  atualização do site), paridade de permissões, catálogo de permissões, nomes de contrato,
  tráfego de cidades, Clicksign e outros.
- `npm run lint` roda o ESLint. Hoje ele não analisa arquivos `.ts`.
- Não existe script de typecheck. Para checar o `gemini.ts`, rode `tsc --strict` com um tsconfig temporário.

---

## 13. Documentação relacionada

| Documento | Conteúdo |
|---|---|
| [README.md](../README.md) | Início rápido |
| [docs/seguranca.md](seguranca.md) | Auth nas APIs, RLS, rate limits, headers, política de senha |
| [docs/CHECKLIST_SEGURANCA.md](CHECKLIST_SEGURANCA.md) | Checklist operacional e smoke tests depois do deploy |
| [docs/ia-usuario.md](ia-usuario.md) | IA para quem usa o sistema |
| [docs/ia-desenvolvedor.md](ia-desenvolvedor.md) | IA para desenvolvedores (módulo global, env, rate, Edge) |
| [docs/emer-radar.md](emer-radar.md) | Integração com o Emer-Radar |
| [docs/resend-email.md](resend-email.md) | E-mails pelo Resend e Outlook |
| [supabase/MIGRACAO_EDGE_FUNCTIONS.md](../supabase/MIGRACAO_EDGE_FUNCTIONS.md) | Migração para Edge Functions |
| `scripts/sql/README_*.md` | Auditoria, bate-papo v2, logout por inatividade, afazeres da Home |
| `CHECKLIST_TAILWIND.md` | Checklist de migração para Tailwind |

---

## 14. Convenções e observações

- **Idioma:** código, comentários e UI em português (há um pouco de pt-PT, como "utilizador").
- **Componentes:** cada componente/página fica numa pasta própria, com `.jsx` e `.css`. O Tailwind
  é adotado aos poucos e `src/components/ui/` reúne os primitivos (Button, Card, Modal, Input...).
- **Lógica fora das telas:** as regras de negócio ficam em `src/lib/` e são testadas ali.
- **Segredos:** só no servidor (Vercel env / Supabase secrets). O front usa apenas a publishable key.
- **Rotas legadas** são mantidas com `<Navigate replace>` (por exemplo `/pagamentos/cadastro` →
  `/pagamentos/registro`, `/ser-parceiro` → `/ser_parceiro`).
- **Telas desativadas:** `Credenciamento_doc` (`/credenciamentodoc` agora redireciona para o
  Kanban), a lista antiga de processos (`Credenciamento_main`, trocada pelo Kanban) e o catálogo
  OSM (trocado pelo Emer-Radar).
- **Secrets locais:** `supabase/env.secrets` é ignorado pelo git (`supabase/.gitignore`). O modelo
  versionado é `env.secrets.example`.
