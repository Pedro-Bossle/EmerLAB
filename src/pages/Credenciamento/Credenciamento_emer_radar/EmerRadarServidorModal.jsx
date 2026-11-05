import React, { useEffect, useState } from 'react'
import { Badge, Button, Modal } from '../../../components/ui'
import { emerRadarWorkerDownload, emerRadarWorkerInfo } from '../../../lib/credenciamento/emerRadarApi.js'
import { avisar } from '../../../lib/dialogos.js'

const fmtTamanho = (bytes) => {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return ''
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(0)} MB` : `${Math.round(n / 1024)} KB`
}

const fmtData = (iso) => {
  const d = iso ? new Date(iso) : null
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('pt-BR') : ''
}

/**
 * Baixar o «Servidor de prospecção» (.exe do Windows) e instruções de uso.
 * `workerAtivo`: o site já enxerga o servidor rodando neste computador.
 */
export default function EmerRadarServidorModal({ open, onClose, workerAtivo = false }) {
  const [info, setInfo] = useState(null)
  const [erro, setErro] = useState('')
  const [baixando, setBaixando] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    let cancelado = false
    emerRadarWorkerInfo()
      .then((r) => {
        if (!cancelado) {
          setInfo(r)
          setErro('')
        }
      })
      .catch((e) => {
        if (!cancelado) setErro(e?.message || 'Não foi possível consultar o pacote.')
      })
    return () => {
      cancelado = true
    }
  }, [open])

  const baixar = async () => {
    setBaixando(true)
    try {
      const r = await emerRadarWorkerDownload()
      if (!r.disponivel || !r.url) throw new Error(r.motivo || 'Pacote indisponível.')
      window.location.assign(r.url) // link temporário do Storage: o navegador baixa direto
    } catch (e) {
      avisar({ titulo: 'Não foi possível baixar', mensagem: e?.message || 'Erro desconhecido.' })
    } finally {
      setBaixando(false)
    }
  }

  const disponivel = info?.disponivel === true
  const detalhe = [fmtTamanho(info?.tamanho), info?.atualizado_em ? `atualizado em ${fmtData(info.atualizado_em)}` : '']
    .filter(Boolean)
    .join(' · ')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Servidor de prospecção"
      description="Programa para Windows que roda a busca no Google Maps no seu computador."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={() => void baixar()} disabled={baixando || !disponivel}>
            {baixando ? 'Gerando link…' : 'Baixar para Windows'}
          </Button>
        </>
      }
    >
      <div className="er-servidor">
        <p className="er-servidor__estado">
          <span className={`emer-radar-status-dot emer-radar-status-dot--${workerAtivo ? 'ok' : 'erro'}`} aria-hidden />
          {workerAtivo ? (
            <>
              <strong>Servidor rodando neste computador.</strong> A «Busca manual» e o «Rodar agora» já estão liberados.
            </>
          ) : (
            <>
              <strong>Servidor não detectado.</strong> Baixe, abra o programa e clique em «Iniciar servidor de prospecção».
            </>
          )}
        </p>

        <h3 className="er-servidor__titulo">Como usar</h3>
        <ol className="er-servidor__passos">
          <li>
            Baixe o arquivo, <strong>extraia o .zip</strong> e abra <code>EmerRadarWorker.exe</code>.
          </li>
          <li>
            Na janela do programa, clique em <strong>«Iniciar servidor de prospecção»</strong>. Na primeira vez ele baixa o
            navegador (~170 MB); espere a bolinha ficar verde.
          </li>
          <li>
            Volte para esta tela: a bolinha ao lado de «Emer-Radar» fica verde e a aba <strong>«Busca manual»</strong>{' '}
            aparece. O Chrome pode pedir permissão para acessar a rede local — permita.
          </li>
          <li>Mantenha o programa aberto enquanto prospecta. Para encerrar, clique em «Parar servidor».</li>
        </ol>

        <p className="er-servidor__nota">
          O Windows pode mostrar um aviso do SmartScreen na primeira vez (programa sem assinatura digital): clique em «Mais
          informações» → «Executar assim mesmo». O servidor escuta só neste computador.
        </p>

        <p className="er-servidor__arquivo">
          {erro ? (
            <Badge tone="erro">{erro}</Badge>
          ) : info === null ? (
            'Verificando o pacote…'
          ) : disponivel ? (
            <>
              <Badge tone="ok">Disponível</Badge> {info.nome}
              {detalhe ? ` · ${detalhe}` : ''}
            </>
          ) : (
            <Badge tone="warn">{info.motivo || 'Pacote ainda não publicado.'}</Badge>
          )}
        </p>
      </div>
    </Modal>
  )
}
