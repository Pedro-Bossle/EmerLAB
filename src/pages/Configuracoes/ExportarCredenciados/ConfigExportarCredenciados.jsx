import React, { useState } from 'react'
import { exportarCredenciadosParaExcel } from '../../../lib/configuracoes/exportCredenciadosExcel.js'
import CredenciamentoMainAlert from '../../../components/Toast/CredenciamentoMainAlert.jsx'
import '../../Credenciamento/Credenciamento_main/Credenciamento_main.css'
import './ConfigExportarCredenciados.css'

const ConfigExportarCredenciados = () => {
    const [exportando, setExportando] = useState(false)
    const [erro, setErro] = useState('')
    const [feedback, setFeedback] = useState('')

    const exportar = async () => {
        setExportando(true)
        setErro('')
        setFeedback('')
        try {
            const agora = new Date()
            const stamp = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`
            const resultado = await exportarCredenciadosParaExcel({
                nomeArquivoBase: `credenciados-${stamp}`,
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
        <div className='credenciamento_main_page config_export_cred'>
            <div className='config_export_cred_header'>
                <h1>Exportar Credenciados</h1>
            </div>
            <p className='config_export_cred_lead'>
                Gera um Excel com todos os prestadores em status <strong>credenciado</strong>, uma
                linha por procedimento do perfil. Inclui especialidades, modalidades, cidades,
                descontos, vínculos e demais dados do perfil.
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

            <div className='config_export_cred_acoes'>
                <button
                    type='button'
                    className='credenciamento_main_action_btn'
                    disabled={exportando}
                    onClick={() => void exportar()}
                >
                    {exportando ? 'Exportando…' : 'Baixar Excel'}
                </button>
            </div>

            <ul className='config_export_cred_cols'>
                <li>ID, NOME, Telefone, Celular</li>
                <li>Especialidade Primária / Secundárias, Modalidade, Endereço, Cidade Principal</li>
                <li>Código / Nome / Categoria do Procedimento</li>
                <li>Descontos (Grupo, Tipo, Porcentagem)</li>
                <li>Cidades que Atendem, Veterinários Vinculados</li>
            </ul>
        </div>
    )
}

export default ConfigExportarCredenciados
