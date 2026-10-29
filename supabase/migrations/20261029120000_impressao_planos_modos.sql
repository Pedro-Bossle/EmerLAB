-- Modo compartilhado de impressão de planos: procedimentos marcados por plano+cidade.

create table if not exists public.impressao_planos_modos (
  id bigint generated always as identity primary key,
  plano_id integer not null references public.planos (id) on delete cascade,
  cidade_id integer not null references public.cidades (id) on delete cascade,
  selecao jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.profiles (id) on delete set null,
  constraint impressao_planos_modos_plano_cidade_uq unique (plano_id, cidade_id)
);

comment on table public.impressao_planos_modos is
  'Último modo de impressão (procedimentos marcados) por plano+cidade, compartilhado pela equipe.';

create index if not exists impressao_planos_modos_atualizado_em_idx
  on public.impressao_planos_modos (atualizado_em desc);

alter table public.impressao_planos_modos enable row level security;

-- Leitura: qualquer logado (a tela já exige planos.impressao).
drop policy if exists impressao_planos_modos_leitura_logado on public.impressao_planos_modos;
create policy impressao_planos_modos_leitura_logado
  on public.impressao_planos_modos
  for select
  to authenticated
  using (true);

-- Escrita: permissão de planos (create/update) ou legado planos.view / access.manage / dev.tools.
drop policy if exists impressao_planos_modos_insert_permissao on public.impressao_planos_modos;
create policy impressao_planos_modos_insert_permissao
  on public.impressao_planos_modos
  for insert
  to authenticated
  with check (
    (select public.emer_pode_escrever_modulo(
      array['planos.']::text[],
      array['planos.view']::text[]
    ))
  );

drop policy if exists impressao_planos_modos_update_permissao on public.impressao_planos_modos;
create policy impressao_planos_modos_update_permissao
  on public.impressao_planos_modos
  for update
  to authenticated
  using (
    (select public.emer_pode_escrever_modulo(
      array['planos.']::text[],
      array['planos.view']::text[]
    ))
  )
  with check (
    (select public.emer_pode_escrever_modulo(
      array['planos.']::text[],
      array['planos.view']::text[]
    ))
  );

drop policy if exists impressao_planos_modos_delete_permissao on public.impressao_planos_modos;
create policy impressao_planos_modos_delete_permissao
  on public.impressao_planos_modos
  for delete
  to authenticated
  using (
    (select public.emer_pode_escrever_modulo(
      array['planos.']::text[],
      array['planos.view']::text[]
    ))
  );

grant select, insert, update, delete on public.impressao_planos_modos to authenticated;
grant usage, select on sequence public.impressao_planos_modos_id_seq to authenticated;
