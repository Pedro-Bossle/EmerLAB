import { describe, expect, it } from 'vitest'
import {
    ErroValidacao,
    filtrarCredenciados,
    montarCredenciados,
    normalizarMunicipio,
    paraPublico,
    resolverPlanoId,
    situacaoEhCredenciado,
} from './redeRegras.js'

const ESPECIALIDADES = [
    { id: 1, nome: 'Clinica 24h', tipo: 'Local' },
    { id: 2, nome: 'Clinica', tipo: 'Local' },
    { id: 5, nome: 'Laboratorio', tipo: 'Local' },
    { id: 8, nome: 'Dermatologista', tipo: 'Especialidade' },
    { id: 24, nome: 'Integrativa', tipo: 'Especialidade' },
    { id: 37, nome: 'Fisioterapeuta', tipo: 'Especialidade' },
]

const PLANOS = [
    { id: 1, nome: 'Básico' },
    { id: 2, nome: 'Clássico' },
    { id: 3, nome: 'Avançado' },
    { id: 4, nome: 'Ultra' },
    { id: 5, nome: 'Apenas Loja' },
]

const prestador = (dados) => ({
    ativo: true,
    situacao_id: 4,
    tipo: 'Especialidade',
    especialidade_id: 8,
    telefone: null,
    celular: null,
    endereco_logradouro: null,
    endereco_numero: null,
    endereco_complemento: null,
    endereco_bairro: null,
    endereco_cidade: null,
    endereco_uf: null,
    cep: null,
    ...dados,
})

const base = (extra = {}) => ({
    prestadores: [],
    situacoes: [
        { id: 4, descricao: 'Credenciado' },
        { id: 5, descricao: 'Cancelado' },
        { id: 6, descricao: 'Descredenciado' },
        { id: 7, descricao: 'Não credenciado' },
    ],
    estabelecimentos: [],
    procedimentos: [],
    prestadorProcedimentos: [],
    prestadorCidades: [],
    cidadesCredenciamento: [],
    especialidades: ESPECIALIDADES,
    prestadorEspecialidades: [],
    beneficios: [],
    prestadorBeneficios: [],
    beneficiosObs: [],
    planos: PLANOS,
    planosCidade: [],
    cidades: [],
    municipiosVinculo: [],
    categorias: [],
    ...extra,
})

const ids = (lista) => lista.map((c) => c.id)

describe('situacaoEhCredenciado', () => {
    it('aceita Credenciado e recusa Descredenciado, Não credenciado e Cancelado', () => {
        expect(situacaoEhCredenciado('Credenciado')).toBe(true)
        expect(situacaoEhCredenciado('CREDENCIADA')).toBe(true)
        expect(situacaoEhCredenciado('Descredenciado')).toBe(false)
        expect(situacaoEhCredenciado('Não credenciado')).toBe(false)
        expect(situacaoEhCredenciado('Ex-credenciado')).toBe(false)
        expect(situacaoEhCredenciado('Cancelado')).toBe(false)
        expect(situacaoEhCredenciado('')).toBe(false)
    })
})

describe('normalizarMunicipio', () => {
    it('tira acento, caixa e o sufixo de região', () => {
        expect(normalizarMunicipio('Porto Alegre e Região')).toBe('porto alegre')
        expect(normalizarMunicipio('porto alegre e regiao')).toBe('porto alegre')
        expect(normalizarMunicipio('  Gravataí ')).toBe('gravatai')
    })
})

describe('montarCredenciados', () => {
    it('só entram ativos com situação Credenciado', () => {
        const lista = montarCredenciados(
            base({
                prestadores: [
                    prestador({ id: 1, nome: 'Ativo credenciado' }),
                    prestador({ id: 2, nome: 'Inativo', ativo: false }),
                    prestador({ id: 3, nome: 'Cancelado', situacao_id: 5 }),
                    prestador({ id: 4, nome: 'Descredenciado', situacao_id: 6 }),
                    prestador({ id: 5, nome: 'Não credenciado', situacao_id: 7 }),
                ],
            }),
        )
        expect(ids(lista)).toEqual([1])
    })

    it('ordena por nome', () => {
        const lista = montarCredenciados(
            base({
                prestadores: [prestador({ id: 1, nome: 'Zeta' }), prestador({ id: 2, nome: 'Ágata' }), prestador({ id: 3, nome: 'beta' })],
            }),
        )
        expect(ids(lista)).toEqual([2, 3, 1])
    })

    it('vet vinculado a clínica sem endereço próprio herda cidade/UF e cidades da clínica e aparece uma vez', () => {
        const b = base({
            prestadores: [
                prestador({ id: 10, nome: 'Clínica X', especialidade_id: 2, tipo: 'Local', endereco_cidade: 'Canoas', endereco_uf: 'RS' }),
                prestador({ id: 11, nome: 'Clínica Y', especialidade_id: 2, tipo: 'Local', endereco_cidade: 'Esteio', endereco_uf: 'RS' }),
                prestador({ id: 20, nome: 'Dra. Vet', especialidade_id: 8 }),
            ],
            estabelecimentos: [
                { veterinario_id: 20, estabelecimento_id: 11, principal: false },
                { veterinario_id: 20, estabelecimento_id: 10, principal: true },
            ],
            prestadorCidades: [{ prestador_id: 10, cidade_id: 100 }],
            cidadesCredenciamento: [{ id: 100, nome: 'Porto Alegre', uf: 'rs' }],
        })
        const lista = montarCredenciados(b)
        const vets = lista.filter((c) => c.id === 20)
        expect(vets).toHaveLength(1)
        const pub = paraPublico(vets[0])
        expect(pub.cidade_principal).toEqual({ nome: 'Canoas', uf: 'RS' })
        expect(pub.cidades_atende).toEqual([{ nome: 'Porto Alegre', uf: 'RS' }])
        expect(ids(filtrarCredenciados(lista, { cidade: 'porto alegre' }))).toEqual([10, 20])
    })
})

describe('filtrarCredenciados por cidade e UF', () => {
    const b = base({
        prestadores: [
            prestador({ id: 1, nome: 'A', endereco_cidade: 'Porto Alegre e Região', endereco_uf: 'RS' }),
            prestador({ id: 2, nome: 'B', endereco_cidade: 'Canoas', endereco_uf: 'RS' }),
            prestador({ id: 3, nome: 'C', endereco_cidade: 'Curitiba', endereco_uf: 'PR' }),
            prestador({ id: 4, nome: 'D', endereco_cidade: 'Santa Maria', endereco_uf: 'RN' }),
            prestador({ id: 5, nome: 'E', endereco_cidade: 'Santa Maria', endereco_uf: 'RS' }),
        ],
        prestadorCidades: [{ prestador_id: 2, cidade_id: 100 }],
        cidadesCredenciamento: [{ id: 100, nome: 'Porto Alegre', uf: 'RS' }],
    })
    const lista = montarCredenciados(b)

    it('cidade casa "Porto Alegre e Região" e a lista de cidades que atende', () => {
        expect(ids(filtrarCredenciados(lista, { cidade: 'porto alegre' }))).toEqual([1, 2])
        expect(ids(filtrarCredenciados(lista, { cidade: 'PORTO ALEGRE', uf: 'rs' }))).toEqual([1, 2])
    })

    it('não casa quando só outra UF tem o nome', () => {
        expect(ids(filtrarCredenciados(lista, { cidade: 'santa maria', uf: 'RS' }))).toEqual([5])
        expect(ids(filtrarCredenciados(lista, { cidade: 'porto alegre', uf: 'PR' }))).toEqual([])
    })

    it('uf sozinha restringe às cidades da UF', () => {
        expect(ids(filtrarCredenciados(lista, { uf: 'PR' }))).toEqual([3])
    })
})

describe('especialidade, tipo e busca por nome', () => {
    const b = base({
        prestadores: [
            prestador({ id: 1, nome: 'Clínica Boa', especialidade_id: 2, tipo: 'Local' }),
            prestador({ id: 2, nome: 'Ami Reabilitação', especialidade_id: 37 }),
            prestador({ id: 3, nome: 'Dr. Derma', especialidade_id: 8 }),
        ],
        prestadorEspecialidades: [
            { prestador_id: 2, especialidade_id: 37, principal: true },
            { prestador_id: 2, especialidade_id: 2, principal: false },
            { prestador_id: 2, especialidade_id: 24, principal: false },
            { prestador_id: 3, especialidade_id: 24, principal: false },
        ],
    })
    const lista = montarCredenciados(b)

    it('tipo local inclui principal ou secundária Local e exclui os demais', () => {
        expect(ids(filtrarCredenciados(lista, { tipo: 'local' }))).toEqual([2, 1])
        expect(ids(filtrarCredenciados(lista, { tipo: 'especialidade' }))).toEqual([3])
    })

    it('tipo desconhecido é erro de validação', () => {
        expect(() => filtrarCredenciados(lista, { tipo: 'outro' })).toThrow(ErroValidacao)
    })

    it('especialidade casa a primária e as secundárias, por id ou por nome', () => {
        expect(ids(filtrarCredenciados(lista, { especialidade: 'integrativa' }))).toEqual([2, 3])
        expect(ids(filtrarCredenciados(lista, { especialidade: '2' }))).toEqual([2, 1])
        expect(ids(filtrarCredenciados(lista, { especialidade: 37 }))).toEqual([2])
        expect(ids(filtrarCredenciados(lista, { especialidade: 'Clínica' }))).toEqual([2, 1])
    })

    it('q busca pelo nome sem acento', () => {
        expect(ids(filtrarCredenciados(lista, { q: 'reabilitacao' }))).toEqual([2])
        expect(ids(filtrarCredenciados(lista, { q: 'clinica boa' }))).toEqual([1])
    })

    it('tipo do objeto público é o da principal', () => {
        const porId = new Map(lista.map((c) => [c.id, paraPublico(c)]))
        expect(porId.get(1).tipo).toBe('local')
        expect(porId.get(2).tipo).toBe('especialidade')
        expect(porId.get(2).especialidade_principal).toBe('Fisioterapeuta')
        expect(porId.get(2).especialidades_secundarias).toEqual(['Clinica', 'Integrativa'])
    })
})

describe('paraPublico: endereço', () => {
    const endereco = {
        endereco_logradouro: 'Rua Antônio Ribeiro Mendes',
        endereco_numero: '2138',
        endereco_bairro: 'Santa Catarina',
        endereco_cidade: 'Caxias do Sul',
        endereco_uf: 'RS',
    }
    const b = base({
        prestadores: [
            prestador({ id: 1, nome: 'Clínica', especialidade_id: 2, tipo: 'Local', ...endereco }),
            prestador({ id: 2, nome: 'Fisio com clínica', especialidade_id: 37, ...endereco }),
            prestador({ id: 3, nome: 'Só vet', especialidade_id: 8, ...endereco }),
        ],
        prestadorEspecialidades: [
            { prestador_id: 2, especialidade_id: 37, principal: true },
            { prestador_id: 2, especialidade_id: 2, principal: false },
            { prestador_id: 3, especialidade_id: 24, principal: false },
        ],
    })
    const porId = new Map(montarCredenciados(b).map((c) => [c.id, paraPublico(c)]))

    it('principal Local traz endereço com texto', () => {
        const e = porId.get(1).endereco
        expect(e).toEqual({
            logradouro: 'Rua Antônio Ribeiro Mendes',
            numero: '2138',
            complemento: null,
            bairro: 'Santa Catarina',
            cidade: 'Caxias do Sul',
            uf: 'RS',
            cep: null,
            texto: 'Rua Antônio Ribeiro Mendes, 2138 — Santa Catarina — Caxias do Sul/RS',
        })
    })

    it('principal Especialidade com secundária Local também traz endereço', () => {
        expect(porId.get(2).endereco?.texto).toBeTruthy()
        expect(porId.get(2).tipo).toBe('especialidade')
    })

    it('só especialidades do tipo Especialidade → endereco null', () => {
        expect(porId.get(3).endereco).toBeNull()
    })
})

describe('paraPublico: campos', () => {
    it('nunca expõe campos internos', () => {
        const b = base({
            prestadores: [
                prestador({
                    id: 1,
                    nome: 'Clínica',
                    especialidade_id: 2,
                    tipo: 'Local',
                    cpf_cnpj: '00.000.000/0001-00',
                    chave_pix: 'pix@x',
                    tipo_pix: 'email',
                    email: 'interno@x',
                    observacoes: 'interno',
                    obs: 'interno',
                    crmv: '123',
                    data_cadastro: '2020-01-01',
                    cadastrado_por: 'u',
                    cadastrado_por_nome: 'Fulano',
                    endereco_cidade: 'Canoas',
                    endereco_uf: 'RS',
                }),
            ],
        })
        const [c] = montarCredenciados(b)
        const pub = paraPublico(c, { planoId: 1 })
        expect(Object.keys(pub).sort()).toEqual(
            [
                'id',
                'nome',
                'tipo',
                'especialidade_principal',
                'especialidades_secundarias',
                'contatos',
                'cidade_principal',
                'cidades_atende',
                'endereco',
                'procedimentos',
                'descontos',
            ].sort(),
        )
        const json = JSON.stringify(pub)
        for (const chave of ['cpf_cnpj', 'chave_pix', 'tipo_pix', 'email', 'situacao_id', 'obs', 'crmv', 'data_cadastro', 'cadastrado_por', 'cadastrado_por_nome']) {
            expect(json).not.toContain(`"${chave}"`)
        }
        expect(json).not.toContain('interno')
        expect(json).not.toContain('pix@x')
    })

    it('sem procedimentos, descontos e telefone devolve vazios', () => {
        const [c] = montarCredenciados(base({ prestadores: [prestador({ id: 1, nome: 'Vazio' })] }))
        const pub = paraPublico(c)
        expect(pub.procedimentos).toEqual([])
        expect(pub.descontos).toEqual({ itens: [], observacoes: null })
        expect(pub.contatos).toEqual({ telefone: null, celular: null, whatsapp_url: null })
        expect(pub.cidade_principal).toBeNull()
        expect(pub.cidades_atende).toEqual([])
        expect(pub.especialidades_secundarias).toEqual([])
    })

    it('contatos com link do WhatsApp', () => {
        const [c] = montarCredenciados(
            base({ prestadores: [prestador({ id: 1, nome: 'X', telefone: ' (54) 3222-1111 ', celular: '(54) 9259-5078' })] }),
        )
        expect(paraPublico(c).contatos).toEqual({
            telefone: '(54) 3222-1111',
            celular: '(54) 9259-5078',
            whatsapp_url: 'https://wa.me/555492595078',
        })
    })

    it('descontos só com incluir = true e percentuais numéricos', () => {
        const b = base({
            prestadores: [prestador({ id: 1, nome: 'Pet' })],
            beneficios: [
                { id: 1, nome: 'Banho e tosa', grupo_nome: 'Serviços', ordem: 2 },
                { id: 2, nome: 'Ração', grupo_nome: 'Produtos', ordem: 1 },
                { id: 3, nome: 'Fora', grupo_nome: 'Produtos', ordem: 3 },
            ],
            prestadorBeneficios: [
                { prestador_id: 1, beneficio_id: 1, percentual: '10', percentual_max: '15', incluir: true, ordem: 1 },
                { prestador_id: 1, beneficio_id: 2, percentual: 5, percentual_max: null, incluir: true, ordem: 2 },
                { prestador_id: 1, beneficio_id: 3, percentual: 50, percentual_max: null, incluir: false, ordem: 3 },
            ],
            beneficiosObs: [{ prestador_id: 1, observacoes: '  Só às terças  ' }],
        })
        const [c] = montarCredenciados(b)
        expect(paraPublico(c).descontos).toEqual({
            itens: [
                { nome: 'Banho e tosa', grupo: 'Serviços', percentual: 10, percentual_max: 15 },
                { nome: 'Ração', grupo: 'Produtos', percentual: 5, percentual_max: null },
            ],
            observacoes: 'Só às terças',
        })
    })

    it('procedimentos agrupados por categoria, pelo código ou pelo id', () => {
        const b = base({
            prestadores: [prestador({ id: 1, nome: 'Fisio' })],
            categorias: [{ id: 7, nome: 'Sessões' }, { id: 8, nome: 'Consultas' }],
            procedimentos: [
                { id: 50, codigo: 'SESS-002', nome: 'Sessão de Fisioterapia', categoria_id: 7, plano_base_id: 1 },
                { id: 51, codigo: 'SESS-001', nome: 'Avaliação Fisiátrica', categoria_id: 7, plano_base_id: 1 },
                { id: 52, codigo: 'CON-001', nome: 'Consulta', categoria_id: 8, plano_base_id: 1 },
            ],
            prestadorProcedimentos: [
                { prestador_id: 1, procedimento_cod: 'sess-002', procedimento_id: null, nome_alternativo: null },
                { prestador_id: 1, procedimento_cod: null, procedimento_id: 51, nome_alternativo: 'Avaliação' },
                { prestador_id: 1, procedimento_cod: 'SESS-002', procedimento_id: 50, nome_alternativo: null },
                { prestador_id: 1, procedimento_cod: 'CON-001', procedimento_id: 52, nome_alternativo: '' },
            ],
        })
        const [c] = montarCredenciados(b)
        expect(paraPublico(c).procedimentos).toEqual([
            { categoria: 'Consultas', itens: [{ codigo: 'CON-001', nome: 'Consulta', nome_alternativo: null }] },
            {
                categoria: 'Sessões',
                itens: [
                    { codigo: 'SESS-001', nome: 'Avaliação Fisiátrica', nome_alternativo: 'Avaliação' },
                    { codigo: 'SESS-002', nome: 'Sessão de Fisioterapia', nome_alternativo: null },
                ],
            },
        ])
    })
})

describe('plano', () => {
    const b = base({
        prestadores: [
            prestador({ id: 1, nome: 'Em Canoas', endereco_cidade: 'Canoas', endereco_uf: 'RS' }),
            prestador({ id: 2, nome: 'Em Caxias', endereco_cidade: 'Caxias do Sul', endereco_uf: 'RS' }),
            prestador({ id: 3, nome: 'Em Pelotas', endereco_cidade: 'Pelotas', endereco_uf: 'RS' }),
            prestador({ id: 4, nome: 'Atende POA', endereco_cidade: 'Gramado', endereco_uf: 'RS' }),
        ],
        prestadorCidades: [{ prestador_id: 4, cidade_id: 100 }],
        cidadesCredenciamento: [{ id: 100, nome: 'Porto Alegre e Região', uf: null }],
        cidades: [
            { id: 1, nome: 'Caxias do Sul', uf: 'RS' },
            { id: 4, nome: 'Porto Alegre', uf: 'RS' },
            { id: 30, nome: 'Pelotas', uf: 'RS' },
        ],
        municipiosVinculo: [
            { cidade_id: 4, uf: 'RS', municipio_nome: 'Canoas' },
            { cidade_id: 4, uf: 'RS', municipio_nome: 'Porto Alegre' },
        ],
        planosCidade: [
            { plano_id: 1, cidade_id: 4, procedimento_cod: 'A' },
            { plano_id: 2, cidade_id: 4, procedimento_cod: 'A' },
            { plano_id: 2, cidade_id: 1, procedimento_cod: 'A' },
            { plano_id: 5, cidade_id: 30, procedimento_cod: 'A' },
            { plano_id: 1, cidade_id: null, procedimento_cod: 'A' },
        ],
        categorias: [{ id: 7, nome: 'Geral' }],
        procedimentos: [
            { id: 1, codigo: 'B-1', nome: 'Do básico', categoria_id: 7, plano_base_id: 1 },
            { id: 2, codigo: 'C-1', nome: 'Do clássico', categoria_id: 7, plano_base_id: 2 },
            { id: 3, codigo: 'U-1', nome: 'Do ultra', categoria_id: 7, plano_base_id: 4 },
            { id: 4, codigo: 'L-1', nome: 'Da loja', categoria_id: 7, plano_base_id: 5 },
        ],
        prestadorProcedimentos: ['B-1', 'C-1', 'U-1', 'L-1'].map((cod) => ({ prestador_id: 1, procedimento_cod: cod })),
    })
    const lista = montarCredenciados(b)
    const codigos = (pub) => pub.procedimentos.flatMap((g) => g.itens.map((i) => i.codigo))

    it('basico mantém só credenciados de cidades com tabela do plano (município vinculado incluído)', () => {
        expect(ids(filtrarCredenciados(lista, { plano: 'basico' }))).toEqual([4, 1])
        expect(ids(filtrarCredenciados(lista, { plano: 1 }))).toEqual([4, 1])
        expect(ids(filtrarCredenciados(lista, { plano: '2' }))).toEqual([4, 1, 2])
        expect(ids(filtrarCredenciados(lista, { plano: 'ultra' }))).toEqual([])
    })

    it('procedimentos cortados pela hierarquia do plano', () => {
        const c = lista.find((x) => x.id === 1)
        expect(codigos(paraPublico(c, { planoId: 1 }))).toEqual(['B-1'])
        expect(codigos(paraPublico(c, { planoId: 2 }))).toEqual(['B-1', 'C-1'])
        expect(codigos(paraPublico(c, { planoId: 4 }))).toEqual(['B-1', 'C-1', 'U-1'])
        expect(codigos(paraPublico(c))).toEqual(['B-1', 'C-1', 'L-1', 'U-1'])
    })

    it('apenas_loja e planos desconhecidos são inválidos', () => {
        const erro = (fn) => {
            try {
                fn()
            } catch (e) {
                return e
            }
            return null
        }
        for (const plano of ['apenas_loja', 5, '5', 'premium', 99]) {
            const e = erro(() => filtrarCredenciados(lista, { plano }))
            expect(e).toBeInstanceOf(ErroValidacao)
            expect(e.codigo).toBe('plano_invalido')
        }
        expect(erro(() => paraPublico(lista[0], { planoId: 5 }))?.codigo).toBe('plano_invalido')
    })

    it('resolverPlanoId aceita id, chave e nome', () => {
        expect(resolverPlanoId(PLANOS, 'classico')).toBe(2)
        expect(resolverPlanoId(PLANOS, 'Avançado')).toBe(3)
        expect(resolverPlanoId(PLANOS, '4')).toBe(4)
        expect(() => resolverPlanoId(PLANOS, 'apenas_loja')).toThrow(ErroValidacao)
    })

    it('lista vazia com plano válido devolve vazio; inválido ainda dá erro', () => {
        expect(filtrarCredenciados([], { plano: 'basico' })).toEqual([])
        expect(() => filtrarCredenciados([], { plano: 'apenas_loja' })).toThrow(ErroValidacao)
    })
})
