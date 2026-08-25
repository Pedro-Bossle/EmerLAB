# Segurança — EmerLAB

Checklist operacional após as mudanças de código. Detalhes técnicos nos ficheiros apontados.

## Já no código

| Item | O quê |
| --- | --- |
| 1 Auth APIs | JWT + permissão em prospectos, geocode, RC PDF, Clicksign proxy/download; rate limit nas proxies públicas |
| 2 RLS | Script `scripts/sql/seguranca_rls_hardening.sql` (profiles) |
| 3 Login rate | Mensagem amigável no Login; configurar Attack Protection no Supabase (abaixo) |
| 5 Headers | `vercel.json` → CSP, HSTS, X-Frame-Options, etc. |
| 6 Rate limit | `src/lib/api/rateLimit.js` em CEP/CNPJ/map/RC/prospectos/Clicksign/webhook |
| 7 Webhook | HMAC obrigatório salvo opt-in `CLICKSIGN_WEBHOOK_ALLOW_INSECURE_DEV=true` |
| 8 Senha | Mín. 10 chars + letra + número (`src/lib/passwordPolicy.js`) + `force_password_change` existente |
| 9 Auditoria | Alertas de login/logout em massa e mudanças de permissão |
| 10 CI | `.github/workflows/security.yml` — `npm audit` + guards de segredos |

## Configurar no painel Supabase (item 3)

1. Dashboard → **Authentication** → **Attack Protection** / rate limits.
2. Ativar limites de login / email (valores padrão do plano estão ok para começar).
3. Confirmar **Password requirements** alinhados (mín. 10 se o painel permitir).
4. **Não** ativar CAPTCHA até o Turnstile voltar ao front.

## Executar SQL (item 2)

No SQL Editor (staging → produção):

```sql
-- conteúdo de scripts/sql/seguranca_rls_hardening.sql
```

Depois: login com user normal e admin; alterar o próprio nome; tentar alterar `permissions` via PostgREST (deve falhar para user comum).

## Variáveis

| Variável | Onde |
| --- | --- |
| `CLICKSIGN_WEBHOOK_SECRET` | Vercel / `.env.local` — obrigatória para aceitar webhooks |
| `CLICKSIGN_WEBHOOK_ALLOW_INSECURE_DEV` | Só local, `true` se testar webhook sem secret |
| Nunca `VITE_` em | `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, tokens Clicksign |

## Redeploy Edge (se `VITE_SUPABASE_EDGE_API=true`)

```bash
npm run supabase:deploy-functions
```

Functions `prospectos-coletar` e `geocode-prestador` passam a exigir JWT + permissão de credenciamento.

## Captcha (depois)

Reintroduzir Turnstile quando quiserem; até lá deixe CAPTCHA **desligado** no Auth.
