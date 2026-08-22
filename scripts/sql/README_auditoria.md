# SQL — Auditoria + credenciado_em

Execute no **SQL Editor** do Supabase (projeto de produção/staging), nesta ordem:

1. `scripts/sql/audit_logs_e_credenciado_em.sql` — cria `audit_logs`, coluna `prestadores.credenciado_em`, função `fn_audit_row`, triggers nas tabelas críticas (incluindo **UPDATE** em `repasses`) e backfill de credenciados.
2. `scripts/sql/audit_logs_repasses_update.sql` — patch focado só em `repasses` (útil se o script completo já rodou antes sem UPDATE).
3. `scripts/sql/audit_logs_retencao_45_dias.sql` — cada entrada de `audit_logs` expira **45 dias após a própria `data_hora`**; cria `limpar_audit_logs_expirados(45)` e tenta agendar limpeza diária via `pg_cron`.

Isso cria / garante:

- coluna `prestadores.credenciado_em`
- tabela `audit_logs` (somente leitura para autenticados; sem update/delete pelo cliente)
- triggers de auditoria nas tabelas críticas
- trigger que preenche `credenciado_em` ao passar para situação Credenciado (id=4)
- backfill para quem já está credenciado
- **UPDATE de valores** em `repasses` (SuperTabela)
- **retenção 45 dias** por item (`data_hora` + 45 dias)

Sem o script base, a tela **Administrativo → Auditoria** abre com aviso de tabela não configurada. Sem o patch de UPDATE em `repasses`, o preset **Valores** só mostra CREATE/DELETE.

### Retenção (45 dias)

```sql
-- Manual
select public.limpar_audit_logs_expirados(45);

-- Job esperado: limpar-audit-logs-45d (diário ~04:15 UTC)
select * from cron.job where jobname = 'limpar-audit-logs-45d';
```

Se `pg_cron` não estiver disponível no plano, rode a função periodicamente (SQL Editor ou Edge Function com service role).
