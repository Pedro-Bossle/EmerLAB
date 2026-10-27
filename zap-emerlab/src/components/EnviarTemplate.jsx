import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import Modal from './Modal.jsx'
import Icone from './Icone.jsx'

const RE_VAR = /\{\{\s*([\w.]+)\s*\}\}/g

function nomesEm(texto) {
    return [...String(texto || '').matchAll(RE_VAR)].map((m) => m[1])
}

function ordenarVars(nomes) {
    return [...nomes].sort((a, b) => {
        const na = /^\d+$/.test(a)
        const nb = /^\d+$/.test(b)
        if (na && nb) return Number(a) - Number(b)
        if (na !== nb) return na ? -1 : 1
        return a.localeCompare(b, 'pt')
    })
}

/** Variáveis do cabeçalho, corpo, rodapé e botões (a WATI manda cada trecho separado). */
function variaveisDoTemplate(t) {
    if (!t) return []
    const ordem = []
    const visto = new Set()
    for (const parte of [t.cabecalho, t.corpo, t.rodape, t.botoes]) {
        for (const v of nomesEm(parte)) {
            if (visto.has(v)) continue
            visto.add(v)
            ordem.push(v)
        }
    }
    return ordenarVars(ordem)
}

function ondeAparece(t, nome) {
    const partes = []
    if (nomesEm(t.cabecalho).includes(nome)) partes.push('cabeçalho')
    if (nomesEm(t.corpo).includes(nome)) partes.push('corpo')
    if (nomesEm(t.rodape).includes(nome)) partes.push('rodapé')
    if (nomesEm(t.botoes).includes(nome)) partes.push('botão')
    return partes
}

function substituir(texto, valores) {
    return String(texto || '').replace(RE_VAR, (_, v) => (valores[v] != null && String(valores[v]).trim() !== '' ? valores[v] : `{{${v}}}`))
}

function valorInicial(v, conversa) {
    return v === '1' || /nome|name/i.test(v) ? conversa.nome?.split(' ')[0] || '' : ''
}

export default function EnviarTemplate({ conversa, config, aoFechar, aoEnviado, avisar }) {
    const [templates, setTemplates] = useState(null)
    const [erro, setErro] = useState('')
    const [busca, setBusca] = useState('')
    const [escolhido, setEscolhido] = useState(null)
    const [valores, setValores] = useState({})
    const [enviando, setEnviando] = useState(false)

    useEffect(() => {
        api('templates')
            .then((r) => setTemplates(r.templates))
            .catch((e) => setErro(e.message))
    }, [])

    const vars = useMemo(() => (escolhido ? variaveisDoTemplate(escolhido) : []), [escolhido])

    const escolher = (t) => {
        setEscolhido(t)
        const inicial = {}
        for (const v of variaveisDoTemplate(t)) inicial[v] = valorInicial(v, conversa)
        setValores(inicial)
    }

    const faltando = vars.filter((v) => !String(valores[v] || '').trim())
    const motivo = !config.canalConfigurado
        ? 'Envio bloqueado: o administrador precisa definir WATI_CHANNEL_NUMBER no .env.'
        : faltando.length
          ? `Preencha ${faltando.length === 1 ? 'a variável' : 'as variáveis'} ${faltando.map((v) => `{{${v}}}`).join(', ')} para enviar.`
          : ''

    const previaCabecalho = escolhido ? substituir(escolhido.cabecalho, valores) : ''
    const previaCorpo = escolhido ? substituir(escolhido.corpo, valores) : ''

    const enviar = async () => {
        setEnviando(true)
        try {
            await api(`conversas/${encodeURIComponent(conversa.waId)}/template`, { method: 'POST', body: { nome: escolhido.nome, parametros: valores } })
            aoEnviado()
        } catch (e) {
            avisar(e.message, 'erro')
            setEnviando(false)
        }
    }

    const filtrados = (templates || []).filter(
        (t) =>
            !busca ||
            t.nome.toLowerCase().includes(busca.toLowerCase()) ||
            t.corpo.toLowerCase().includes(busca.toLowerCase()) ||
            String(t.cabecalho || '')
                .toLowerCase()
                .includes(busca.toLowerCase()),
    )

    return (
        <Modal titulo={escolhido ? `Template: ${escolhido.nome}` : 'Enviar template'} aoFechar={aoFechar} largo>
            {!config.canalConfigurado ? <div className="alerta">Defina WATI_CHANNEL_NUMBER no .env para enviar templates.</div> : null}
            {erro ? <div className="alerta alerta-erro">{erro}</div> : null}
            {!escolhido ? (
                <>
                    <input className="entrada" placeholder="Buscar template…" value={busca} onChange={(e) => setBusca(e.target.value)} autoFocus />
                    {templates === null && !erro ? <div className="spinner spinner-centro" /> : null}
                    <div className="lista-templates">
                        {filtrados.map((t) => {
                            const nVars = variaveisDoTemplate(t).length
                            return (
                                <button key={`${t.nome}-${t.idioma}`} className="template-item" onClick={() => escolher(t)}>
                                    <div>
                                        <strong>{t.nome}</strong>
                                        <small>
                                            {t.categoria} {t.idioma ? `· ${t.idioma}` : ''}
                                            {nVars ? ` · ${nVars} var.` : ''}
                                        </small>
                                    </div>
                                    <p>{t.corpo}</p>
                                </button>
                            )
                        })}
                        {templates && filtrados.length === 0 ? <p className="lista-vazia">Nenhum template aprovado encontrado.</p> : null}
                    </div>
                </>
            ) : (
                <>
                    {vars.map((v) => {
                        const onde = ondeAparece(escolhido, v)
                        const rotulo = onde.length === 1 ? `${onde[0][0].toUpperCase()}${onde[0].slice(1)} {{${v}}}` : `Variável {{${v}}}`
                        return (
                            <label key={v} className="campo">
                                <span>{rotulo}</span>
                                <input value={valores[v] || ''} onChange={(e) => setValores((s) => ({ ...s, [v]: e.target.value }))} />
                            </label>
                        )
                    })}
                    <div className="previa-template">
                        <div className="msg-linha minha com-cauda">
                            <div className="msg">
                                {previaCabecalho ? <strong className="msg-texto">{previaCabecalho}</strong> : null}
                                <span className="msg-texto">{previaCorpo}</span>
                                {escolhido.rodape ? <small className="msg-rodape">{substituir(escolhido.rodape, valores)}</small> : null}
                            </div>
                        </div>
                    </div>
                    {motivo ? (
                        <p className="ajuda ajuda-motivo" role="status">
                            <Icone nome="info" tamanho={14} /> {motivo}
                        </p>
                    ) : null}
                    <div className="modal-acoes">
                        <button className="botao botao-secundario" onClick={() => setEscolhido(null)} disabled={enviando}>
                            Voltar
                        </button>
                        <button className="botao" onClick={enviar} disabled={enviando || Boolean(motivo)}>
                            {enviando ? 'Enviando…' : 'Enviar template'}
                        </button>
                    </div>
                </>
            )}
        </Modal>
    )
}
