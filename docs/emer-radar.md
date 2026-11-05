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

E-mail do relatório (Resend, via EmerLAB):

- `EMAIL_INTERNAL_SECRET` — mesmo valor da Vercel. Com ele o worker envia por `POST /api/email`
  (anexos Excel/HTML em base64). Opcional: `EMAIL_API_URL` (default `https://emerlab.com.br/api/email`).
- Sem o segredo, o worker tenta `SMTP_*` (legado). Sem nenhum dos dois, o envio é pulado.
- O mesmo segredo envia o alerta quando o cron falha ou termina com 0 resultados.

Tarefas no Home do EmerLAB:

- `EMERDOG_SUPABASE_URL`, `EMERDOG_SUPABASE_SERVICE_ROLE_KEY`, `EMERDOG_TAREFA_CRIADOR_ID`

### Secrets no EmerLAB (Vercel)

Para o botão «Rodar cron (Actions)» (`POST /api/emer-radar-cron`, rewrite → `audit-logs` — cabe no limite Hobby de 12 Serverless):

- `EMER_RADAR_GITHUB_TOKEN` — PAT com permissão de disparar workflows
- `EMER_RADAR_GITHUB_REPO` — default `Pedro-Bossle/teste-emeradar`
- `EMER_RADAR_WORKFLOW_FILE` — default `emer-radar-cron.yml`

## Catálogo unificado (Prospect Maps + pipeline)

- A tela tem três abas: **Catálogo** (tudo o que foi coletado), **Busca manual** (Maps ao vivo, precisa do worker local)
  e **Coleta automática** (tráfego do dia, fila, execuções).
- Os dois caminhos gravam no mesmo lugar: `cred_prospectos_maps`. O formato é montado por
  `src/lib/credenciamento/prospectosMapsCore.js` (usado pelo navegador e pelo servidor).
- **Cron → catálogo:** ao terminar, o worker chama `POST /api/emer-radar-runs {action:'catalogar', runId}` com
  `Authorization: Bearer EMAIL_INTERNAL_SECRET` (`backend/pipeline/catalogo_sync.py`). Falha nessa etapa não derruba o pipeline.
- Regras de gravação: só preenche campos vazios, nunca rebaixa o status (contactado/credenciado) e preserva dados editados.
  Registros «somente rede» (sem presença no Maps) ficam só no run.
- Fachada e planos: ficam em `tags` (`tags.imagem`, `tags.planos`). A URL da fachada é do Google e pode expirar; se falhar, o cartão
  tenta buscar ao vivo (com worker) e, sem worker, mostra «Sem imagem».
- Execuções antigas: botão «Adicionar todas ao catálogo» (aba Coleta automática) ou «Adicionar N ao catálogo» na página da execução.

## Servidor de prospecção (.exe para Windows)

- Programa com janela (`teste-emeradar/desktop/emer_radar_worker.py`, empacotado com PyInstaller): botão
  «Iniciar servidor de prospecção» / «Parar servidor», instruções e log. Escuta só em `127.0.0.1:8000`.
- **Gerar:** `teste-emeradar\desktopuild_exe.bat` → `dist\EmerRadarWorker\EmerRadarWorker.exe` e `dist\EmerRadarWorker.zip` (~93 MB;
  o Chromium é baixado na primeira execução para a pasta `browsers`).
- **Publicar para download no EmerLAB:** `node scripts/publicar-worker.mjs <caminho do .zip>` (usa a service role do `.env.local`).
  Cria o bucket PRIVADO `emer-radar-worker` e envia `EmerRadarWorker.zip`. O limite de tamanho de arquivo do projeto
  precisa comportar ~100 MB (Supabase → Project Settings → Storage → Upload file size limit).
- **Baixar:** ícone ao lado da bolinha de status do Emer-Radar → modal com instruções. O link é gerado por
  `POST /api/emer-radar-runs {action:'worker-download'}` (login + permissão) e vale 2 minutos.
- **Detecção:** o site testa `http://127.0.0.1:8000/api/health`; com o servidor aberto a bolinha fica verde e a aba
  «Busca manual» aparece. Em produção o Chrome pode pedir permissão de «rede local» (o worker já responde ao preflight
  de rede privada e o CSP do `vercel.json` permite a conexão).

## Execuções e estado do cron (UI)

- Aba Pipeline → «Execuções e resultados»: próxima execução, último disparo no GitHub, fila e última coleta,
  mais a lista de coletas (abrir resultados / baixar Excel).
- Lê por `POST /api/emer-radar-runs` (rewrite → `audit-logs`), com a service role: as tabelas `pipeline_runs`
  e `pipeline_results` têm RLS sem políticas, então o navegador não as lê direto.
- O cron falha (e alerta por e-mail) quando o pipeline termina com 0 registros.

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
