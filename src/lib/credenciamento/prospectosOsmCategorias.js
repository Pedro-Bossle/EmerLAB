/**

 * Categorias OSM para catálogo de prospectos (Overpass / Gemini).

 * Apenas estabelecimentos e serviços voltados a animais / medicina veterinária.

 * @typedef {{ id: string, label: string, overpass: [string, string][] }} ProspectoOsmCategoria

 */



/** Categorias descontinuadas (dados antigos no banco). */

export const PROSPECTOS_OSM_CATEGORIAS_EXCLUIDAS = ['doctors', 'hospital', 'laboratory']



/** @type {ProspectoOsmCategoria[]} */

export const PROSPECTOS_OSM_CATEGORIAS = [

    {

        id: 'veterinary',

        label: 'Clínica / veterinária',

        overpass: [

            ['amenity', 'veterinary'],

            ['healthcare', 'veterinary'],

        ],

    },

    {

        id: 'pet_shop',

        label: 'Pet shop',

        overpass: [['shop', 'pet']],

    },

    {

        id: 'pet_grooming',

        label: 'Banho e tosa',

        overpass: [

            ['shop', 'pet_grooming'],

            ['craft', 'dog_grooming'],

        ],

    },

    {

        id: 'animal_boarding',

        label: 'Hotel / hospedagem pet',

        overpass: [['amenity', 'animal_boarding']],

    },

]



export function getProspectoOsmCategoriaPorId(id) {

    return PROSPECTOS_OSM_CATEGORIAS.find((c) => c.id === id) || null

}



export function labelProspectoOsmCategoria(id) {

    return getProspectoOsmCategoriaPorId(id)?.label || id || '—'

}


