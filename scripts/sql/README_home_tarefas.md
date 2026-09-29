# Home — tarefas

## RLS: responsável não consegue editar / reassinar

Se ao alterar o responsável (ou salvar uma tarefa criada por outra pessoa) aparecer:

`new row violates row-level security policy for table "home_tarefas"`

a policy de **UPDATE** no Supabase provavelmente só permite o **criador**.

Execute no SQL Editor:

`scripts/sql/home_tarefas_rls_update_participantes.sql`

Isso permite UPDATE a quem criou **ou** está em `atribuido_a`, e impede trocar `criado_por`.
