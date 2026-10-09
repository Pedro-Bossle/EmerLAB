# E-mail via Resend (EmerLAB)

Todos os e-mails do EmerLAB saem pela **API Resend**, remetente `noreply@emerlab.com.br`, com **cores e logo** da plataforma.

## Variáveis (Vercel / `.env.local`)

| Variável | Tipo | Exemplo |
|----------|------|---------|
| `RESEND_API_KEY` | Secret | `re_...` (obrigatória — criar em resend.com) |
| `RESEND_FROM_EMAIL` | Config | `noreply@emerlab.com.br` |
| `RESEND_FROM_NAME` | Config | `EmerLAB` |
| `EMAIL_INTERNAL_SECRET` | Secret | segredo compartilhado com o worker Emer-Radar |
| `SITE_URL` | Config | `https://emerlab.com.br` (links Auth + imagens `/email/*`) |
| `VITE_MSAL_REDIRECT_URI` | Config | `https://emerlab.com.br` (Outlook / Azure) |

## Identidade visual

- Cores: `--azul-escuro` `#1E3148`, `--azul-destaque` `#2F87C6`, `--azul-claro` `#E7F4FC`
- Logos públicos: `/email/logo-azul.png`, `/email/logo-branco.png`
- Assinaturas HTML (para copiar no Outlook/Gmail): [`public/email/assinaturas/`](../public/email/assinaturas/)

## Fluxos

- **Convite / reset (admin):** `POST /api/admin-users` → `generateLink` (Supabase) + Resend  
  O convite usa mensagem de **boas-vindas** ao convidado.
- **Reset próprio (menu):** `action: resetOwnPassword`
- **Pipeline / worker:** `POST /api/email` com `Authorization: Bearer <EMAIL_INTERNAL_SECRET>`

## Modelos (`api/_lib/emailTemplates.js`)

| Template | Quando | Assunto |
|----------|--------|---------|
| `invite` / `welcome` | Convite de usuário novo | Bem-vindo(a) ao EmerLAB — defina sua senha |
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

## Outlook (MSAL)

Redirect URIs registados no Azure (já configurados):

- `https://emerlab.com.br`
- `https://emerlab.com.br/auth-redirect.html`

Em produção o app usa `https://emerlab.com.br` automaticamente quando o host é `emerlab.com.br` / `www.emerlab.com.br`. Em local, use `VITE_MSAL_REDIRECT_URI=http://localhost:5173`.
