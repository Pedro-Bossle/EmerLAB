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
