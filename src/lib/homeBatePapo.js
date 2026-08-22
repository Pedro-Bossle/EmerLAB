import { supabase } from './supabase.js'
import {
  desenrolarChaveConversa,
  desenrolarPrivComSenha,
  desencriptarBytes,
  desencriptarTexto,
  encriptarBytes,
  encriptarTexto,
  envolverChaveConversa,
  envolverPrivComSenha,
  gerarChaveConversaAes,
  gerarNovoParChaves,
  importarParDePrivJwk,
  importarPublicaJwk,
  lerPrivJwkLocal,
  limparPrivJwkLocal,
  montarMetaImagem,
  normalizarSenhaChave,
  parseAnexoMeta,
  privadaCorrespondePublica,
  salvarPrivJwkLocal,
} from './batePapoCrypto.js'

const MSG_INDISPONIVEL = 'Mensagem indisponível neste dispositivo'

/** Códigos de UI para senha da chave de conta (multi-dispositivo). */
export const CHAVE_CONTA_SETUP = 'CHAVE_CONTA_SETUP'
export const CHAVE_CONTA_UNLOCK = 'CHAVE_CONTA_UNLOCK'
export const CHAVE_CONTA_ATIVAR_SYNC = 'CHAVE_CONTA_ATIVAR_SYNC'
export const CHAVE_CONTA_BLOQUEADO = 'CHAVE_CONTA_BLOQUEADO'

export function isErroChaveConta(err) {
  const code = err?.code || ''
  return (
    code === CHAVE_CONTA_SETUP ||
    code === CHAVE_CONTA_UNLOCK ||
    code === CHAVE_CONTA_ATIVAR_SYNC ||
    code === CHAVE_CONTA_BLOQUEADO ||
    String(err?.message || '').includes('CHAVE_CONTA_')
  )
}

function erroChaveConta(code, message) {
  const err = new Error(message || code)
  err.code = code
  return err
}

async function buscarRowChaveConta(uid) {
  const { data, error } = await supabase
    .from('home_bate_papo_user_keys')
    .select('user_id, public_jwk, priv_cipher, chave_reset_pedido_em, atualizado_em')
    .eq('user_id', uid)
    .maybeSingle()
  if (error) {
    // Colunas novas ainda não existem → fallback
    if (/priv_cipher|chave_reset_pedido_em|column/i.test(String(error.message || ''))) {
      const { data: legacy, error: err2 } = await supabase
        .from('home_bate_papo_user_keys')
        .select('user_id, public_jwk, atualizado_em')
        .eq('user_id', uid)
        .maybeSingle()
      if (err2) throw new Error(mensagemErroBatePapo(err2))
      return legacy ? { ...legacy, priv_cipher: null, chave_reset_pedido_em: null } : null
    }
    throw new Error(mensagemErroBatePapo(error))
  }
  return data
}

async function upsertChaveConta({ uid, publicJwk, privCipher, manterPrivCipher = false }) {
  const payload = {
    user_id: uid,
    public_jwk: publicJwk,
    atualizado_em: new Date().toISOString(),
  }
  if (!manterPrivCipher) {
    payload.priv_cipher = privCipher ?? null
    if (privCipher) {
      payload.chave_reset_pedido_em = null
    }
  }
  const { error } = await supabase.from('home_bate_papo_user_keys').upsert(payload, { onConflict: 'user_id' })
  if (error) {
    if (privCipher != null && /priv_cipher|column/i.test(String(error.message || ''))) {
      throw new Error(
        'Execute o SQL scripts/sql/home_bate_papo_chave_conta.sql no Supabase para ativar sync multi-dispositivo.',
      )
    }
    // Sem coluna chave_reset_pedido_em: tenta sem o campo
    if (/chave_reset_pedido_em/i.test(String(error.message || ''))) {
      delete payload.chave_reset_pedido_em
      const { error: err2 } = await supabase
        .from('home_bate_papo_user_keys')
        .upsert(payload, { onConflict: 'user_id' })
      if (err2) throw new Error(mensagemErroBatePapo(err2))
      return
    }
    throw new Error(mensagemErroBatePapo(error))
  }
}

/**
 * Inspeciona se a identidade E2EE está pronta neste aparelho.
 * @returns {{ status: 'ok'|'setup'|'unlock'|'ativar_sync'|'bloqueado', pair?: object, message?: string }}
 */
export async function inspecionarChaveConta() {
  const uid = await uidAtual()
  const row = await buscarRowChaveConta(uid)
  const local = lerPrivJwkLocal()
  const temCipher = Boolean(row?.priv_cipher)
  const temPublica = Boolean(row?.public_jwk?.n)

  if (temCipher) {
    if (local && privadaCorrespondePublica(local, row.public_jwk)) {
      const pair = await importarParDePrivJwk(local)
      return { status: 'ok', pair }
    }
    return {
      status: 'unlock',
      message: 'Desbloqueie a chave Emerzap com a senha definida noutro aparelho.',
    }
  }

  const resetPedido = Boolean(row?.chave_reset_pedido_em)
  const msgReset =
    'Um administrador pediu a redefinição da senha da chave Emerzap. Defina uma nova senha para continuar.'

  if (local) {
    if (temPublica && !privadaCorrespondePublica(local, row.public_jwk)) {
      // Reset admin: descarta chave local antiga e permite criar nova senha neste aparelho
      if (resetPedido) {
        return {
          status: 'setup',
          message: msgReset,
        }
      }
      return {
        status: 'bloqueado',
        message:
          'Este aparelho tem uma chave antiga diferente da conta. No aparelho onde o Emerzap já funciona, defina a senha da chave. Depois volte aqui e desbloqueie.',
      }
    }
    const pair = await importarParDePrivJwk(local)
    if (!temPublica) {
      await upsertChaveConta({ uid, publicJwk: pair.publicJwk, privCipher: null })
    }
    return {
      status: 'ativar_sync',
      pair,
      message: resetPedido
        ? msgReset
        : 'Defina uma senha da chave para usar o Emerzap noutros aparelhos (obrigatório).',
    }
  }

  if (temPublica && !temCipher) {
    // Reset admin: sem cipher na cloud → utilizador deve definir nova senha (nova chave)
    if (resetPedido) {
      return {
        status: 'setup',
        message: `${msgReset} Se este não for o aparelho original, as conversas antigas podem ficar ilegíveis neste dispositivo.`,
      }
    }
    return {
      status: 'bloqueado',
      message:
        'A conta já tem chave pública, mas a sincronização ainda não foi ativada. Abra o Emerzap no aparelho original e defina a senha da chave.',
    }
  }

  return {
    status: 'setup',
    message: resetPedido
      ? msgReset
      : 'Crie a senha da chave Emerzap (protege o histórico entre aparelhos).',
  }
}

/** Configura senha (setup ou ativar_sync) e grava priv_cipher na cloud. */
export async function configurarChaveContaComSenha(senha, senhaConfirm) {
  const s = normalizarSenhaChave(senha)
  const c = normalizarSenhaChave(senhaConfirm)
  if (s.length < 6) throw new Error('A senha da chave deve ter pelo menos 6 caracteres.')
  if (s !== c) throw new Error('As senhas não coincidem. Confirme a mesma senha nos dois campos.')

  const uid = await uidAtual()
  const row = await buscarRowChaveConta(uid)
  let pair

  if (row?.priv_cipher) {
    throw erroChaveConta(CHAVE_CONTA_UNLOCK, 'Esta conta já tem chave sincronizada. Use desbloquear.')
  }

  const local = lerPrivJwkLocal()
  const resetPedido = Boolean(row?.chave_reset_pedido_em)

  if (resetPedido) {
    // Reset admin: gera chave nova (não reutiliza privada antiga que pode divergir)
    limparPrivJwkLocal()
    pair = await gerarNovoParChaves()
  } else if (local && (!row?.public_jwk || privadaCorrespondePublica(local, row.public_jwk))) {
    pair = await importarParDePrivJwk(local)
  } else if (row?.public_jwk && !row?.priv_cipher) {
    throw erroChaveConta(
      CHAVE_CONTA_BLOQUEADO,
      'Não é possível criar nova chave: a conta já publicou uma pública sem sync. Use o aparelho original.',
    )
  } else {
    pair = await gerarNovoParChaves()
  }

  const privJwk = pair.privJwk || lerPrivJwkLocal()
  const privCipher = await envolverPrivComSenha(privJwk, s)
  // Garante que a mesma senha consegue abrir o blob antes de gravar na cloud
  const roundTrip = await desenrolarPrivComSenha(privCipher, s)
  if (!privadaCorrespondePublica(roundTrip, pair.publicJwk)) {
    throw new Error('Falha ao validar a senha da chave. Tente novamente.')
  }
  salvarPrivJwkLocal(privJwk)
  await upsertChaveConta({ uid, publicJwk: pair.publicJwk, privCipher })
  return pair
}

/** Desbloqueia a privada da cloud com a senha e grava em localStorage. */
export async function desbloquearChaveContaComSenha(senha) {
  const uid = await uidAtual()
  const row = await buscarRowChaveConta(uid)
  if (!row?.priv_cipher) {
    throw erroChaveConta(CHAVE_CONTA_SETUP, 'Ainda não há chave sincronizada. Configure a senha primeiro.')
  }
  const privJwk = await desenrolarPrivComSenha(row.priv_cipher, senha)
  if (!privadaCorrespondePublica(privJwk, row.public_jwk)) {
    throw new Error('A chave desbloqueada não corresponde à pública da conta.')
  }
  salvarPrivJwkLocal(privJwk)
  return importarParDePrivJwk(privJwk)
}

/**
 * Garante par RSA utilizável neste aparelho.
 * Não regenera chave se a cloud já tiver identidade (evita “mensagem indisponível” multi-device).
 */
export async function garantirChavesUsuario() {
  const est = await inspecionarChaveConta()
  if (est.status === 'ok' && est.pair) {
    const uid = await uidAtual()
    await upsertChaveConta({
      uid,
      publicJwk: est.pair.publicJwk,
      manterPrivCipher: true,
    })
    return est.pair
  }
  if (est.status === 'ativar_sync') {
    throw erroChaveConta(CHAVE_CONTA_ATIVAR_SYNC, est.message)
  }
  if (est.status === 'setup') {
    throw erroChaveConta(CHAVE_CONTA_SETUP, est.message)
  }
  if (est.status === 'unlock') {
    throw erroChaveConta(CHAVE_CONTA_UNLOCK, est.message)
  }
  throw erroChaveConta(CHAVE_CONTA_BLOQUEADO, est.message || 'Chave de conta indisponível.')
}

async function buscarPublicas(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))]
  if (!ids.length) return new Map()
  const { data, error } = await supabase.rpc('home_bate_papo_publicas', { uids: ids })
  if (!error) {
    return new Map((data || []).map((r) => [r.user_id, r.public_jwk]))
  }
  // Fallback: view ou tabela (antes do SQL de chave de conta)
  const { data: rows, error: err2 } = await supabase
    .from('home_bate_papo_user_public_keys')
    .select('user_id, public_jwk')
    .in('user_id', ids)
  if (!err2) {
    return new Map((rows || []).map((r) => [r.user_id, r.public_jwk]))
  }
  const { data: legacy, error: err3 } = await supabase
    .from('home_bate_papo_user_keys')
    .select('user_id, public_jwk')
    .in('user_id', ids)
  if (err3) throw new Error(mensagemErroBatePapo(error || err2 || err3))
  return new Map((legacy || []).map((r) => [r.user_id, r.public_jwk]))
}

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

export const MSG_CHAVE_PENDENTE =
  'A sincronizar a chave desta conversa… Se outro participante tiver o Emerzap aberto, deve concluir em poucos segundos.'

export function isErroChavePendente(err) {
  const msg = String(err?.message || err || '')
  return (
    msg.includes('ainda não está neste dispositivo') ||
    msg.includes('A sincronizar a chave') ||
    msg.includes('CHAVE_PENDENTE')
  )
}

function chaveEstaPendente(wrapped) {
  return !wrapped || String(wrapped).startsWith('legado:')
}

function chaveEstaV1(wrapped) {
  return String(wrapped || '').startsWith('v1:')
}

/** Com AES válida, re-envolve a chave para todos os participantes com pública conhecida. */
async function reenveloparParticipantes(conversaId, aesKey, pair) {
  const uid = await uidAtual()
  const { data: parts, error } = await supabase
    .from('home_bate_papo_participantes')
    .select('user_id, chave_conversa_envolvida')
    .eq('conversa_id', conversaId)
  if (error) throw new Error(error.message)

  const pubs = await buscarPublicas((parts || []).map((p) => p.user_id))
  pubs.set(uid, pair.publicJwk)

  for (const p of parts || []) {
    const jwk = pubs.get(p.user_id)
    if (!jwk) continue
    // Só re-envolve quem está pendente (ou o próprio, para validar o wrap local)
    if (p.user_id !== uid && !chaveEstaPendente(p.chave_conversa_envolvida)) continue
    try {
      const pub = p.user_id === uid ? pair.publicKey : await importarPublicaJwk(jwk)
      const wrapped = await envolverChaveConversa(aesKey, pub)
      const { error: upErr } = await supabase
        .from('home_bate_papo_participantes')
        .update({ chave_conversa_envolvida: wrapped })
        .eq('conversa_id', conversaId)
        .eq('user_id', p.user_id)
      if (upErr) {
        console.warn('[emerzap] reenvelopar', p.user_id, upErr.message)
      }
    } catch (e) {
      console.warn('[emerzap] reenvelopar falhou', p.user_id, e?.message || e)
    }
  }
}

async function marcarMinhaChavePendente(conversaId) {
  const uid = await uidAtual()
  await supabase
    .from('home_bate_papo_participantes')
    .update({ chave_conversa_envolvida: 'legado:pending' })
    .eq('conversa_id', conversaId)
    .eq('user_id', uid)
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

  if (chaveEstaPendente(wrapped)) {
    return provisionarOuAguardarChave(conversaId, pair)
  }

  try {
    const aes = await desenrolarChaveConversa(wrapped, pair.privateKey)
    await reenveloparParticipantes(conversaId, aes, pair)
    return aes
  } catch {
    // OperationError típico: privada local ≠ pública com que a chave foi envolvida
    await marcarMinhaChavePendente(conversaId)
    throw new Error(MSG_CHAVE_PENDENTE)
  }
}

/**
 * Se ninguém tem chave v1 ainda → gera AES (migração / conversa nova).
 * Se já existe v1 noutro participante → NÃO gerar AES nova (destruiria o histórico).
 */
async function provisionarOuAguardarChave(conversaId, pair) {
  const uid = await uidAtual()
  const { data: parts, error } = await supabase
    .from('home_bate_papo_participantes')
    .select('user_id, papel, chave_conversa_envolvida')
    .eq('conversa_id', conversaId)
  if (error) throw new Error(error.message)

  const me = (parts || []).find((p) => p.user_id === uid)
  if (!me) throw new Error('Não é participante.')

  const alguemComChave = (parts || []).some((p) => chaveEstaV1(p.chave_conversa_envolvida))
  if (alguemComChave) {
    throw new Error(MSG_CHAVE_PENDENTE)
  }

  // Ninguém tem v1: — primeira provisionação (DM migrado / grupo ainda sem cifra ativa)
  const aes = await gerarChaveConversaAes()
  await reenveloparParticipantes(conversaId, aes, pair)

  const { data: meRow } = await supabase
    .from('home_bate_papo_participantes')
    .select('chave_conversa_envolvida')
    .eq('conversa_id', conversaId)
    .eq('user_id', uid)
    .maybeSingle()
  if (chaveEstaPendente(meRow?.chave_conversa_envolvida)) {
    const wrappedMe = await envolverChaveConversa(aes, pair.publicKey)
    const { error: upErr } = await supabase
      .from('home_bate_papo_participantes')
      .update({ chave_conversa_envolvida: wrappedMe })
      .eq('conversa_id', conversaId)
      .eq('user_id', uid)
    if (upErr) throw new Error(upErr.message)
  }

  return aes
}

/** Quem já tem a AES re-envolve os outros; útil em realtime quando alguém fica pendente. */
export async function sincronizarChavesConversaSePossivel(conversaId) {
  const cid = String(conversaId || '').trim()
  if (!cid) return false
  try {
    const pair = await garantirChavesUsuario()
    await obterChaveConversa(cid, pair)
    return true
  } catch {
    return false
  }
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

/**
 * Lista participantes de uma conversa (DM ou grupo) da qual o utilizador faz parte.
 * Não devolve chaves envolvidas — só id, nome e papel.
 */
export async function listarParticipantesConversa(conversaId) {
  const uid = await uidAtual()
  const cid = String(conversaId || '').trim()
  if (!cid) return []

  const { data: parts, error } = await supabase
    .from('home_bate_papo_participantes')
    .select('user_id, papel, entrou_em')
    .eq('conversa_id', cid)
  if (error) throw new Error(error.message)

  const ids = [...new Set((parts || []).map((p) => p.user_id).filter(Boolean))]
  let nomes = new Map()
  if (ids.length) {
    const { data: perfis } = await supabase.from('profiles').select('id, name').in('id', ids)
    nomes = new Map((perfis || []).map((p) => [p.id, p.name || p.id]))
  }

  return (parts || [])
    .map((p) => {
      const souEu = p.user_id === uid
      return {
        id: p.user_id,
        nome: souEu ? 'Você' : nomes.get(p.user_id) || 'Usuário',
        papel: p.papel || 'membro',
        souEu,
        entrouEm: p.entrou_em || null,
      }
    })
    .sort((a, b) => {
      if (a.papel === 'admin' && b.papel !== 'admin') return -1
      if (b.papel === 'admin' && a.papel !== 'admin') return 1
      if (a.souEu !== b.souEu) return a.souEu ? -1 : 1
      return String(a.nome).localeCompare(String(b.nome), 'pt-BR')
    })
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

    const participantesCount = (allParts || []).filter((x) => x.conversa_id === conv.id).length

    out.push({
      conversaId: conv.id,
      tipo: conv.tipo,
      nome: titulo,
      peerId,
      participantesCount,
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
  let avisoChave = ''
  try {
    aes = await obterChaveConversa(cid, pair)
  } catch (e) {
    avisoChave = e?.message || MSG_CHAVE_PENDENTE
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

  const temCifradas = (data || []).some((r) => Number(r.cipher_version) !== 0)
  if (!aes && temCifradas && avisoChave) {
    const err = new Error(avisoChave)
    err.mensagensParciais = mapped
    throw err
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
