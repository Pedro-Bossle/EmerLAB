import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import Modal from './Modal.jsx'

// extrai {{1}}, {{nome}} etc. do corpo do template
function variaveis(corpo) {
    return [...new Set([...String(corpo).matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]))]
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

    const vars = useMemo(() => (escolhido ? variaveis(escolhido.corpo) : []), [escolhido])

    const escolher = (t) => {
        setEscolhido(t)
        const inicial = {}
        for (const v of variaveis(t.corpo)) inicial[v] = v === '1' || /nome|name/i.test(v) ? conversa.nome?.split(' ')[0] || '' : ''
        setValores(inicial)
    }

    const previa = escolhido ? escolhido.corpo.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, v) => valores[v] || `{{${v}}}`) : ''

    const enviar = async () => {
        setEnviando(true)
        try {
            await api(`conversas/${conversa.waId}/template`, { method: 'POST', body: { nome: escolhido.nome, parametros: valores } })
            aoEnviado()
        } catch (e) {
            avisar(e.message, 'erro')
            setEnviando(false)
        }
    }

    const filtrados = (templates || []).filter((t) => !busca || t.nome.toLowerCase().includes(busca.toLowerCase()) || t.corpo.toLowerCase().includes(busca.toLowerCase()))

    return (
        <Modal titulo={escolhido ? `Template: ${escolhido.nome}` : 'Enviar template'} aoFechar={aoFechar} largo>
            {!config.canalConfigurado ? <div className="alerta">Defina WATI_CHANNEL_NUMBER no .env para enviar templates.</div> : null}
            {erro ? <div className="alerta alerta-erro">{erro}</div> : null}
            {!escolhido ? (
                <>
                    <input className="entrada" placeholder="Buscar template…" value={busca} onChange={(e) => setBusca(e.target.value)} autoFocus />
                    {templates === null && !erro ? <div className="spinner spinner-centro" /> : null}
                    <div className="lista-templates">
                        {filtrados.map((t) => (
                            <button key={`${t.nome}-${t.idioma}`} className="template-item" onClick={() => escolher(t)}>
                                <div>
                                    <strong>{t.nome}</strong>
                                    <small>
                                        {t.categoria} {t.idioma ? `· ${t.idioma}` : ''}
                                    </small>
                                </div>
                                <p>{t.corpo}</p>
                            </button>
                        ))}
                        {templates && filtrados.length === 0 ? <p className="lista-vazia">Nenhum template aprovado encontrado.</p> : null}
                    </div>
                </>
            ) : (
                <>
                    {vars.map((v) => (
                        <label key={v} className="campo">
                            <span>Variável {`{{${v}}}`}</span>
                            <input value={valores[v] || ''} onChange={(e) => setValores((s) => ({ ...s, [v]: e.target.value }))} />
                        </label>
                    ))}
                    <div className="previa-template">
                        <div className="msg-linha minha com-cauda">
                            <div className="msg">
                                {escolhido.cabecalho ? <strong className="msg-texto">{escolhido.cabecalho}</strong> : null}
                                <span className="msg-texto">{previa}</span>
                                {escolhido.rodape ? <small className="msg-rodape">{escolhido.rodape}</small> : null}
                            </div>
                        </div>
                    </div>
                    <div className="modal-acoes">
                        <button className="botao botao-secundario" onClick={() => setEscolhido(null)} disabled={enviando}>
                            Voltar
                        </button>
                        <button className="botao" onClick={enviar} disabled={enviando || !config.canalConfigurado || vars.some((v) => !valores[v])}>
                            {enviando ? 'Enviando…' : 'Enviar template'}
                        </button>
                    </div>
                </>
            )}
        </Modal>
    )
}
