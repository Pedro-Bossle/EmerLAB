-- Correção de 20261017000000_seguranca_rls_hardening.sql (aplicada em produção em 30/10/2026).
--
-- O formulário público (/ser_parceiro, sem login) consulta `prestadores` por CPF/CNPJ antes de
-- enviar. A migração anterior revogou TODOS os privilégios de `anon` na tabela, e a consulta
-- passou a falhar com "permission denied", travando o envio do formulário.
--
-- Devolvemos só SELECT. Não há política de leitura para `anon` em `prestadores`, então o RLS
-- continua devolvendo zero linhas: nenhum dado fica exposto, a consulta apenas deixa de dar erro.
-- A verificação de duplicidade de verdade é feita pela RPC `credenciamento_documento_disponivel`.

grant select on table public.prestadores to anon;
