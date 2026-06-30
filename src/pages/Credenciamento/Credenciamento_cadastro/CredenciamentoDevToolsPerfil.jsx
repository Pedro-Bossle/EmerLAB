import React, { useState } from 'react'
import { hasStoredDevTools } from '../../../lib/accessControl.js'
import { useDevToolsUi } from '../../../lib/devToolsUi.js'
import {
    filtrarCodigosRemovendoCategoriasExame,
    limparProcedimentosPrestadorCategoriasExame,
} from '../../../lib/prestadorProcedimentos.js'
import CopiarCodigosProcedimentosBtn from './CopiarCodigosProcedimentosBtn.jsx'

const ACOES = [
    { escopo: 'simples', rotulo: 'Exames simples' },
    { escopo: 'especiais', rotulo: 'Exames especiais' },
    { escopo: 'ambas', rotulo: 'Simples + especiais' },
]

export default function CredenciamentoDevToolsPerfil({
    prestadorId,
    procSelecionados,
    onChangeSelecionados,
    somenteLeitura,
}) {
    const [painelAberto, setPainelAberto] = useState(false)
    const [busy, setBusy] = useState('')
    const [feedback, setFeedback] = useState('')
    const { ui: devToolsUi } = useDevToolsUi()
    const mostrarCopiarCodigos =
        hasStoredDevTools() && Boolean(devToolsUi.colunasCadastro?.copiarCodigosProcs)

    const executar = async (escopo, rotulo) => {
        if (somenteLeitura) return
        const ok = window.confirm(
            `Limpar todos os procedimentos de «${rotulo}» deste credenciado? Não há desfazer automático.`,
        )
        if (!ok) return
        setBusy(escopo)
        setFeedback('')
        try {
            if (prestadorId) {
                const { removidos, restantes } = await limparProcedimentosPrestadorCategoriasExame(
                    prestadorId,
                    escopo,
                )
                onChangeSelecionados(restantes)
                setFeedback(
                    removidos
                        ? `${removidos} procedimento(s) removido(s) e gravado(s) no perfil.`
                        : 'Nenhum procedimento dessas categorias estava vinculado.',
                )
            } else {
                const { removidos, codigos } = await filtrarCodigosRemovendoCategoriasExame(procSelecionados, escopo)
                onChangeSelecionados(codigos)
                setFeedback(
                    removidos
                        ? `${removidos} removido(s) da seleção. Clique em Salvar para persistir.`
                        : 'Nenhum procedimento dessas categorias na seleção atual.',
                )
            }
        } catch (e) {
            setFeedback(e?.message || String(e))
        } finally {
            setBusy('')
        }
    }

    return (
        <div className="pcad_dev_tools_perfil">
            <div className="pcad_servicos_opcoes pcad_dev_tools_perfil_opcoes">
                {mostrarCopiarCodigos ? (
                    <CopiarCodigosProcedimentosBtn
                        prestadorId={prestadorId}
                        codigosAtuais={procSelecionados}
                        className="credenciamento_main_action_btn secondary pcad_dev_tools_copiar_codigos"
                        rotulo="Dev · copiar códigos do perfil"
                    />
                ) : null}
                <button
                    type="button"
                    className={`credenciamento_main_action_btn secondary pcad_servicos_toggle pcad_dev_tools_perfil_toggle ${painelAberto ? 'is-on' : ''}`}
                    onClick={() => setPainelAberto((v) => !v)}
                    aria-expanded={painelAberto}
                >
                    Dev · limpar categorias de exame
                </button>
            </div>
            {painelAberto ? (
                <div className="pcad_servicos_massa pcad_dev_tools_perfil_painel">
                    <p className="pcad_dev_tools_perfil_desc">
                        Remove vínculos nas categorias cujo nome indica exames simples ou especiais. Use só para
                        correção em massa.
                    </p>
                    <div className="pcad_servicos_massa_actions pcad_dev_tools_perfil_acoes">
                        {ACOES.map(({ escopo, rotulo }) => (
                            <button
                                key={escopo}
                                type="button"
                                className="credenciamento_main_action_btn secondary pcad_dev_tools_perfil_acao"
                                disabled={somenteLeitura || !!busy}
                                onClick={() => void executar(escopo, rotulo)}
                            >
                                {busy === escopo ? 'Aguarde…' : `Limpar ${rotulo}`}
                            </button>
                        ))}
                    </div>
                    {feedback ? <p className="pcad_servicos_massa_feedback">{feedback}</p> : null}
                </div>
            ) : null}
        </div>
    )
}
