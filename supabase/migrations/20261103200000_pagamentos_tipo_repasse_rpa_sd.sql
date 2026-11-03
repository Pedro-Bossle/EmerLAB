-- Novo tipo de repasse «rpa_sd» (RPA sem o desconto de 11%): só uso interno, definido no perfil do prestador.
-- A constraint antiga aceitava apenas rpa | nota | boleto e barrava o registro de pagamentos desses prestadores.
-- Só amplia a lista de valores aceitos; nenhum dado existente é alterado.
-- Reversão: supabase/migrations/rollback/20261103200000_pagamentos_tipo_repasse_rpa_sd_rollback.sql

alter table public.pagamentos_registros
  drop constraint if exists pagamentos_registros_tipo_repasse_check;

alter table public.pagamentos_registros
  add constraint pagamentos_registros_tipo_repasse_check
  check (tipo_repasse is null or tipo_repasse = any (array['rpa'::text, 'rpa_sd'::text, 'nota'::text, 'boleto'::text]));
