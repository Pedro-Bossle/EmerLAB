// Leitura centralizada das variáveis de ambiente (ver .env.example)
import process from 'node:process'

function str(name, fallback = '') {
    const v = process.env[name]
    if (v == null || v === '') return fallback
    // remove aspas que às vezes vêm coladas do .env (ex.: ZAP_ADMIN_EMAIL="a@b.com")
    return String(v).trim().replace(/^['"]+|['"]+$/g, '').trim()
}

/** Remove BOM, aspas e "Bearer " — evita "API key is invalid" com chave certa no painel. */
function normalizeResendApiKey(raw) {
    let k = String(raw ?? '').trim()
    if (k.charCodeAt(0) === 0xfeff) k = k.slice(1).trim()
    k = k.replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, '').trim()
    k = k.replace(/^Bearer\s+/i, '').trim()
    return k
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
        resendKey: normalizeResendApiKey(process.env.RESEND_API_KEY || process.env.RESEND_KEY || ''),
        emailFrom: str('RESEND_FROM_EMAIL', 'noreply@emerlab.com.br'),
        emailFromNome: str('ZAP_EMAIL_FROM_NOME') || str('RESEND_FROM_NAME', 'Emerzap'),
        publicUrl: str('ZAP_PUBLIC_URL', 'https://zap.emerlab.com.br').replace(/\/+$/, ''),
        // Microsoft (Outlook e Teams). Tudo desligado até MS_ATIVO=true e o app estar registrado no Azure.
        msAtivo: ['1', 'true'].includes(str('MS_ATIVO').toLowerCase()),
        msClientId: str('MS_CLIENT_ID'),
        msTenantId: str('MS_TENANT_ID'),
        msClientSecret: str('MS_CLIENT_SECRET'),
        msRedirectUri: str('MS_REDIRECT_URI') || `${str('ZAP_PUBLIC_URL', 'https://zap.emerlab.com.br').replace(/\/+$/, '')}/api/ms/callback`,
        msTokenKey: str('MS_TOKEN_KEY') || str('ZAP_SESSION_SECRET'),
        msTeamNome: str('MS_TEAM_NOME'), // opcional: só mostra a equipe com esse nome (ex.: Emerdog)
        msCanalMinutos: Number(str('MS_CANAL_MINUTOS', '60')) || 60, // vida da assinatura de canal (a confirmar na doc da Microsoft)
        cronSecret: str('CRON_SECRET'),
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

/** O que falta para ligar a integração Microsoft (vazio = pronta). */
export function msFaltando() {
    const e = getEnv()
    const f = []
    if (!e.msClientId) f.push('MS_CLIENT_ID')
    if (!e.msTenantId) f.push('MS_TENANT_ID')
    if (!e.msClientSecret) f.push('MS_CLIENT_SECRET')
    if (!e.msTokenKey || e.msTokenKey.length < 16) f.push('MS_TOKEN_KEY (mín. 16 caracteres)')
    return f
}
