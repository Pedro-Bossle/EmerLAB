import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { EQUIVALENCIAS_PADRAO } from '../../../lib/configuracoes/conferencia/examSimilarity.js'
import ComboExame from './ComboExame.jsx'
import { useDrawerDialog } from './useDrawerDialog.js'

export default function CadastroRegrasConferencia({
    aberto,
    onClose,
    equivalencias = [],
    perfis = [],
    examesOpcoes = [],
    onSalvarEquivalencia,
    onAtualizarEquivalencia,
    onRemoverEquivalencia,
    onSalvarPerfil,
}) {
    const [nomeA, setNomeA] = useState('')
    const [nomeB, setNomeB] = useState('')
    const [editIndex, setEditIndex] = useState(null)
    const [perfilNome, setPerfilNome] = useState('')
    const [perfilDesc, setPerfilDesc] = useState('')
    const [perfilValor, setPerfilValor] = useState('')
    const [perfilIni, setPerfilIni] = useState('')
    const [perfilFim, setPerfilFim] = useState('')
    const [perfilExames, setPerfilExames] = useState([])
    const [examePerfil, setExamePerfil] = useState('')
    const closeRef = useDrawerDialog({ aberto, onClose })

    const editando = editIndex != null && editIndex >= 0

    const limparFormEquivalencia = () => {
        setNomeA('')
        setNomeB('')
        setEditIndex(null)
    }

    useEffect(() => {
        if (!aberto) limparFormEquivalencia()
    }, [aberto])

    const iniciarEdicao = (idx, p) => {
        setEditIndex(idx)
        setNomeA(p.a || '')
        setNomeB(p.b || '')
    }

    const salvarOuAtualizar = () => {
        const a = String(nomeA || '').trim()
        const b = String(nomeB || '').trim()
        if (!a || !b) return
        if (editando) {
            if (!onAtualizarEquivalencia) return
            onAtualizarEquivalencia(editIndex, a, b)
        } else {
            if (!onSalvarEquivalencia) return
            onSalvarEquivalencia(a, b)
        }
        limparFormEquivalencia()
    }

    if (!aberto) return null

    return createPortal(
        <div className="conf_lab_drawer_overlay" onClick={onClose} role="presentation">
            <aside
                className="conf_lab_drawer conf_lab_drawer_regras"
                role="dialog"
                aria-modal="true"
                aria-labelledby="conf-lab-regras-title"
                onClick={(e) => e.stopPropagation()}
            >
                <header>
                    <div>
                        <p className="conf_lab_kicker">Esta conferência</p>
                        <h2 id="conf-lab-regras-title">Equivalências e perfis</h2>
                    </div>
                    <button
                        ref={closeRef}
                        type="button"
                        className="conf_lab_drawer_close"
                        onClick={onClose}
                    >
                        Fechar
                    </button>
                </header>

                <section>
                    <h3>{editando ? 'Editar equivalência de exame' : 'Nova equivalência de exame'}</h3>
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
                    <div className="conf_lab_regras_form_acoes">
                        <button
                            type="button"
                            className="credenciamento_main_action_btn"
                            disabled={!String(nomeA || '').trim() || !String(nomeB || '').trim()}
                            onClick={salvarOuAtualizar}
                        >
                            {editando ? 'Atualizar equivalência' : 'Salvar equivalência'}
                        </button>
                        {editando ? (
                            <button
                                type="button"
                                className="credenciamento_main_action_btn secondary"
                                onClick={limparFormEquivalencia}
                            >
                                Cancelar
                            </button>
                        ) : null}
                    </div>
                    <ul className="conf_lab_regras_lista">
                        {EQUIVALENCIAS_PADRAO.map((p) => (
                            <li key={`pad-${p.a}`} className="conf_lab_regras_item">
                                <span>
                                    <em>Padrão:</em> {p.a} = {p.b}
                                </span>
                            </li>
                        ))}
                        {equivalencias.map((p, idx) => (
                            <li
                                key={p.id || `eq-${idx}-${p.a}-${p.b}`}
                                className={`conf_lab_regras_item${editIndex === idx ? ' is-editing' : ''}`}
                            >
                                <span>
                                    {p.a} = {p.b}
                                </span>
                                <span className="conf_lab_regras_item_acoes">
                                    <button
                                        type="button"
                                        className="credenciamento_main_action_btn secondary conf_lab_regras_btn"
                                        onClick={() => iniciarEdicao(idx, p)}
                                    >
                                        Editar
                                    </button>
                                    {onRemoverEquivalencia ? (
                                        <button
                                            type="button"
                                            className="credenciamento_main_action_btn secondary conf_lab_regras_btn"
                                            aria-label={`Remover equivalência ${p.a} = ${p.b}`}
                                            onClick={() => {
                                                if (editIndex === idx) limparFormEquivalencia()
                                                else if (editIndex != null && editIndex > idx) {
                                                    setEditIndex((prev) =>
                                                        prev == null ? null : prev - 1,
                                                    )
                                                }
                                                onRemoverEquivalencia(idx)
                                            }}
                                        >
                                            Remover
                                        </button>
                                    ) : null}
                                </span>
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
                            {perfilExames.map((ex) => {
                                const rotulo =
                                    examesOpcoes.find((o) => String(o.id) === String(ex))
                                        ?.rotulo || ex
                                return (
                                <li key={ex}>
                                    <span>{rotulo}</span>
                                    <button
                                        type="button"
                                        className="conf_lab_alias_combo_limpar"
                                        aria-label={`Remover ${rotulo}`}
                                        onClick={() =>
                                            setPerfilExames((prev) => prev.filter((x) => x !== ex))
                                        }
                                    >
                                        ×
                                    </button>
                                </li>
                                )
                            })}
                        </ul>
                    ) : null}
                    <button
                        type="button"
                        className="credenciamento_main_action_btn"
                        disabled={!String(perfilNome || '').trim()}
                        onClick={() => {
                            if (!onSalvarPerfil) return
                            if (!String(perfilNome || '').trim()) return
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
