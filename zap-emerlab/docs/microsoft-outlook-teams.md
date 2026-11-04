# Emerzap: Outlook e Teams (Microsoft Graph)

Branch `feat/emerzap-msal-azure`. Tudo vem **desligado**: sem `MS_ATIVO=true` as abas Outlook/Teams seguem na prévia simulada.

## Como ligar (depois que o ADM registrar o app)

1. **Banco:** rode `supabase/migracao-microsoft.sql` no SQL Editor do Supabase (cria `zap_ms_contas` e `zap_ms_assinaturas`).
2. **Entra ID (Azure AD):** app novo só do Emerzap, plataforma **Web**, Redirect URI `https://<ZAP_PUBLIC_URL>/api/ms/callback`.
   Permissões **delegadas**: `offline_access`, `User.Read`, `Mail.ReadWrite`, `Mail.Send`, `Team.ReadBasic.All`,
   `Channel.ReadBasic.All`, `ChannelMessage.Read.All`, `ChannelMessage.Send`. Consentimento do administrador
   (obrigatório para `ChannelMessage.Read.All`). Crie um client secret.
3. **Vercel (projeto do Emerzap):** variáveis `MS_CLIENT_ID`, `MS_TENANT_ID`, `MS_CLIENT_SECRET`, `MS_TOKEN_KEY`
   (texto longo aleatório), `CRON_SECRET`, e por último `MS_ATIVO=true`. Opcional: `MS_TEAM_NOME=Emerdog`.
4. **Teste primeiro num Preview** com uma conta só. Cada atendente clica em "Entrar com a Microsoft" na aba.

Voltar atrás: `MS_ATIVO=false` (as abas voltam à prévia). Para revogar tudo, remover o consentimento no Entra ID.

## Como funciona

- Permissão **delegada e individual**: cada pessoa conecta a própria conta; o servidor guarda só o refresh token,
  **cifrado** (AES-256-GCM, `MS_TOKEN_KEY`). Canal privado só aparece para quem é membro (o ADM controla no Teams).
- **Nada de e-mail ou mensagem é gravado no banco.** O webhook só avisa "mudou" por Supabase Realtime e a tela busca
  o conteúdo no Graph na hora. Sem Realtime, a tela confere a cada 45 s.
- Webhook: `POST /api/ms/webhook` (validação por `validationToken`, confirmação por `clientState` de cada assinatura,
  sempre responde 202). Assinaturas: caixa de entrada + cada canal, por usuário.
- Renovação: ao abrir a aba (no máximo a cada 5 min) e cron diário `/api/ms/renovar` (`vercel.json`).

## Código

| Arquivo | Papel |
|---|---|
| `server/microsoft.js` | OAuth, tokens, Graph, e-mail, canais, assinaturas e webhook |
| `server/router.js` (`rotasMs`, `webhookMs`) | rotas `/api/ms/*` |
| `server/crypto.js` (`cifrar`/`decifrar`) | cifra dos tokens |
| `src/clienteMs.js` | hooks da conta, do Teams e do Outlook no navegador |
| `src/components/PreviaMicrosoft.jsx`, `MolduraMicrosoft.jsx` | telas (mesmas da prévia, prop `real`) |

## Limitações conhecidas (versão atual)

- **Pendente de confirmar na doc da Microsoft:** vida máxima da assinatura de webhook de canal (hoje `MS_CANAL_MINUTOS`,
  padrão 60) e comportamento em canais privados. Se a renovação diária não bastar, a tela renova ao abrir e faz polling.
- Teams: só mensagens de **topo** dos canais (respostas em thread, presença, menções ao enviar e anexos não entram).
- Outlook: sem Agenda no modo real; anexos aparecem só como nome (não baixa nem envia); rascunhos novos ficam só na tela.
- Outlook: ações (lido, mover, excluir, enviar, responder) são enviadas à Microsoft comparando a lista antes/depois;
  se alguma falhar, a tela mostra o aviso e recarrega o estado real.
- Cron da Vercel no plano Hobby roda no máximo 1x por dia.
