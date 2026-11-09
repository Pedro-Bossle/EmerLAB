-- Reversão de 20261109120000_indices_fk_e_politicas_rls.sql: recria as políticas como eram antes (get de pg_policies em 09/11/2026).

drop index if exists public.impressao_planos_modos_atualizado_por_fk_idx;
drop index if exists public.impressao_planos_modos_cidade_id_fk_idx;
drop index if exists public.repasse_relatorios_envio_id_fk_idx;

create policy cidades_credenciamento_select_auth on public.cidades_credenciamento for select to authenticated using (true);
create policy formulario_cred_entradas_insert_permissao on public.formulario_cred_entradas for insert to authenticated
    with check ((select emer_pode_escrever_modulo('{credenciamento.,configuracoes.}'::text[], '{credenciamento.edit,credenciamento.formulario.config,credenciamento.formulario.paginas}'::text[])));
create policy servico_valor_venda_select_authenticated_only on public.servico_valor_venda for select to authenticated using (true);

drop policy if exists home_bate_papo_user_keys_insert on public.home_bate_papo_user_keys;
drop policy if exists home_bate_papo_user_keys_update on public.home_bate_papo_user_keys;
drop policy if exists home_bate_papo_user_keys_delete on public.home_bate_papo_user_keys;
create policy home_bate_papo_user_keys_upsert on public.home_bate_papo_user_keys for all to authenticated
    using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy home_bate_papo_user_keys_insert_own on public.home_bate_papo_user_keys for insert to authenticated with check (user_id = (select auth.uid()));
create policy home_bate_papo_user_keys_update_own on public.home_bate_papo_user_keys for update to authenticated
    using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy home_bate_papo_user_keys_select_own on public.home_bate_papo_user_keys for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists mkt_document_shares_insert on public.mkt_document_shares;
drop policy if exists mkt_document_shares_update on public.mkt_document_shares;
drop policy if exists mkt_document_shares_delete on public.mkt_document_shares;
create policy mkt_document_shares_dono on public.mkt_document_shares for all to authenticated
    using (((select emer_tem_acesso_marketing()) and mkt_sou_dono_documento(document_id)))
    with check (((select emer_tem_acesso_marketing()) and mkt_sou_dono_documento(document_id)));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update_admin on public.profiles for update to authenticated
    using (emer_tem_permissao(array['access.manage'::text, 'admin.acessos.update'::text]))
    with check (emer_tem_permissao(array['access.manage'::text, 'admin.acessos.update'::text]));
create policy profiles_update_own_safe on public.profiles for update to authenticated
    using (id = (select auth.uid()))
    with check (
        (id = (select auth.uid()))
        and (not (permissions is distinct from (select p.permissions from profiles p where p.id = (select auth.uid()))))
        and (not (coalesce(force_password_change, false) is distinct from (select coalesce(p.force_password_change, false) from profiles p where p.id = (select auth.uid()))))
    );

do $$
declare
    t text;
    escrita constant text := $k$array['pagamentos.edit'::text, 'pagamentos.registro.update'::text, 'pagamentos.registro.create'::text, 'access.manage'::text]$k$;
    leitura constant text := $k$array['pagamentos.view'::text, 'pagamentos.registro.read'::text, 'pagamentos.edit'::text, 'access.manage'::text]$k$;
begin
    foreach t in array array['repasse_comprovantes', 'repasse_documentos', 'repasse_envios', 'repasse_eventos', 'repasse_relatorios'] loop
        execute format('drop policy if exists %I on public.%I', t || '_leitura', t);
        execute format('drop policy if exists %I on public.%I', t || '_insert', t);
        execute format('drop policy if exists %I on public.%I', t || '_update', t);
        execute format('drop policy if exists %I on public.%I', t || '_delete', t);
        execute format('create policy %I on public.%I for select to authenticated using (emer_tem_permissao(%s))', t || '_leitura', t, leitura);
        execute format('create policy %I on public.%I for all to authenticated using (emer_tem_permissao(%s)) with check (emer_tem_permissao(%s))', t || '_escrita', t, escrita, escrita);
    end loop;
end $$;

drop policy if exists repasse_config_insert on public.repasse_config;
drop policy if exists repasse_config_update on public.repasse_config;
drop policy if exists repasse_config_delete on public.repasse_config;
create policy repasse_config_escrita on public.repasse_config for all to authenticated
    using (emer_tem_permissao(array['access.manage'::text])) with check (emer_tem_permissao(array['access.manage'::text]));
