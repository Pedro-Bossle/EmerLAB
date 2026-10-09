# E-mail via Resend (EmerLAB)

Todos os e-mails do EmerLAB saem pela **API Resend**, remetente `noreply@emerlab.com.br`.

## Variáveis (Vercel / `.env.local`)

| Variável | Tipo | Exemplo |
|----------|------|---------|
| `RESEND_API_KEY` | Secret | `re_...` (obrigatória — criar em resend.com) |
| `RESEND_FROM_EMAIL` | Config | `noreply@emerlab.com.br` |
| `RESEND_FROM_NAME` | Config | `EmerLAB` |
| `EMAIL_INTERNAL_SECRET` | Secret | segredo compartilhado com o worker Emer-Radar |
| `SITE_URL` | Config | URL canônica do app (redirect dos links de Auth) |

Alias aceito para o segredo do pipeline: `RESEND_PIPELINE_SECRET`.

Já configurados na Vercel (production/preview/development): `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME`, `EMAIL_INTERNAL_SECRET`.  
Falta adicionar `RESEND_API_KEY` (Secret) nos três ambientes e redeploy.

## Fluxos

- **Convite / reset (admin):** `POST /api/admin-users` → `generateLink` (Supabase) + Resend
- **Reset próprio (menu):** `action: resetOwnPassword`
- **Pipeline / worker:** `POST /api/email` com `Authorization: Bearer <EMAIL_INTERNAL_SECRET>`

## Modelos (`api/_lib/emailTemplates.js`)

| Template | Quando | Assunto |
|----------|--------|---------|
| `invite` | Convite de usuário novo | Convite para acessar o EmerLAB |
| `invite_existing` | Convite para e-mail que já tem conta | Acesso ao EmerLAB — reative sua senha |
| `recovery` | Reset admin ou “redefinir senha” no menu | Redefinição de senha — EmerLAB |
| `pipeline` | Relatório do Emer-Radar | Pipeline Emer-Radar — … |

### Pipeline (worker)

```json
{
  "template": "pipeline",
  "to": ["pessoa@emerdog.com.br"],
  "vars": {
    "nome": "Camila",
    "cidade": "Curitiba",
    "uf": "PR",
    "resumo": "120 lugares processados."
  },
  "attachments": [{ "filename": "relatorio.xlsx", "content": "<base64>" }]
}
```

Ver também [`docs/emer-radar.md`](emer-radar.md).
