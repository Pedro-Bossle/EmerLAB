-- Endurecimento de RLS e grants (auditoria de 16/10/2026: S-01 a S-06, S-11).
-- Rollback: supabase/migrations/rollback/20261017000000_seguranca_rls_hardening.rollback.sql
--
-- Princípios:
--   * Nenhuma escrita do front em `profiles` (tudo passa por /api/admin-users com service role).
--   * `anon` só alcança o que o formulário público usa: config/páginas/categorias do formulário,
--     insert em formulario_cred_entradas, leitura de cidades/planos/procedimentos/portes/categorias
--     e as RPCs credenciamento_documento_disponivel, credenciamento_listar_especialidades e
--     credenciamento_obter_ou_criar_cidade_credenciamento.
--   * Escritas em pagamentos e prestadores exigem a mesma permissão que a tela exige.

begin;

-- ---------------------------------------------------------------------------
-- Helper: o utilizador atual tem alguma das chaves de permissão (JSON plano)?
-- ---------------------------------------------------------------------------
create or replace function public.emer_tem_permissao(p_chaves text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and exists (select 1 from unnest(p_chaves) k where p.permissions ->> k = 'true')
  );
$$;

revoke all on function public.emer_tem_permissao(text[]) from public, anon;
grant execute on function public.emer_tem_permissao(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- S-01 / S-02: profiles
-- ---------------------------------------------------------------------------
drop policy if exists "Enable read access for all users" on public.profiles;  -- leitura anónima
drop policy if exists profiles_update_own on public.profiles;                 -- anulava a _safe
drop policy if exists profiles_insert_own on public.profiles;                 -- permitia criar perfil já admin
drop policy if exists profiles_select_nome_para_tarefas on public.profiles;   -- duplicada
drop policy if exists profiles_select_own on public.profiles;                 -- coberta por select_authenticated
drop policy if exists read_own_profile on public.profiles;                    -- coberta por select_authenticated

-- Admin: aceita a chave legada e as chaves ACL planas (admin.acessos.update).
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  as permissive for update to authenticated
  using (public.emer_tem_permissao(array['access.manage', 'admin.acessos.update']))
  with check (public.emer_tem_permissao(array['access.manage', 'admin.acessos.update']));

-- Defesa em profundidade: nenhuma sessão de utilizador muda colunas sensíveis,
-- mesmo que alguém recrie uma política permissiva no futuro.
create or replace function public.profiles_bloquear_colunas_sensiveis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- SQL editor / migrações (sem JWT) e service role passam.
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if public.emer_tem_permissao(array['access.manage', 'admin.acessos.update']) then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.permissions is distinct from old.permissions
     or new.force_password_change is distinct from old.force_password_change
     or new.password_changed_at is distinct from old.password_changed_at
     or new.disable_idle_logout is distinct from old.disable_idle_logout then
    raise exception 'Alteração de permissões ou dados de acesso não permitida.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.profiles_bloquear_colunas_sensiveis() from public, anon, authenticated;

drop trigger if exists trg_profiles_bloquear_colunas_sensiveis on public.profiles;
create trigger trg_profiles_bloquear_colunas_sensiveis
  before update on public.profiles
  for each row execute function public.profiles_bloquear_colunas_sensiveis();

-- ---------------------------------------------------------------------------
-- S-03: repasses — sem acesso anónimo
-- ---------------------------------------------------------------------------
drop policy if exists repasses_insert_all on public.repasses;
drop policy if exists repasses_update_all on public.repasses;
drop policy if exists read_all_repasses on public.repasses;
drop policy if exists repasses_read_all on public.repasses;
revoke all on table public.repasses from anon;

-- Grants de anon em tabelas internas sem nenhuma política para anon (RLS já negava; grants
-- removidos para não depender de uma única camada).
revoke all on table public.profiles from anon;
revoke all on table public.pagamentos_registros from anon;
revoke all on table public.prestadores from anon;
revoke update, delete, truncate on table public.formulario_cred_entradas from anon;

-- ---------------------------------------------------------------------------
-- S-04: escrita condicionada à permissão da tela
-- ---------------------------------------------------------------------------
-- Pagamentos: mesma regra de syncLegacyFromAcl (pagamentos.registro create/update/delete).
drop policy if exists pagamentos_registros_auth_insert on public.pagamentos_registros;
drop policy if exists pagamentos_registros_auth_update on public.pagamentos_registros;
drop policy if exists pagamentos_registros_auth_delete on public.pagamentos_registros;

create policy pagamentos_registros_insert_perm on public.pagamentos_registros
  as permissive for insert to authenticated
  with check (public.emer_tem_permissao(array[
    'access.manage', 'pagamentos.edit',
    'pagamentos.registro.create', 'pagamentos.registro.update', 'pagamentos.registro.delete'
  ]));

create policy pagamentos_registros_update_perm on public.pagamentos_registros
  as permissive for update to authenticated
  using (public.emer_tem_permissao(array[
    'access.manage', 'pagamentos.edit',
    'pagamentos.registro.create', 'pagamentos.registro.update', 'pagamentos.registro.delete'
  ]))
  with check (public.emer_tem_permissao(array[
    'access.manage', 'pagamentos.edit',
    'pagamentos.registro.create', 'pagamentos.registro.update', 'pagamentos.registro.delete'
  ]));

-- Exclusão permanente de prestador (Dev Tool) também apaga os pagamentos dele.
create policy pagamentos_registros_delete_perm on public.pagamentos_registros
  as permissive for delete to authenticated
  using (public.emer_tem_permissao(array[
    'access.manage', 'pagamentos.edit',
    'pagamentos.registro.update', 'pagamentos.registro.delete',
    'dev.tools', 'admin.dev_tools.read'
  ]));

-- Prestadores: mesma regra de credenciamento.edit em syncLegacyFromAcl.
drop policy if exists prestadores_insert_auth on public.prestadores;
drop policy if exists prestadores_update_auth on public.prestadores;
drop policy if exists prestadores_delete_auth on public.prestadores;

create policy prestadores_insert_perm on public.prestadores
  as permissive for insert to authenticated
  with check (public.emer_tem_permissao(array[
    'access.manage', 'credenciamento.edit',
    'credenciamento.cadastro.create', 'credenciamento.cadastro.update',
    'credenciamento.especialidades_rc.update', 'credenciamento.formulario_inbox.update',
    'credenciamento.import_kmz.update',
    'credenciamento.prospectos_osm.create', 'credenciamento.prospectos_osm.update',
    'credenciamento.prospectos_osm.delete',
    'credenciamento.processos.create', 'credenciamento.processos.update',
    'configuracoes.importar_credenciados.update'
  ]));

create policy prestadores_update_perm on public.prestadores
  as permissive for update to authenticated
  using (public.emer_tem_permissao(array[
    'access.manage', 'credenciamento.edit',
    'credenciamento.cadastro.create', 'credenciamento.cadastro.update',
    'credenciamento.especialidades_rc.update', 'credenciamento.formulario_inbox.update',
    'credenciamento.import_kmz.update',
    'credenciamento.prospectos_osm.create', 'credenciamento.prospectos_osm.update',
    'credenciamento.prospectos_osm.delete',
    'credenciamento.processos.create', 'credenciamento.processos.update',
    'configuracoes.importar_credenciados.update'
  ]))
  with check (public.emer_tem_permissao(array[
    'access.manage', 'credenciamento.edit',
    'credenciamento.cadastro.create', 'credenciamento.cadastro.update',
    'credenciamento.especialidades_rc.update', 'credenciamento.formulario_inbox.update',
    'credenciamento.import_kmz.update',
    'credenciamento.prospectos_osm.create', 'credenciamento.prospectos_osm.update',
    'credenciamento.prospectos_osm.delete',
    'credenciamento.processos.create', 'credenciamento.processos.update',
    'configuracoes.importar_credenciados.update'
  ]));

create policy prestadores_delete_perm on public.prestadores
  as permissive for delete to authenticated
  using (public.emer_tem_permissao(array[
    'access.manage', 'credenciamento.cadastro.delete', 'dev.tools', 'admin.dev_tools.read'
  ]));

-- ---------------------------------------------------------------------------
-- S-05: auditoria só para quem administra
-- ---------------------------------------------------------------------------
drop policy if exists audit_logs_select_authenticated on public.audit_logs;

-- ---------------------------------------------------------------------------
-- S-06: funções SECURITY DEFINER fora do alcance de anon
-- ---------------------------------------------------------------------------
-- Funções de trigger / event trigger: ninguém chama via RPC.
revoke execute on function public.audit_row_change() from public, anon, authenticated;
revoke execute on function public.fn_audit_row() from public, anon, authenticated;
revoke execute on function public.fn_prestadores_credenciado_em() from public, anon, authenticated;
revoke execute on function public.prestadores_set_credenciado_em() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.limpar_audit_logs_expirados(integer) from public, anon, authenticated;

-- Usadas por utilizadores logados (políticas do chat, Clicksign, migração de DMs).
revoke execute on function public.home_bate_papo_migrar_dms_legado() from public, anon;
revoke execute on function public.home_bate_papo_publicas(uuid[]) from public, anon;
revoke execute on function public.home_bate_papo_sou_admin(uuid) from public, anon;
revoke execute on function public.home_bate_papo_sou_participante(uuid) from public, anon;
revoke execute on function public.usuario_pode_clicksign() from public, anon;
grant execute on function public.home_bate_papo_migrar_dms_legado() to authenticated;
grant execute on function public.home_bate_papo_publicas(uuid[]) to authenticated;
grant execute on function public.home_bate_papo_sou_admin(uuid) to authenticated;
grant execute on function public.home_bate_papo_sou_participante(uuid) to authenticated;
grant execute on function public.usuario_pode_clicksign() to authenticated;

-- Mantidas para anon de propósito (formulário público /ser_parceiro):
--   credenciamento_documento_disponivel(text)
--   credenciamento_listar_especialidades()
--   credenciamento_obter_ou_criar_cidade_credenciamento(text) e (text, text)

-- ---------------------------------------------------------------------------
-- S-11: search_path fixo (unaccent continua em public, por isso public basta)
-- ---------------------------------------------------------------------------
alter function public.credenciamento_normalizar_documento(text) set search_path = public;
alter function public.cred_prospectos_norm_texto(text) set search_path = public;
alter function public.audit_extract_registro_id(jsonb) set search_path = public;
alter function public.audit_infer_severidade(text, text, jsonb, jsonb) set search_path = public;
alter function public.situacao_eh_credenciado(bigint) set search_path = public;
alter function public.tg_cred_kanban_cards_atualizado_em() set search_path = public;
alter function public.home_tarefas_bloquear_criado_por() set search_path = public;

commit;
