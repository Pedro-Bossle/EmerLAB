# Emerzap v2 (SQL)

Execute `home_bate_papo_v2.sql` no SQL Editor do Supabase **depois** de `home_bate_papo.sql`.

## E2EE

- Texto e imagens: AES-GCM no cliente; o servidor guarda só ciphertext.
- Par RSA-OAEP **por utilizador** (não por dispositivo): pública em `home_bate_papo_user_keys.public_jwk`.
- Privada sincronizada: `priv_cipher` (AES-GCM + PBKDF2 com **senha da chave**). No aparelho novo, desbloqueia com a mesma senha.
- Cada conversa tem uma chave AES envolvida por participante (`chave_conversa_envolvida`).
- Histórico migrado de DMs fica em `corpo_legado` (`cipher_version = 0`) até haver re-encrypt oportunista.

## Multi-dispositivo (obrigatório)

Execute no Supabase:

1. `home_bate_papo_chave_conta.sql` — colunas `priv_cipher`, `chave_reset_pedido_em` + view (`security_invoker`) + RPC de públicas.
2. Se o Advisor marcar a view como SECURITY DEFINER: `home_bate_papo_view_security_invoker.sql`.
2. No primeiro uso: o modal de **senha da chave** é obrigatório (não dá para saltar).
3. Noutro aparelho: a mesma senha desbloqueia o histórico.

### Admin — redefinir senha Emerzap

Em **Administrativo → Gerenciamento de Acessos → Conta** do utilizador: botão **Redefinir senha Emerzap**.
Isto limpa `priv_cipher`, marca `chave_reset_pedido_em` e o utilizador vê o modal obrigatório ao abrir o Emerzap.

## RLS (fixes)

Se criar conversa, listar membros ou sincronizar chaves E2EE falhar, execute no Supabase:

1. `home_bate_papo_v2_rls_fix_select.sql` — SELECT na criação, ver participantes, e UPDATE da chave envolvida por qualquer membro (re-envelope).

## Recuperar «Mensagem indisponível» / chave pendente

1. Correr os SQL acima (se ainda não correu).
2. Garantir que a **senha da chave** está configurada e desbloqueada neste aparelho.
3. Um participante que **já consegue** ler deve manter o chat aberto (re-envelope automático).
4. O utilizador afetado abre a mesma conversa — a sincronização é automática (realtime + retry).


## Storage

Bucket privado `bate-papo-anexos`, path `{conversa_id}/{msg_id}.bin`.
