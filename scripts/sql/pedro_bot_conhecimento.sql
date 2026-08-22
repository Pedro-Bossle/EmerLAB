-- Pedro Bot — blocos editáveis da base de conhecimento.
-- Execute no SQL Editor do Supabase.

create table if not exists public.pedro_bot_conhecimento (
  id uuid primary key default gen_random_uuid(),
  categoria text not null default 'geral',
  titulo text not null default '',
  corpo text not null default '',
  activo boolean not null default true,
  updated_at timestamptz not null default now()
);

comment on table public.pedro_bot_conhecimento is
  'Blocos extra do Pedro Bot (onboarding). Concatenados ao seed estático no servidor.';

create index if not exists pedro_bot_conhecimento_activo_idx
  on public.pedro_bot_conhecimento (activo, titulo);

alter table public.pedro_bot_conhecimento enable row level security;

drop policy if exists pedro_bot_conhecimento_select_auth on public.pedro_bot_conhecimento;
create policy pedro_bot_conhecimento_select_auth
  on public.pedro_bot_conhecimento
  for select
  to authenticated
  using (true);

-- Escrita na app passa pela API com service role; políticas de insert/update/delete
-- para authenticated ficam desligadas de propósito.
