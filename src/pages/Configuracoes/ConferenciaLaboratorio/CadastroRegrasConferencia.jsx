import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { EQUIVALENCIAS_PADRAO } from '../../../lib/configuracoes/conferencia/examSimilarity.js'
import ComboExame from './ComboExame.jsx'

export default function CadastroRegrasConferencia({
    aberto,
    onClose,
    equivalencias = [],
    perfis = [],
    examesOpcoes = [],
    onSalvarEquivalencia,
    onSalvarPerfil,
}) {
    const [nomeA, setNomeA] = useState('')
    const [nomeB, setNomeB] = useState('')
    const [perfilNome, setPerfilNome] = useState('')
    const [perfilDesc, setPerfilDesc] = useState('')
    const [perfilValor, setPerfilValor] = useState('')
    const [perfilIni, setPerfilIni] = useState('')
    const [perfilFim, setPerfilFim] = useState('')
    const [perfilExames, setPerfilExames] = useState([])
    const [examePerfil, setExamePerfil] = useState('')

    if (!aberto) return null

    return createPortal(
        <div className="conf_lab_drawer_overlay" onClick={onClose} role="presentation">
            <aside
                className="conf_lab_drawer conf_lab_drawer_regras"
                role="dialog"
                aria-labelledby="conf-lab-regras-title"
                onClick={(e) => e.stopPropagation()}
            >
                <header>
                    <div>
                        <p className="conf_lab_kicker">Esta conferência</p>
                        <h2 id="conf-lab-regras-title">Equivalências e perfis</h2>
                    </div>
                    <button type="button" className="conf_lab_drawer_close" onClick={onClose}>
                        Fechar
                    </button>
                </header>

                <section>
                    <h3>Nova equivalência de exame</h3>
                    <div className="conf_lab_regras_grid">
                        <label>
                            Nome no plano
                            <ComboExame
                                itens={examesOpcoes}
                                value={nomeA}
                                placeholder="Buscar exame…"
                                onChange={setNomeA}
                            />
                        </label>
                        <label>
                            Nome no laboratório
                            <ComboExame
                                itens={examesOpcoes}
                                value={nomeB}
                                placeholder="Buscar exame…"
                                onChange={setNomeB}
                            />
                        </label>
                    </div>
                    <button
                        type="button"
                        className="credenciamento_main_action_btn"
                        onClick={() => {
                            onSalvarEquivalencia(nomeA, nomeB)
                            setNomeA('')
                            setNomeB('')
                        }}
                    >
                        Salvar equivalência
                    </button>
                    <ul className="conf_lab_regras_lista">
                        {EQUIVALENCIAS_PADRAO.map((p) => (
                            <li key={`pad-${p.a}`}>
                                <em>Padrão:</em> {p.a} = {p.b}
                            </li>
                        ))}
                        {equivalencias.map((p) => (
                            <li key={p.id || `${p.a}-${p.b}`}>
                                {p.a} = {p.b}
                            </li>
                        ))}
                    </ul>
                </section>

                <section>
                    <h3>Novo perfil / pacote</h3>
                    <div className="conf_lab_regras_grid">
                        <label>
                            Perfil
                            <input value={perfilNome} onChange={(e) => setPerfilNome(e.target.value)} />
                        </label>
                        <label>
                            Descrição
                            <input value={perfilDesc} onChange={(e) => setPerfilDesc(e.target.value)} />
                        </label>
                        <label>
                            Valor
                            <input
                                value={perfilValor}
                                onChange={(e) => setPerfilValor(e.target.value)}
                                inputMode="decimal"
                            />
                        </label>
                        <label>
                            Vigência início
                            <input
                                type="date"
                                value={perfilIni}
                                onChange={(e) => setPerfilIni(e.target.value)}
                            />
                        </label>
                        <label>
                            Vigência fim
                            <input
                                type="date"
                                value={perfilFim}
                                onChange={(e) => setPerfilFim(e.target.value)}
                            />
                        </label>
                    </div>
                    <label>
                        Exames integrantes
                        <div className="conf_lab_perfil_exame_add">
                            <ComboExame
                                itens={examesOpcoes}
                                value={examePerfil}
                                placeholder="Buscar e adicionar exame…"
                                onChange={(id) => {
                                    setExamePerfil('')
                                    if (id && !perfilExames.includes(id)) {
                                        setPerfilExames((prev) => [...prev, id])
                                    }
                                }}
                            />
                        </div>
                    </label>
                    {perfilExames.length ? (
                        <ul className="conf_lab_chip_lista">
                            {perfilExames.map((ex) => (
                                <li key={ex}>
                                    <span>{ex}</span>
                                    <button
                                        type="button"
                                        className="conf_lab_alias_combo_limpar"
                                        aria-label={`Remover ${ex}`}
                                        onClick={() =>
                                            setPerfilExames((prev) => prev.filter((x) => x !== ex))
                                        }
                                    >
                                        ×
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                    <button
                        type="button"
                        className="credenciamento_main_action_btn"
                        onClick={() => {
                            onSalvarPerfil({
                                nome: perfilNome,
                                descricao: perfilDesc,
                                valor: perfilValor,
                                vigenciaInicio: perfilIni,
                                vigenciaFim: perfilFim,
                                exames: perfilExames,
                            })
                            setPerfilNome('')
                            setPerfilDesc('')
                            setPerfilValor('')
                            setPerfilIni('')
                            setPerfilFim('')
                            setPerfilExames([])
                            setExamePerfil('')
                        }}
                    >
                        Salvar perfil
                    </button>
                    <ul className="conf_lab_regras_lista">
                        {perfis.map((p) => (
                            <li key={p.id || p.nome}>
                                <strong>{p.nome}</strong>
                                {p.valor != null ? ` · ${p.valor}` : ''}
                                {(p.exames || []).length ? ` · ${p.exames.join(', ')}` : ''}
                            </li>
                        ))}
                    </ul>
                </section>
            </aside>
        </div>,
        document.body,
    )
}
