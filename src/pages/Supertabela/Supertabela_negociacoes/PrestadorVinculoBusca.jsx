import React, { useMemo } from 'react'
import { Dropdown } from '../../../components/ui/Dropdown.jsx'

/**
 * Seleção/vínculo de prestador ou clínica credenciada (gatilho + painel com busca, padrão do UI Kit).
 * `onChange(prestador | null)`; o item «— Nenhum vínculo» limpa a escolha.
 * `usePortal` é mantido por compatibilidade: o painel sempre sai em portal (não é cortado por tabelas).
 */
export default function PrestadorVinculoBusca({
    prestadores = [],
    prestadorId = '',
    onChange,
    disabled = false,
    rotuloFn,
    placeholder = 'Buscar clínica ou prestador…',
    titleValor,
}) {
    const opcoes = useMemo(
        () => [
            { value: '', label: '— Nenhum vínculo' },
            ...(prestadores || []).map((p) => ({
                value: String(p.id),
                label: String(rotuloFn ? rotuloFn(p) : p.nome || ''),
            })),
        ],
        [prestadores, rotuloFn],
    )

    return (
        <Dropdown
            options={opcoes}
            value={String(prestadorId ?? '')}
            onChange={(v) => {
                if (!v) return onChange?.(null)
                onChange?.((prestadores || []).find((p) => String(p.id) === v) || null)
            }}
            disabled={disabled}
            placeholder={placeholder}
            searchPlaceholder="Buscar clínica ou prestador…"
            searchable
            emptyAsPlaceholder
            title={titleValor}
            aria-label="Prestador"
            triggerClassName="prestador_vinculo_busca_input"
        />
    )
}
