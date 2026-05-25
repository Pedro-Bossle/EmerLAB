import React, { useMemo, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import {
    acharSituacaoCredenciadoId,
    formatarCrmvEntrada,
    normalizarCrmvParaSalvar,
    normalizarTextoBusca,
    prestadorEhEstabelecimento,
} from '../../../lib/prestadorCadastroHelpers'

/**
 * Vínculo de veterinários a estabelecimento (clínica etc.): busca por nome, novo perfil mínimo ou existente.
 */
export default function VeterinariosVinculados({
    estabelecimentoId,
    cidadeIdClinica,
    situacoes,
    especialidades,
    prestadoresTodos,
    onPrestadoresAtualizados,
    vetsVinculados,
    onChangeVetsVinculados,
    vetsPendentes,
    onChangeVetsPendentes,
    somenteLeitura,
    onErro,
}) {
    const [nomeNovo, setNomeNovo] = useState('')
    const [crmvNovo, setCrmvNovo] = useState('')
    const [espNovoId, setEspNovoId] = useState('')
    const [sugestoesAbertas, setSugestoesAbertas] = useState(false)
    const [incluindo, setIncluindo] = useState(false)
    const wrapRef = useRef(null)

    const especialidadesVet = useMemo(
        () => (especialidades || []).filter((e) => !prestadorEhEstabelecimento(e.id)),
        [especialidades],
    )

    const espPadraoId = useMemo(() => {
        const geral = especialidadesVet.find((e) => normalizarTextoBusca(e.nome).includes('geral'))
        return geral ? String(geral.id) : especialidadesVet[0] ? String(especialidadesVet[0].id) : ''
    }, [especialidadesVet])

    const espEfetiva = espNovoId || espPadraoId

    const sugestoes = useMemo(() => {
        const seg = normalizarTextoBusca(nomeNovo)
        if (seg.length < 2) return []
        return (prestadoresTodos || [])
            .filter((p) => !prestadorEhEstabelecimento(p.especialidade_id))
            .filter((p) => normalizarTextoBusca(p.nome).includes(seg))
            .slice(0, 10)
    }, [nomeNovo, prestadoresTodos])

    const vinculadosExibicao = useMemo(() => {
        const ids = new Set((vetsVinculados || []).map(Number))
        const salvos = (prestadoresTodos || []).filter((p) => ids.has(Number(p.id)))
        const pendentes = (vetsPendentes || []).map((p) => ({
            id: `pend-${p.key}`,
            nome: p.nome,
            crmv: p.crmv,
            especialidade_id: p.especialidade_id,
            pendente: true,
        }))
        return [...salvos.map((p) => ({ ...p, pendente: false })), ...pendentes]
    }, [vetsVinculados, prestadoresTodos, vetsPendentes])

    const nomeEsp = (id) => especialidades.find((e) => Number(e.id) === Number(id))?.nome || '—'

    const removerVinculo = (id) => {
        if (somenteLeitura) return
        if (String(id).startsWith('pend-')) {
            const key = Number(String(id).replace('pend-', ''))
            onChangeVetsPendentes((prev) => prev.filter((p) => p.key !== key))
            return
        }
        onChangeVetsVinculados((prev) => prev.filter((x) => Number(x) !== Number(id)))
    }

    const aplicarExistente = (prestador) => {
        const id = Number(prestador.id)
        if (!vetsVinculados.includes(id)) onChangeVetsVinculados([...vetsVinculados, id])
        setNomeNovo('')
        setCrmvNovo('')
        setSugestoesAbertas(false)
    }

    const incluirVeterinario = async () => {
        if (somenteLeitura) return
        const nome = nomeNovo.trim()
        if (!nome) {
            onErro?.('Informe o nome do veterinário.')
            return
        }
        if (!espEfetiva) {
            onErro?.('Selecione a especialidade do veterinário.')
            return
        }

        const normNome = normalizarTextoBusca(nome)
        const igualExistente = (prestadoresTodos || []).find(
            (p) =>
                !prestadorEhEstabelecimento(p.especialidade_id) &&
                normalizarTextoBusca(p.nome) === normNome,
        )

        if (igualExistente) {
            aplicarExistente(igualExistente)
            onErro?.('')
            return
        }

        setIncluindo(true)
        onErro?.('')
        try {
            const esp = especialidades.find((e) => Number(e.id) === Number(espEfetiva))
            const tipo = String(esp?.tipo || 'ESPECIALIDADE').trim() || 'ESPECIALIDADE'
            const credId = acharSituacaoCredenciadoId(situacoes)

            if (!estabelecimentoId) {
                onChangeVetsPendentes((prev) => [
                    ...prev,
                    {
                        key: Date.now(),
                        nome,
                        crmv: normalizarCrmvParaSalvar(crmvNovo) || '',
                        especialidade_id: Number(espEfetiva),
                    },
                ])
                setNomeNovo('')
                setCrmvNovo('')
                setSugestoesAbertas(false)
                return
            }

            if (!cidadeIdClinica) {
                onErro?.('Defina a cidade da clínica (endereço ou cidades que atende) antes de criar veterinários.')
                return
            }

            const payload = {
                nome,
                crmv: normalizarCrmvParaSalvar(crmvNovo),
                especialidade_id: Number(espEfetiva),
                tipo,
                cidade_id: Number(cidadeIdClinica),
                situacao_id: credId ? Number(credId) : null,
                ativo: true,
                data_cadastro: new Date().toISOString(),
                data_atualizacao: new Date().toISOString(),
            }

            const { data: ins, error } = await supabase.from('prestadores').insert(payload).select('id, nome, especialidade_id, crmv').single()
            if (error) throw new Error(error.message)

            const novoId = Number(ins.id)
            onChangeVetsVinculados((prev) => (prev.includes(novoId) ? prev : [...prev, novoId]))
            onPrestadoresAtualizados?.([...(prestadoresTodos || []), ins])
            setNomeNovo('')
            setCrmvNovo('')
            setSugestoesAbertas(false)
        } catch (e) {
            onErro?.(e?.message || String(e))
        } finally {
            setIncluindo(false)
        }
    }

    return (
        <div className="pcad_vets">
            <div className="pcad_row pcad_row_vet_novo">
                <label className="pcad_field pcad_vet_nome_cell">
                    Nome
                    <div className="pcad_vet_nome_wrap" ref={wrapRef}>
                        <input
                            className="credenciamento_main_input"
                            value={nomeNovo}
                            disabled={somenteLeitura || incluindo}
                            placeholder="Nome do veterinário"
                            onChange={(e) => {
                                setNomeNovo(e.target.value)
                                setSugestoesAbertas(true)
                            }}
                            onFocus={() => setSugestoesAbertas(true)}
                            onBlur={() => setTimeout(() => setSugestoesAbertas(false), 150)}
                        />
                        {sugestoesAbertas && sugestoes.length > 0 && (
                            <ul className="pcad_sugestoes" role="listbox">
                                {sugestoes.map((s) => (
                                    <li key={s.id}>
                                        <button
                                            type="button"
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={() => aplicarExistente(s)}
                                        >
                                            {s.nome}
                                            {s.crmv ? ` · CRMV ${s.crmv}` : ''}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </label>
                <label className="pcad_field">
                    Especialidade
                    <select
                        className="credenciamento_main_select"
                        value={espEfetiva}
                        disabled={somenteLeitura || incluindo}
                        onChange={(e) => setEspNovoId(e.target.value)}
                    >
                        <option value="">—</option>
                        {especialidadesVet.map((e) => (
                            <option key={e.id} value={e.id}>
                                {e.nome}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="pcad_field pcad_vet_crmv_cell">
                    CRMV
                    <input
                        className="credenciamento_main_input"
                        value={crmvNovo}
                        disabled={somenteLeitura || incluindo}
                        onChange={(e) => setCrmvNovo(formatarCrmvEntrada(e.target.value))}
                    />
                </label>
                <div className="pcad_field pcad_vet_incluir_btn">
                    <span className="pcad_field_label" aria-hidden="true">
                        &nbsp;
                    </span>
                    <button
                        type="button"
                        className="credenciamento_main_action_btn"
                        disabled={somenteLeitura || incluindo}
                        onClick={() => void incluirVeterinario()}
                    >
                        {incluindo ? '…' : 'Incluir'}
                    </button>
                </div>
            </div>

            <ul className="pcad_vet_vinculados">
                {vinculadosExibicao.length === 0 && (
                    <li className="pcad_muted pcad_vet_vinculados_vazio">Nenhum veterinário vinculado.</li>
                )}
                {vinculadosExibicao.map((v) => (
                    <li key={v.pendente ? v.id : Number(v.id)}>
                        <span>
                            <strong>{v.nome}</strong>
                            {v.crmv ? ` · CRMV ${v.crmv}` : ''}
                            {` · ${nomeEsp(v.especialidade_id)}`}
                            {v.pendente ? ' (será criado ao salvar)' : ''}
                        </span>
                        {!somenteLeitura && (
                            <button type="button" className="pcad_link_btn danger" onClick={() => removerVinculo(v.pendente ? v.id : v.id)}>
                                Remover
                            </button>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    )
}
