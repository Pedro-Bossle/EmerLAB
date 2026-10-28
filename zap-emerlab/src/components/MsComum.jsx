import Icone from './Icone.jsx'
import { PRESENCA, corAvatar, iniciais } from '../util.js'

// Peças comuns da prévia de Teams e Outlook: avatar (com presença do Teams) e cartão de arquivo anexado.

export function Avatar({ nome, tipo, presenca, tamanho = 49 }) {
    const grupo = tipo && tipo !== 'chat'
    // "(exemplo)" não entra nas iniciais
    const limpo = String(nome || '').replace(/\s*\(.*?\)\s*/g, ' ').trim()
    return (
        <span className="ms-avatar" style={{ width: tamanho, height: tamanho }}>
            <span className="avatar" style={{ '--av': corAvatar(nome), width: tamanho, height: tamanho }}>
                {tipo === 'reuniao' ? (
                    <Icone nome="calendario" tamanho={Math.round(tamanho * 0.42)} />
                ) : grupo ? (
                    <Icone nome="equipe" tamanho={Math.round(tamanho * 0.45)} />
                ) : (
                    iniciais(limpo)
                )}
            </span>
            {presenca ? <span className="ms-presenca" style={{ background: PRESENCA[presenca].cor }} title={PRESENCA[presenca].rotulo} /> : null}
        </span>
    )
}

// cor do ícone pelo tipo do arquivo (PDF vermelho, planilha verde), como no Office
const tipoArquivo = (nome) => (/\.pdf$/i.test(nome) ? 'pdf' : /\.(xlsx?|csv)$/i.test(nome) ? 'planilha' : '')

export function Arquivo({ arquivo }) {
    return (
        <span className="ms-arquivo">
            <span className={`ms-arquivo-ico ${arquivo.tipo || tipoArquivo(arquivo.nome)}`}>
                <Icone nome="documento" tamanho={18} />
            </span>
            <span className="ms-arquivo-txt">
                <strong>{arquivo.nome}</strong>
                <small>{arquivo.tamanho}</small>
            </span>
        </span>
    )
}
