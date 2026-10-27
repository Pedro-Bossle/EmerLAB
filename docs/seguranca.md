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

## Migrações do banco (RLS e grants)

As políticas agora ficam versionadas em `supabase/migrations/` (antes `*.sql` era ignorado pelo Git e as regras de produção divergiram do que a documentação dizia).

| Arquivo | O quê |
| --- | --- |
| `20261017000000_seguranca_rls_hardening.sql` | Remove a escalada de privilégio em `profiles`, a leitura anónima de perfis e repasses, exige permissão para escrever em `pagamentos_registros` e `prestadores`, fecha `audit_logs` e as funções `SECURITY DEFINER` para `anon` |
| `20261017000100_rate_limit_distribuido.sql` | Contador de rate limit compartilhado entre instâncias (recuperação de senha) |
| `rollback/…rollback.sql` | Recria o estado anterior exatamente como estava em 16/10/2026 |

Aplicar (staging → produção), num horário de pouco uso:

```bash
npx supabase db push        # ou cole o arquivo no SQL Editor
```

Depois, testar com um utilizador comum (sem acesso administrativo):

1. No console do navegador logado: `await supabase.from('profiles').update({ permissions: { 'access.manage': true } }).eq('id', '<id próprio>')` → deve falhar.
2. `curl "$SUPABASE_URL/rest/v1/profiles?select=email" -H "apikey: <chave publicável>"` → deve devolver `[]`.
3. Perfil só de leitura em Pagamentos tenta salvar uma linha → deve falhar; perfil com edição → salva.
4. Formulário público `/ser_parceiro` continua enviando (cidades, especialidades, documento).

## Painel Supabase (manual)

- Authentication → **Password security** → ativar *Leaked password protection* (HaveIBeenPwned).

## Variáveis

| Variável | Onde |
| --- | --- |
| `AUTH_REDIRECT_ORIGINS` | Vercel — origens extra aceitas nos links de convite/recuperação, além de `SITE_URL` |
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
