// Leitura centralizada das variáveis de ambiente (ver .env.example)
import process from 'node:process'

function str(name, fallback = '') {
    const v = process.env[name]
    return v == null || v === '' ? fallback : String(v).trim()
}

export function getEnv() {
    return {
        watiTenantId: str('WATI_TENANT_ID'),
        watiToken: str('WATI_API_TOKEN').replace(/^Bearer\s+/i, ''),
        watiBase: str('WATI_API_BASE', 'https://live-mt-server.wati.io').replace(/\/+$/, ''),
        watiChannel: str('WATI_CHANNEL_NUMBER').replace(/\D/g, ''),
        sessionSecret: str('ZAP_SESSION_SECRET'),
        sessionHoras: Number(str('ZAP_SESSION_HORAS', '12')) || 12,
        adminEmail: str('ZAP_ADMIN_EMAIL').toLowerCase(),
        adminSenha: str('ZAP_ADMIN_SENHA'),
        adminNome: str('ZAP_ADMIN_NOME', 'Administrador'),
        supabaseUrl: str('SUPABASE_URL'),
        supabaseKey: str('SUPABASE_SERVICE_ROLE_KEY'),
        webhookSecret: str('ZAP_WEBHOOK_SECRET'),
        atendenteVeSemDepto: str('ZAP_ATENDENTE_VE_SEM_DEPARTAMENTO', 'true') !== 'false',
    }
}

export function envFaltando() {
    const e = getEnv()
    const faltando = []
    if (!e.watiTenantId) faltando.push('WATI_TENANT_ID')
    if (!e.watiToken) faltando.push('WATI_API_TOKEN')
    if (!e.sessionSecret || e.sessionSecret.length < 16) faltando.push('ZAP_SESSION_SECRET (mín. 16 caracteres)')
    if (!e.supabaseUrl) faltando.push('SUPABASE_URL')
    if (!e.supabaseKey) faltando.push('SUPABASE_SERVICE_ROLE_KEY')
    return faltando
}
