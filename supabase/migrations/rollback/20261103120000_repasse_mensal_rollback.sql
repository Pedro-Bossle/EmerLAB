-- Reverte 20261103120000_repasse_mensal.sql. Só remove objetos criados por ela (nada de pagamentos_registros).
drop table if exists public.repasse_eventos;
drop table if exists public.repasse_comprovantes;
drop table if exists public.repasse_documentos;
drop table if exists public.repasse_relatorios;
drop table if exists public.repasse_envios;
drop table if exists public.repasse_config;
-- O bucket 'repasse-documentos' deve ser esvaziado e removido pelo painel do Storage.
