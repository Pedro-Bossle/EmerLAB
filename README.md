# EmerLAB

**EmerLAB** — Livro de Apoio Base. App React + Vite.

## Configuração local

1. `npm install`
2. Copie `env.chaves.modelo` para `.env.local` na raiz e preencha as chaves (ver comentários no modelo).
3. `npm run dev` — front (Vite, porta padrão 5173).
4. Opcional: `npm run dev:api` — APIs em `http://localhost:3000` (RC PDF, Clicksign proxy, CNPJ).

## Gemini (prospectos)

O código usa a Google AI Studio via **generateContent**. **Não** coloque a chave com prefixo `VITE_` — só no servidor.

1. Crie a chave em [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (prefixos habituais: `AIza…` ou `AQ.…`).
2. Grave `GEMINI_API_KEY` (e opcionalmente `GEMINI_MODEL=gemini-2.5-flash` ou `gemini-flash-latest`) no sítio que atende a API:
   - **Dev (Vite, padrão):** `.env.local` na raiz → reinicie `npm run dev`.
   - **Produção Vercel** (enquanto Edge estiver desligada): Environment Variables do projeto → redeploy.
   - **Supabase Edge** (`VITE_SUPABASE_EDGE_API=true`): copie [`supabase/env.secrets.example`](supabase/env.secrets.example) para `supabase/env.secrets`, preencha e rode `npm run supabase:secrets` + deploy das functions. Detalhes em [`supabase/MIGRACAO_EDGE_FUNCTIONS.md`](supabase/MIGRACAO_EDGE_FUNCTIONS.md).
3. Teste: `GET /api/prospectos-gemini-status` (legado) ou `…/functions/v1/prospectos-coletar?route=gemini-status` (Edge). Sem chave → `configurado: false`; com chave e cota → `disponivel: true`.

Sem chave, a coleta de prospectos usa só OpenStreetMap.

## Build

```bash
npm run build
```
