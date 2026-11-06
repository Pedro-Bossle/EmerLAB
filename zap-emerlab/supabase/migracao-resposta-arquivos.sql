-- Rode no SQL Editor do Supabase (idempotente). Também está no fim de schema.sql.

-- Arquivos vinculados às respostas rápidas (enviados junto com o texto, que vai de legenda).
-- O conteúdo fica em base64 na própria tabela (máx. 3 MB por arquivo e 3 arquivos por resposta, validado no servidor);
-- a listagem nunca seleciona a coluna `conteudo`.
create table if not exists public.zap_respostas_arquivos (
    id uuid primary key default gen_random_uuid(),
    resposta_id uuid not null references public.zap_respostas_rapidas(id) on delete cascade,
    nome text not null,
    mime text,
    tamanho integer not null,
    conteudo text not null,
    ordem integer not null default 0,
    criado_em timestamptz not null default now()
);
create index if not exists zap_respostas_arquivos_resposta_idx on public.zap_respostas_arquivos (resposta_id, ordem);
alter table public.zap_respostas_arquivos enable row level security;
