export type OsmCategoria = { id: string; label: string; overpass: [string, string][] }

export const PROSPECTOS_OSM_CATEGORIAS: OsmCategoria[] = [
  {
    id: 'veterinary',
    label: 'Clínica / veterinária',
    overpass: [
      ['amenity', 'veterinary'],
      ['healthcare', 'veterinary'],
    ],
  },
  { id: 'pet_shop', label: 'Pet shop', overpass: [['shop', 'pet']] },
  {
    id: 'pet_grooming',
    label: 'Banho e tosa',
    overpass: [
      ['shop', 'pet_grooming'],
      ['craft', 'dog_grooming'],
    ],
  },
  { id: 'animal_boarding', label: 'Hotel / hospedagem pet', overpass: [['amenity', 'animal_boarding']] },
]

export function getProspectoOsmCategoriaPorId(id: string): OsmCategoria | null {
  return PROSPECTOS_OSM_CATEGORIAS.find((c) => c.id === id) || null
}

export function labelProspectoOsmCategoria(id: string): string {
  return getProspectoOsmCategoriaPorId(id)?.label || id || '—'
}
