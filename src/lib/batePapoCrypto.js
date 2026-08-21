/**
 * E2EE Emerzap (Web Crypto).
 * - Par RSA-OAEP por dispositivo (privada em localStorage, pública no DB).
 * - Chave AES-GCM por conversa, envolvida com a pública de cada participante.
 */

const PRIV_STORAGE_KEY = 'emerlab-bate-papo-priv-jwk-v1'
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function bufToB64(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer || buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function b64ToBuf(b64) {
  const bin = atob(String(b64 || ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out.buffer
}

async function gerarParRsa() {
  return crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  )
}

export async function carregarOuCriarParChaves() {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    throw new Error('Web Crypto indisponível neste ambiente.')
  }
  let privJwk = null
  try {
    const raw = localStorage.getItem(PRIV_STORAGE_KEY)
    if (raw) privJwk = JSON.parse(raw)
  } catch {
    privJwk = null
  }

  if (privJwk) {
    try {
      const privateKey = await crypto.subtle.importKey(
        'jwk',
        privJwk,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        false,
        ['decrypt'],
      )
      const publicJwk = {
        kty: privJwk.kty,
        n: privJwk.n,
        e: privJwk.e,
        alg: 'RSA-OAEP-256',
        ext: true,
        key_ops: ['encrypt'],
      }
      const publicKey = await crypto.subtle.importKey(
        'jwk',
        publicJwk,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        true,
        ['encrypt'],
      )
      return { privateKey, publicKey, publicJwk }
    } catch {
      /* regenera */
    }
  }

  const pair = await gerarParRsa()
  const privExport = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  try {
    localStorage.setItem(PRIV_STORAGE_KEY, JSON.stringify(privExport))
  } catch {
    /* ignore */
  }
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, publicJwk }
}

export async function importarPublicaJwk(publicJwk) {
  return crypto.subtle.importKey(
    'jwk',
    publicJwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['encrypt'],
  )
}

export async function gerarChaveConversaAes() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

export async function exportarChaveAesRaw(key) {
  return crypto.subtle.exportKey('raw', key)
}

export async function importarChaveAesRaw(raw) {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
}

export async function envolverChaveConversa(aesKey, publicKey) {
  const raw = await exportarChaveAesRaw(aesKey)
  const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, raw)
  return `v1:${bufToB64(wrapped)}`
}

export async function desenrolarChaveConversa(wrappedB64, privateKey) {
  const s = String(wrappedB64 || '')
  if (s.startsWith('legado:')) {
    throw new Error('CHAVE_LEGADO_PENDING')
  }
  const payload = s.startsWith('v1:') ? s.slice(3) : s
  const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, b64ToBuf(payload))
  return importarChaveAesRaw(raw)
}

export async function encriptarTexto(aesKey, texto) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    encoder.encode(String(texto || '')),
  )
  return `v1:${bufToB64(iv)}:${bufToB64(cipher)}`
}

export async function desencriptarTexto(aesKey, payload) {
  const s = String(payload || '')
  const parts = s.split(':')
  if (parts[0] !== 'v1' || parts.length < 3) {
    throw new Error('Formato de cifra inválido.')
  }
  const iv = new Uint8Array(b64ToBuf(parts[1]))
  const data = b64ToBuf(parts.slice(2).join(':'))
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, data)
  return decoder.decode(plain)
}

export async function encriptarBytes(aesKey, arrayBuffer) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, arrayBuffer)
  return {
    ivB64: bufToB64(iv),
    cipherBuf: cipher,
    header: `v1:${bufToB64(iv)}`,
  }
}

export async function desencriptarBytes(aesKey, ivB64, cipherBuf) {
  const iv = new Uint8Array(b64ToBuf(ivB64))
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, cipherBuf)
}

export function parseAnexoMeta(corpoCipher) {
  // Imagens: corpo_cipher guarda "img:v1:<ivB64>" e o ficheiro é ciphertext puro
  const s = String(corpoCipher || '')
  if (s.startsWith('img:v1:')) {
    return { kind: 'imagem', ivB64: s.slice(7) }
  }
  return null
}

export function montarMetaImagem(ivB64) {
  return `img:v1:${ivB64}`
}
