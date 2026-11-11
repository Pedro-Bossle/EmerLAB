-- PENDENTE: NÃO aplicada no banco. Aguardando revisão. Para aplicar, mover para supabase/migrations/ (o rollback fica em rollback/).
-- API pública de pagamentos (docs/api/especificacao-design.md, seção 7): comprovante de registro SEM relatório de
-- repasse fica ligado só ao registro (registro_id) e com relatorio_id nulo. Hoje a coluna é NOT NULL (conferido em
-- 10/11/2026 por information_schema), então a API devolve 409 registro_sem_relatorio nesse caso até esta migração entrar.
-- A chave estrangeira para repasse_relatorios (on delete cascade) continua; ela aceita nulo.
-- repasse_eventos.relatorio_id continua NOT NULL: sem relatório a API grava só em audit_logs.
-- Reversão: 20261110130000_repasse_comprovantes_relatorio_nullable.rollback.sql

alter table public.repasse_comprovantes alter column relatorio_id drop not null;
