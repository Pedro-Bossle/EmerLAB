-- Rollback de 20261017000000_seguranca_rls_hardening.sql.
-- Recria exatamente as políticas e grants de produção em 16/10/2026 (snapshot via pg_policies).
-- ATENÇÃO: reabre as falhas S-01 a S-06. Use só para destravar uma regressão e corrija em seguida.

begin;

drop trigger if exists trg_profiles_bloquear_colunas_sensiveis on public.profiles;
drop function if exists public.profiles_bloquear_colunas_sensiveis();

-- profiles
drop policy if exists profiles_update_admin on public.profiles;
create policy "Enable read access for all users" on public.profiles as permissive for select to public using (true);
create policy profiles_insert_own on public.profiles as permissive for insert to authenticated with check ((id = auth.uid()));
create policy profiles_select_nome_para_tarefas on public.profiles as permissive for select to authenticated using (true);
create policy profiles_select_own on public.profiles as permissive for select to authenticated using ((id = auth.uid()));
create policy read_own_profile on public.profiles as permissive for select to authenticated using ((auth.uid() = id));
create policy profiles_update_own on public.profiles as permissive for update to authenticated using ((id = auth.uid())) with check ((id = auth.uid()));
create policy profiles_update_admin on public.profiles as permissive for update to authenticated
  using ((exists (select 1 from profiles me where ((me.id = auth.uid()) and (coalesce(((me.permissions ->> 'access.manage'::text))::boolean, false) or coalesce((((me.permissions -> 'admin.acessos'::text) ->> 'update'::text))::boolean, false))))))
  with check (true);

-- repasses
create policy repasses_insert_all on public.repasses as permissive for insert to anon, authenticated with check (true);
create policy repasses_update_all on public.repasses as permissive for update to anon, authenticated using (true) with check (true);
create policy read_all_repasses on public.repasses as permissive for select to anon, authenticated using (true);
create policy repasses_read_all on public.repasses as permissive for select to anon, authenticated using (true);
grant all on table public.repasses to anon;
grant all on table public.profiles to anon;
grant all on table public.pagamentos_registros to anon;
grant all on table public.prestadores to anon;
grant update, delete, truncate on table public.formulario_cred_entradas to anon;

-- pagamentos_registros
drop policy if exists pagamentos_registros_insert_perm on public.pagamentos_registros;
drop policy if exists pagamentos_registros_update_perm on public.pagamentos_registros;
drop policy if exists pagamentos_registros_delete_perm on public.pagamentos_registros;
create policy pagamentos_registros_auth_insert on public.pagamentos_registros as permissive for insert to authenticated with check (true);
create policy pagamentos_registros_auth_update on public.pagamentos_registros as permissive for update to authenticated using (true) with check (true);
create policy pagamentos_registros_auth_delete on public.pagamentos_registros as permissive for delete to authenticated using (true);

-- prestadores
drop policy if exists prestadores_insert_perm on public.prestadores;
drop policy if exists prestadores_update_perm on public.prestadores;
drop policy if exists prestadores_delete_perm on public.prestadores;
create policy prestadores_insert_auth on public.prestadores as permissive for insert to authenticated with check (true);
create policy prestadores_update_auth on public.prestadores as permissive for update to authenticated using (true) with check (true);
create policy prestadores_delete_auth on public.prestadores as permissive for delete to authenticated using (true);

-- audit_logs
create policy audit_logs_select_authenticated on public.audit_logs as permissive for select to authenticated using (true);

-- funções
grant execute on function public.audit_row_change() to public, anon, authenticated;
grant execute on function public.fn_audit_row() to public, anon, authenticated;
grant execute on function public.fn_prestadores_credenciado_em() to public, anon, authenticated;
grant execute on function public.prestadores_set_credenciado_em() to public, anon, authenticated;
grant execute on function public.rls_auto_enable() to public, anon, authenticated;
grant execute on function public.limpar_audit_logs_expirados(integer) to public, anon, authenticated;
grant execute on function public.home_bate_papo_migrar_dms_legado() to public, anon;
grant execute on function public.home_bate_papo_publicas(uuid[]) to public, anon;
grant execute on function public.home_bate_papo_sou_admin(uuid) to public, anon;
grant execute on function public.home_bate_papo_sou_participante(uuid) to public, anon;
grant execute on function public.usuario_pode_clicksign() to public, anon;

-- emer_tem_permissao fica (inofensiva, só leitura) — remova se quiser:
-- drop function if exists public.emer_tem_permissao(text[]);

commit;
