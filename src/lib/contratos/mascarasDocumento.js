import { apenasDigitos } from './validarDocumentos.js'

export function maskCNPJ(value) {
    const d = apenasDigitos(value).slice(0, 14)
    const p = []
    for (let i = 0; i < d.length; i += 1) {
        if (i === 2 || i === 5) p.push('.')
        if (i === 8) p.push('/')
        if (i === 12) p.push('-')
        p.push(d[i])
    }
    return p.join('')
}

export function maskCPF(value) {
    const d = apenasDigitos(value).slice(0, 11)
    const p = []
    for (let i = 0; i < d.length; i += 1) {
        if (i === 3 || i === 6) p.push('.')
        if (i === 9) p.push('-')
        p.push(d[i])
    }
    return p.join('')
}
