import React, { useState } from 'react'
import { Badge, Button, Input, Select } from '../../../components/ui'
import { montarRequisicaoTeste, ROTAS_TESTE, testarRequisicao } from '../../../lib/apiV1/chavesAdminApi.js'

const URL_DOCS = 'https://api.emerlab.com.br/docs'

const tomDoStatus = (status) => (status >= 200 && status < 300 ? 'ok' : status >= 500 || status === 429 ? 'warn' : 'erro')

export default function AdminApiTestar() {
    // A chave digitada vive só neste estado; ao trocar de aba o componente é desmontado e ela some.
    const [chave, setChave] = useState('')
    const [indice, setIndice] = useState('0')
    const [valores, setValores] = useState({})
    const [origem, setOrigem] = useState('')
    const [confirmou, setConfirmou] = useState(false)
    const [executando, setExecutando] = useState(false)
    const [resultado, setResultado] = useState(null)
    const [erro, setErro] = useState('')

    const rota = ROTAS_TESTE[Number(indice)]
    const faltando = rota.params.filter((p) => p.obrigatorio && !String(valores[p.nome] ?? '').trim())
    const podeExecutar = Boolean(chave.trim()) && faltando.length === 0 && (!rota.escrita || confirmou) && !executando

    const trocarRota = (e) => {
        setIndice(e.target.value)
        setValores({})
        setConfirmou(false)
        setResultado(null)
        setErro('')
    }

    const executar = async () => {
        setExecutando(true)
        setErro('')
        setResultado(null)
        try {
            const req = montarRequisicaoTeste(rota, valores)
            setResultado(
                await testarRequisicao({
                    chave: chave.trim(),
                    metodo: req.metodo,
                    caminho: req.caminho,
                    origem: origem.trim() || undefined,
                    corpo: req.corpo,
                    confirmar_escrita: rota.escrita ? confirmou : undefined,
                }),
            )
        } catch (e) {
            setErro(e.message)
        } finally {
            setExecutando(false)
        }
    }

    return (
        <section className="admin_api_grade">
            <div className="admin_api_painel">
                <h2>Requisição</h2>
                <p className="ek-hint" style={{ margin: 0 }}>
                    O teste usa a chave de verdade: conta no limite por minuto e, nas rotas que gravam, altera dados reais.{' '}
                    <a href={URL_DOCS} target="_blank" rel="noopener noreferrer">
                        Documentação da API
                    </a>
                </p>
                <Input
                    label="Chave de API"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={chave}
                    onChange={(e) => setChave(e.target.value)}
                    placeholder="emer_rede_… ou emer_pag_…"
                />
                <Select label="Rota" value={indice} onChange={trocarRota}>
                    {ROTAS_TESTE.map((r, i) => (
                        <option key={`${r.metodo} ${r.caminho}`} value={String(i)}>
                            {`${r.metodo} ${r.caminho} — ${r.rotulo}`}
                        </option>
                    ))}
                </Select>
                {rota.params.map((p) => (
                    <Input
                        key={`${indice}-${p.nome}`}
                        label={`${p.rotulo}${p.obrigatorio ? ' *' : ''}`}
                        value={valores[p.nome] ?? ''}
                        placeholder={p.dica}
                        onChange={(e) => setValores((v) => ({ ...v, [p.nome]: e.target.value }))}
                    />
                ))}
                <Input
                    label="Origem simulada"
                    value={origem}
                    onChange={(e) => setOrigem(e.target.value)}
                    placeholder="https://site.exemplo.com.br"
                    hint="Vai no cabeçalho Origin. Chaves da rede exigem uma origem da lista; chaves de pagamentos exigem vazio."
                />
                {rota.escrita ? (
                    <label className="ek-check">
                        <input type="checkbox" checked={confirmou} onChange={(e) => setConfirmou(e.target.checked)} />
                        Confirmo que isto grava dados reais
                    </label>
                ) : null}
                <div>
                    <Button onClick={executar} disabled={!podeExecutar}>
                        {executando ? 'Executando…' : 'Executar'}
                    </Button>
                </div>
            </div>

            <div className="admin_api_painel" aria-live="polite">
                <h2>Resultado</h2>
                {erro ? (
                    <div className="ek-banner ek-banner--erro" role="alert">
                        {erro}
                    </div>
                ) : null}
                {resultado ? (
                    <>
                        <div className="admin_api_lista">
                            <Badge tone={tomDoStatus(resultado.status)}>{`Status ${resultado.status}`}</Badge>
                            <Badge>{`${resultado.duracao_ms} ms`}</Badge>
                        </div>
                        {Object.keys(resultado.headers || {}).length ? (
                            <dl className="admin_api_cabecalhos">
                                {Object.entries(resultado.headers).map(([k, v]) => (
                                    <React.Fragment key={k}>
                                        <dt>{k}</dt>
                                        <dd>{v}</dd>
                                    </React.Fragment>
                                ))}
                            </dl>
                        ) : null}
                        <pre className="admin_api_json">{JSON.stringify(resultado.corpo, null, 2) ?? 'null'}</pre>
                    </>
                ) : !erro ? (
                    <p className="ek-hint" style={{ margin: 0 }}>
                        Preencha a chave e execute para ver a resposta aqui.
                    </p>
                ) : null}
            </div>
        </section>
    )
}
