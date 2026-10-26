# zap.emerlab

Painel de atendimento WhatsApp no estilo do WhatsApp Web, usando a [API da WATI](https://docs.wati.io/reference/introduction).
É um app separado dentro do repositório (React + Vite no front, uma função serverless como proxy da WATI).

## O que tem

- Login com **ID da conta WATI + e-mail + senha**
- **Três canais: WhatsApp, Instagram e Messenger.** Os ícones ficam numa barra à esquerda no desktop e em abas embaixo no celular, e o clique troca a lista para aquele canal. Só ficam ativos os canais conectados na WATI (`GET /api/ext/v3/channels`)
- Lista de conversas com busca, filtros (não lidas, minhas, na fila, resolvidas) e filtro por departamento
- Chat com balões, ticks de entrega/leitura, imagens, áudio, vídeo e documentos, responder mensagem, emojis, anexos (até 3 MB)
- **Departamentos por usuário**: o atendente só vê as conversas dos próprios departamentos (e a triagem, se `ZAP_ATENDENTE_VE_SEM_DEPARTAMENTO=true`). O admin vê tudo
- Assumir, transferir (departamento e/ou atendente), soltar para a fila, marcar como resolvida/pendente. As atribuições são repassadas à WATI (`assignOperator`, `assignTeam`, status)
- **Respostas rápidas**: digite `/` no campo ou use o botão ⚡. Aceitam variáveis `{{nome}}`, `{{primeiro_nome}}`, `{{atendente}}` e `{{telefone}}`, e podem ser globais ou de um departamento
- Templates aprovados, com preenchimento de variáveis, para quando a janela de 24h estiver fechada
- Temas: sistema, claro ou escuro; 6 cores de destaque; papel de parede; tamanho do texto; Enter envia; som e notificações
- Responsivo: moldura centralizada em telas grandes, colunas que se ajustam em notebook e tablet, uma coluna com abas no celular. Botões de 44px em telas de toque e respeito às bordas do iPhone (notch e barra inferior)
- Mensagem que não sai fica no chat, marcada em vermelho, com o motivo explicado e as ações **Tentar de novo**, **Descartar** ou **Enviar template** quando a janela de 24h fechou. Os erros da WATI são traduzidos (janela de 24h, número inválido, limite de requisições, token, arquivo, bloqueio)

## Como rodar localmente

1. Rode [`supabase/schema.sql`](supabase/schema.sql) no SQL Editor do Supabase. Pode ser o mesmo projeto do EmerLAB, porque as tabelas usam o prefixo `zap_`.
2. Copie as chaves de [`.env.example`](.env.example) para um `.env.local`, nesta pasta ou na raiz do repositório, e preencha.
3. Instale e suba o painel:
   ```bash
   cd zap-emerlab
   npm install
   npm run dev        # API em :3001 + Vite em http://localhost:5174
   ```
4. Entre com `WATI_TENANT_ID`, `ZAP_ADMIN_EMAIL` e `ZAP_ADMIN_SENHA`. Depois cadastre departamentos, usuários e respostas rápidas em **⋮ → Administração**.

## Sobre o login "da WATI"

A API pública da WATI autentica só por **token Bearer**. Ela não tem endpoint para validar o e-mail e a senha de um operador. Por isso o painel funciona assim:

- **ID** é o tenant da WATI e precisa ser igual a `WATI_TENANT_ID`.
- **E-mail** deve ser o mesmo e-mail do operador na WATI. É ele que vai no `assignOperator`, então as atribuições aparecem certas no painel da WATI.
- **Senha** é própria do painel e fica guardada com hash scrypt no Supabase. O admin define a senha ao criar o usuário, e cada pessoa pode trocar a sua em Configurações → Conta.

O token da WATI e a service role do Supabase ficam **só no servidor**.

## Instagram e Messenger

- Os contatos vêm de `GET /api/ext/v3/contacts` (campo `channel_type`). O painel identifica essas conversas como `ig:<contactId>` e `ms:<contactId>` e usa o ContactId como destino nos endpoints v1, que aceitam número, ContactId ou BSUID.
- Esses canais não têm templates. Depois de 24h sem mensagem do cliente, a resposta só fica liberada quando ele escrever de novo, e o painel avisa isso.
- O webhook do painel trata só eventos do WhatsApp. No Instagram e no Messenger a lista atualiza por polling, sem contador de não lidas.

## Webhook (recomendado)

Sem webhook, o painel funciona por polling: a lista atualiza a cada 10 s e o chat aberto a cada 5 s. O contador de **não lidas** e a prévia da última mensagem, porém, dependem do webhook. Na WATI, em Webhooks, cadastre *Message Received* e *Session Message Sent* apontando para:

```
https://SEU-DOMINIO/api/webhook?token=<ZAP_WEBHOOK_SECRET>
```

## Deploy (Vercel)

Crie um projeto novo na Vercel com **Root Directory = `zap-emerlab`** e cadastre as variáveis do `.env.example`. O [`vercel.json`](vercel.json) já reescreve `/api/*` para uma única função (`api/zap.js`), então o painel não consome o limite de funções do projeto principal.

## Estrutura

```
zap-emerlab/
├─ api/zap.js            função serverless (entrada única)
├─ server/
│  ├─ router.js          rotas, permissões por departamento, webhook
│  ├─ wati.js            cliente da API WATI (v1 + v3) com cache curto
│  ├─ db.js              Supabase (service role)
│  ├─ crypto.js          hash de senha e cookie de sessão assinado
│  └─ env.js             variáveis de ambiente
├─ scripts/dev-server.mjs
├─ supabase/schema.sql
└─ src/                  React (Painel, Chat, Composer, Admin, Configurações…)
```
