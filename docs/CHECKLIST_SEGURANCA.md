# Checklist de segurança — EmerLAB / SFSC SUPERTOOL

Inventário feito em **2026-08-26** a partir do código em `api/`, `supabase/functions/`, `src/lib/api/` e `scripts/sql/`.

Legenda do estado:

- `[x]` OK no código (ou público **intencional**)
- `[ ]` Pendente / gap a corrigir ou a validar no Supabase
- `[~]` Parcial / depende de ambiente ou deploy

Marque à mão os itens de **operação** (SQL aplicado, secrets na Vercel, etc.).

---

## 1. Operação — SQL / RLS / secrets

Executar no SQL Editor do Supabase (ou confirmar já aplicados):

- [ ] `scripts/sql/profiles_force_password_change.sql`
- [ ] `scripts/sql/seguranca_rls_hardening.sql`
- [ ] `scripts/sql/home_tarefas.sql` (+ `home_tarefas_horario.sql` se usarem horário)
- [ ] `scripts/sql/cred_kanban_mencoes.sql`
- [ ] `scripts/sql/notificacoes_realtime.sql`
- [ ] `scripts/sql/formulario_cred_entradas_delete_rls.sql` (se inbox/formulário ativo)
- [ ] `scripts/sql/home_bate_papo_v2_rls_fix_select.sql` (se bate-papo v2 ativo)
- [ ] `scripts/sql/audit_logs_e_credenciado_em.sql` (se auditoria unificada ativa)

Secrets / ambiente:

- [ ] `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` só no servidor (Vercel / Edge), nunca no client
- [ ] `CLICKSIGN_WEBHOOK_SECRET` definido em produção
- [ ] `CLICKSIGN_WEBHOOK_ALLOW_INSECURE_DEV` **não** definido em produção
- [ ] Confirmar se o client usa Edge (`VITE_SUPABASE_EDGE_API`) — afeta gaps §3

---

## 2. APIs Vercel (`api/*.js`)

| Rota | JWT / auth | Permissão | Rate-limit | Público? | Estado |
|------|------------|-----------|------------|----------|--------|
| `cep-lookup` | Não | — | `cep` 40/min | Sim (formulário) | [x] |
| `consulta-cnpj` | `validarJwtComPerfil` | sessão | `cnpj` 30/min | Não | [x] |
| `map-osm` | `validarJwtComPerfil` | sessão | `map-osm` 45/min | Não | [x] |
| `geocode-prestador` | `validarJwtComPermissao` | `credenciamento.edit` | `geocode` 30/min | Não | [x] |
| `prospectos-osm-coletar` GET | ferramenta + view | prospectos read | `prospectos` 12/min | Não | [x] |
| `prospectos-osm-coletar` POST | ferramenta + edit | prospectos write | idem | Não | [x] |
| `rc-pdf` | `validarJwtComPermissao` | credenciamento view / cadastro view | `rc-pdf` 8/min | Não | [x] |
| `clicksign-download` | `validarJwtComPermissao` | contratos view/edit ou access.manage | `clicksign` | Não | [x] |
| `clicksign-catchall` | via proxy | idem contratos | `clicksign` | Não | [x] |
| `clicksign-webhook` | HMAC | — | `webhook` 120/min + body ≤256 KiB | Receptor externo | [x] |
| `admin-users` | JWT local (`validarAdmin` / clearOwn) | `access.manage` (exceto clearOwn) | `adminUsers` 30/min | Não | [x] |
| `audit-logs` | JWT local | `access.manage` (list); recordAuth = qualquer JWT | `auditLogs` 40/min | Não | [x] |
| `gemini-rate` | JWT local | view + ACL prospectos | `geminiRate` 30/min | Não | [x] |

Gate sessão com troca de senha obrigatória (`forcePasswordChange`) via `serverAuth.validarJwtComPerfil`:

- [x] Rotas que usam `serverAuth` (cnpj, map-osm, geocode, prospectos, rc-pdf, clicksign-*)
- [ ] `admin-users` / `audit-logs` / `gemini-rate` usam auth local — **não** aplicam o mesmo gate (parcialmente esperado em admin; `audit-logs` `recordAuth` e `gemini-rate` merecem revisão)

IP para rate-limit (`getClientIp` = **último** hop de `x-forwarded-for`):

- [x] `src/lib/api/serverAuth.js`
- [x] `api/audit-logs.js` usa `serverAuth.getClientIp` (último hop)

Limite de tamanho de body:

- [x] `clicksign-webhook` (256 KiB)
- [x] POSTs autenticados via `readJsonBodyLimited` (256 KiB): `admin-users`, `audit-logs`, `geocode-prestador`, `prospectos-osm-coletar`

---

## 3. Edge Functions (`supabase/functions/*`)

IP last-hop em `_shared/requireUser.ts`:

- [x] `clientIp` alinhado com Vercel

| Function | JWT | Permissão | Rate-limit | vs API Vercel | Estado |
|----------|-----|-----------|------------|---------------|--------|
| `cep-lookup` | Não | — | 40/min | Alinhado (público) | [x] |
| `consulta-cnpj` | `requireUserProfile` | sessão | 30/min | Alinhado (JWT) | [x] |
| `map-osm` | `requireUserProfile` | sessão | 45/min | Alinhado (JWT) | [x] |
| `geocode-prestador` | `requireUserProfile` | edit | 30/min | Quase alinhado | [~] |
| `prospectos-coletar` | `requireUserProfile` | GET read / POST **edit** | 12/min | Alinhado com Vercel | [x] |

Outros:

- [ ] Edge **não** rejeita sessão com `force_password_change` (Vercel sim)
- [~] CORS `Access-Control-Allow-Origin: *` em `_shared/cors.ts` (comum em Edge + JWT; rever se Edge público permanece)

Prioridade alta se o front chamar Edge diretamente:

1. ~~Exigir JWT em `consulta-cnpj` e `map-osm` Edge (espelhar Vercel).~~ **feito**
2. ~~POST `prospectos-coletar` exigir permissão de **edit** (como Vercel).~~ **feito**
3. Opcional: espelhar gate `forcePasswordChange` em `requireUserProfile`.

---

## 4. Auth / política de senha (app)

- [x] Colunas / normalização: `force_password_change`, `password_changed_at`, prazo 90 dias (`accessControl.js`)
- [x] `AlterarSenha`: troca via `admin-users` `clearOwnForcePassword` + `validarPoliticaSenha` + `admin.updateUserById`
- [x] APIs via `serverAuth` bloqueiam até trocar senha
- [ ] Confirmar UI: rotas protegidas redirecionam para `/alterar-senha` quando `forcePasswordChange`
- [ ] Confirmar RLS: utilizador **não** consegue limpar `force_password_change` no client (`seguranca_rls_hardening.sql`)

---

## 5. Dados / Realtime / Kanban / Home

- [ ] RLS `cred_kanban_mencoes` aplicado (só autor/mencionado)
- [ ] Realtime com filtros server-side onde aplicável (ex.: menções `mencionado_id=eq.{userId}` na Home)
- [ ] Storage anexos tarefas: bucket privado + policies (`home_tarefas.sql`)
- [ ] Webhook Clicksign: tabela `clicksign_notificacoes_webhook` + RLS/acesso só via service role / UI autenticada

---

## 6. CI / higiene

- [x] `.github/workflows/security.yml` — `actions/checkout` com `persist-credentials: false`
- [ ] `npm audit` / dependências críticas em PR (se fizer parte do workflow de segurança)
- [ ] Sem service role / secrets em ficheiros commitados (`.env*` no `.gitignore`)

---

## 7. Smoke test manual (após deploys)

### APIs (com sessão normal)

- [ ] Sem `Authorization` → 401 em `consulta-cnpj`, `map-osm`, `geocode-prestador`, `prospectos-osm-coletar`
- [ ] User só **view** → POST geocode / POST coleta → 403
- [ ] User com `force_password_change` → APIs `serverAuth` → 403 até alterar senha
- [ ] `cep-lookup` funciona sem JWT; 429 após rajada
- [ ] Webhook Clicksign sem HMAC válido → 401; payload >256 KiB → 413

### Edge (se usado em produção)

- [ ] `map-osm` / `consulta-cnpj` **sem** JWT → 401 (após deploy das functions)
- [ ] `geocode-prestador` / `prospectos-coletar` sem JWT → 401
- [ ] User só **view** → POST `prospectos-coletar` → 403

### UI

- [ ] Login → forçar troca de senha → não entra nas ferramentas até concluir
- [ ] Kanban / Home / selects cidade-UF em mobile (smoke)

---

## 8. Gaps prioritários (resumo)

| Prioridade | Item | Onde |
|------------|------|------|
| ~~P0~~ | ~~JWT em Edge `map-osm` e `consulta-cnpj`~~ | feito |
| ~~P0~~ | ~~POST prospectos Edge exigir edit~~ | feito |
| ~~P1~~ | ~~IP last-hop em `audit-logs`~~ | feito |
| ~~P1~~ | ~~Rate-limit em `admin-users` / `audit-logs` / `gemini-rate`~~ | feito |
| ~~P1~~ | ~~Limite de body nos POSTs restantes~~ | feito (`readJsonBodyLimited`) |
| P2 | Gate force-password na Edge | `requireUser.ts` |
| P2 | Confirmar SQLs de RLS aplicados no projeto Supabase | operação |

---

## Referência rápida de ficheiros

- Auth Vercel: `src/lib/api/serverAuth.js`, `src/lib/api/rateLimit.js`
- Auth Edge: `supabase/functions/_shared/requireUser.ts`
- Senha / permissões: `src/lib/accessControl.js`, `src/lib/passwordPolicy.js`, `api/admin-users.js`
- SQL: `scripts/sql/seguranca_rls_hardening.sql`, `profiles_force_password_change.sql`, …

*Documento gerado a partir do código; atualizar quando os gaps P0/P1 forem corrigidos.*
