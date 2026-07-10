import { responsaveisParaPayload } from './prestadorVeterinarioCadastro.js'

export function totalCertificadosConclusaoAtivos({ salvos = [], pendentes = [], removerIds = [] }) {
    const idsRemover = new Set((removerIds || []).map(Number))
    const qSalvos = (salvos || []).filter((c) => !idsRemover.has(Number(c.id))).length
    const qPendentes = (pendentes || []).filter((p) => p?.file).length
    return qSalvos + qPendentes
}

export function validarCertificadosConclusaoObrigatorios(opts) {
    if (totalCertificadosConclusaoAtivos(opts) < 1) {
        return 'Envie pelo menos um certificado de conclusão de curso (foto ou PDF).'
    }
    return ''
}

function validarCamposResponsaveisInformados(rows) {
    for (let i = 0; i < rows.length; i += 1) {
        const r = rows[i]
        const rotulo = rows.length > 1 ? ` (responsável ${i + 1})` : ''
        if (!r.email?.trim()) {
            return `Informe o e-mail do responsável${rotulo}.`
        }
        if (!r.telefone?.trim()) {
            return `Informe o telefone do responsável${rotulo}.`
        }
    }
    return ''
}

/** Formulário público de credenciamento: pelo menos um responsável completo. */
export function validarResponsaveisObrigatorios(lista) {
    const rows = responsaveisParaPayload(lista)
    if (!rows.length) {
        return 'Informe pelo menos um responsável (nome, e-mail e telefone).'
    }
    return validarCamposResponsaveisInformados(rows)
}

/** Cadastro interno: responsáveis opcionais; se informados, e-mail e telefone são obrigatórios. */
export function validarResponsaveisCompletosSeInformados(lista) {
    const rows = responsaveisParaPayload(lista)
    return validarCamposResponsaveisInformados(rows)
}
