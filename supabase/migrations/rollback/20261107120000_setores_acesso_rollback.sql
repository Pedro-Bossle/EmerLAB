-- Rollback de 20261107120000_setores_acesso.sql
-- Remove a tabela de setores e a coluna profiles.setores (os vínculos de setor se perdem; as permissões não).

begin;

drop table if exists public.setores_acesso;
alter table public.profiles drop column if exists setores;

commit;
