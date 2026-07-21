import React, { useEffect, useMemo, useState } from 'react'
import { obterOuCriarCidadeCredenciamentoPorMunicipio } from '../../../lib/cidadesCredenciamento.js'
import { UFS_BRASIL, buscarMunicipiosPorUf } from '../../../lib/ibgeLocalidades'
import { formatarCrmvEntrada, normalizarCrmvParaSalvar } from '../../../lib/prestadorCadastroHelpers'
import {
    filtrarEspecialidadesVeterinario,
    montarEspecialidadesIdsFormulario,
} from '../../../lib/formularioPublicoEspecialidades'
import MultiEspecialidadesInput from '../Credenciamento_cadastro/MultiEspecialidadesInput.jsx'
import PrestadorCertificadosConclusaoInput from '../Credenciamento_cadastro/PrestadorCertificadosConclusaoInput.jsx'
import PrestadorResponsaveisInput from '../Credenciamento_cadastro/PrestadorResponsaveisInput.jsx'

const PLACEHOLDER_CRMV = 'PF/PJ - 123456 - UF'

/**
 * Campos extras do passo de dados conforme tipo de perfil.
 * Certificados e responsáveis aparecem em todos os perfis; volante/clínica têm blocos adicionais.
 */
export default function FormularioPublicoPerfilExtra({
    tipoPerfil,
    especialidades,
    cidadesAtende,
    onCidadesAtendeChange,
    vetsPendentes,
    onVetsPendentesChange,
    certificadosPendentes,
    onCertificadosPendentesChange,
    responsaveis,
    onResponsaveisChange,
    erroCertificados,
    onErroCertificados,
}) {
    const [ufAtende, setUfAtende] = useState('SP')
    const [municipioIbgeId, setMunicipioIbgeId] = useState('')
    const [municipiosUf, setMunicipiosUf] = useState([])
    const [carregandoMunicipios, setCarregandoMunicipios] = useState(false)
    const [erroLocal, setErroLocal] = useState('')
    const [nomeVet, setNomeVet] = useState('')
    const [crmvVet, setCrmvVet] = useState('')
    const [espVetPrincipalId, setEspVetPrincipalId] = useState('')
    const [espVetSecundariasIds, setEspVetSecundariasIds] = useState([])
    const [adicionandoCidade, setAdicionandoCidade] = useState(false)

    const isVolante = tipoPerfil === 'volante'
    const isClinica = tipoPerfil === 'clinica'

    const especialidadesVet = useMemo(
        () => filtrarEspecialidadesVeterinario(especialidades),
        [especialidades],
    )

    const mapaNomeEsp = useMemo(() => {
        const m = new Map()
        especialidadesVet.forEach((e) => m.set(Number(e.id), e.nome))
        return m
    }, [especialidadesVet])

    useEffect(() => {
        if (!isVolante) return
        let cancel = false
        setCarregandoMunicipios(true)
        buscarMunicipiosPorUf(ufAtende)
            .then((lista) => {
                if (!cancel) setMunicipiosUf(lista)
            })
            .catch(() => {
                if (!cancel) setMunicipiosUf([])
            })
            .finally(() => {
                if (!cancel) setCarregandoMunicipios(false)
            })
        return () => {
            cancel = true
        }
    }, [ufAtende, isVolante])

    const adicionarCidade = async () => {
        setErroLocal('')
        const mun = municipiosUf.find((m) => String(m.id) === String(municipioIbgeId))
        if (!mun) {
            setErroLocal('Selecione a cidade na lista da UF.')
            return
        }
        setAdicionandoCidade(true)
        try {
            const obj = await obterOuCriarCidadeCredenciamentoPorMunicipio(ufAtende, mun.nome)
            const cid = Number(obj?.id)
            if (!cid) {
                setErroLocal('Não foi possível vincular a cidade.')
                return
            }
            if (cidadesAtende.some((c) => Number(c.cidadeId) === cid)) {
                setErroLocal('Esta cidade já está na lista.')
                return
            }
            onCidadesAtendeChange([
                ...cidadesAtende,
                { cidadeId: cid, nome: mun.nome, uf: ufAtende },
            ])
            setMunicipioIbgeId('')
        } catch (e) {
            setErroLocal(e?.message || String(e))
        } finally {
            setAdicionandoCidade(false)
        }
    }

    const removerCidade = (cidadeId) => {
        onCidadesAtendeChange(cidadesAtende.filter((c) => Number(c.cidadeId) !== Number(cidadeId)))
    }

    const rotuloEspsVet = (ids) =>
        (ids || [])
            .map((id) => mapaNomeEsp.get(Number(id)))
            .filter(Boolean)
            .join(', ')

    const incluirVet = () => {
        setErroLocal('')
        const nome = nomeVet.trim()
        if (!nome) {
            setErroLocal('Informe o nome do veterinário.')
            return
        }
        if (!normalizarCrmvParaSalvar(crmvVet)) {
            setErroLocal('Informe o CRMV do veterinário.')
            return
        }
        const espIds = montarEspecialidadesIdsFormulario(espVetPrincipalId, espVetSecundariasIds)
        if (!espIds.length) {
            setErroLocal('Selecione a especialidade do veterinário.')
            return
        }
        onVetsPendentesChange([
            ...vetsPendentes,
            {
                key: Date.now(),
                nome,
                crmv: normalizarCrmvParaSalvar(crmvVet) || '',
                especialidades_ids: espIds,
            },
        ])
        setNomeVet('')
        setCrmvVet('')
        setEspVetPrincipalId('')
        setEspVetSecundariasIds([])
    }

    const removerVet = (key) => {
        onVetsPendentesChange(vetsPendentes.filter((v) => v.key !== key))
    }

    if (!tipoPerfil) return null

    return (
        <>
            {isVolante && (
                <section className="fcred_bloco">
                    <h2 className="fcred_bloco_tit">Cidades que atende</h2>
                    <div className="fcred_grid fcred_grid_3 fcred_grid_cidades">
                        <label className="fcred_field">
                            <span>UF</span>
                            <select
                                className="fcred_select"
                                value={ufAtende}
                                onChange={(e) => setUfAtende(e.target.value)}
                            >
                                {UFS_BRASIL.map((u) => (
                                    <option key={u} value={u}>
                                        {u}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="fcred_field fcred_field_grow">
                            <span>Cidade</span>
                            <select
                                className="fcred_select"
                                value={municipioIbgeId}
                                onChange={(e) => setMunicipioIbgeId(e.target.value)}
                                disabled={carregandoMunicipios}
                            >
                                <option value="">{carregandoMunicipios ? 'Carregando…' : 'Selecione'}</option>
                                {municipiosUf.map((m) => (
                                    <option key={m.id} value={m.id}>
                                        {m.nome}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <div className="fcred_cidades_add">
                            <button
                                type="button"
                                className="fcred_btn secondary"
                                disabled={adicionandoCidade}
                                onClick={() => void adicionarCidade()}
                            >
                                Adicionar
                            </button>
                        </div>
                    </div>
                    {cidadesAtende.length > 0 ? (
                        <ul className="fcred_cidades_lista">
                            {cidadesAtende.map((c) => (
                                <li key={`${c.cidadeId}-${c.uf}`}>
                                    <span>
                                        {c.nome}
                                        {c.uf ? ` — ${c.uf}` : ''}
                                    </span>
                                    <button
                                        type="button"
                                        className="fcred_rem_item"
                                        aria-label={`Remover ${c.nome}`}
                                        onClick={() => removerCidade(c.cidadeId)}
                                    >
                                        ×
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="fcred_public_muted">Inclua pelo menos uma cidade em que você atende.</p>
                    )}
                </section>
            )}

            {isClinica && (
                <section className="fcred_bloco">
                    <h2 className="fcred_bloco_tit">Veterinários vinculados</h2>
                    <p className="fcred_public_muted fcred_bloco_lead">
                        Informe os veterinários que atuam nesta clínica (nome, CRMV e especialidade).
                    </p>
                    <div className="fcred_vet_novo">
                        <div className="fcred_grid fcred_grid_3 fcred_vet_linha1">
                            <label className="fcred_field">
                                <span>Nome</span>
                                <input
                                    value={nomeVet}
                                    onChange={(e) => setNomeVet(e.target.value)}
                                    placeholder="Nome do veterinário"
                                    autoComplete="name"
                                />
                            </label>
                            <label className="fcred_field">
                                <span>CRMV</span>
                                <input
                                    value={crmvVet}
                                    onChange={(e) => setCrmvVet(formatarCrmvEntrada(e.target.value))}
                                    placeholder={PLACEHOLDER_CRMV}
                                    autoComplete="off"
                                />
                            </label>
                            <label className="fcred_field">
                                <span>Especialidade</span>
                                <select
                                    className="fcred_select credenciamento_main_select"
                                    value={espVetPrincipalId}
                                    onChange={(e) => setEspVetPrincipalId(e.target.value)}
                                >
                                    <option value="">—</option>
                                    {especialidadesVet.map((e) => (
                                        <option key={e.id} value={e.id}>
                                            {e.nome}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>
                        <div className="fcred_vet_multi_linha">
                            <div className="pcad_row pcad_row_esp fcred_pcad_esp_row fcred_pcad_esp_row--vet">
                                <MultiEspecialidadesInput
                                    layout="inline"
                                    especialidades={especialidadesVet}
                                    principalId={espVetPrincipalId}
                                    secundariasIds={espVetSecundariasIds}
                                    onChangeSecundarias={setEspVetSecundariasIds}
                                />
                            </div>
                        </div>
                        <div className="fcred_vet_incluir">
                            <button type="button" className="fcred_btn secondary" onClick={incluirVet}>
                                Incluir
                            </button>
                        </div>
                    </div>
                    {vetsPendentes.length > 0 ? (
                        <ul className="fcred_cidades_lista">
                            {vetsPendentes.map((v) => (
                                <li key={v.key}>
                                    <span>
                                        {v.nome}
                                        {v.crmv ? ` · CRMV ${v.crmv}` : ''}
                                        {(() => {
                                            const rot = v.especialidades_ids?.length
                                                ? rotuloEspsVet(v.especialidades_ids)
                                                : v.especialidade_id
                                                  ? mapaNomeEsp.get(Number(v.especialidade_id))
                                                  : ''
                                            return rot ? ` · ${rot}` : ''
                                        })()}
                                    </span>
                                    <button
                                        type="button"
                                        className="fcred_rem_item"
                                        aria-label={`Remover ${v.nome}`}
                                        onClick={() => removerVet(v.key)}
                                    >
                                        ×
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="fcred_public_muted">Opcional: inclua um ou mais veterinários.</p>
                    )}
                </section>
            )}

            <section className="fcred_bloco">
                <h2 className="fcred_bloco_tit">Certificado de conclusão de curso *</h2>
                <p className="fcred_public_muted fcred_bloco_lead">
                    Anexe foto ou PDF do certificado (obrigatório; até 5 arquivos).
                </p>
                <PrestadorCertificadosConclusaoInput
                    modo="staging"
                    variant="public"
                    mostrarHint={false}
                    somenteLeitura={false}
                    salvos={[]}
                    pendentes={certificadosPendentes || []}
                    onChangePendentes={onCertificadosPendentesChange}
                    onErro={onErroCertificados}
                />
                {erroCertificados && (
                    <p className="fcred_public_erro fcred_perfil_erro">{erroCertificados}</p>
                )}
            </section>
            <section className="fcred_bloco">
                <h2 className="fcred_bloco_tit">Responsável(is) *</h2>
                <PrestadorResponsaveisInput
                    variant="public"
                    mostrarLead={false}
                    lista={responsaveis}
                    onChange={onResponsaveisChange}
                    somenteLeitura={false}
                />
            </section>

            {erroLocal && <p className="fcred_public_erro fcred_perfil_erro">{erroLocal}</p>}
        </>
    )
}
