-- Reversão de 20261110130000_repasse_comprovantes_relatorio_nullable.sql.
-- Falha de propósito se já houver comprovante sem relatório (gravado pela API). Antes de reverter, confira:
--   select id, registro_id, storage_path from public.repasse_comprovantes where relatorio_id is null;
-- e decida com o financeiro o que fazer com essas linhas (não apagar sem autorização: são comprovantes de pagamento).

alter table public.repasse_comprovantes alter column relatorio_id set not null;
