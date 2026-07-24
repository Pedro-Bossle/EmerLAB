# Migração para Supabase Edge Functions

Este guia descreve como sair das APIs **Vite/Vercel** (`/api/*`) e passar a usar **Supabase Edge Functions** para os fluxos já migrados no repositório.

## O que já foi migrado (código)

| Legado (Vercel/Vite) | Edge Function | JWT |
|----------------------|---------------|-----|
| `GET /api/cep-lookup` | `cep-lookup` | não |
| `GET /api/consulta-cnpj` | `consulta-cnpj` | não |
| `GET /api/nominatim-search` | `map-osm?route=nominatim` | não |
| `GET /api/overpass-poi` | `map-osm?route=overpass` | não |
| `POST /api/geocode-prestador` | `geocode-prestador` | **sim** |
| `POST /api/prospectos-osm-coletar` | `prospectos-coletar` | **sim** |
| `GET /api/prospectos-gemini-status` | `prospectos-coletar?route=gemini-status` | não* |

\* O status Gemini usa GET público na function; a coleta exige usuário logado (JWT).

## O que permanece no Vercel (por enquanto)

| Rota | Motivo |
|------|--------|
| `/api/rc-pdf` | Puppeteer + Chromium (pesado para Edge) |
| `/api/clicksign/*` | Webhook URL fixa + proxy extenso |
| `/api/admin-users` | Admin Auth; migrar em fase 2 com validação JWT + service role |

Enquanto `VITE_SUPABASE_EDGE_API` não estiver `true`, o front continua usando `/api/*` em dev e produção.

---

## Passo 1 — Instalar Supabase CLI

```bash
npm install -g supabase
```

Ou: [https://supabase.com/docs/guides/cli](https://supabase.com/docs/guides/cli)

Verifique:

```bash
supabase --version
```

## Passo 2 — Login e link do projeto

```bash
cd C:\Users\loopy\Documents\GitHub\Emerdog_SFSC_SUPERTOOL
supabase login
supabase link --project-ref SEU_PROJECT_REF
```

O **Project ref** está no dashboard Supabase → Settings → General.

Ajuste `project_id` em `supabase/config.toml` se necessário (opcional para link).

## Passo 3 — Secrets das Edge Functions

Crie `supabase/.env.secrets` (não commitar — já está no `.gitignore`):

```env
SUPABASE_URL=https://SEU_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash
PROSPECTOS_COLETA_FONTE=auto
PROSPECTOS_GEMINI_FALLBACK_OSM=true
PROSPECTOS_GEMINI_MAX=30
NOMINATIM_CONTACT_EMAIL=seu-email@dominio.com
BRASILAPI_CNPJ_URL=https://brasilapi.com.br/api/cnpj/v1
```

Enviar para o projeto remoto:

```bash
supabase secrets set --env-file supabase/.env.secrets
```

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são injetados automaticamente no deploy em muitos ambientes; incluí-los no secrets garante paridade local.

## Passo 4 — Deploy das functions

```bash
supabase functions deploy cep-lookup
supabase functions deploy consulta-cnpj
supabase functions deploy map-osm
supabase functions deploy geocode-prestador
supabase functions deploy prospectos-coletar
```

Ou todas de uma vez:

```bash
supabase functions deploy
```

## Passo 5 — Frontend (.env.local)

Após deploy bem-sucedido:

```env
VITE_SUPABASE_URL=https://SEU_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJ...anon...
VITE_SUPABASE_EDGE_API=true
```

Reinicie `npm run dev`.

Com `VITE_SUPABASE_EDGE_API=true`, o módulo `src/lib/api/serverBackend.js` aponta para:

`https://SEU_REF.supabase.co/functions/v1/<nome-da-function>`

Com `false` ou ausente, mantém `/api/*` (plugins Vite + Vercel).

## Passo 6 — Testar

1. **CEP:** abrir cadastro com CEP → rede deve chamar `.../functions/v1/cep-lookup?cep=...`
2. **Mapa / Nominatim:** credenciamento mapa → `map-osm`
3. **Prospectos:** botão Prospectar → `prospectos-coletar` (usuário logado)
4. **Gemini status:** `.../functions/v1/prospectos-coletar?route=gemini-status`

Erros comuns:

| Sintoma | Ação |
|---------|------|
| 401 na Edge | Usuário não logado em rotas com `verify_jwt=true` |
| 500 secrets | `supabase secrets set` novamente |
| CORS | Functions usam `_shared/cors.ts` com `*`; restrinja origem em produção se quiser |
| Tabela jobs | Rodar `scripts/sql/cred_prospectos_coleta_jobs.sql` |

## Passo 7 — Desenvolvimento local das functions

```bash
supabase functions serve --env-file supabase/.env.secrets
```

No `.env.local` do Vite, aponte temporariamente:

```env
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_EDGE_API=true
```

(Quando usar stack local completa `supabase start`.)

## Passo 8 — Produção (Vercel + Supabase)

- Front continua na **Vercel** (estático).
- APIs migradas rodam na **Supabase**; não é obrigatório remover `api/*.js` da Vercel de imediato — servem de fallback se `VITE_SUPABASE_EDGE_API=false`.
- **Clicksign webhook:** manter URL `https://seu-dominio.vercel.app/api/clicksign-webhook` até migrar webhook para Edge com URL pública equivalente.

## Passo 9 — Fase 2 (opcional)

1. `admin-users` → Edge com validação de permissão `admin` no JWT + service role.
2. `rc-pdf` → worker externo (Railway/Fly) ou Supabase com limite de tempo; Edge puro não roda Puppeteer completo.
3. Clicksign → Edge proxy + webhook dedicado.
4. Remover rewrites `api/*` do `vercel.json` quando Edge for 100%.

## Estrutura no repositório

```
supabase/
  config.toml
  MIGRACAO_EDGE_FUNCTIONS.md
  .env.secrets          # local, não commitar
  functions/
    _shared/            # cors, nominatim, overpass, gemini, jobs…
    cep-lookup/
    consulta-cnpj/
    map-osm/
    geocode-prestador/
    prospectos-coletar/
src/lib/api/
  serverBackend.js      # roteamento Edge vs /api
```

## Scripts npm (sugestão)

Adicione ao `package.json` se desejar:

```json
"supabase:secrets": "supabase secrets set --env-file supabase/.env.secrets",
"supabase:deploy-functions": "supabase functions deploy"
```

---

Dúvidas ou erro de deploy: copie o log do `supabase functions deploy <nome>` (sem chaves) para o time.
