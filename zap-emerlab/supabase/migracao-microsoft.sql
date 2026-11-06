-- Rode no SQL Editor do Supabase (idempotente). Também está no fim de schema.sql.

-- ===== Microsoft (Outlook e Teams): contas conectadas e assinaturas de webhook =====
-- usuario_id é texto (e não FK) porque o admin do .env não tem linha em zap_usuarios.
-- Nenhum e-mail nem mensagem é guardado: o webhook só avisa "mudou" e o conteúdo vem do Graph na hora.
create table if not exists public.zap_ms_contas (
    usuario_id text primary key,
    ms_id text not null,
    email text,
    nome text,
    -- refresh token cifrado (AES-256-GCM, ver server/crypto.js); nunca em texto puro
    refresh_token text not null,
    escopos text,
    status text not null default 'ok' check (status in ('ok', 'reconectar')),
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now()
);

create table if not exists public.zap_ms_assinaturas (
    id text primary key, -- id da assinatura no Graph
    usuario_id text not null references public.zap_ms_contas(usuario_id) on delete cascade,
    recurso text not null,
    tipo text not null check (tipo in ('email', 'canal')),
    client_state text not null,
    expira_em timestamptz not null,
    erro text,
    criado_em timestamptz not null default now(),
    unique (usuario_id, recurso)
);
create index if not exists zap_ms_assinaturas_usuario_idx on public.zap_ms_assinaturas (usuario_id);

alter table public.zap_ms_contas enable row level security;
alter table public.zap_ms_assinaturas enable row level security;
