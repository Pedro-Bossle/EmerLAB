import React, { useState } from 'react'
import {
    CAMPOS_EXPORT_CREDENCIADOS,
    CHAVES_CAMPOS_EXPORT_CREDENCIADOS,
    exportarCredenciadosParaExcel,
} from '../../../lib/configuracoes/exportCredenciadosExcel.js'
import CredenciamentoMainAlert from '../../../components/Toast/CredenciamentoMainAlert.jsx'
import '../../Credenciamento/Credenciamento_main/Credenciamento_main.css'
import './ConfigExportarCredenciados.css'

const CAMPOS_POR_GRUPO = CAMPOS_EXPORT_CREDENCIADOS.reduce((acc, campo) => {
    const grupo = campo.grupo || 'Campos'
    if (!acc.has(grupo)) acc.set(grupo, [])
    acc.get(grupo).push(campo)
    return acc
}, new Map())

const ConfigExportarCredenciados = () => {
    const [exportando, setExportando] = useState(false)
    const [erro, setErro] = useState('')
    const [feedback, setFeedback] = useState('')
    const [camposSelecionados, setCamposSelecionados] = useState(() => [
        ...CHAVES_CAMPOS_EXPORT_CREDENCIADOS,
    ])

    const setCampo = (chave, marcado) => {
        setCamposSelecionados((prev) => {
            const set = new Set(prev)
            if (marcado) set.add(chave)
            else set.delete(chave)
            return CHAVES_CAMPOS_EXPORT_CREDENCIADOS.filter((c) => set.has(c))
        })
    }

    const todosSelecionados = camposSelecionados.length === CHAVES_CAMPOS_EXPORT_CREDENCIADOS.length

    const exportar = async () => {
        if (!camposSelecionados.length) {
            setErro('Selecione pelo menos um campo para exportar.')
            return
        }
        setExportando(true)
        setErro('')
        setFeedback('')
        try {
            const agora = new Date()
            const stamp = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`
            const resultado = await exportarCredenciadosParaExcel({
                nomeArquivoBase: `credenciados-${stamp}`,
                campos: camposSelecionados,
            })
            if (!resultado.ok) {
                setErro(resultado.erro || 'Falha na exportação.')
                return
            }
            setFeedback(
                `Exportados ${resultado.totalCredenciados} credenciado(s) em ${resultado.totalLinhas} linha(s).`,
            )
        } catch (e) {
            setErro(e?.message || String(e))
        } finally {
            setExportando(false)
        }
    }

    return (
        <div className='credenciamento_main config_export_cred'>
            <h1>Exportar Credenciados</h1>
            <hr />

            <p className='config_export_cred_lead'>
                Excel com prestadores <strong>credenciados</strong> — uma linha por procedimento do
                perfil. Escolha os campos e baixe.
            </p>

            {erro ? (
                <CredenciamentoMainAlert message={erro} onClose={() => setErro('')} role='alert' />
            ) : null}
            {feedback ? (
                <CredenciamentoMainAlert
                    message={feedback}
                    onClose={() => setFeedback('')}
                    role='status'
                />
            ) : null}

            <div className='config_export_cred_painel' aria-label='Ações de exportação'>
                <div className='config_export_cred_painel_inner'>
                    <div className='config_export_cred_painel_info'>
                        <span className='config_export_cred_painel_kicker'>Arquivo</span>
                        <strong>
                            {camposSelecionados.length}/{CHAVES_CAMPOS_EXPORT_CREDENCIADOS.length}{' '}
                            campos
                        </strong>
                    </div>
                    <div className='config_export_cred_acoes'>
                        <button
                            type='button'
                            className='credenciamento_main_action_btn'
                            disabled={exportando || !camposSelecionados.length}
                            onClick={() => void exportar()}
                        >
                            {exportando ? 'Exportando…' : 'Baixar Excel'}
                        </button>
                        <button
                            type='button'
                            className='credenciamento_main_action_btn secondary'
                            disabled={exportando || todosSelecionados}
                            onClick={() => setCamposSelecionados([...CHAVES_CAMPOS_EXPORT_CREDENCIADOS])}
                        >
                            Marcar todos
                        </button>
                        <button
                            type='button'
                            className='credenciamento_main_action_btn secondary'
                            disabled={exportando || !camposSelecionados.length}
                            onClick={() => setCamposSelecionados([])}
                        >
                            Desmarcar todos
                        </button>
                    </div>
                </div>
            </div>

            <section className='config_export_cred_campos' aria-label='Campos exportados'>
                <div className='config_export_cred_campos_head'>
                    <h2>Campos do Excel</h2>
                    <span>
                        {camposSelecionados.length}/{CHAVES_CAMPOS_EXPORT_CREDENCIADOS.length}{' '}
                        selecionados
                    </span>
                </div>
                <div className='config_export_cred_grupos'>
                    {[...CAMPOS_POR_GRUPO.entries()].map(([grupo, campos]) => (
                        <fieldset key={grupo} className='config_export_cred_grupo'>
                            <legend>{grupo}</legend>
                            <div className='config_export_cred_checks'>
                                {campos.map((campo) => (
                                    <label key={campo.chave} className='config_export_cred_check'>
                                        <input
                                            type='checkbox'
                                            checked={camposSelecionados.includes(campo.chave)}
                                            onChange={(e) => setCampo(campo.chave, e.target.checked)}
                                            disabled={exportando}
                                        />
                                        <span>{campo.cabecalho}</span>
                                    </label>
                                ))}
                            </div>
                        </fieldset>
                    ))}
                </div>
            </section>
        </div>
    )
}

export default ConfigExportarCredenciados
