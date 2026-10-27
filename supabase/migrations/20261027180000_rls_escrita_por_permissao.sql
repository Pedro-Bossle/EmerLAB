-- Escrita condicionada à permissão do módulo (auditoria de 27/10/2026, revisão: N-01).
-- Antes: 44 tabelas aceitavam INSERT/UPDATE/DELETE de qualquer usuário logado; a permissão existia só na tela.
-- Agora: leitura continua para todos os logados; escrita exige permissão de criar/editar/excluir em algum
-- módulo que grava a tabela (mesmas chaves do permissionCatalog), a chave legada de edição do módulo,
-- access.manage ou dev.tools. Políticas de anon (formulário público) não são tocadas.
-- O worker do Emer Radar (DATABASE_URL) e as APIs (service role) não passam por RLS.

create or replace function public.emer_pode_escrever_modulo(p_prefixos text[], p_legado text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p, jsonb_each_text(coalesce(p.permissions, '{}'::jsonb)) e
    where p.id = auth.uid()
      and e.value = 'true'
      and (
        e.key in ('access.manage', 'dev.tools')
        or e.key = any (p_legado)
        or (e.key ~ '\.(create|update|delete)$'
            and exists (select 1 from unnest(p_prefixos) pre where e.key like pre || '%'))
      )
  );
$$;

revoke all on function public.emer_pode_escrever_modulo(text[], text[]) from public, anon;
grant execute on function public.emer_pode_escrever_modulo(text[], text[]) to authenticated;

do $$
declare
  grupos jsonb := jsonb_build_object(
    'supertabela', jsonb_build_object(
      'prefixos', jsonb_build_array('supertabela.'),
      'legado', jsonb_build_array('supertabela.edit'),
      'tabelas', jsonb_build_array('repasses', 'planos_cidade', 'planos_config', 'procedimentos', 'categorias',
        'cidades', 'beneficios_catalogo', 'categoria_limites_grupo', 'planos', 'portes')),
    'supertabela_credenciamento', jsonb_build_object(
      'prefixos', jsonb_build_array('supertabela.', 'credenciamento.', 'configuracoes.'),
      'legado', jsonb_build_array('supertabela.edit', 'credenciamento.edit'),
      'tabelas', jsonb_build_array('negociacoes_vet', 'prestador_procedimentos', 'veterinarios', 'cidades_municipios_vinculo')),
    'credenciamento', jsonb_build_object(
      'prefixos', jsonb_build_array('credenciamento.', 'configuracoes.'),
      'legado', jsonb_build_array('credenciamento.edit', 'credenciamento.formulario.config', 'credenciamento.formulario.paginas'),
      'tabelas', jsonb_build_array('prestador_laboratorios_solicitacao', 'prestador_cidades', 'prestador_especialidades',
        'cred_prospectos_osm', 'prestador_beneficios_obs', 'prestador_estabelecimentos', 'cred_kanban_cards',
        'cred_prospectos_maps', 'prestador_beneficios', 'prestador_responsaveis', 'cidades_credenciamento',
        'prestador_certificados_conclusao', 'cred_trafego_aparicoes', 'formulario_cred_entradas', 'especialidades',
        'cred_trafego_cidades', 'formulario_cred_pagina_categorias', 'app_settings', 'formulario_cred_config',
        'cred_kanban_meta', 'city_registry', 'situacoes', 'pipeline_queue', 'formulario_cred_paginas')),
    'observacoes', jsonb_build_object(
      'prefixos', jsonb_build_array('configuracoes.', 'planos.', 'supertabela.'),
      'legado', jsonb_build_array('supertabela.edit'),
      'tabelas', jsonb_build_array('planos_observacoes', 'planos_observacoes_procedimentos', 'honorarios_observacoes',
        'honorarios_observacoes_procedimentos')),
    'compras', jsonb_build_object(
      'prefixos', jsonb_build_array('compras.'),
      'legado', jsonb_build_array('compras.edit'),
      'tabelas', jsonb_build_array('servico_valor_venda')),
    'contratos', jsonb_build_object(
      'prefixos', jsonb_build_array('contratos.'),
      'legado', jsonb_build_array('contratos.edit'),
      'tabelas', jsonb_build_array('clicksign_notificacoes_webhook'))
  );
  g record;
  t text;
  pol record;
  cond text;
  tinha_all boolean;
begin
  for g in select key, value from jsonb_each(grupos) loop
    cond := format('(select public.emer_pode_escrever_modulo(%L::text[], %L::text[]))',
      (select array_agg(x) from jsonb_array_elements_text(g.value -> 'prefixos') x),
      (select array_agg(x) from jsonb_array_elements_text(g.value -> 'legado') x));
    for t in select jsonb_array_elements_text(g.value -> 'tabelas') loop
      if to_regclass('public.' || t) is null then continue; end if;
      tinha_all := false;
      -- remove só as políticas de escrita "liberadas" (true) exclusivas de authenticated
      for pol in
        select policyname, cmd from pg_policies
        where schemaname = 'public' and tablename = t and roles::text = '{authenticated}'
          and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
          and coalesce(nullif(qual, ''), 'true') = 'true' and coalesce(nullif(with_check, ''), 'true') = 'true'
      loop
        if pol.cmd = 'ALL' then tinha_all := true; end if;
        execute format('drop policy %I on public.%I', pol.policyname, t);
      end loop;
      -- a política ALL também dava leitura: garante a leitura para logados se nada mais a cobre
      if tinha_all and not exists (
        select 1 from pg_policies where schemaname = 'public' and tablename = t and cmd in ('SELECT', 'ALL')
          and (roles::text like '%authenticated%' or roles::text = '{public}')
      ) then
        execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_leitura_logado', t);
      end if;
      execute format('drop policy if exists %I on public.%I', t || '_insert_permissao', t);
      execute format('drop policy if exists %I on public.%I', t || '_update_permissao', t);
      execute format('drop policy if exists %I on public.%I', t || '_delete_permissao', t);
      execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_insert_permissao', t, cond);
      execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t || '_update_permissao', t, cond, cond);
      execute format('create policy %I on public.%I for delete to authenticated using (%s)', t || '_delete_permissao', t, cond);
    end loop;
  end loop;
end $$;
