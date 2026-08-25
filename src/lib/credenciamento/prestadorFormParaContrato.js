import { formatarContatoSeTelefone } from '../telefoneBrasil.js'
import { montarEnderecoUmaLinha, tipoDocumentoCpfCnpj } from '../prestadorCadastroHelpers.js'
import { apenasDigitos } from '../contratos/validarDocumentos.js'
import { maskCNPJ, maskCPF } from '../contratos/mascarasDocumento.js'
import { buscarDadosCNPJ, ORIGENS_CONSULTA_CNPJ } from '../contratos/consultaCnpj.js'
import { responsaveisParaPayload } from '../prestadorVeterinarioCadastro.js'

/** `tipoDocumentoCpfCnpj` devolve CPF/CNPJ em maiúsculas; contratos usam minúsculas. */
function docTipoContrato(cpfCnpj) {
    const t = tipoDocumentoCpfCnpj(cpfCnpj)
    if (t === 'CNPJ') return 'cnpj'
    if (t === 'CPF') return 'cpf'
    return ''
}

/**
 * Campos do contrato de desconto a partir dos responsáveis do perfil.
 * @param {Array<{ nome?: string, email?: string, telefone?: string }>} responsaveis
 * @param {{ email?: string, contato?: string, nomeFallback?: string }} fallback
 */
export function camposResponsaveisContratoDesconto(responsaveis, fallback = {}) {
    const lista = responsaveisParaPayload(responsaveis)
    if (!lista.length) {
        return {
            responsavelLegal: String(fallback.nomeFallback || '').trim(),
            emailResponsavel: String(fallback.email || '').trim(),
            contatoResponsavel: formatarContatoSeTelefone(String(fallback.contato || '').trim()),
        }
    }
    const nomes = lista.map((r) => r.nome).filter(Boolean)
    const emails = lista.map((r) => String(r.email || '').trim()).filter(Boolean)
    const contatos = lista
        .map((r) => formatarContatoSeTelefone(String(r.telefone || '').trim()))
        .filter(Boolean)
    return {
        responsavelLegal: nomes.join('; '),
        emailResponsavel: emails.join('; ') || String(fallback.email || '').trim(),
        contatoResponsavel:
            contatos.join('; ') || formatarContatoSeTelefone(String(fallback.contato || '').trim()),
    }
}

/**
 * @param {'clinica'|'volante_pj'|'volante_pf'|'desconto'} modelo
 * @param {{ nomeEspecialidade?: string, responsaveis?: Array<{ nome?: string, email?: string, telefone?: string }> }} [opts]
 */
export function payloadContratoFromPrestadorForm(form, modelo, { nomeEspecialidade = '', responsaveis = [] } = {}) {
    const f = form || {}
    const enderecoCompleto = montarEnderecoUmaLinha(f) || String(f.endereco || '').trim()
    const email = String(f.email || '').trim()
    const contato = formatarContatoSeTelefone(String(f.celular || f.telefone || '').trim())
    const crmv = String(f.crmv || '').trim()
    const docTipo = docTipoContrato(f.cpf_cnpj)
    const digitos = apenasDigitos(f.cpf_cnpj)

    if (modelo === 'clinica') {
        return {
            cnpj: docTipo === 'cnpj' ? maskCNPJ(digitos) : '',
            razaoSocial: String(f.nome || '').trim(),
            crmv,
            email,
            contatoAgendamento: contato,
            enderecoCompleto,
        }
    }

    if (modelo === 'volante_pj') {
        const ehCnpj = docTipo === 'cnpj'
        return {
            docTipo,
            cnpj: ehCnpj ? maskCNPJ(digitos) : '',
            cpf: ehCnpj ? '' : maskCPF(digitos),
            razaoSocial: ehCnpj ? String(f.nome || '').trim() : '',
            nomeCompleto: ehCnpj ? '' : String(f.nome || '').trim(),
            modeloAtendimento: String(f.modalidade || 'Domiciliar').trim() || 'Domiciliar',
            especialidade: nomeEspecialidade || '—',
            crmv,
            email,
            contatoAgendamento: contato,
            enderecoCompleto,
        }
    }

    if (modelo === 'volante_pf') {
        return {
            docTipo: 'cpf',
            cnpj: '',
            cpf: docTipo === 'cpf' ? maskCPF(digitos) : '',
            razaoSocial: '',
            nomeCompleto: String(f.nome || '').trim(),
            modeloAtendimento: String(f.modalidade || 'Domiciliar').trim() || 'Domiciliar',
            especialidade: nomeEspecialidade || '—',
            crmv,
            email,
            contatoAgendamento: contato,
            enderecoCompleto,
        }
    }

    // desconto / parceria — responsável legal vem do bloco Responsáveis do perfil
    const resp = camposResponsaveisContratoDesconto(responsaveis, {
        nomeFallback: String(f.nome || '').trim(),
        email,
        contato,
    })
    return {
        cnpj: docTipo === 'cnpj' ? maskCNPJ(digitos) : '',
        razaoSocial: String(f.nome || '').trim(),
        enderecoCompleto,
        responsavelLegal: resp.responsavelLegal,
        emailResponsavel: resp.emailResponsavel,
        contatoResponsavel: resp.contatoResponsavel,
    }
}

/** @returns {'clinicas'|'volantes'|'parceria'} */
export function tipoPdfContratoFromModelo(modelo) {
    if (modelo === 'clinica') return 'clinicas'
    if (modelo === 'desconto') return 'parceria'
    return 'volantes'
}

const MODELOS_COM_RAZAO_CNPJ = new Set(['clinica', 'desconto', 'volante_pj'])

/**
 * Completa razão social (e endereço, se vazio) via consulta CNPJ — igual à tela Contratos.
 * @returns {Promise<Record<string,string>>}
 */
export async function buildPayloadContratoFromPrestadorForm(form, modelo, opts = {}) {
    const payload = payloadContratoFromPrestadorForm(form, modelo, opts)
    const docTipo = docTipoContrato(form?.cpf_cnpj)
    if (docTipo !== 'cnpj' || !MODELOS_COM_RAZAO_CNPJ.has(modelo)) {
        return payload
    }

    try {
        const origemPorModelo = {
            clinica: ORIGENS_CONSULTA_CNPJ.CONTRATO_PDF_CLINICA,
            desconto: ORIGENS_CONSULTA_CNPJ.CONTRATO_PDF_DESCONTO,
            volante_pj: ORIGENS_CONSULTA_CNPJ.CONTRATO_PDF_VOLANTE_PJ,
        }
        const origem = origemPorModelo[modelo]
        if (!origem) return payload

        const data = await buscarDadosCNPJ(form?.cpf_cnpj, { origem })
        if (!data) return payload

        const razao = String(data.razaoSocial || '').trim()
        const enderecoApi = String(data.enderecoCompleto || '').trim()
        const next = { ...payload }

        if (razao) {
            next.razaoSocial = razao
        }
        if (enderecoApi && !String(next.enderecoCompleto || '').trim()) {
            next.enderecoCompleto = enderecoApi
        }
        return next
    } catch {
        return payload
    }
}
