import React, { useRef } from 'react'
import {
    MAX_CERTIFICADOS_CONCLUSAO,
    certificadoConclusaoArquivoValido,
    urlAssinadaCertificadoConclusao,
} from '../../../lib/prestadorVeterinarioCadastro.js'
import './PrestadorVeterinarioExtras.css'

export default function PrestadorCertificadosConclusaoInput({
    modo = 'prestador',
    somenteLeitura,
    salvos = [],
    pendentes = [],
    onChangePendentes,
    onRemoverSalvo,
    onErro,
    variant = 'cadastro',
    mostrarHint = true,
}) {
    const inputRef = useRef(null)
    const total = (salvos?.length || 0) + (pendentes?.length || 0)
    const podeAdicionar = !somenteLeitura && total < MAX_CERTIFICADOS_CONCLUSAO
    const isPublic = variant === 'public'
    const btnClass = isPublic
        ? 'fcred_btn secondary pcad_cert_add_btn'
        : 'credenciamento_main_btn secondary pcad_cert_add_btn'

    const adicionarArquivos = (fileList) => {
        const files = [...(fileList || [])]
        if (!files.length) return
        const restante = MAX_CERTIFICADOS_CONCLUSAO - total
        if (restante <= 0) {
            onErro?.(`Máximo de ${MAX_CERTIFICADOS_CONCLUSAO} arquivos.`)
            return
        }
        const aceitos = []
        for (const file of files.slice(0, restante)) {
            const check = certificadoConclusaoArquivoValido(file)
            if (!check.ok) {
                onErro?.(check.erro)
                continue
            }
            aceitos.push({
                key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                file,
                previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
                nome: file.name,
            })
        }
        if (aceitos.length) {
            onErro?.('')
            onChangePendentes?.([...(pendentes || []), ...aceitos])
        }
    }

    const removerPendente = (key) => {
        onChangePendentes?.((prev) => (prev || pendentes || []).filter((p) => p.key !== key))
    }

    const abrirSalvo = async (row) => {
        try {
            const url = await urlAssinadaCertificadoConclusao(row.storage_path)
            if (url) window.open(url, '_blank', 'noopener,noreferrer')
        } catch (e) {
            onErro?.(e?.message || String(e))
        }
    }

    const listaVazia = total === 0

    return (
        <div className="pcad_cert_conclusao">
            {mostrarHint && (
                <p className={isPublic ? 'fcred_public_muted pcad_cert_conclusao_hint' : 'pcad_muted pcad_cert_conclusao_hint'}>
                    Obrigatório: envie foto ou PDF do certificado (até {MAX_CERTIFICADOS_CONCLUSAO} arquivos, 15 MB
                    cada).
                </p>
            )}
            {listaVazia && !somenteLeitura && (
                <p className="pcad_cert_vazio">Nenhum arquivo anexado. Use o botão abaixo para selecionar foto ou PDF.</p>
            )}
            {!listaVazia && (
                <ul className="pcad_cert_lista">
                    {(salvos || []).map((row) => (
                        <li key={`salvo-${row.id}`}>
                            <button type="button" className="pcad_cert_link" onClick={() => void abrirSalvo(row)}>
                                {row.nome_arquivo || 'Certificado'}
                            </button>
                            {!somenteLeitura && (
                                <button
                                    type="button"
                                    className="pcad_cert_rem"
                                    aria-label="Remover certificado"
                                    onClick={() => onRemoverSalvo?.(row.id)}
                                >
                                    ×
                                </button>
                            )}
                        </li>
                    ))}
                    {(pendentes || []).map((p) => (
                        <li key={p.key}>
                            {p.previewUrl ? (
                                <img src={p.previewUrl} alt="" className="pcad_cert_thumb" />
                            ) : (
                                <span className="pcad_cert_pdf_badge">PDF</span>
                            )}
                            <span className="pcad_cert_nome">{p.nome}</span>
                            {!somenteLeitura && (
                                <button
                                    type="button"
                                    className="pcad_cert_rem"
                                    aria-label="Remover arquivo"
                                    onClick={() => removerPendente(p.key)}
                                >
                                    ×
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            {podeAdicionar && (
                <>
                    <input
                        ref={inputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                        multiple
                        className="pcad_cert_input_hidden"
                        onChange={(e) => {
                            adicionarArquivos(e.target.files)
                            e.target.value = ''
                        }}
                    />
                    <button type="button" className={btnClass} onClick={() => inputRef.current?.click()}>
                        Adicionar arquivo
                    </button>
                </>
            )}
        </div>
    )
}
