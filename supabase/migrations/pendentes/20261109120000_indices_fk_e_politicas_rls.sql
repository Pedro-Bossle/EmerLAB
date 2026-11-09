-- PENDENTE: NÃO aplicada no banco. Aguardando revisão. Para aplicar, mover para supabase/migrations/ (o rollback fica em rollback/).
-- Avisos de desempenho do Supabase (get_advisors): 3 chaves estrangeiras sem índice e 14 pontos com várias
-- políticas permissivas para o mesmo papel e ação (o banco avalia todas a cada consulta).
-- As trocas abaixo preservam exatamente quem pode ler, inserir, alterar e apagar:
--   · política duplicada e idêntica → remove uma;
--   · política `ALL` que sobrepunha `SELECT` → vira INSERT/UPDATE/DELETE separados, e o SELECT une as condições (OR);
--   · `emer_tem_permissao(array)` é «tem ao menos uma das chaves», então unir condições = unir os arrays.
-- Reversão: supabase/migrations/rollback/20261109120000_indices_fk_e_politicas_rls.rollback.sql

-- ---------- 1. Índices das chaves estrangeiras ----------
create index if not exists impressao_planos_modos_atualizado_por_fk_idx on public.impressao_planos_modos (atualizado_por);
create index if not exists impressao_planos_modos_cidade_id_fk_idx on public.impressao_planos_modos (cidade_id);
create index if not exists repasse_relatorios_envio_id_fk_idx on public.repasse_relatorios (envio_id);

-- ---------- 2. Duplicadas idênticas ----------
-- cidades_credenciamento: select_anon (anon + authenticated, true) já cobre select_auth (authenticated, true)
drop policy if exists cidades_credenciamento_select_auth on public.cidades_credenciamento;
-- formulario_cred_entradas: insert_anon (anon + authenticated, with check true) já cobre insert_permissao
drop policy if exists formulario_cred_entradas_insert_permissao on public.formulario_cred_entradas;
-- servico_valor_venda: duas políticas SELECT (authenticated, true)
drop policy if exists servico_valor_venda_select_authenticated_only on public.servico_valor_venda;

-- ---------- 3. home_bate_papo_user_keys ----------
-- Antes: ALL(own) + INSERT(own) + UPDATE(own) + SELECT(true) + SELECT(own). SELECT = true OU own = true.
drop policy if exists home_bate_papo_user_keys_upsert on public.home_bate_papo_user_keys;
drop policy if exists home_bate_papo_user_keys_insert_own on public.home_bate_papo_user_keys;
drop policy if exists home_bate_papo_user_keys_update_own on public.home_bate_papo_user_keys;
drop policy if exists home_bate_papo_user_keys_select_own on public.home_bate_papo_user_keys;
create policy home_bate_papo_user_keys_insert on public.home_bate_papo_user_keys
    for insert to authenticated with check (user_id = (select auth.uid()));
create policy home_bate_papo_user_keys_update on public.home_bate_papo_user_keys
    for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy home_bate_papo_user_keys_delete on public.home_bate_papo_user_keys
    for delete to authenticated using (user_id = (select auth.uid()));
-- home_bate_papo_user_keys_select (authenticated, true) permanece

-- ---------- 4. mkt_document_shares ----------
-- A condição do dono já está contida na política SELECT existente; o ALL vira escrita separada.
drop policy if exists mkt_document_shares_dono on public.mkt_document_shares;
create policy mkt_document_shares_insert on public.mkt_document_shares
    for insert to authenticated
    with check (((select emer_tem_acesso_marketing()) and mkt_sou_dono_documento(document_id)));
create policy mkt_document_shares_update on public.mkt_document_shares
    for update to authenticated
    using (((select emer_tem_acesso_marketing()) and mkt_sou_dono_documento(document_id)))
    with check (((select emer_tem_acesso_marketing()) and mkt_sou_dono_documento(document_id)));
create policy mkt_document_shares_delete on public.mkt_document_shares
    for delete to authenticated
    using (((select emer_tem_acesso_marketing()) and mkt_sou_dono_documento(document_id)));

-- ---------- 5. profiles (UPDATE) ----------
-- USING = admin OU próprio; WITH CHECK = admin OU próprio (mesma lógica de duas políticas permissivas).
drop policy if exists profiles_update_admin on public.profiles;
drop policy if exists profiles_update_own_safe on public.profiles;
create policy profiles_update on public.profiles
    for update to authenticated
    using (
        emer_tem_permissao(array['access.manage'::text, 'admin.acessos.update'::text])
        or (id = (select auth.uid()))
    )
    with check (
        emer_tem_permissao(array['access.manage'::text, 'admin.acessos.update'::text])
        or (
            (id = (select auth.uid()))
            and (not (permissions is distinct from (select p.permissions from profiles p where p.id = (select auth.uid()))))
            and (not (coalesce(force_password_change, false) is distinct from (select coalesce(p.force_password_change, false) from profiles p where p.id = (select auth.uid()))))
        )
    );

-- ---------- 6. Tabelas do repasse (escrita ALL + leitura SELECT) ----------
-- SELECT passa a aceitar a união das chaves de leitura e de escrita (o ALL antigo também permitia ler).
do $$
declare
    t text;
    chaves_escrita constant text := $k$array['pagamentos.edit'::text, 'pagamentos.registro.update'::text, 'pagamentos.registro.create'::text, 'access.manage'::text]$k$;
    chaves_leitura_e_escrita constant text := $k$array['pagamentos.view'::text, 'pagamentos.registro.read'::text, 'pagamentos.edit'::text, 'access.manage'::text, 'pagamentos.registro.update'::text, 'pagamentos.registro.create'::text]$k$;
begin
    foreach t in array array['repasse_comprovantes', 'repasse_documentos', 'repasse_envios', 'repasse_eventos', 'repasse_relatorios'] loop
        execute format('drop policy if exists %I on public.%I', t || '_escrita', t);
        execute format('drop policy if exists %I on public.%I', t || '_leitura', t);
        execute format('create policy %I on public.%I for select to authenticated using (emer_tem_permissao(%s))', t || '_leitura', t, chaves_leitura_e_escrita);
        execute format('create policy %I on public.%I for insert to authenticated with check (emer_tem_permissao(%s))', t || '_insert', t, chaves_escrita);
        execute format('create policy %I on public.%I for update to authenticated using (emer_tem_permissao(%s)) with check (emer_tem_permissao(%s))', t || '_update', t, chaves_escrita, chaves_escrita);
        execute format('create policy %I on public.%I for delete to authenticated using (emer_tem_permissao(%s))', t || '_delete', t, chaves_escrita);
    end loop;
end $$;

-- repasse_config: a escrita é só access.manage, que já está na leitura; ALL vira escrita separada
drop policy if exists repasse_config_escrita on public.repasse_config;
create policy repasse_config_insert on public.repasse_config
    for insert to authenticated with check (emer_tem_permissao(array['access.manage'::text]));
create policy repasse_config_update on public.repasse_config
    for update to authenticated
    using (emer_tem_permissao(array['access.manage'::text])) with check (emer_tem_permissao(array['access.manage'::text]));
create policy repasse_config_delete on public.repasse_config
    for delete to authenticated using (emer_tem_permissao(array['access.manage'::text]));
-- repasse_config_leitura (view/read/edit/access.manage) permanece
