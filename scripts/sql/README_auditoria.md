# SQL — Auditoria + credenciado_em

Execute o script no **SQL Editor** do Supabase (projeto de produção/staging):

`scripts/sql/audit_logs_e_credenciado_em.sql`

Isso cria:

- coluna `prestadores.credenciado_em`
- tabela `audit_logs` (somente leitura para autenticados admin; sem update/delete)
- triggers de auditoria nas tabelas críticas
- trigger que preenche `credenciado_em` ao passar para situação Credenciado
- backfill para quem já está credenciado

Sem esse script, a tela **Administrativo → Auditoria** abre com aviso de tabela não configurada.
