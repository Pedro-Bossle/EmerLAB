import { buscarEnderecoPorCep } from '../viacepClient.js'
import { geocodificarCepNominatim, geocodificarEnderecoNominatim } from './geocodeNominatim.js'

/** Detecta se o texto da busca é um CEP brasileiro (8 dígitos). */
export function extrairCepDigitosBuscaMapa(bruto) {
    const t = String(bruto || '').trim()
    const digits = t.replace(/\D/g, '')
    if (digits.length !== 8) return null
    const compact = t.replace(/\s/g, '')
    if (/^\d{5}-?\d{3}$/.test(compact)) return digits
    if (/^\d{8}$/.test(compact)) return digits
    if (/\bcep\b/i.test(t)) return digits
    return null
}

/** ViaCEP + Nominatim (endereço completo, senão postalcode). */
export async function geocodificarCepParaMapa(cepDigits) {
    const cep = String(cepDigits || '').replace(/\D/g, '')
    if (cep.length !== 8) return { ok: false, erro: 'CEP inválido.' }

    let via = null
    try {
        via = await buscarEnderecoPorCep(cep)
    } catch (e) {
        return { ok: false, erro: e?.message || 'CEP não encontrado.' }
    }

    const rotuloVia = [
        via.logradouro,
        via.bairro,
        `${via.cidade}/${via.uf}`,
        via.cep ? `CEP ${via.cep}` : '',
    ]
        .filter(Boolean)
        .join(' · ')

    const consulta = [via.logradouro, via.bairro, via.cidade, via.uf, via.cep, 'Brasil']
        .filter(Boolean)
        .join(', ')

    let geo = await geocodificarEnderecoNominatim(consulta)
    if (!geo.ok) {
        geo = await geocodificarCepNominatim(cep)
    }
    if (!geo.ok) {
        return { ok: false, erro: geo.erro || 'Não foi possível localizar o CEP no mapa.' }
    }

    return {
        ok: true,
        latitude: geo.latitude,
        longitude: geo.longitude,
        rotulo: rotuloVia || geo.rotuloCurto || `CEP ${cep.slice(0, 5)}-${cep.slice(5)}`,
        telefone: geo.telefone || '',
        enderecoLinha: geo.enderecoLinha || rotuloVia || '',
        via,
    }
}
