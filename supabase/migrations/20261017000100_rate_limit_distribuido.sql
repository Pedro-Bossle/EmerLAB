-- Rate limit compartilhado entre instâncias serverless (auditoria S-10).
-- Janela fixa por chave; só o service role (APIs em /api) consegue chamar.

begin;

create table if not exists public.api_rate_limit (
  chave text not null,
  janela_inicio timestamptz not null,
  contagem integer not null default 0,
  primary key (chave, janela_inicio)
);

alter table public.api_rate_limit enable row level security;
revoke all on table public.api_rate_limit from public, anon, authenticated;

create or replace function public.emer_rate_limit_consumir(p_chave text, p_limite integer, p_janela_seg integer)
returns table (ok boolean, restante integer, retry_after_seg integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inicio timestamptz := to_timestamp(floor(extract(epoch from now()) / p_janela_seg) * p_janela_seg);
  v_contagem integer;
begin
  insert into public.api_rate_limit as r (chave, janela_inicio, contagem)
  values (p_chave, v_inicio, 1)
  on conflict (chave, janela_inicio) do update set contagem = r.contagem + 1
  returning r.contagem into v_contagem;

  -- Limpeza oportunista das janelas antigas (barata: índice da PK).
  if random() < 0.02 then
    delete from public.api_rate_limit where janela_inicio < now() - interval '1 day';
  end if;

  ok := v_contagem <= p_limite;
  restante := greatest(0, p_limite - v_contagem);
  retry_after_seg := case when ok then 0
    else greatest(1, ceil(extract(epoch from (v_inicio + make_interval(secs => p_janela_seg) - now())))::integer) end;
  return next;
end;
$$;

revoke all on function public.emer_rate_limit_consumir(text, integer, integer) from public, anon, authenticated;
grant execute on function public.emer_rate_limit_consumir(text, integer, integer) to service_role;

commit;
