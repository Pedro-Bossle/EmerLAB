import { createHash, randomBytes } from 'node:crypto'

export const ESCOPOS = Object.freeze(['rede:ler', 'pagamentos:ler', 'pagamentos:escrever'])

const ALFABETO = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const TIPOS = { rede: 'emer_rede_', pag: 'emer_pag_' }
const TAMANHO_SEGREDO = 32

function segredoBase62(tamanho) {
    // Descarta bytes >= 248 (múltiplo de 62) para não enviesar a distribuição.
    let saida = ''
    while (saida.length < tamanho) {
        for (const byte of randomBytes(tamanho * 2)) {
            if (byte >= 248) continue
            saida += ALFABETO[byte % 62]
            if (saida.length === tamanho) break
        }
    }
    return saida
}

export function hashChave(chave) {
    return createHash('sha256').update(String(chave), 'utf8').digest('hex')
}

export function gerarChave(tipo) {
    const prefixoTipo = TIPOS[tipo]
    if (!prefixoTipo) throw new Error(`Tipo de chave inválido: ${tipo}`)
    const chave = prefixoTipo + segredoBase62(TAMANHO_SEGREDO)
    return { chave, prefixo: chave.slice(0, 8), hash: hashChave(chave) }
}

const negar = (status, codigo) => ({ ok: false, status, codigo })

export function autorizarChave(linha, { escopo, origem, ip, agora = new Date() } = {}) {
    if (!linha || linha.revogada_em) return negar(401, 'chave_invalida')
    if (linha.expira_em && new Date(linha.expira_em).getTime() <= new Date(agora).getTime()) {
        return negar(401, 'chave_invalida')
    }
    if (!Array.isArray(linha.escopos) || !linha.escopos.includes(escopo)) {
        return negar(403, 'escopo_insuficiente')
    }
    if (escopo.startsWith('pagamentos:')) {
        // Chave de pagamentos é servidor a servidor: qualquer Origin indica navegador.
        if (origem) return negar(403, 'origem_nao_permitida')
    } else if (!origem || !(linha.origens_permitidas || []).includes(origem)) {
        return negar(403, 'origem_nao_permitida')
    }
    const ips = linha.ips_permitidos || []
    if (ips.length > 0 && !ips.includes(ip)) return negar(403, 'ip_nao_permitido')
    return { ok: true }
}
