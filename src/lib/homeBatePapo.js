import { supabase } from './supabase.js'
import {
  carregarOuCriarParChaves,
  desenrolarChaveConversa,
  desencriptarBytes,
  desencriptarTexto,
  encriptarBytes,
  encriptarTexto,
  envolverChaveConversa,
  gerarChaveConversaAes,
  importarPublicaJwk,
  montarMetaImagem,
  parseAnexoMeta,
} from './batePapoCrypto.js'

const MSG_INDISPONIVEL = 'Mensagem indisponível neste dispositivo'

function previewBatePapo(texto, max = 80) {
  const limpo = String(texto || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!limpo) return ''
  if (limpo.length <= max) return limpo
  return `${limpo.slice(0, max - 1)}…`
}

export { previewBatePapo }

async function uidAtual() {
  const { data } = await supabase.auth.getUser()
  const uid = data?.user?.id
  if (!uid) throw new Error('Sessão ausente.')
  return uid
}

function isMissingTable(err) {
  return /does not exist|schema cache|Could not find the table/i.test(String(err?.message || err || ''))
}

function mensagemErroBatePapo(err) {
  const msg = String(err?.message || err || '')
  if (isMissingTable(err) || /home_bate_papo_/i.test(msg)) {
    return 'Schema Emerzap ainda a atualizar. Aguarde uns segundos e tente de novo (ou recarregue a página).'
  }
  return msg || 'Erro no bate-papo.'
}

/** Garante par local + publica JWK no servidor. */
export async function garantirChavesUsuario() {
  const uid = await uidAtual()
  const pair = await carregarOuCriarParChaves()
  const { error } = await supabase.from('home_bate_papo_user_keys').upsert(
    {
      user_id: uid,
      public_jwk: pair.publicJwk,
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (error) throw new Error(mensagemErroBatePapo(error))
  return pair
}

async function buscarPublicas(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))]
  if (!ids.length) return new Map()
  const { data, error } = await supabase
    .from('home_bate_papo_user_keys')
    .select('user_id, public_jwk')
    .in('user_id', ids)
  if (error) throw new Error(mensagemErroBatePapo(error))
  return new Map((data || []).map((r) => [r.user_id, r.public_jwk]))
}

async function obterChaveConversa(conversaId, pair) {
  const uid = await uidAtual()
  const { data, error } = await supabase
    .from('home_bate_papo_participantes')
    .select('chave_conversa_envolvida')
    .eq('conversa_id', conversaId)
    .eq('user_id', uid)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const wrapped = data?.chave_conversa_envolvida
  if (!wrapped) throw new Error('Não é participante desta conversa.')

  if (String(wrapped).startsWith('legado:')) {
    return provisionarChaveLegado(conversaId, pair)
  }
  return desenrolarChaveConversa(wrapped, pair.privateKey)
}

/** Primeira abertura de DM migrado: gera AES e envolve para quem já tem public_jwk. */
async function provisionarChaveLegado(conversaId, pair) {
  const uid = await uidAtual()
  const { data: parts, error } = await supabase
    .from('home_bate_papo_participantes')
    .select('user_id, papel, chave_conversa_envolvida')
    .eq('conversa_id', conversaId)
  if (error) throw new Error(error.message)

  const me = (parts || []).find((p) => p.user_id === uid)
  if (!me) throw new Error('Não é participante.')

  // Só admin (ou qualquer se ambos pending) provisiona uma vez
  const aes = await gerarChaveConversaAes()
  const pubs = await buscarPublicas((parts || []).map((p) => p.user_id))

  for (const p of parts || []) {
    const jwk = pubs.get(p.user_id)
    if (!jwk) continue
    const pub = await importarPublicaJwk(jwk)
    const wrapped = await envolverChaveConversa(aes, pub)
    const { error: upErr } = await supabase
      .from('home_bate_papo_participantes')
      .update({ chave_conversa_envolvida: wrapped })
      .eq('conversa_id', conversaId)
      .eq('user_id', p.user_id)
    if (upErr) throw new Error(upErr.message)
  }

  // Se o próprio user não tinha pública (improvável pós garantirChaves), envolve agora
  const { data: meRow } = await supabase
    .from('home_bate_papo_participantes')
    .select('chave_conversa_envolvida')
    .eq('conversa_id', conversaId)
    .eq('user_id', uid)
    .maybeSingle()
  if (meRow?.chave_conversa_envolvida?.startsWith('legado:')) {
    const wrappedMe = await envolverChaveConversa(aes, pair.publicKey)
    await supabase
      .from('home_bate_papo_participantes')
      .update({ chave_conversa_envolvida: wrappedMe })
      .eq('conversa_id', conversaId)
      .eq('user_id', uid)
  }

  return aes
}

async function mapMensagem(row, aesKey, nomesPorId) {
  const base = {
    id: row.id,
    conversaId: row.conversa_id,
    remetenteId: row.remetente_id,
    tipo: row.tipo || 'texto',
    criadoEm: row.criado_em,
    remetenteNome: nomesPorId.get(row.remetente_id) || 'Usuário',
    anexoPath: row.anexo_path || null,
    corpo: MSG_INDISPONIVEL,
    cipherOk: false,
  }

  try {
    if (row.cipher_version === 0 && row.corpo_legado) {
      base.corpo = String(row.corpo_legado).trim()
      base.cipherOk = true
      return base
    }
    if (row.tipo === 'imagem') {
      const meta = parseAnexoMeta(row.corpo_cipher)
      base.corpo = meta ? '📷 Imagem' : MSG_INDISPONIVEL
      base.imagemIv = meta?.ivB64 || null
      base.cipherOk = Boolean(meta && aesKey)
      return base
    }
    if (aesKey && row.corpo_cipher) {
      base.corpo = await desencriptarTexto(aesKey, row.corpo_cipher)
      base.cipherOk = true
    }
  } catch {
    base.corpo = MSG_INDISPONIVEL
    base.cipherOk = false
  }
  return base
}

export async function listarUsuariosBatePapo({ excluirUserId } = {}) {
  const { data, error } = await supabase.from('profiles').select('id, name').order('name', { ascending: true })
  if (error) throw new Error(error.message)
  const excluir = String(excluirUserId || '')
  return (data || [])
    .filter((u) => u?.id && String(u.id) !== excluir)
    .map((u) => ({ id: u.id, nome: u.name || u.id }))
}

export async function obterOuCriarDm(outroUserId) {
  const uid = await uidAtual()
  const outro = String(outroUserId || '').trim()
  if (!outro || outro === uid) throw new Error('Destinatário inválido.')

  const pair = await garantirChavesUsuario()
  const userA = uid < outro ? uid : outro
  const userB = uid < outro ? outro : uid

  const { data: existente } = await supabase
    .from('home_bate_papo_dm_pares')
    .select('conversa_id')
    .eq('user_a', userA)
    .eq('user_b', userB)
    .maybeSingle()

  if (existente?.conversa_id) return existente.conversa_id

  const pubs = await buscarPublicas([uid, outro])
  if (!pubs.get(uid)) throw new Error('Publique a sua chave E2EE primeiro.')
  const aes = await gerarChaveConversaAes()
  const wrapMe = await envolverChaveConversa(aes, pair.publicKey)
  let wrapOutro = 'legado:pending'
  if (pubs.get(outro)) {
    const pubOutro = await importarPublicaJwk(pubs.get(outro))
    wrapOutro = await envolverChaveConversa(aes, pubOutro)
  }

  const { data: conv, error: cErr } = await supabase
    .from('home_bate_papo_conversas')
    .insert({ tipo: 'dm', nome: null, criado_por: uid })
    .select('id')
    .single()
  if (cErr) {
    if (isMissingTable(cErr)) {
      throw new Error('Schema Emerzap v2 ausente. Execute scripts/sql/home_bate_papo_v2.sql no Supabase.')
    }
    throw new Error(cErr.message)
  }

  const { error: pErr } = await supabase.from('home_bate_papo_participantes').insert([
    { conversa_id: conv.id, user_id: uid, papel: 'admin', chave_conversa_envolvida: wrapMe },
    { conversa_id: conv.id, user_id: outro, papel: 'membro', chave_conversa_envolvida: wrapOutro },
  ])
  if (pErr) throw new Error(pErr.message)

  const { error: dErr } = await supabase.from('home_bate_papo_dm_pares').insert({
    user_a: userA,
    user_b: userB,
    conversa_id: conv.id,
  })
  if (dErr && !/duplicate|unique/i.test(dErr.message)) throw new Error(dErr.message)

  return conv.id
}

export async function criarGrupo({ nome, memberIds }) {
  const uid = await uidAtual()
  const titulo = String(nome || '').trim()
  if (!titulo) throw new Error('Indique o nome do grupo.')
  const members = [...new Set((memberIds || []).map(String).filter((id) => id && id !== uid))]
  if (!members.length) throw new Error('Selecione pelo menos um participante.')

  const pair = await garantirChavesUsuario()
  const aes = await gerarChaveConversaAes()
  const allIds = [uid, ...members]
  const pubs = await buscarPublicas(allIds)

  const { data: conv, error: cErr } = await supabase
    .from('home_bate_papo_conversas')
    .insert({ tipo: 'grupo', nome: titulo, criado_por: uid })
    .select('id')
    .single()
  if (cErr) throw new Error(cErr.message)

  const rows = []
  for (const id of allIds) {
    const jwk = pubs.get(id)
    let wrapped = 'legado:pending'
    if (id === uid) {
      wrapped = await envolverChaveConversa(aes, pair.publicKey)
    } else if (jwk) {
      wrapped = await envolverChaveConversa(aes, await importarPublicaJwk(jwk))
    }
    rows.push({
      conversa_id: conv.id,
      user_id: id,
      papel: id === uid ? 'admin' : 'membro',
      chave_conversa_envolvida: wrapped,
    })
  }
  const { error: pErr } = await supabase.from('home_bate_papo_participantes').insert(rows)
  if (pErr) throw new Error(pErr.message)
  return conv.id
}

export async function listarConversasBatePapo({ userId } = {}) {
  const uid = userId || (await uidAtual().catch(() => null))
  if (!uid) return []

  try {
    await garantirChavesUsuario()
  } catch {
    /* continua; pode listar legado */
  }

  const { data: parts, error: pErr } = await supabase
    .from('home_bate_papo_participantes')
    .select('conversa_id, ultima_leitura_em, home_bate_papo_conversas ( id, tipo, nome, criado_em )')
    .eq('user_id', uid)
  if (pErr) {
    if (isMissingTable(pErr)) return listarConversasLegado(uid)
    throw new Error(pErr.message)
  }

  const conversaIds = (parts || []).map((p) => p.conversa_id).filter(Boolean)
  if (!conversaIds.length) return []

  const { data: msgs } = await supabase
    .from('home_bate_papo_mensagens_v2')
    .select('id, conversa_id, remetente_id, tipo, corpo_cipher, corpo_legado, cipher_version, criado_em')
    .in('conversa_id', conversaIds)
    .order('criado_em', { ascending: false })
    .limit(500)

  const ultimaPorConv = new Map()
  for (const m of msgs || []) {
    if (!ultimaPorConv.has(m.conversa_id)) ultimaPorConv.set(m.conversa_id, m)
  }

  const { data: allParts } = await supabase
    .from('home_bate_papo_participantes')
    .select('conversa_id, user_id')
    .in('conversa_id', conversaIds)

  const outrosIds = [
    ...new Set(
      (allParts || [])
        .filter((p) => p.user_id !== uid)
        .map((p) => p.user_id),
    ),
  ]
  let nomes = new Map()
  if (outrosIds.length) {
    const { data: perfis } = await supabase.from('profiles').select('id, name').in('id', outrosIds)
    nomes = new Map((perfis || []).map((p) => [p.id, p.name || p.id]))
  }

  const leituraMap = new Map((parts || []).map((p) => [p.conversa_id, p.ultima_leitura_em]))

  const out = []
  for (const p of parts || []) {
    const conv = p.home_bate_papo_conversas
    if (!conv?.id) continue
    const ultima = ultimaPorConv.get(conv.id)
    const peers = (allParts || []).filter((x) => x.conversa_id === conv.id && x.user_id !== uid)
    let titulo = conv.nome
    let peerId = null
    if (conv.tipo === 'dm') {
      peerId = peers[0]?.user_id || null
      titulo = peerId ? nomes.get(peerId) || 'Usuário' : 'Conversa'
    }

    let preview = ''
    if (ultima) {
      if (ultima.tipo === 'imagem') preview = '📷 Imagem'
      else if (ultima.cipher_version === 0) preview = previewBatePapo(ultima.corpo_legado)
      else preview = 'Mensagem criptografada'
    }

    const leitura = leituraMap.get(conv.id)
    let naoLidas = 0
    for (const m of msgs || []) {
      if (m.conversa_id !== conv.id) continue
      if (m.remetente_id === uid) continue
      if (!leitura || new Date(m.criado_em) > new Date(leitura)) naoLidas += 1
    }

    out.push({
      conversaId: conv.id,
      tipo: conv.tipo,
      nome: titulo,
      peerId,
      ultimaMensagem: preview,
      ultimaEm: ultima?.criado_em || conv.criado_em,
      naoLidas,
    })
  }

  return out.sort((a, b) => {
    if ((b.naoLidas || 0) !== (a.naoLidas || 0)) return (b.naoLidas || 0) - (a.naoLidas || 0)
    return new Date(b.ultimaEm || 0) - new Date(a.ultimaEm || 0)
  })
}

async function listarConversasLegado(uid) {
  const { data, error } = await supabase
    .from('home_bate_papo_mensagens')
    .select('id, remetente_id, destinatario_id, corpo, criado_em, lida_em')
    .or(`remetente_id.eq.${uid},destinatario_id.eq.${uid}`)
    .order('criado_em', { ascending: false })
    .limit(400)
  if (error) {
    if (isMissingTable(error)) return []
    throw new Error(error.message)
  }
  const porContato = new Map()
  for (const row of data || []) {
    const outro = row.remetente_id === uid ? row.destinatario_id : row.remetente_id
    if (!outro || outro === uid) continue
    if (!porContato.has(outro)) {
      porContato.set(outro, {
        conversaId: null,
        peerId: outro,
        tipo: 'dm',
        ultimaMensagem: previewBatePapo(row.corpo),
        ultimaEm: row.criado_em,
        naoLidas: 0,
      })
    }
    const c = porContato.get(outro)
    if (row.destinatario_id === uid && !row.lida_em) c.naoLidas += 1
  }
  const ids = [...porContato.keys()]
  let nomes = new Map()
  if (ids.length) {
    const { data: perfis } = await supabase.from('profiles').select('id, name').in('id', ids)
    nomes = new Map((perfis || []).map((p) => [p.id, p.name || p.id]))
  }
  return [...porContato.values()]
    .map((c) => ({ ...c, nome: nomes.get(c.peerId) || 'Usuário' }))
    .sort((a, b) => new Date(b.ultimaEm || 0) - new Date(a.ultimaEm || 0))
}

export async function listarMensagensConversa(conversaId) {
  const uid = await uidAtual()
  const cid = String(conversaId || '').trim()
  if (!cid) return []

  const pair = await garantirChavesUsuario()
  let aes = null
  try {
    aes = await obterChaveConversa(cid, pair)
  } catch {
    aes = null
  }

  const { data, error } = await supabase
    .from('home_bate_papo_mensagens_v2')
    .select(
      'id, conversa_id, remetente_id, tipo, corpo_cipher, corpo_legado, cipher_version, anexo_path, criado_em',
    )
    .eq('conversa_id', cid)
    .order('criado_em', { ascending: true })
    .limit(400)
  if (error) throw new Error(error.message)

  const ids = new Set((data || []).map((r) => r.remetente_id).filter(Boolean))
  let nomes = new Map()
  if (ids.size) {
    const { data: perfis } = await supabase.from('profiles').select('id, name').in('id', [...ids])
    nomes = new Map((perfis || []).map((p) => [p.id, p.name || p.id]))
    nomes.set(uid, 'Você')
  }

  const mapped = []
  for (const row of data || []) {
    mapped.push(await mapMensagem(row, aes, nomes))
  }
  return mapped
}

/** Compat: abre DM pelo userId do contacto. */
export async function listarMensagensBatePapoCom(outroUserId) {
  const cid = await obterOuCriarDm(outroUserId)
  return listarMensagensConversa(cid)
}

export async function enviarMensagemTexto(conversaId, texto) {
  const uid = await uidAtual()
  const corpo = String(texto || '').trim()
  if (!corpo) throw new Error('Digite uma mensagem.')
  const pair = await garantirChavesUsuario()
  const aes = await obterChaveConversa(conversaId, pair)
  const cipher = await encriptarTexto(aes, corpo)

  const { data, error } = await supabase
    .from('home_bate_papo_mensagens_v2')
    .insert({
      conversa_id: conversaId,
      remetente_id: uid,
      tipo: 'texto',
      corpo_cipher: cipher,
      cipher_version: 1,
    })
    .select(
      'id, conversa_id, remetente_id, tipo, corpo_cipher, corpo_legado, cipher_version, anexo_path, criado_em',
    )
    .single()
  if (error) throw new Error(error.message)

  return mapMensagem(data, aes, new Map([[uid, 'Você']]))
}

export async function enviarMensagemBatePapo(destinatarioId, texto) {
  const cid = await obterOuCriarDm(destinatarioId)
  return enviarMensagemTexto(cid, texto)
}

export async function enviarImagemConversa(conversaId, file) {
  const uid = await uidAtual()
  if (!file || !file.type?.startsWith('image/')) throw new Error('Selecione uma imagem.')
  if (file.size > 4.5 * 1024 * 1024) throw new Error('Imagem demasiado grande (máx. ~4,5 MB).')

  const pair = await garantirChavesUsuario()
  const aes = await obterChaveConversa(conversaId, pair)
  const buf = await file.arrayBuffer()
  const { ivB64, cipherBuf } = await encriptarBytes(aes, buf)
  const msgId = crypto.randomUUID()
  const path = `${conversaId}/${msgId}.bin`

  const { error: upErr } = await supabase.storage
    .from('bate-papo-anexos')
    .upload(path, cipherBuf, { contentType: 'application/octet-stream', upsert: false })
  if (upErr) throw new Error(upErr.message)

  const { data, error } = await supabase
    .from('home_bate_papo_mensagens_v2')
    .insert({
      id: msgId,
      conversa_id: conversaId,
      remetente_id: uid,
      tipo: 'imagem',
      corpo_cipher: montarMetaImagem(ivB64),
      cipher_version: 1,
      anexo_path: path,
    })
    .select(
      'id, conversa_id, remetente_id, tipo, corpo_cipher, corpo_legado, cipher_version, anexo_path, criado_em',
    )
    .single()
  if (error) throw new Error(error.message)

  const mapped = await mapMensagem(data, aes, new Map([[uid, 'Você']]))
  return mapped
}

export async function baixarImagemDescriptografada(msg) {
  if (!msg?.anexoPath || !msg.imagemIv || !msg.conversaId) {
    throw new Error('Anexo inválido.')
  }
  const pair = await garantirChavesUsuario()
  const aes = await obterChaveConversa(msg.conversaId, pair)
  const { data, error } = await supabase.storage.from('bate-papo-anexos').download(msg.anexoPath)
  if (error) throw new Error(error.message)
  const cipherBuf = await data.arrayBuffer()
  const plain = await desencriptarBytes(aes, msg.imagemIv, cipherBuf)
  return URL.createObjectURL(new Blob([plain], { type: 'image/jpeg' }))
}

export async function marcarConversaComoLida(conversaId) {
  const uid = await uidAtual()
  const { error } = await supabase
    .from('home_bate_papo_participantes')
    .update({ ultima_leitura_em: new Date().toISOString() })
    .eq('conversa_id', conversaId)
    .eq('user_id', uid)
  if (error && !isMissingTable(error)) throw new Error(error.message)
}

/** Compat legado DM */
export async function marcarMensagensBatePapoComoLidas(outroUserId) {
  try {
    const cid = await obterOuCriarDm(outroUserId)
    await marcarConversaComoLida(cid)
  } catch {
    const uid = await uidAtual()
    await supabase
      .from('home_bate_papo_mensagens')
      .update({ lida_em: new Date().toISOString() })
      .eq('destinatario_id', uid)
      .eq('remetente_id', outroUserId)
      .is('lida_em', null)
  }
}

export async function contarNaoLidasBatePapo({ userId } = {}) {
  const uid = userId || (await uidAtual().catch(() => null))
  if (!uid) return 0

  const { data: parts, error } = await supabase
    .from('home_bate_papo_participantes')
    .select('conversa_id, ultima_leitura_em')
    .eq('user_id', uid)
  if (error) {
    if (isMissingTable(error)) {
      const { count } = await supabase
        .from('home_bate_papo_mensagens')
        .select('id', { count: 'exact', head: true })
        .eq('destinatario_id', uid)
        .is('lida_em', null)
      return count || 0
    }
    throw new Error(error.message)
  }

  let total = 0
  for (const p of parts || []) {
    let q = supabase
      .from('home_bate_papo_mensagens_v2')
      .select('id', { count: 'exact', head: true })
      .eq('conversa_id', p.conversa_id)
      .neq('remetente_id', uid)
    if (p.ultima_leitura_em) q = q.gt('criado_em', p.ultima_leitura_em)
    const { count } = await q
    total += count || 0
  }
  return total
}

export async function tentarMigrarDmsLegado() {
  const { error } = await supabase.rpc('home_bate_papo_migrar_dms_legado')
  if (error && !isMissingTable(error) && !/function|permission/i.test(error.message)) {
    console.warn('[bate-papo] migração legado:', error.message)
  }
}
