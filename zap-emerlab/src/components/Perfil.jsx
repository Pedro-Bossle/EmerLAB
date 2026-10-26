import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { formatarTelefone, canalDoId, CANAIS, TIPOS_CONTATO, normalizarTextoBusca } from '../util.js'
import Icone from './Icone.jsx'
import { Avatar } from './ListaConversas.jsx'
import SelectUfBusca from './SelectUfBusca.jsx'
import SelectMunicipioBusca from './SelectMunicipioBusca.jsx'

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const OPCOES_TIPO = TIPOS_CONTATO.map((nome) => ({ id: nome, nome }))

/** Se o valor salvo bater com um tipo padrão (ignorando acento/caixa), devolve o rótulo canônico. */
function tipoCanonico(valor) {
    const v = normalizarTextoBusca(valor)
    if (!v) return ''
    return TIPOS_CONTATO.find((t) => normalizarTextoBusca(t) === v) || String(valor || '').trim()
}

// Atributos da WATI exibidos na ficha (o servidor manda nesta ordem: name, phone, cidade, uf, tipo)
const CAMPOS_WATI = {
    name: ['Nome', { input: { maxLength: 80 } }],
    phone: ['Telefone', { input: { inputMode: 'tel', maxLength: 20 } }],
    uf: ['UF', {}],
    cidade: ['Cidade', { input: { maxLength: 60 } }],
    tipo: ['Tipo', {}],
}

// municípios do IBGE por UF (via servidor do painel), guardados enquanto a página está aberta
const municipiosCache = new Map()
function carregarMunicipios(uf) {
    if (!municipiosCache.has(uf)) {
        const pedido = api(`ibge/municipios?uf=${encodeURIComponent(uf)}`).then((r) => r.municipios)
        pedido.catch(() => municipiosCache.delete(uf))
        municipiosCache.set(uf, pedido)
    }
    return municipiosCache.get(uf)
}

// "Dados do contato", aberto ao clicar no nome da conversa (como no WhatsApp Web)
export default function Perfil({ conversa, sugestoesTags, aoFechar, aoSalvo, avisar }) {
    const { waId } = conversa
    const caminho = `conversas/${encodeURIComponent(waId)}/perfil`
    const canal = canalDoId(waId)
    const [dados, setDados] = useState(null)
    const [form, setForm] = useState(null)
    const [erro, setErro] = useState('')
    // '' | 'salvando' | 'salvo' | 'erro' — mostrado no topo no lugar de um botão Salvar
    const [estadoSalvar, setEstadoSalvar] = useState('')
    const [novaTag, setNovaTag] = useState('')
    const original = useRef(null)
    // cópia síncrona do form: o salvamento roda no blur, antes do próximo render
    const formAtual = useRef(null)
    const fila = useRef({ rodando: false, denovo: false })
    const painel = useRef(null)

    useEffect(() => {
        let vivo = true
        api(caminho)
            .then((r) => {
                if (!vivo) return
                const f = { ...r.perfil, atributos: r.wati?.atributos || [] }
                original.current = f
                formAtual.current = f
                setDados(r)
                setForm(f)
            })
            .catch((e) => vivo && setErro(e.message))
        return () => {
            vivo = false
        }
    }, [caminho])

    // Esc fecha só o perfil (a conversa continua aberta)
    useEffect(() => {
        const esc = (e) => {
            // com um modal por cima (transferir, template…), o Esc é dele
            if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[aria-modal="true"]')) return
            e.preventDefault()
            aoFechar()
        }
        document.addEventListener('keydown', esc)
        return () => document.removeEventListener('keydown', esc)
    }, [aoFechar])

    useEffect(() => painel.current?.focus(), [])

    // salva sozinho: texto ao sair do campo; seletores e etiquetas assim que mudam
    const salvar = async () => {
        const q = fila.current
        if (q.rodando) {
            q.denovo = true
            return
        }
        const f = formAtual.current
        const base = original.current
        if (!f || !base || igual(f, base)) return
        q.rodando = true
        setEstadoSalvar('salvando')
        try {
            const r = await api(caminho, {
                method: 'PUT',
                body: {
                    email: f.email,
                    tags: f.tags,
                    notas: f.notas,
                    // só os atributos que mudaram: reenviar os vazios faria a WATI recusar tudo
                    atributos: f.atributos.filter((a, i) => a.value !== base.atributos[i]?.value),
                },
            })
            original.current = { ...f, tags: r.tags }
            // o servidor pode normalizar as etiquetas; só aplica se ninguém mexeu nelas durante o envio
            if (!igual(r.tags, f.tags) && igual(formAtual.current.tags, f.tags)) alterar({ ...formAtual.current, tags: r.tags })
            const atributos = Object.fromEntries(f.atributos.filter((a) => a.value).map((a) => [a.name.toLowerCase(), a.value]))
            aoSalvo({ tags: r.tags }, atributos)
            const avisos = []
            if (r.falhasTags?.length) {
                const naoAdicionadas = r.falhasTags.filter((x) => x.acao === 'adicionar').map((x) => x.tag)
                const naoRemovidas = r.falhasTags.filter((x) => x.acao === 'remover').map((x) => x.tag)
                if (naoAdicionadas.length) avisos.push(`etiqueta(s) ${naoAdicionadas.join(', ')} não foram para a WATI (crie a tag lá com o mesmo nome)`)
                if (naoRemovidas.length) avisos.push(`etiqueta(s) ${naoRemovidas.join(', ')} não saíram da WATI`)
            }
            if (r.avisoWati) avisos.push(`atributos não foram para a WATI: ${r.avisoWati}`)
            if (r.atributosVazios?.length) avisos.push(`a WATI não aceita apagar atributo: ${r.atributosVazios.join(', ')} continua(m) com o valor antigo lá`)
            if (avisos.length) avisar(`Perfil salvo no painel, mas ${avisos.join('; ')}.`, 'aviso')
            setEstadoSalvar('salvo')
        } catch (e) {
            // original não muda: a próxima saída de campo tenta de novo
            avisar(`Dados do contato não salvos: ${e.message}`, 'erro')
            setEstadoSalvar('erro')
        } finally {
            q.rodando = false
            if (q.denovo) {
                q.denovo = false
                salvar()
            }
        }
    }

    const alterar = (f, salvarJa = false) => {
        formAtual.current = f
        setForm(f)
        if (salvarJa) salvar()
    }

    // fechar a ficha (Esc, X) ou trocar de conversa com um campo ainda focado também salva
    useEffect(() => () => salvar(), [caminho]) // eslint-disable-line react-hooks/exhaustive-deps

    const adicionarTag = (bruta) => {
        const t = String(bruta || '').trim().replace(/\s+/g, ' ').slice(0, 30)
        setNovaTag('')
        if (t && !form.tags.some((x) => x.toLowerCase() === t.toLowerCase())) alterar({ ...form, tags: [...form.tags, t] }, true)
    }

    const aoTeclarTag = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            adicionarTag(novaTag)
        } else if (e.key === 'Backspace' && !novaTag && form.tags.length) {
            alterar({ ...form, tags: form.tags.slice(0, -1) }, true)
        }
    }

    // cidade e UF usam os mesmos seletores do projeto principal (Credenciamento)
    const indiceDe = (chave) => (form?.atributos || []).findIndex((x) => x.name.toLowerCase() === chave)
    const ufAtual = form?.atributos[indiceDe('uf')]?.value || ''
    const [municipios, setMunicipios] = useState({ uf: '', lista: [], carregando: false })
    useEffect(() => {
        if (!ufAtual) return
        let vivo = true
        setMunicipios({ uf: ufAtual, lista: [], carregando: true })
        carregarMunicipios(ufAtual)
            .then((lista) => vivo && setMunicipios({ uf: ufAtual, lista, carregando: false }))
            .catch(() => vivo && setMunicipios({ uf: ufAtual, lista: [], carregando: false }))
        return () => {
            vivo = false
        }
    }, [ufAtual])

    const mudarUf = (uf) => {
        const iUf = indiceDe('uf')
        const iCidade = indiceDe('cidade')
        // a cidade escolhida era da UF anterior: limpa para escolher de novo
        const trocou = uf !== ufAtual && ufAtual
        alterar(
            {
                ...form,
                atributos: form.atributos.map((a, j) => (j === iUf ? { ...a, value: uf } : j === iCidade && trocou ? { ...a, value: '' } : a)),
            },
            true,
        )
    }

    const campoAtributo = (a, i) => {
        const chave = a.name.toLowerCase()
        if (chave === 'uf') {
            return (
                <div key={a.name} className="campo">
                    <span>UF</span>
                    <SelectUfBusca value={a.value} onChange={mudarUf} placeholder="UF" aria-label="UF" />
                </div>
            )
        }
        if (chave === 'cidade') {
            const lista = municipios.uf === ufAtual ? municipios.lista : []
            return (
                <div key={a.name} className="campo">
                    <span>Cidade</span>
                    <SelectMunicipioBusca
                        options={lista}
                        value={a.value}
                        onChange={(v) => mudarAtributo(i, v, true)}
                        loading={Boolean(ufAtual) && municipios.carregando}
                        placeholder={ufAtual ? 'Selecionar cidade…' : 'Escolha a UF primeiro'}
                        creatable
                        createLabel={(q) => `Usar «${q}»`}
                        aria-label="Cidade"
                    />
                </div>
            )
        }
        if (chave === 'tipo') {
            const valor = tipoCanonico(a.value)
            // valor livre antigo (fora da lista) entra nas opções só nesta sessão, para continuar visível
            const extras =
                valor && !OPCOES_TIPO.some((o) => normalizarTextoBusca(o.nome) === normalizarTextoBusca(valor))
                    ? [{ id: valor, nome: valor }]
                    : []
            return (
                <div key={a.name} className="campo">
                    <span>Tipo</span>
                    <SelectMunicipioBusca
                        options={[...OPCOES_TIPO, ...extras]}
                        value={valor}
                        onChange={(v) => mudarAtributo(i, tipoCanonico(v) || v, true)}
                        placeholder="Selecionar tipo…"
                        searchPlaceholder="Buscar tipo…"
                        creatable
                        createLabel={(q) => `Usar «${q}»`}
                        aria-label="Tipo"
                    />
                </div>
            )
        }
        const [rotulo, extra] = CAMPOS_WATI[chave] || [a.name, {}]
        return (
            <label key={a.name} className="campo">
                <span>{rotulo}</span>
                <input
                    value={a.value}
                    onChange={(e) => mudarAtributo(i, extra.maiusculas ? e.target.value.toUpperCase() : e.target.value)}
                    onBlur={salvar}
                    {...extra.input}
                />
            </label>
        )
    }

    const mudarAtributo = (i, valor, salvarJa = false) =>
        alterar({ ...form, atributos: form.atributos.map((a, j) => (j === i ? { ...a, value: valor } : a)) }, salvarJa)

    const fone = canal === 'whatsapp' ? formatarTelefone(waId) : null
    const sugestoes = useMemo(() => {
        if (!form) return []
        const jaTem = new Set(form.tags.map((t) => t.toLowerCase()))
        const q = normalizarTextoBusca(novaTag)
        return (sugestoesTags || [])
            .filter((t) => !jaTem.has(String(t).toLowerCase()))
            .filter((t) => !q || normalizarTextoBusca(t).includes(q))
            .slice(0, q ? 12 : 8)
    }, [form, sugestoesTags, novaTag])

    return (
        <aside className="perfil" aria-label="Dados do contato" tabIndex={-1} ref={painel}>
            <header className="barra perfil-topo">
                <button className="icone-botao" onClick={aoFechar} aria-label="Fechar dados do contato" data-dica="Fechar (Esc)">
                    <Icone nome="fechar" />
                </button>
                <strong>Dados do contato</strong>
                <span className={`perfil-estado ${estadoSalvar}`} role="status">
                    {estadoSalvar === 'salvando' ? 'Salvando…' : estadoSalvar === 'salvo' ? 'Salvo' : estadoSalvar === 'erro' ? 'Não salvo' : ''}
                </span>
            </header>

            <div className="perfil-corpo">
                <div className="perfil-cabeca">
                    <Avatar conversa={conversa} tamanho={96} />
                    <h2>{form?.nomeWhatsapp || conversa.nome || fone || 'Contato'}</h2>
                    <p>{fone || CANAIS[canal].rotulo}</p>
                </div>

                {erro ? (
                    <div className="alerta alerta-erro" role="alert">
                        Não foi possível abrir o perfil. {erro}
                    </div>
                ) : null}
                {!form && !erro ? <div className="spinner spinner-centro" aria-label="Carregando perfil" /> : null}

                {form ? (
                    <form
                        className="perfil-form"
                        onSubmit={(e) => {
                            e.preventDefault()
                            salvar()
                        }}
                    >
                        {dados?.avisoWati ? <p className="ajuda ajuda-motivo">Dados da WATI indisponíveis: {dados.avisoWati}</p> : null}

                        {form.atributos.map((a, i) => {
                            const chave = a.name.toLowerCase()
                            const temUf = form.atributos.some((x) => x.name.toLowerCase() === 'uf')
                            // cidade vai na mesma linha da UF (UF → Cidade); se não houver UF, a cidade aparece sozinha
                            if (chave === 'cidade' && temUf) return null
                            if (chave === 'uf') {
                                const iCidade = form.atributos.findIndex((x) => x.name.toLowerCase() === 'cidade')
                                return (
                                    <div key={a.name} className="campo-par">
                                        {campoAtributo(a, i)}
                                        {iCidade >= 0 ? campoAtributo(form.atributos[iCidade], iCidade) : null}
                                    </div>
                                )
                            }
                            return campoAtributo(a, i)
                        })}

                        <div className="campo">
                            <span id="perfil-tags">Etiquetas</span>
                            <div className="tags-entrada" onClick={(e) => e.currentTarget.querySelector('input')?.focus()}>
                                {form.tags.map((t) => (
                                    <span key={t} className="tag tag-neutra tag-removivel">
                                        {t}
                                        <button type="button" aria-label={`Remover etiqueta ${t}`} onClick={() => alterar({ ...form, tags: form.tags.filter((x) => x !== t) }, true)}>
                                            <Icone nome="fechar" tamanho={12} />
                                        </button>
                                    </span>
                                ))}
                                <input
                                    aria-labelledby="perfil-tags"
                                    value={novaTag}
                                    onChange={(e) => setNovaTag(e.target.value)}
                                    onKeyDown={aoTeclarTag}
                                    placeholder={form.tags.length ? '' : 'ex.: VIP, Retorno, Orçamento'}
                                />
                            </div>
                            {sugestoes.length ? (
                                <div className="tags-sugestoes" role="list" aria-label="Etiquetas já existentes">
                                    {sugestoes.map((t) => (
                                        <button type="button" key={t} className="chip" role="listitem" onClick={() => adicionarTag(t)}>
                                            + {t}
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                            <small className="ajuda">
                                Sugestões vêm das etiquetas já cadastradas na WATI / usadas no painel. Digite para filtrar; Enter adiciona. Tudo é salvo automaticamente.
                                A tag precisa existir na WATI com o mesmo nome para ser aplicada lá.
                            </small>
                        </div>

                        <label className="campo">
                            <span>E-mail</span>
                            <input type="email" value={form.email} onChange={(e) => alterar({ ...form, email: e.target.value })} onBlur={salvar} placeholder="cliente@exemplo.com" maxLength={120} />
                        </label>

                        <label className="campo">
                            <span>Notas</span>
                            <textarea rows={4} value={form.notas} onChange={(e) => alterar({ ...form, notas: e.target.value })} onBlur={salvar} maxLength={2000} placeholder="Preferências, histórico, combinados…" />
                        </label>

                    </form>
                ) : null}
            </div>
        </aside>
    )
}
