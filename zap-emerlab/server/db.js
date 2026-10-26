// Acesso ao Supabase com service role (somente servidor)
import { createClient } from '@supabase/supabase-js'
import { getEnv } from './env.js'

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

export async function buscarUsuarioPorId(id) {
    return ok(
        await db()
            .from('zap_usuarios')
            .select('id, nome, email, papel, ativo, zap_usuario_departamentos(departamento_id)')
            .eq('id', id)
            .maybeSingle(),
    )
}

export function idsDepartamentos(usuario) {
    return (usuario?.zap_usuario_departamentos || []).map((r) => r.departamento_id)
}
