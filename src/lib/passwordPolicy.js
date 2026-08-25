/**
 * Política de senha de login (EmerLAB).
 * Alinhada no UI (AlterarSenha, GerenciamentoAcessos) e na API admin-users.
 */

export const PASSWORD_MIN_LENGTH = 10

/**
 * @param {string} password
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validarPoliticaSenha(password) {
    const s = String(password ?? '')
    if (s.length < PASSWORD_MIN_LENGTH) {
        return {
            ok: false,
            error: `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`,
        }
    }
    if (!/[A-Za-zÀ-ÿ]/.test(s)) {
        return { ok: false, error: 'A senha deve incluir pelo menos uma letra.' }
    }
    if (!/[0-9]/.test(s)) {
        return { ok: false, error: 'A senha deve incluir pelo menos um número.' }
    }
    if (/\s/.test(s)) {
        return { ok: false, error: 'A senha não pode conter espaços.' }
    }
    return { ok: true }
}

export function textoAjudaPoliticaSenha() {
    return `Mínimo ${PASSWORD_MIN_LENGTH} caracteres, com letra e número (sem espaços).`
}
