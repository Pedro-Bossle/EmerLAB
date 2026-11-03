-- Repasse mensal (docs/repasse-mensal.md §7). SOMENTE objetos novos:
--   * nenhuma coluna é adicionada a pagamentos_registros;
--   * nenhum UPDATE/DELETE em dados existentes (sem backfill).
-- O prestador nunca acessa o banco: lê/escreve só pela API (service role, que ignora RLS) filtrando pelo token.
-- Leitura: quem tem permissão de ver Pagamentos. Escrita: quem edita Pagamentos (mesmo padrão do RLS por permissão).
-- Reversão: supabase/migrations/rollback/20261103120000_repasse_mensal_rollback.sql

create table if not exists public.repasse_config (
  id smallint primary key default 1 check (id = 1),
  email_reprovacoes text not null default 'pedro@emerdog.com.br',
  whatsapp_financeiro text not null default '555499041695',
  validade_link_dias int not null default 60 check (validade_link_dias between 1 and 365),
  remetente_nome text not null default 'Emerdog Financeiro',
  competencia_inicial text not null default '2026-10' check (competencia_inicial ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  atualizado_em timestamptz not null default now()
);
insert into public.repasse_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.repasse_envios (
  id uuid primary key default gen_random_uuid(),
  criado_por uuid,
  assunto text not null,
  corpo text not null,
  modo text not null check (modo in ('agora', 'periodo')),
  janela_inicio timestamptz,
  janela_fim timestamptz,
  ordem text check (ordem in ('aleatoria', 'iguais')),
  total int not null default 0,
  criado_em timestamptz not null default now()
);

create table if not exists public.repasse_relatorios (
  id uuid primary key default gen_random_uuid(),
  registro_id uuid not null unique references public.pagamentos_registros (id) on delete cascade,
  prestador_id bigint,
  mes smallint not null,
  ano smallint not null,
  periodo_inicio date,
  periodo_fim date,
  arquivo_origem text,
  aba_nome text,
  nome_a1 text,
  dados jsonb not null default '{}'::jsonb,
  total_repasse numeric(12, 2) not null default 0,
  total_tutor numeric(12, 2) not null default 0,
  soma_linhas_repasse numeric(12, 2) not null default 0,
  divergente boolean not null default false,
  fluxo text not null default 'automatico' check (fluxo in ('automatico', 'laboratorio_manual')),
  status text not null default 'nao_enviado' check (status in (
    'nao_enviado', 'agendado', 'enviado', 'visualizado', 'aprovado',
    'documento_em_revisao', 'documento_devolvido', 'reprovado', 'tratado')),
  token_versao int not null default 1,
  token_hash text unique,
  token_expira_em timestamptz,
  token_revogado_em timestamptz,
  envio_id uuid references public.repasse_envios (id) on delete set null,
  agendado_para timestamptz,
  enviado_em timestamptz,
  visualizado_em timestamptz,
  respondido_em timestamptz,
  resend_email_id text,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists repasse_relatorios_competencia_idx on public.repasse_relatorios (ano, mes);
create index if not exists repasse_relatorios_status_idx on public.repasse_relatorios (status);

create table if not exists public.repasse_documentos (
  id uuid primary key default gen_random_uuid(),
  relatorio_id uuid not null references public.repasse_relatorios (id) on delete cascade,
  tipo text not null check (tipo in ('nota', 'boleto')),
  storage_path text not null,
  numero text,
  vencimento date,
  valor numeric(12, 2),
  status text not null default 'em_revisao' check (status in ('em_revisao', 'aprovado', 'devolvido')),
  motivo_devolucao text,
  revisado_por uuid,
  revisado_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists repasse_documentos_relatorio_idx on public.repasse_documentos (relatorio_id);

create table if not exists public.repasse_comprovantes (
  id uuid primary key default gen_random_uuid(),
  relatorio_id uuid not null references public.repasse_relatorios (id) on delete cascade,
  registro_id uuid not null,
  forma text not null check (forma in ('pix', 'boleto')),
  storage_path text not null,
  data_pagamento date not null,
  valor numeric(12, 2) not null,
  enviado_em timestamptz not null default now(),
  enviado_por uuid,
  resend_email_id text
);
create index if not exists repasse_comprovantes_relatorio_idx on public.repasse_comprovantes (relatorio_id);

create table if not exists public.repasse_eventos (
  id uuid primary key default gen_random_uuid(),
  relatorio_id uuid not null references public.repasse_relatorios (id) on delete cascade,
  tipo text not null,
  dados jsonb not null default '{}'::jsonb,
  autor text not null default 'sistema',
  ip_hash text,
  criado_em timestamptz not null default now()
);
create index if not exists repasse_eventos_relatorio_idx on public.repasse_eventos (relatorio_id, criado_em desc);

-- RLS: anon sem acesso; authenticated lê com pagamentos.view e escreve com pagamentos.edit.
do $$
declare
  t text;
begin
  foreach t in array array['repasse_config', 'repasse_envios', 'repasse_relatorios', 'repasse_documentos',
                           'repasse_comprovantes', 'repasse_eventos']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_leitura', t);
    execute format('drop policy if exists %I on public.%I', t || '_escrita', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.emer_tem_permissao(array[%L, %L, %L, %L]))',
      t || '_leitura', t, 'pagamentos.view', 'pagamentos.registro.read', 'pagamentos.edit', 'access.manage');
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.emer_tem_permissao(array[%L, %L, %L, %L])) with check (public.emer_tem_permissao(array[%L, %L, %L, %L]))',
      t || '_escrita', t,
      'pagamentos.edit', 'pagamentos.registro.update', 'pagamentos.registro.create', 'access.manage',
      'pagamentos.edit', 'pagamentos.registro.update', 'pagamentos.registro.create', 'access.manage');
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Dados sensíveis (tutores/pets) e tokens: configuração só admin altera.
drop policy if exists repasse_config_escrita on public.repasse_config;
create policy repasse_config_escrita on public.repasse_config for all to authenticated
  using (public.emer_tem_permissao(array['access.manage']))
  with check (public.emer_tem_permissao(array['access.manage']));

-- Bucket privado (acesso só por URL assinada gerada pela API).
insert into storage.buckets (id, name, public, file_size_limit)
values ('repasse-documentos', 'repasse-documentos', false, 10485760)
on conflict (id) do nothing;
