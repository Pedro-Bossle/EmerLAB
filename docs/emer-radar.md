# Integração Emer-Radar no EmerLAB

## Desenvolvimento

1. Worker: `python backend/main.py` (porta 8000) na pasta `teste-emeradar`
2. EmerLAB: `npm run dev` — proxy `/emeradar` → 8000 (`vite.config.js`)

Scraping interativo (Prospect Maps) e fila HTTP do pipeline precisam do worker local.

## Produção (sem Railway)

O cron da fila corre no **GitHub Actions** do repositório `teste-emeradar`
(`.github/workflows/emer-radar-cron.yml`):

- Agenda: seg–sex 18:00 America/Sao_Paulo (`0 21 * * 1-5` UTC)
- Manual: botão **Rodar cron (Actions)** na UI, ou `workflow_dispatch` no GitHub

### Secrets no repositório `teste-emeradar`

Obrigatórios:

- `DATABASE_URL` — Postgres da fila/runs do Emer-Radar
- `CRON_SECRET` — o mesmo valor usado pelo endpoint `/api/pipeline/cron/run-queue`

Opcionais (e-mail / tarefas EmerLAB):

- `EMERDOG_SUPABASE_URL`, `EMERDOG_SUPABASE_SERVICE_ROLE_KEY`, `EMERDOG_TAREFA_CRIADOR_ID`
- Ou SMTP_* se o mailer do worker ainda usar SMTP

### Secrets no EmerLAB (Vercel)

Para o botão «Rodar cron (Actions)» (`POST /api/emer-radar-cron`, rewrite → `audit-logs` — cabe no limite Hobby de 12 Serverless):

- `EMER_RADAR_GITHUB_TOKEN` — PAT com permissão de disparar workflows
- `EMER_RADAR_GITHUB_REPO` — default `Pedro-Bossle/teste-emeradar`
- `EMER_RADAR_WORKFLOW_FILE` — default `emer-radar-cron.yml`

## E-mail do pipeline (Resend)

- No EmerLAB (Vercel): `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME`, `EMAIL_INTERNAL_SECRET`
- No worker/Actions, quando `send_email=true`, chamar:
  `POST https://emerlab.com.br/api/email` com `Authorization: Bearer <EMAIL_INTERNAL_SECRET>`

## UI

- Rota: `/credenciamento/emer-radar`
- Legado: `/credenciamento/prospectos-osm` redireciona para Emer-Radar

## Persistência Prospect Maps

- Tabela Supabase `cred_prospectos_maps`
- Após cada busca, resultados são upsertados
- Foto de fachada: GET `/api/place-photo` (worker local) sob demanda

## Pipeline — cidades do tráfego

- Tabelas `cred_trafego_cidades` + `cred_trafego_aparicoes`
- Colar cidades do dia; 1 marcador/dia; ao bater 4 → enfileira no worker (`POST /api/pipeline/queue`)
- Em produção, a fila é consumida pelo GitHub Actions (não há worker Railway)
