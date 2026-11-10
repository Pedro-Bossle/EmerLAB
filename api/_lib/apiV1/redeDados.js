/**
 * Leitura em lote da rede credenciada (somente SELECT) e cache em memória de 5 minutos por instância.
 * Padrão do `memo` de zap-emerlab/server/cache.js: junta chamadas simultâneas e nunca guarda falha.
 * As colunas dos prestadores são listadas uma a uma: dados sensíveis (cpf_cnpj, pix, e-mail, observações)
 * nunca saem do banco.
 */
const PAGINA = 1000
const VALIDADE_MS = 5 * 60 * 1000

let guardado = null // { valor, expira }
let emVoo = null

async function todas(montar) {
    const linhas = []
    for (let inicio = 0; ; inicio += PAGINA) {
        const { data, error } = await montar().range(inicio, inicio + PAGINA - 1)
        if (error) throw error
        const lote = data || []
        linhas.push(...lote)
        if (lote.length < PAGINA) return linhas
    }
}

const COLUNAS_PRESTADOR = [
    'id',
    'nome',
    'ativo',
    'situacao_id',
    'especialidade_id',
    'tipo',
    'telefone',
    'celular',
    'endereco_logradouro',
    'endereco_numero',
    'endereco_complemento',
    'endereco_bairro',
    'endereco_cidade',
    'endereco_uf',
    'cep',
    'endereco',
].join(', ')

async function lerBase(admin) {
    const t = (tabela, colunas, ordem, filtro) => () => {
        let q = admin.from(tabela).select(colunas)
        if (filtro) q = filtro(q)
        for (const o of ordem) q = q.order(o)
        return q
    }
    const [
        prestadores,
        situacoes,
        estabelecimentos,
        procedimentos,
        prestadorProcedimentos,
        prestadorCidades,
        cidadesCredenciamento,
        especialidades,
        prestadorEspecialidades,
        beneficios,
        prestadorBeneficios,
        beneficiosObs,
        planos,
        planosCidade,
        cidades,
        municipiosVinculo,
        categorias,
    ] = await Promise.all([
        todas(t('prestadores', COLUNAS_PRESTADOR, ['id'], (q) => q.eq('ativo', true))),
        todas(t('situacoes', 'id, descricao', ['id'])),
        todas(t('prestador_estabelecimentos', 'veterinario_id, estabelecimento_id, principal', ['id'])),
        todas(t('procedimentos', 'id, codigo, nome, categoria_id, plano_base_id', ['id'])),
        todas(t('prestador_procedimentos', 'prestador_id, procedimento_cod, procedimento_id, nome_alternativo', ['id'])),
        todas(t('prestador_cidades', 'prestador_id, cidade_id', ['id'])),
        todas(t('cidades_credenciamento', 'id, nome, uf', ['id'])),
        todas(t('especialidades', 'id, nome, tipo', ['id'])),
        todas(t('prestador_especialidades', 'prestador_id, especialidade_id, principal', ['id'])),
        todas(t('beneficios_catalogo', 'id, nome, grupo_nome, ordem, ativo', ['id'])),
        todas(t('prestador_beneficios', 'prestador_id, beneficio_id, percentual, percentual_max, incluir, ordem', ['id'], (q) => q.eq('incluir', true))),
        todas(t('prestador_beneficios_obs', 'prestador_id, observacoes', ['prestador_id'])),
        todas(t('planos', 'id, nome', ['id'])),
        todas(t('planos_cidade', 'plano_id, cidade_id', ['id'])),
        todas(t('cidades', 'id, nome, uf', ['id'])),
        todas(t('cidades_municipios_vinculo', 'cidade_id, uf, municipio_nome', ['id'])),
        todas(t('categorias', 'id, nome', ['id'])),
    ])
    return {
        prestadores,
        situacoes,
        estabelecimentos,
        procedimentos,
        prestadorProcedimentos,
        prestadorCidades,
        cidadesCredenciamento,
        especialidades,
        prestadorEspecialidades,
        beneficios,
        prestadorBeneficios,
        beneficiosObs,
        planos,
        planosCidade,
        cidades,
        municipiosVinculo,
        categorias,
    }
}

/** BaseRede em cache por 5 minutos (uma leitura em voo por vez; erro não é guardado). */
export function carregarBaseRede(admin) {
    if (guardado && guardado.expira > Date.now()) return Promise.resolve(guardado.valor)
    if (emVoo) return emVoo
    const promessa = (async () => {
        try {
            const valor = await lerBase(admin)
            guardado = { valor, expira: Date.now() + VALIDADE_MS }
            return valor
        } finally {
            emVoo = null
        }
    })()
    emVoo = promessa
    return promessa
}

/** Zera o cache (testes). */
export function limparCacheRede() {
    guardado = null
    emVoo = null
}
