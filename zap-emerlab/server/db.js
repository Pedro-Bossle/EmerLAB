// Acesso ao Supabase com service role (somente servidor)
import { createClient } from '@supabase/supabase-js'
import { getEnv } from './env.js'
import { memo, invalidar } from './cache.js'

let cliente = null

export function db() {
    if (!cliente) {
        const { supabaseUrl, supabaseKey } = getEnv()
        cliente = createClient(supabaseUrl, supabaseKey, {
            auth: { persistSession: false, autoRefreshToken: false },
        })
    }
    return cliente
}

export class DbError extends Error {
    constructor(message, status = 500) {
        super(message)
        this.status = status
    }
}

// Lança erro legível a partir do retorno { data, error } do supabase-js
export function ok({ data, error }) {
    if (error) {
        if (error.code === '23505') throw new DbError('Já existe um registro com esse valor.', 409)
        if (error.code === '42P01') throw new DbError('Tabelas zap_* não encontradas. Rode supabase/schema.sql no Supabase.', 500)
        if (error.code === '42703') throw new DbError('O banco está sem uma coluna nova do painel. Rode supabase/schema.sql no Supabase.', 500)
        throw new DbError(error.message || 'Erro no banco de dados.', 500)
    }
    return data
}

export async function buscarUsuarioPorEmail(email) {
    return ok(
        await db()
            .from('zap_usuarios')
            .select('id, nome, email, senha_hash, papel, ativo, zap_usuario_departamentos(departamento_id)')
            .eq('email', String(email).toLowerCase())
            .maybeSingle(),
    )
}

// Toda requisição do painel valida a sessão lendo o usuário; com o polling isso eram ~54 mil leituras por dia.
// 2 min de cache (e limpeza ao gravar nesta instância): desativar um usuário ou trocar a senha vale em até 2 min
// nas outras instâncias (o cache é por instância serverless, então TTL curto demais quase não poupa leituras).
const TTL_USUARIO_MS = 120_000

export async function buscarUsuarioPorId(id) {
    return memo(`usuario:${id}`, TTL_USUARIO_MS, async () =>
        ok(
            await db()
                .from('zap_usuarios')
                .select('id, nome, email, papel, ativo, senha_hash, zap_usuario_departamentos(departamento_id)')
                .eq('id', id)
                .maybeSingle(),
        ),
    )
}

/** Chame depois de qualquer gravação em zap_usuarios / zap_usuario_departamentos. */
export function invalidarUsuarios() {
    invalidar('usuario:')
}

const TTL_DEPARTAMENTOS_MS = 600_000

/** Departamentos (mudam raramente): cache de 10 min compartilhado entre /me e a conferência na WATI. */
export function listarDepartamentos() {
    return memo('departamentos', TTL_DEPARTAMENTOS_MS, async () => ok(await db().from('zap_departamentos').select('id, nome, cor, equipe_wati').order('nome')))
}

export function invalidarDepartamentos() {
    invalidar('departamentos')
}

export function idsDepartamentos(usuario) {
    return (usuario?.zap_usuario_departamentos || []).map((r) => r.departamento_id)
}
