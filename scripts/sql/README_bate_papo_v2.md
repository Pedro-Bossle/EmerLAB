# Emerzap v2 (SQL)

Execute `home_bate_papo_v2.sql` no SQL Editor do Supabase **depois** de `home_bate_papo.sql`.

## E2EE (MVP)

- Texto e imagens: AES-GCM no cliente; o servidor guarda só ciphertext.
- Par RSA-OAEP por dispositivo: privada em `localStorage`, pública em `home_bate_papo_user_keys`.
- Cada conversa tem uma chave AES envolvida por participante (`chave_conversa_envolvida`).
- **Sem sync multi-dispositivo:** novo browser gera novo par; o admin/criador precisa reabrir a conversa (ou o fluxo de provisionamento) para re-envolver a chave para quem ainda está em `legado:pending`.
- Histórico migrado de DMs fica em `corpo_legado` (`cipher_version = 0`) até haver re-encrypt oportunista.

## Storage

Bucket privado `bate-papo-anexos`, path `{conversa_id}/{msg_id}.bin`.
