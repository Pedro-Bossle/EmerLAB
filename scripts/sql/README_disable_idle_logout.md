# profiles.disable_idle_logout

Permite, em **Administrativo → Gerenciar acessos → Conta**, marcar a opção
**Desativar logoff automático por inatividade** para um perfil específico.

## SQL (Supabase)

Execute no SQL Editor:

```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS disable_idle_logout boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.disable_idle_logout IS
  'Quando true, o monitor de inatividade no cliente não encerra a sessão deste usuário.';
```

Arquivo espelho (ignorado pelo git): `profiles_disable_idle_logout.sql`.
