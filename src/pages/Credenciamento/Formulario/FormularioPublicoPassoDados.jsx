import React from 'react'
import { documentoCpfCnpjEstaCompleto } from '../../../lib/formularioCredenciamento'
import MultiEspecialidadesInput from '../Credenciamento_cadastro/MultiEspecialidadesInput.jsx'
import {
    TIPOS_CHAVE_PIX,
    TIPOS_REPASSE,
    formatarChavePixEntrada,
    formatarCpfCnpjEntrada,
    formatarCrmvEntrada,
    formatarEmailEntrada,
    formatarTelefoneEntrada,
} from '../../../lib/prestadorCadastroHelpers'
import { placeholderOutrasEspecialidadesPublico } from '../../../lib/formularioPublicoEspecialidades'
import FormularioPublicoPerfilExtra from './FormularioPublicoPerfilExtra.jsx'

function Bloco({ titulo, children }) {
    return (
        <section className="fcred_bloco">
            <h2 className="fcred_bloco_tit">{titulo}</h2>
            {children}
        </section>
    )
}

export default function FormularioPublicoPassoDados({
    tipoPerfil,
    cpfCnpj,
    setCpfCnpj,
    docOk,
    verificandoDoc,
    onVerificarDoc,
    nome,
    setNome,
    telefone,
    setTelefone,
    celular,
    setCelular,
    email,
    setEmail,
    crmv,
    setCrmv,
    especialidadesFiltradas,
    especialidadePrincipalId,
    setEspecialidadePrincipalId,
    especialidadesSecundariasIds,
    setEspecialidadesSecundariasIds,
    tipoPix,
    setTipoPix,
    chavePix,
    setChavePix,
    tipoRepasse,
    setTipoRepasse,
    cep,
    onCepChange,
    cepLoading,
    onBuscarCep,
    endereco,
    setEndereco,
    especialidades,
    cidadesAtende,
    onCidadesAtendeChange,
    vetsPendentes,
    onVetsPendentesChange,
}) {
    const mostrarCrmv = tipoPerfil === 'volante' || tipoPerfil === 'clinica'
    const placeholderOutrasEsp = placeholderOutrasEspecialidadesPublico(tipoPerfil)

    const onChavePixChange = (valor) => {
        setChavePix(formatarChavePixEntrada(valor, tipoPix))
    }

    const docCompleto = documentoCpfCnpjEstaCompleto(cpfCnpj)
    const mostrarDocIndisponivel = docOk === false && docCompleto

    return (
        <div className="fcred_passo_dados">
            <Bloco titulo="Identificação">
                <div className="fcred_grid fcred_grid_2">
                    <label className="fcred_field fcred_field_doc">
                        <span>CPF / CNPJ</span>
                        <input
                            value={cpfCnpj}
                            autoComplete="off"
                            inputMode="numeric"
                            className={mostrarDocIndisponivel ? 'fcred_input_invalid' : undefined}
                            aria-invalid={mostrarDocIndisponivel}
                            onChange={(e) => {
                                setCpfCnpj(formatarCpfCnpjEntrada(e.target.value))
                            }}
                            onBlur={() => {
                                if (documentoCpfCnpjEstaCompleto(cpfCnpj)) void onVerificarDoc()
                            }}
                        />
                        <span className="fcred_field_hint" aria-live="polite">
                            {verificandoDoc && <span className="fcred_doc_muted">A verificar…</span>}
                            {docOk === true && docCompleto && (
                                <span className="fcred_doc_ok">Documento disponível</span>
                            )}
                            {mostrarDocIndisponivel && (
                                <span className="fcred_doc_bad">Documento já cadastrado ou pendente</span>
                            )}
                        </span>
                    </label>
                    <label className="fcred_field">
                        <span>Nome</span>
                        <input value={nome} autoComplete="name" onChange={(e) => setNome(e.target.value)} />
                    </label>
                </div>
                <div className="fcred_grid fcred_grid_3">
                    <label className="fcred_field">
                        <span>Telefone</span>
                        <input
                            type="tel"
                            inputMode="tel"
                            autoComplete="tel"
                            value={telefone}
                            onChange={(e) => setTelefone(formatarTelefoneEntrada(e.target.value))}
                        />
                    </label>
                    <label className="fcred_field">
                        <span>WhatsApp</span>
                        <input
                            type="tel"
                            inputMode="tel"
                            autoComplete="tel"
                            value={celular}
                            onChange={(e) => setCelular(formatarTelefoneEntrada(e.target.value))}
                        />
                    </label>
                    <label className="fcred_field">
                        <span>E-mail</span>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(formatarEmailEntrada(e.target.value))}
                        />
                    </label>
                </div>
                {mostrarCrmv ? (
                    <div className="fcred_grid fcred_grid_crmv_esp fcred_grid_esp_linha">
                        <label className="fcred_field fcred_field_crmv">
                            <span>CRMV</span>
                            <input
                                value={crmv}
                                onChange={(e) => setCrmv(formatarCrmvEntrada(e.target.value))}
                                placeholder="PF/PJ - 123456 - UF"
                                autoComplete="off"
                            />
                        </label>
                        <div className="fcred_field fcred_campo_tipo_esp">
                            <div className="pcad_row pcad_row_esp fcred_pcad_esp_row">
                                <label className="pcad_field">
                                    Especialidade *
                                    <select
                                        className="credenciamento_main_select"
                                        value={especialidadePrincipalId}
                                        onChange={(e) => setEspecialidadePrincipalId(e.target.value)}
                                    >
                                        <option value="">—</option>
                                        {especialidadesFiltradas.map((e) => (
                                            <option key={e.id} value={e.id}>
                                                {e.nome}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <MultiEspecialidadesInput
                                    layout="inline"
                                    especialidades={especialidadesFiltradas}
                                    principalId={especialidadePrincipalId}
                                    secundariasIds={especialidadesSecundariasIds}
                                    onChangeSecundarias={setEspecialidadesSecundariasIds}
                                    placeholderOutras={placeholderOutrasEsp}
                                />
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="fcred_campo_tipo_esp fcred_campo_tipo_esp--solo">
                        <div className="pcad_row pcad_row_esp fcred_pcad_esp_row">
                            <label className="pcad_field">
                                Especialidade *
                                <select
                                    className="credenciamento_main_select"
                                    value={especialidadePrincipalId}
                                    onChange={(e) => setEspecialidadePrincipalId(e.target.value)}
                                >
                                    <option value="">—</option>
                                    {especialidadesFiltradas.map((e) => (
                                        <option key={e.id} value={e.id}>
                                            {e.nome}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <MultiEspecialidadesInput
                                layout="inline"
                                especialidades={especialidadesFiltradas}
                                principalId={especialidadePrincipalId}
                                secundariasIds={especialidadesSecundariasIds}
                                onChangeSecundarias={setEspecialidadesSecundariasIds}
                                placeholderOutras={placeholderOutrasEsp}
                            />
                        </div>
                    </div>
                )}
            </Bloco>

            <Bloco titulo="Financeiro">
                <div className="fcred_grid fcred_grid_3">
                    <label className="fcred_field">
                        <span>Tipo de PIX</span>
                        <select
                            className="fcred_select credenciamento_main_select"
                            value={tipoPix}
                            onChange={(e) => {
                                setTipoPix(e.target.value)
                                setChavePix('')
                            }}
                        >
                            {TIPOS_CHAVE_PIX.map((t) => (
                                <option key={t.value || 'vazio'} value={t.value}>
                                    {t.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="fcred_field">
                        <span>Chave PIX</span>
                        <input
                            type={tipoPix === 'email' ? 'email' : tipoPix === 'telefone' ? 'tel' : 'text'}
                            inputMode={
                                tipoPix === 'telefone'
                                    ? 'tel'
                                    : tipoPix === 'cpf' || tipoPix === 'cnpj'
                                      ? 'numeric'
                                      : undefined
                            }
                            autoComplete={tipoPix === 'email' ? 'email' : tipoPix === 'telefone' ? 'tel' : 'off'}
                            value={chavePix}
                            disabled={!tipoPix}
                            placeholder={
                                tipoPix === 'email'
                                    ? 'email@exemplo.com'
                                    : tipoPix === 'telefone'
                                      ? '(00) 00000-0000'
                                      : tipoPix === 'cpf'
                                        ? '000.000.000-00'
                                        : tipoPix === 'cnpj'
                                          ? '00.000.000/0000-00'
                                          : 'Selecione o tipo de PIX'
                            }
                            onChange={(e) => onChavePixChange(e.target.value)}
                        />
                    </label>
                    <label className="fcred_field">
                        <span>Nota / RPA</span>
                        <select
                            className="fcred_select credenciamento_main_select"
                            value={tipoRepasse}
                            onChange={(e) => setTipoRepasse(e.target.value)}
                        >
                            {TIPOS_REPASSE.map((t) => (
                                <option key={t.value || 'vazio'} value={t.value}>
                                    {t.label}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            </Bloco>

            <Bloco titulo="Endereço">
                <div className="fcred_grid fcred_grid_3">
                    <label className="fcred_field">
                        <span>CEP {cepLoading ? '(buscando…)' : ''}</span>
                        <input
                            inputMode="numeric"
                            autoComplete="postal-code"
                            value={cep}
                            placeholder="00000-000"
                            onChange={(e) => onCepChange(e.target.value)}
                            onBlur={() => void onBuscarCep()}
                        />
                    </label>
                    <label className="fcred_field">
                        <span>Logradouro</span>
                        <input
                            value={endereco.logradouro}
                            onChange={(e) => setEndereco((x) => ({ ...x, logradouro: e.target.value }))}
                        />
                    </label>
                    <label className="fcred_field">
                        <span>Número</span>
                        <input
                            value={endereco.numero}
                            onChange={(e) => setEndereco((x) => ({ ...x, numero: e.target.value }))}
                        />
                    </label>
                </div>
                <div className="fcred_grid fcred_grid_4">
                    <label className="fcred_field">
                        <span>Cidade</span>
                        <input
                            value={endereco.cidade}
                            onChange={(e) => setEndereco((x) => ({ ...x, cidade: e.target.value }))}
                        />
                    </label>
                    <label className="fcred_field">
                        <span>UF</span>
                        <input
                            value={endereco.uf}
                            maxLength={2}
                            onChange={(e) =>
                                setEndereco((x) => ({ ...x, uf: e.target.value.toUpperCase().slice(0, 2) }))
                            }
                        />
                    </label>
                    <label className="fcred_field">
                        <span>País</span>
                        <input
                            value={endereco.pais}
                            onChange={(e) => setEndereco((x) => ({ ...x, pais: e.target.value }))}
                        />
                    </label>
                    <label className="fcred_field">
                        <span>Complemento</span>
                        <input
                            value={endereco.complemento}
                            onChange={(e) => setEndereco((x) => ({ ...x, complemento: e.target.value }))}
                        />
                    </label>
                </div>
            </Bloco>

            <FormularioPublicoPerfilExtra
                tipoPerfil={tipoPerfil}
                especialidades={especialidades}
                cidadesAtende={cidadesAtende}
                onCidadesAtendeChange={onCidadesAtendeChange}
                vetsPendentes={vetsPendentes}
                onVetsPendentesChange={onVetsPendentesChange}
            />
        </div>
    )
}
