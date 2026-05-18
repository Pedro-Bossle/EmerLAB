import { getReadOnlyFlag } from './supabase'

/** @returns {boolean} true se bloqueou a ação */
export function bloquearSeSomenteLeitura(mostrarMensagem) {
    if (!getReadOnlyFlag()) return false
    if (typeof mostrarMensagem === 'function') {
        mostrarMensagem('Perfil somente leitura: exclusão e alterações estão bloqueadas.')
    }
    return true
}
