import React, { useMemo } from 'react'
import { UFS_BRASIL } from '../../lib/ibgeLocalidades.js'
import SelectMunicipioBusca from '../SelectMunicipioBusca/SelectMunicipioBusca.jsx'

const NOMES_UF = {
    AC: 'Acre',
    AL: 'Alagoas',
    AP: 'Amapá',
    AM: 'Amazonas',
    BA: 'Bahia',
    CE: 'Ceará',
    DF: 'Distrito Federal',
    ES: 'Espírito Santo',
    GO: 'Goiás',
    MA: 'Maranhão',
    MT: 'Mato Grosso',
    MS: 'Mato Grosso do Sul',
    MG: 'Minas Gerais',
    PA: 'Pará',
    PB: 'Paraíba',
    PR: 'Paraná',
    PE: 'Pernambuco',
    PI: 'Piauí',
    RJ: 'Rio de Janeiro',
    RN: 'Rio Grande do Norte',
    RS: 'Rio Grande do Sul',
    RO: 'Rondônia',
    RR: 'Roraima',
    SC: 'Santa Catarina',
    SP: 'São Paulo',
    SE: 'Sergipe',
    TO: 'Tocantins',
}

/**
 * Drop de UF com busca digitável (mesmo padrão de SelectMunicipioBusca).
 * @param {{
 *   value?: string,
 *   onChange?: (uf: string) => void,
 *   ufs?: string[],
 *   disabled?: boolean,
 *   className?: string,
 *   inputClassName?: string,
 *   placeholder?: string,
 *   emptyLabel?: string,
 *   showNome?: boolean,
 *   id?: string,
 *   'aria-label'?: string,
 * }} props
 */
export default function SelectUfBusca({
    value = '',
    onChange,
    ufs = UFS_BRASIL,
    disabled = false,
    className = '',
    inputClassName = '',
    placeholder = 'Selecionar UF…',
    emptyLabel = '—',
    showNome = false,
    id,
    'aria-label': ariaLabel = 'UF',
}) {
    const options = useMemo(
        () =>
            (ufs || UFS_BRASIL).map((sigla) => ({
                id: sigla,
                nome: showNome && NOMES_UF[sigla] ? `${sigla} · ${NOMES_UF[sigla]}` : sigla,
            })),
        [ufs, showNome],
    )

    return (
        <SelectMunicipioBusca
            id={id}
            options={options}
            value={String(value || '').trim().toUpperCase()}
            onChange={(v) => onChange?.(String(v || '').trim().toUpperCase())}
            valueKey="id"
            disabled={disabled}
            className={className}
            inputClassName={inputClassName}
            placeholder={placeholder}
            searchPlaceholder="Buscar UF…"
            emptyLabel={emptyLabel}
            aria-label={ariaLabel}
        />
    )
}

export { NOMES_UF }
