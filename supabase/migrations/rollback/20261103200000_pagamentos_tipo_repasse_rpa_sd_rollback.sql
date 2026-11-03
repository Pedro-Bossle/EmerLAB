-- Reverte 20261103200000_pagamentos_tipo_repasse_rpa_sd.sql.
-- ATENÇÃO: registros com tipo_repasse = 'rpa_sd' impediriam a volta da constraint antiga. Eles passam a 'rpa'
-- (o que, na prática, reativa o desconto de 11% para esses prestadores).

update public.pagamentos_registros set tipo_repasse = 'rpa' where tipo_repasse = 'rpa_sd';

alter table public.pagamentos_registros
  drop constraint if exists pagamentos_registros_tipo_repasse_check;

alter table public.pagamentos_registros
  add constraint pagamentos_registros_tipo_repasse_check
  check (tipo_repasse is null or tipo_repasse = any (array['rpa'::text, 'nota'::text, 'boleto'::text]));
