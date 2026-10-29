# Modo de impressão de planos (equipe)

## Objetivo

Lembrar, por **plano + cidade**, quais procedimentos estavam marcados na impressão, de forma **compartilhada pela equipe**, para reutilizar na próxima carga.

## Decisões

- Escopo: `plano_id` + `cidade_id` (cidade principal do filtro; paralelas não entram na chave).
- Persistência: tabela Supabase `impressao_planos_modos`, um registro por par.
- Gravação: debounce ~600 ms a cada alteração de seleção **e** imediata ao imprimir PDF.
- Procedimento novo (sem chave no JSON): regra atual ≥3 realizadores.
- Conflito: último upsert vence.
- PDF não é bloqueado se o save falhar (aviso + gera arquivo).

## Dados

`selecao` jsonb: `{ [linhaKey]: boolean }`.

Metadados: `atualizado_em`, `atualizado_por` (profiles).

## UI

Indicador discreto: modo salvo (quando / por quem) ou “ainda sem modo salvo”.
