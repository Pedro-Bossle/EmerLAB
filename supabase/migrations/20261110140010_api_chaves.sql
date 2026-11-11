-- Chaves da API pública /api/v1 (rede credenciada e pagamentos).
-- Só o servidor (service role) acessa; a chave completa nunca é armazenada, apenas o hash SHA-256.
create table if not exists public.api_chaves (
    id uuid primary key default gen_random_uuid(),
    nome text not null,
    prefixo text not null,
    hash text not null unique,
    escopos text[] not null default '{}',
    origens_permitidas text[] not null default '{}',
    limite_por_minuto integer not null default 120 check (limite_por_minuto > 0),
    ips_permitidos text[] not null default '{}',
    criada_em timestamptz not null default now(),
    criada_por uuid,
    expira_em timestamptz,
    revogada_em timestamptz,
    ultimo_uso_em timestamptz,
    constraint api_chaves_escopos_validos check (
        escopos <@ array['rede:ler', 'pagamentos:ler', 'pagamentos:escrever']::text[]
    ),
    constraint api_chaves_rede_exige_origem check (
        not ('rede:ler' = any (escopos)) or cardinality(origens_permitidas) > 0
    )
);

alter table public.api_chaves enable row level security;

revoke all on table public.api_chaves from anon, authenticated;
