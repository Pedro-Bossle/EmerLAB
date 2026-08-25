# EmerLAB

**EmerLAB** — Livro de Apoio Base. App React + Vite.

## Configuração local

1. `npm install`
2. Copie `env.chaves.modelo` para `.env.local` na raiz e preencha as chaves (ver comentários no modelo).
3. `npm run dev` — front (Vite, porta padrão 5173).
4. Opcional: `npm run dev:api` — APIs em `http://localhost:3000` (RC PDF, Clicksign proxy, CNPJ).

## Gemini (IA)

A coleta de prospectos usa Google AI Studio via **generateContent**. A chave é só de servidor — nunca com prefixo `VITE_`. Copie as tags `GEMINI_*` / `PROSPECTOS_*` de [`env.chaves.modelo`](env.chaves.modelo) para `.env.local` (dev), Vercel ou secrets da Edge.

- Utilizadores: [`docs/ia-usuario.md`](docs/ia-usuario.md)
- Desenvolvedores: [`docs/ia-desenvolvedor.md`](docs/ia-desenvolvedor.md)
- Edge Functions: [`supabase/MIGRACAO_EDGE_FUNCTIONS.md`](supabase/MIGRACAO_EDGE_FUNCTIONS.md)

## Build

```bash
npm run build
```

## Segurança

Ver [`docs/seguranca.md`](docs/seguranca.md) — auth nas APIs, RLS, rate limits, headers Vercel, política de senha e CI.