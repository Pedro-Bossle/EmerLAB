-- Rode no SQL Editor do Supabase (idempotente). Também já está em schema.sql.
-- Mudança: a mensagem do cliente não sobrescreve mais o nome já gravado (ficha da WATI) com o apelido do WhatsApp.

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
    insert into zap_conversas (wa_id, nome, ultima_msg, ultima_msg_em, ultima_msg_minha, ultima_cliente_em, nao_lidas, status)
    values (p_wa_id, p_nome, p_texto, p_em, p_minha, case when p_minha then null else p_em end, case when p_minha then 0 else 1 end, 'aberta')
    on conflict (wa_id) do update set
        -- o nome do WhatsApp (senderName) só entra se ainda não há nome: não pode apagar o Nome da ficha da WATI
        nome = coalesce(nullif(zap_conversas.nome, ''), excluded.nome),
        ultima_msg = excluded.ultima_msg,
        ultima_msg_em = excluded.ultima_msg_em,
        ultima_msg_minha = excluded.ultima_msg_minha,
        ultima_cliente_em = case when p_minha then zap_conversas.ultima_cliente_em else greatest(zap_conversas.ultima_cliente_em, p_em) end,
        nao_lidas = case when p_minha then zap_conversas.nao_lidas else zap_conversas.nao_lidas + 1 end,
        -- cliente escreveu numa conversa resolvida → reabre
        status = case when p_minha then zap_conversas.status else 'aberta' end,
        atualizado_em = now();
end;
$$;

revoke all on function public.zap_registrar_mensagem(text, text, text, timestamptz, boolean) from public, anon, authenticated;
