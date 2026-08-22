/**
 * E2EE Emerzap (Web Crypto).
 * - Par RSA-OAEP por utilizador (privada local + cópia na cloud cifrada com senha da chave).
 * - Chave AES-GCM por conversa, envolvida com a pública de cada participante.
 */

export const PRIV_STORAGE_KEY = 'emerlab-bate-papo-priv-jwk-v1'
const PBKDF2_ITERS = 210_000
const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Normaliza senha da chave (trim + NFC) para comparação/cifragem consistentes. */
export function normalizarSenhaChave(senha) {
  return String(senha || '')
    .normalize('NFC')
    .trim()
}

function bufToB64(buf) {
  let bytes
  if (buf instanceof ArrayBuffer) bytes = new Uint8Array(buf)
  else if (ArrayBuffer.isView(buf)) bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  else bytes = new Uint8Array(buf)
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

export function lerPrivJwkLocal() {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(PRIV_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function salvarPrivJwkLocal(privJwk) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(PRIV_STORAGE_KEY, JSON.stringify(privJwk))
  } catch {
    /* ignore */
  }
}

export function limparPrivJwkLocal() {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(PRIV_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function publicaDePrivJwk(privJwk) {
  return {
    kty: privJwk.kty,
    n: privJwk.n,
    e: privJwk.e,
    alg: 'RSA-OAEP-256',
    ext: true,
    key_ops: ['encrypt'],
  }
}

export function privadaCorrespondePublica(privJwk, publicJwk) {
  if (!privJwk?.n || !publicJwk?.n) return false
  return String(privJwk.n) === String(publicJwk.n) && String(privJwk.e || 'AQAB') === String(publicJwk.e || 'AQAB')
}

export async function importarParDePrivJwk(privJwk) {
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    privJwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['decrypt'],
  )
  const publicJwk = publicaDePrivJwk(privJwk)
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    publicJwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['encrypt'],
  )
  return { privateKey, publicKey, publicJwk, privJwk }
}

async function derivarChaveDaSenha(senha, saltBuf) {
  const base = await crypto.subtle.importKey('raw', encoder.encode(String(senha)), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBuf, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Cifra a privada JWK com senha da conta → `v1:salt:iv:cipher` (só o servidor guarda isto). */
export async function envolverPrivComSenha(privJwk, senha) {
  const s = normalizarSenhaChave(senha)
  if (s.length < 6) throw new Error('A senha da chave deve ter pelo menos 6 caracteres.')
  if (!privJwk?.n || !privJwk?.d) throw new Error('Chave privada inválida para cifrar.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await derivarChaveDaSenha(s, salt)
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(privJwk)),
  )
  return `v1:${bufToB64(salt)}:${bufToB64(iv)}:${bufToB64(cipher)}`
}

export async function desenrolarPrivComSenha(blob, senha) {
  const raw = typeof blob === 'string' ? blob : blob == null ? '' : String(blob)
  const s = normalizarSenhaChave(senha)
  const parts = raw.split(':')
  if (parts[0] !== 'v1' || parts.length < 4) {
    throw new Error('Formato de chave de conta inválido.')
  }
  const salt = new Uint8Array(b64ToBuf(parts[1]))
  const iv = new Uint8Array(b64ToBuf(parts[2]))
  const data = b64ToBuf(parts.slice(3).join(':'))
  const key = await derivarChaveDaSenha(s, salt)
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
    return JSON.parse(decoder.decode(plain))
  } catch {
    throw new Error('Senha da chave incorreta.')
  }
}

/** Carrega o par local ou gera um novo (só quando ainda não há identidade na cloud). */
export async function carregarOuCriarParChaves() {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    throw new Error('Web Crypto indisponível neste ambiente.')
  }
  const local = lerPrivJwkLocal()
  if (local) {
    try {
      return await importarParDePrivJwk(local)
    } catch {
      limparPrivJwkLocal()
    }
  }

  const pair = await gerarParRsa()
  const privExport = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  salvarPrivJwkLocal(privExport)
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, publicJwk, privJwk: privExport }
}

export async function gerarNovoParChaves() {
  const pair = await gerarParRsa()
  const privExport = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  salvarPrivJwkLocal(privExport)
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, publicJwk, privJwk: privExport }
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
  const s = String(corpoCipher || '')
  if (s.startsWith('img:v1:')) {
    return { kind: 'imagem', ivB64: s.slice(7) }
  }
  return null
}

export function montarMetaImagem(ivB64) {
  return `img:v1:${ivB64}`
}
