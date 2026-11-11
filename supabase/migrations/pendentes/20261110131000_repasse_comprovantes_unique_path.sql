-- PENDENTE: NÃO aplicada no banco. Aguardando revisão. Para aplicar, mover para supabase/migrations/ (o rollback fica em rollback/).
-- API pública de pagamentos: o comprovante enviado pela API tem o SHA-256 do arquivo no nome (storage_path), e o
-- mesmo arquivo no mesmo registro deve virar UMA linha. A API lê antes de gravar, mas duas chamadas idênticas
-- simultâneas passariam juntas pela leitura; este índice faz a segunda inserção falhar com 23505, e a API devolve a
-- linha existente (ja_existia), sem e-mail e sem apagar o arquivo.
-- O comprovante em lote do painel grava várias linhas com o MESMO storage_path e registro_id DIFERENTES: continua
-- permitido. Conferido em 10/11/2026 (SELECT somente leitura): repasse_comprovantes tem 0 linhas, 0 pares
-- (registro_id, storage_path) repetidos; nada viola o índice.
-- Reversão: 20261110131000_repasse_comprovantes_unique_path.rollback.sql

create unique index if not exists repasse_comprovantes_registro_path_key
    on public.repasse_comprovantes (registro_id, storage_path);
