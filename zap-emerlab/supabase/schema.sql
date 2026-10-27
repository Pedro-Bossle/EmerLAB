-- zap.emerlab — schema (rode no SQL Editor do Supabase)
-- Todas as tabelas ficam com RLS ligado e SEM policies: só a service role
-- (usada pelo servidor do painel) lê/escreve. O navegador nunca acessa direto.

create extension if not exists pgcrypto;

create table if not exists public.zap_departamentos (
    id uuid primary key default gen_random_uuid(),
    nome text not null unique,
    cor text not null default '#25d366',
    -- Nome da equipe (team) correspondente na WATI. Se preenchido, ao transferir
    -- a conversa o painel também chama /assignTeam na WATI (plano Pro).
    equipe_wati text,
    criado_em timestamptz not null default now()
);

create table if not exists public.zap_usuarios (
    id uuid primary key default gen_random_uuid(),
    nome text not null,
    -- Mesmo e-mail do operador na WATI (usado no assignOperator)
    email text not null unique,
    senha_hash text not null,
    papel text not null default 'atendente' check (papel in ('admin', 'atendente')),
    ativo boolean not null default true,
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now()
);

create table if not exists public.zap_usuario_departamentos (
    usuario_id uuid not null references public.zap_usuarios(id) on delete cascade,
    departamento_id uuid not null references public.zap_departamentos(id) on delete cascade,
    primary key (usuario_id, departamento_id)
);

create table if not exists public.zap_respostas_rapidas (
    id uuid primary key default gen_random_uuid(),
    atalho text not null,
    titulo text,
    texto text not null,
    -- null = disponível para todos os departamentos
    departamento_id uuid references public.zap_departamentos(id) on delete cascade,
    criado_em timestamptz not null default now()
);
create index if not exists zap_respostas_rapidas_depto_idx on public.zap_respostas_rapidas (departamento_id);
-- Regras de relevância (texto "chave {valor}", ver src/regras.js): as que batem com o contato aparecem primeiro
alter table public.zap_respostas_rapidas add column if not exists regras text;
-- Vários departamentos por resposta (vazio = todos). departamento_id fica só quando há exatamente um,
-- para a importação por planilha e o "on delete cascade" continuarem como antes.
alter table public.zap_respostas_rapidas add column if not exists departamento_ids uuid[] not null default '{}';
update public.zap_respostas_rapidas set departamento_ids = array[departamento_id]
    where departamento_id is not null and departamento_ids = '{}';
create index if not exists zap_respostas_rapidas_deptos_idx on public.zap_respostas_rapidas using gin (departamento_ids);

-- Metadados por conversa (chave = número WhatsApp com DDI, só dígitos)
create table if not exists public.zap_conversas (
    wa_id text primary key,
    nome text,
    departamento_id uuid references public.zap_departamentos(id) on delete set null,
    atendente_email text,
    status text not null default 'aberta' check (status in ('aberta', 'pendente', 'resolvida')),
    ultima_msg text,
    ultima_msg_em timestamptz,
    ultima_msg_minha boolean,
    nao_lidas integer not null default 0,
    atualizado_em timestamptz not null default now()
);
-- Perfil do contato editado no painel (dados que ficam só aqui; o resto vai em atributos da WATI)
alter table public.zap_conversas add column if not exists email text;
alter table public.zap_conversas add column if not exists tags text[] not null default '{}';
alter table public.zap_conversas add column if not exists notas text;
create index if not exists zap_conversas_depto_idx on public.zap_conversas (departamento_id);
create index if not exists zap_conversas_ultima_idx on public.zap_conversas (ultima_msg_em desc);

-- Nome original dos arquivos enviados pelo painel: a WATI guarda cada arquivo com um nome aleatório (UUID).
-- arquivo = caminho na WATI, quando a resposta do envio traz; senão é ligado à mensagem pelo horário.
create table if not exists public.zap_arquivos (
    id bigserial primary key,
    wa_id text not null,
    nome text not null,
    arquivo text,
    enviado_em timestamptz not null default now()
);
create index if not exists zap_arquivos_wa_idx on public.zap_arquivos (wa_id, enviado_em desc);
alter table public.zap_arquivos enable row level security;

-- ID do WhatsApp (wamid) de cada mensagem, que só chega pelo webhook: o getMessages da WATI devolve
-- whatsappMessageId vazio, e sem ele não dá para responder citando a mensagem (replyContextId)
create table if not exists public.zap_mensagens_wamid (
    id text primary key,
    wa_id text not null,
    wamid text not null,
    em timestamptz not null,
    minha boolean not null default false
);
create index if not exists zap_mensagens_wamid_wa_idx on public.zap_mensagens_wamid (wa_id, em desc);
alter table public.zap_mensagens_wamid enable row level security;

alter table public.zap_departamentos enable row level security;
alter table public.zap_usuarios enable row level security;
alter table public.zap_usuario_departamentos enable row level security;
alter table public.zap_respostas_rapidas enable row level security;
alter table public.zap_conversas enable row level security;

-- Registro atômico de mensagem vinda do webhook (incrementa não lidas)
create or replace function public.zap_registrar_mensagem(
    p_wa_id text,
    p_nome text,
    p_texto text,
    p_em timestamptz,
    p_minha boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into zap_conversas (wa_id, nome, ultima_msg, ultima_msg_em, ultima_msg_minha, nao_lidas, status)
    values (p_wa_id, p_nome, p_texto, p_em, p_minha, case when p_minha then 0 else 1 end, 'aberta')
    on conflict (wa_id) do update set
        nome = coalesce(excluded.nome, zap_conversas.nome),
        ultima_msg = excluded.ultima_msg,
        ultima_msg_em = excluded.ultima_msg_em,
        ultima_msg_minha = excluded.ultima_msg_minha,
        nao_lidas = case when p_minha then zap_conversas.nao_lidas else zap_conversas.nao_lidas + 1 end,
        -- cliente escreveu numa conversa resolvida → reabre
        status = case when p_minha then zap_conversas.status else 'aberta' end,
        atualizado_em = now();
end;
$$;

revoke all on function public.zap_registrar_mensagem(text, text, text, timestamptz, boolean) from public, anon, authenticated;
