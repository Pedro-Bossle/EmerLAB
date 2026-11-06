-- Setores de acesso: presets de permissões por setor (Credenciamento, Vendas, Financeiro, Comercial, Gerenciamento…)
-- e o vínculo do usuário a um ou mais setores.
--
-- - public.setores_acesso: uma linha por setor com o mapa de permissões (ACL) do preset. Os setores padrão existem
--   no código mesmo sem linha aqui; a linha só é criada quando alguém edita o setor na tela de acessos.
-- - public.profiles.setores: ids dos setores vinculados ao usuário (jsonb, lista de texto). É só um rótulo/ponto de
--   partida: as permissões reais continuam em profiles.permissions.
--
-- Escrita somente pela API administrativa (service role, exige gerenciar acessos). Leitura para usuários logados.

begin;

create table if not exists public.setores_acesso (
  id          text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  nome        text not null check (length(btrim(nome)) > 0),
  descricao   text not null default '',
  permissions jsonb not null default '{}'::jsonb,
  ordem       integer not null default 99,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);

alter table public.setores_acesso enable row level security;

drop policy if exists setores_acesso_select_logados on public.setores_acesso;
create policy setores_acesso_select_logados
  on public.setores_acesso
  for select
  to authenticated
  using (true);

-- sem políticas de insert/update/delete: só o service role (API) escreve
revoke all on table public.setores_acesso from anon;
revoke insert, update, delete on table public.setores_acesso from authenticated;
grant select on table public.setores_acesso to authenticated;

alter table public.profiles
  add column if not exists setores jsonb not null default '[]'::jsonb;

commit;
