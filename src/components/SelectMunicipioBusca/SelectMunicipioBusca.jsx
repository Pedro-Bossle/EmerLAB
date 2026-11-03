import React, { useMemo } from 'react'
import { Dropdown } from '../ui/Dropdown.jsx'

/**
 * Dropdown de município/cidade/UF com busca. Invólucro do `Dropdown` do UI Kit que preserva a API antiga:
 * options `{ id, nome }`, `valueKey` ('id' | 'nome'), `onChange(valor)`.
 */
export default function SelectMunicipioBusca({
    options = [],
    value = '',
    onChange,
    valueKey = 'nome',
    disabled = false,
    loading = false,
    placeholder = 'Selecionar cidade…',
    searchPlaceholder = 'Buscar cidade…',
    className = '',
    inputClassName = '',
    emptyLabel = '—',
    creatable = false,
    createLabel,
    id,
    name,
    'aria-label': ariaLabel = 'Cidade',
}) {
    const opcoes = useMemo(
        () =>
            (options || []).map((o) => ({
                value: valueKey === 'id' ? (o.id == null ? '' : String(o.id)) : String(o.nome || '').trim(),
                label: String(o.nome || '').trim(),
            })),
        [options, valueKey],
    )

    return (
        <Dropdown
            options={opcoes}
            value={String(value ?? '').trim()}
            onChange={(v) => onChange?.(v)}
            disabled={disabled}
            loading={loading}
            placeholder={placeholder || emptyLabel}
            searchPlaceholder={searchPlaceholder}
            searchable
            clearable
            emptyLabel="Nenhum resultado"
            creatable={creatable}
            createLabel={createLabel}
            className={className}
            triggerClassName={inputClassName}
            id={id}
            name={name}
            aria-label={ariaLabel}
        />
    )
}
