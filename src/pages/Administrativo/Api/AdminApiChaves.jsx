import React, { useCallback, useEffect, useState } from 'react'
import { Badge, Button, EmptyState, ErrorState, Input, LoadingState, Modal, ResponsiveTable, Select, Textarea } from '../../../components/ui'
import {
    criarChave,
    editarChave,
    formDeChave,
    girarChave,
    listarChaves,
    mensagemDeErro,
    montarPayloadEdicao,
    revogarChave,
    validarFormChave,
} from '../../../lib/apiV1/chavesAdminApi.js'
import { LIMITE_PADRAO } from '../../../lib/apiV1/chavesAdminRegras.js'
import { confirmarAcao } from '../../../lib/dialogos.js'
import { useAutoDismiss } from '../../../lib/toastUi.js'

const FORM_VAZIO = { nome: '', tipo: 'rede', origensTexto: '', ipsTexto: '', limite: '', expiraEm: '', escrita: false }
const TONS = { ativa: 'ok', revogada: 'erro', expirada: 'warn' }
const ROTULOS_ESTADO = { ativa: 'Ativa', revogada: 'Revogada', expirada: 'Expirada' }

const formatarData = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR') : 'Nunca')

function FormChave({ form, setForm, edicao = false, erro = '', onEditar }) {
    const campo = (nome) => (e) => {
        onEditar?.()
        setForm((f) => ({ ...f, [nome]: e.target.value }))
    }
    return (
        <div className="admin_api_form">
            {erro ? (
                <div className="ek-banner ek-banner--erro" role="alert">
                    {erro}
                </div>
            ) : null}
            <Input label="Nome" value={form.nome} onChange={campo('nome')} maxLength={80} placeholder="Ex.: Site institucional" />
            {!edicao ? (
                <Select label="Tipo" value={form.tipo} onChange={campo('tipo')}>
                    <option value="rede">Rede credenciada (navegador, exige origem)</option>
                    <option value="pagamentos">Pagamentos (servidor a servidor)</option>
                </Select>
            ) : null}
            {form.tipo === 'rede' ? (
                <Textarea
                    label="Origens permitidas"
                    hint="Uma por linha, no formato https://dominio[:porta]. Sem caminho nem curinga. http://localhost e http://127.0.0.1 só valem para desenvolvimento local."
                    value={form.origensTexto}
                    onChange={campo('origensTexto')}
                    rows={3}
                />
            ) : (
                <label className="ek-check">
                    <input
                        type="checkbox"
                        checked={form.escrita}
                        onChange={(e) => {
                            onEditar?.()
                            setForm((f) => ({ ...f, escrita: e.target.checked }))
                        }}
                    />
                    Permitir escrita (marcar pagamento e comprovantes)
                </label>
            )}
            <Input
                label="Limite por minuto"
                type="number"
                min="1"
                max="10000"
                value={form.limite}
                onChange={campo('limite')}
                placeholder={String(LIMITE_PADRAO[form.tipo])}
                hint="De 1 a 10000. Vazio usa o padrão do tipo."
            />
            <Input label="Expira em (opcional)" type="date" value={form.expiraEm} onChange={campo('expiraEm')} />
            <Textarea
                label="IPs permitidos (opcional)"
                hint="Um por linha. Vazio aceita qualquer IP."
                value={form.ipsTexto}
                onChange={campo('ipsTexto')}
                rows={2}
            />
        </div>
    )
}

export default function AdminApiChaves() {
    const [chaves, setChaves] = useState([])
    const [carregando, setCarregando] = useState(true)
    const [falha, setFalha] = useState('')
    const [mensagem, setMensagem] = useState('')
    const [erro, setErro] = useState('')
    const [formNova, setFormNova] = useState(null)
    const [editando, setEditando] = useState(null)
    const [formEdicao, setFormEdicao] = useState(FORM_VAZIO)
    const [salvando, setSalvando] = useState(false)
    // Erros de criar/editar ficam dentro do modal (o banner da página fica atrás dele).
    const [erroModal, setErroModal] = useState('')
    // A chave completa fica só neste estado: nunca em storage nem na URL.
    const [chaveNova, setChaveNova] = useState(null)
    const [copiada, setCopiada] = useState(false)

    useAutoDismiss(Boolean(mensagem || erro), () => {
        setMensagem('')
        setErro('')
    })

    const carregar = useCallback(async () => {
        setCarregando(true)
        setFalha('')
        try {
            setChaves(await listarChaves())
        } catch (e) {
            setFalha(e.message)
        } finally {
            setCarregando(false)
        }
    }, [])

    useEffect(() => {
        void carregar()
    }, [carregar])

    const fecharNova = () => {
        setErroModal('')
        setFormNova(null)
    }

    const fecharEdicao = () => {
        setErroModal('')
        setEditando(null)
    }

    const fecharChaveNova = () => {
        setChaveNova(null)
        setCopiada(false)
    }

    const criar = async () => {
        const v = validarFormChave(formNova)
        if (!v.ok) {
            setErroModal(mensagemDeErro(v))
            return
        }
        setErroModal('')
        setSalvando(true)
        try {
            const r = await criarChave(v.payload)
            setFormNova(null)
            setChaveNova({ titulo: 'Chave criada', chave: r.chave, nome: r.registro?.nome })
            await carregar()
        } catch (e) {
            setErroModal(mensagemDeErro(e))
        } finally {
            setSalvando(false)
        }
    }

    const abrirEdicao = (linha) => {
        setErroModal('')
        setEditando(linha)
        setFormEdicao(formDeChave(linha))
    }

    const salvarEdicao = async () => {
        const v = validarFormChave(formEdicao)
        if (!v.ok) {
            setErroModal(mensagemDeErro(v))
            return
        }
        setErroModal('')
        const payload = montarPayloadEdicao(formEdicao, editando)
        if (Object.keys(payload).length === 0) {
            setEditando(null)
            return
        }
        setSalvando(true)
        try {
            await editarChave(editando.id, payload)
            setEditando(null)
            setMensagem('Chave atualizada. A mudança pode levar até 30 segundos para valer.')
            await carregar()
        } catch (e) {
            setErroModal(mensagemDeErro(e))
        } finally {
            setSalvando(false)
        }
    }

    const revogar = async (linha) => {
        const ok = await confirmarAcao({
            titulo: 'Revogar chave?',
            mensagem: `«${linha.nome}» deixa de funcionar em até 30 segundos. Isso não pode ser desfeito.`,
            confirmar: 'Revogar chave',
            perigo: true,
        })
        if (!ok) return
        try {
            await revogarChave(linha.id)
            setMensagem(`Chave «${linha.nome}» revogada.`)
            await carregar()
        } catch (e) {
            setErro(e.message)
        }
    }

    const girar = async (linha) => {
        const ok = await confirmarAcao({
            titulo: 'Girar chave?',
            mensagem: `Cria uma chave nova com as mesmas regras e revoga «${linha.nome}». Quem usa a chave antiga precisa trocar para a nova.`,
            confirmar: 'Girar chave',
            perigo: true,
        })
        if (!ok) return
        try {
            const r = await girarChave(linha.id)
            setChaveNova({ titulo: 'Chave girada', chave: r.chave, nome: r.registro?.nome })
            await carregar()
        } catch (e) {
            setErro(e.message)
        }
    }

    const copiar = async () => {
        try {
            await navigator.clipboard.writeText(chaveNova.chave)
            setCopiada(true)
        } catch {
            setErro('Não foi possível copiar. Selecione o texto da chave e copie manualmente.')
        }
    }

    return (
        <section>
            {erro || mensagem ? (
                <div className={`ek-banner ${erro ? 'ek-banner--erro' : 'ek-banner--ok'}`} role={erro ? 'alert' : 'status'}>
                    {erro || mensagem}
                </div>
            ) : null}

            <div className="admin_api_barra">
                <p>A chave completa aparece uma única vez, ao criar ou girar. Depois só o prefixo fica visível.</p>
                <Button onClick={() => {
                        setErroModal('')
                        setFormNova({ ...FORM_VAZIO })
                    }}>Nova chave</Button>
            </div>

            {carregando ? (
                <LoadingState label="Carregando chaves…" />
            ) : falha ? (
                <ErrorState title="Não foi possível carregar as chaves" description={falha} onRetry={carregar} />
            ) : chaves.length === 0 ? (
                <EmptyState title="Nenhuma chave criada" description="Crie a primeira chave para liberar o acesso à API." />
            ) : (
                <ResponsiveTable stack>
                    <thead>
                        <tr>
                            <th>Nome</th>
                            <th>Prefixo</th>
                            <th>Escopos</th>
                            <th>Origens</th>
                            <th>Último uso</th>
                            <th>Estado</th>
                            <th>Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        {chaves.map((c) => (
                            <tr key={c.id}>
                                <td data-label="Nome">{c.nome}</td>
                                <td data-label="Prefixo" className="admin_api_mono">
                                    {c.prefixo}…
                                </td>
                                <td data-label="Escopos">
                                    <div className="admin_api_lista">
                                        {c.escopos.map((e) => (
                                            <Badge key={e}>{e}</Badge>
                                        ))}
                                    </div>
                                </td>
                                <td data-label="Origens">{c.origens_permitidas.length ? c.origens_permitidas.join(', ') : '—'}</td>
                                <td data-label="Último uso">{formatarData(c.ultimo_uso_em)}</td>
                                <td data-label="Estado">
                                    <Badge tone={TONS[c.estado] || 'neutral'}>{ROTULOS_ESTADO[c.estado] || c.estado}</Badge>
                                </td>
                                <td data-label="Ações">
                                    {c.estado === 'revogada' ? (
                                        '—'
                                    ) : (
                                        <div className="admin_api_acoes">
                                            <Button variant="secondary" size="sm" onClick={() => abrirEdicao(c)}>
                                                Editar
                                            </Button>
                                            <Button variant="secondary" size="sm" onClick={() => girar(c)}>
                                                Girar
                                            </Button>
                                            <Button variant="danger" size="sm" onClick={() => revogar(c)}>
                                                Revogar
                                            </Button>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </ResponsiveTable>
            )}

            <Modal
                open={Boolean(formNova)}
                onClose={fecharNova}
                title="Nova chave"
                busy={salvando}
                footer={
                    <>
                        <Button variant="secondary" onClick={fecharNova} disabled={salvando}>
                            Cancelar
                        </Button>
                        <Button onClick={criar} disabled={salvando}>
                            {salvando ? 'Criando…' : 'Criar chave'}
                        </Button>
                    </>
                }
            >
                {formNova ? <FormChave form={formNova} setForm={setFormNova} erro={erroModal} onEditar={() => setErroModal('')} /> : null}
            </Modal>

            <Modal
                open={Boolean(editando)}
                onClose={fecharEdicao}
                title={`Editar «${editando?.nome || ''}»`}
                busy={salvando}
                footer={
                    <>
                        <Button variant="secondary" onClick={fecharEdicao} disabled={salvando}>
                            Cancelar
                        </Button>
                        <Button onClick={salvarEdicao} disabled={salvando}>
                            {salvando ? 'Salvando…' : 'Salvar'}
                        </Button>
                    </>
                }
            >
                {editando ? <FormChave form={formEdicao} setForm={setFormEdicao} edicao erro={erroModal} onEditar={() => setErroModal('')} /> : null}
            </Modal>

            <Modal
                open={Boolean(chaveNova)}
                onClose={fecharChaveNova}
                dismissOnBackdrop={false}
                title={chaveNova?.titulo || 'Chave'}
                footer={<Button onClick={fecharChaveNova}>Já copiei, fechar</Button>}
            >
                {chaveNova ? (
                    <div className="admin_api_form">
                        <div className="ek-banner ek-banner--warn" role="alert">
                            Copie agora; ela não será exibida novamente.
                        </div>
                        <div className="admin_api_chave_nova">
                            <code aria-label={`Chave de «${chaveNova.nome || ''}»`}>{chaveNova.chave}</code>
                            <Button variant="secondary" onClick={copiar}>
                                {copiada ? 'Copiada' : 'Copiar'}
                            </Button>
                        </div>
                    </div>
                ) : null}
            </Modal>
        </section>
    )
}
