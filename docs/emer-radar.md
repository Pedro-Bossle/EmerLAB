# Integração Emer-Radar no EmerLAB
#
# Em desenvolvimento:
# 1. Worker: python backend/main.py (porta 8000) na pasta teste-emeradar
# 2. EmerLAB: npm run dev — proxy /emeradar → 8000 (vite.config.js)
#
# Em produção (Vercel):
# VITE_EMERADAR_API_BASE=https://SEU-WORKER.up.railway.app
# No worker: CORS_ORIGINS=https://SEU-EMERLAB.vercel.app
#
# Rota na UI: /credenciamento/emer-radar (menu Credenciamento → Prospecção)
# Legado: /credenciamento/prospectos-osm redireciona para Emer-Radar
#
# Persistência Prospect Maps:
# - Tabela Supabase `cred_prospectos_maps` (scripts/sql/cred_prospectos_maps.sql)
# - Após cada busca, resultados são upsertados (sem coluna/URL de foto de fachada)
# - Aba «Catálogo salvo» filtra por UF, cidade, status e texto
# - «Atualizar filtrados»: reexecuta scrape por cidade/UF dos itens visíveis e faz upsert com preferirNovos
# - Foto de fachada: GET /api/place-photo (worker) sob demanda; URL do CDN Google, sem gravar no Supabase
#
# Pipeline — cidades do tráfego:
# - Tabelas `cred_trafego_cidades` + `cred_trafego_aparicoes` (scripts/sql/cred_trafego_cidades.sql)
# - Colar cidades do dia na aba Pipeline; 1 marcador/dia; ao bater 4 → POST /api/pipeline/queue
# - Enfileiramento manual («Enfileirar p/ cron») continua disponível
