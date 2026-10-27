import { useEffect, useRef, useState } from 'react'
import Icone from './Icone.jsx'

// Escolha de vários departamentos (respostas rápidas): nenhum marcado = disponível para todos
export default function SeletorDepartamentos({ departamentos, valor, aoMudar, rotulo = 'Disponível para' }) {
    const [aberto, setAberto] = useState(false)
    const raiz = useRef(null)
    const escolhidos = departamentos.filter((d) => valor.includes(d.id))

    useEffect(() => {
        if (!aberto) return
        const fora = (e) => !raiz.current?.contains(e.target) && setAberto(false)
        const tecla = (e) => {
            if (e.key !== 'Escape') return
            // o Esc fecha só o menu, não o modal por trás
            e.stopPropagation()
            setAberto(false)
        }
        document.addEventListener('mousedown', fora)
        document.addEventListener('keydown', tecla, true)
        return () => {
            document.removeEventListener('mousedown', fora)
            document.removeEventListener('keydown', tecla, true)
        }
    }, [aberto])

    const alternar = (id) => aoMudar(valor.includes(id) ? valor.filter((x) => x !== id) : [...valor, id])

    return (
        <div className="campo seletor-deptos" ref={raiz}>
            <span id="seletor-deptos-rotulo">{rotulo}</span>
            <div className="seletor-deptos-ancora">
                <button
                    type="button"
                    className="seletor-deptos-campo"
                    aria-haspopup="listbox"
                    aria-expanded={aberto}
                    aria-labelledby="seletor-deptos-rotulo"
                    onClick={() => setAberto((v) => !v)}
                >
                    <span className="seletor-deptos-valor">
                        {escolhidos.length ? (
                            escolhidos.map((d) => (
                                <span key={d.id} className="tag" style={{ '--tag': d.cor }}>
                                    {d.nome}
                                </span>
                            ))
                        ) : (
                            <span className="seletor-deptos-todos">Todos os departamentos</span>
                        )}
                    </span>
                    <Icone nome="baixo" tamanho={16} className={`seletor-depto-seta ${aberto ? 'aberto' : ''}`} />
                </button>
                {aberto ? (
                    <ul className="menu-depto menu-depto-campo" role="listbox" aria-multiselectable="true" aria-labelledby="seletor-deptos-rotulo">
                        <li role="none">
                            <button type="button" role="option" aria-selected={!valor.length} onClick={() => aoMudar([])}>
                                <span className="depto-ponto vazio" />
                                <span className="menu-depto-nome">Todos os departamentos</span>
                                {!valor.length ? <Icone nome="check" tamanho={16} className="menu-depto-check" /> : <span className="menu-depto-check" />}
                            </button>
                        </li>
                        {departamentos.map((d, i) => (
                            <li key={d.id} role="none" className={i === 0 ? 'separado' : ''}>
                                <button type="button" role="option" aria-selected={valor.includes(d.id)} onClick={() => alternar(d.id)}>
                                    <span className={`menu-depto-caixa ${valor.includes(d.id) ? 'marcada' : ''}`} aria-hidden="true">
                                        {valor.includes(d.id) ? <Icone nome="check" tamanho={12} traco={3} /> : null}
                                    </span>
                                    <span className="depto-ponto" style={{ '--tag': d.cor }} />
                                    <span className="menu-depto-nome">{d.nome}</span>
                                </button>
                            </li>
                        ))}
                        {departamentos.length === 0 ? <li className="ajuda">Cadastre departamentos na aba Departamentos.</li> : null}
                    </ul>
                ) : null}
            </div>
            <small className="ajuda">Marque um ou mais. Sem nenhum marcado, a resposta aparece para todos os departamentos.</small>
        </div>
    )
}
