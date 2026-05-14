export const apenasDigitos = (v) => String(v || '').replace(/\D/g, '')

export function validarCNPJ(cnpj) {
    const c = apenasDigitos(cnpj)
    if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false
    const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    let s = 0
    for (let i = 0; i < 12; i += 1) s += Number(c[i]) * w1[i]
    let d1 = s % 11 < 2 ? 0 : 11 - (s % 11)
    if (Number(c[12]) !== d1) return false
    s = 0
    for (let i = 0; i < 13; i += 1) s += Number(c[i]) * w2[i]
    const d2 = s % 11 < 2 ? 0 : 11 - (s % 11)
    return Number(c[13]) === d2
}

export function validarCPF(cpf) {
    const c = apenasDigitos(cpf)
    if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false
    let s = 0
    for (let i = 0; i < 9; i += 1) s += Number(c[i]) * (10 - i)
    let d1 = (s * 10) % 11
    if (d1 === 10) d1 = 0
    if (Number(c[9]) !== d1) return false
    s = 0
    for (let i = 0; i < 10; i += 1) s += Number(c[i]) * (11 - i)
    let d2 = (s * 10) % 11
    if (d2 === 10) d2 = 0
    return Number(c[10]) === d2
}

export function validarEmail(email) {
    const e = String(email || '').trim()
    if (!e) return false
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
}

export function errosValidacao(tipo, d) {
    const e = []
    const req = (ok, msg) => {
        if (!ok) e.push(msg)
    }

    if (tipo === 'clinicas') {
        req(validarCNPJ(d.cnpj), 'CNPJ da contratada inválido.')
        req(String(d.razaoSocial || '').trim(), 'Razão Social é obrigatória.')
        req(String(d.crmv || '').trim(), 'CRMV é obrigatório.')
        req(validarEmail(d.email), 'E-mail inválido ou vazio.')
        req(String(d.contatoAgendamento || '').trim(), 'Contato para agendamento é obrigatório.')
        req(String(d.enderecoCompleto || '').trim(), 'Endereço completo é obrigatório.')
    } else if (tipo === 'volantes') {
        const isCnpj = d.docTipo === 'cnpj'
        if (isCnpj) {
            req(validarCNPJ(d.cnpj), 'CNPJ inválido.')
            req(String(d.razaoSocial || '').trim(), 'Razão Social é obrigatória.')
        } else {
            req(validarCPF(d.cpf), 'CPF inválido.')
            req(String(d.nomeCompleto || '').trim(), 'Nome completo é obrigatório.')
        }
        req(String(d.modeloAtendimento || '').trim(), 'Modelo de atendimento é obrigatório.')
        req(String(d.especialidade || '').trim(), 'Especialidade é obrigatória.')
        req(String(d.crmv || '').trim(), 'CRMV é obrigatório.')
        req(validarEmail(d.email), 'E-mail inválido ou vazio.')
        req(String(d.contatoAgendamento || '').trim(), 'Contato para agendamento é obrigatório.')
        req(String(d.enderecoCompleto || '').trim(), 'Endereço completo é obrigatório.')
    } else if (tipo === 'parceria') {
        req(validarCNPJ(d.cnpj), 'CNPJ inválido.')
        req(String(d.razaoSocial || '').trim(), 'Razão Social é obrigatória.')
        req(String(d.enderecoCompleto || '').trim(), 'Endereço é obrigatório.')
        req(String(d.responsavelLegal || '').trim(), 'Responsável legal é obrigatório.')
        req(validarEmail(d.emailResponsavel), 'E-mail do responsável inválido ou vazio.')
        req(String(d.contatoResponsavel || '').trim(), 'Contato do responsável é obrigatório.')
    }

    return e
}
