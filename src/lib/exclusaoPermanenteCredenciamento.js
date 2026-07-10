import { supabase } from './supabase.js'

async function apagarLinhas(tabela, coluna, valor) {
    const { error } = await supabase.from(tabela).delete().eq(coluna, valor)
    if (error) throw new Error(`${tabela}: ${error.message}`)
}

async function apagarLinhaObrigatoria(tabela, coluna, valor, rotulo = 'registro') {
    const { data, error } = await supabase.from(tabela).delete().eq(coluna, valor).select(coluna)
    if (error) throw new Error(`${tabela}: ${error.message}`)
    if (!data?.length) {
        throw new Error(
            `Nenhum ${rotulo} foi removido em ${tabela}. Verifique políticas RLS de DELETE no Supabase.`,
        )
    }
}

async function limparReferencia(tabela, colunaFk, valor) {
    const { error } = await supabase.from(tabela).update({ [colunaFk]: null }).eq(colunaFk, valor)
    if (error && !/column|relation|does not exist/i.test(error.message || '')) {
        throw new Error(`${tabela}: ${error.message}`)
    }
}

/**
 * Remove o prestador e dados dependentes do banco (irreversível). Exige Dev Tools + permissão de edição no app.
 */
export async function excluirPrestadorPermanentemente(prestadorId) {
    const pid = Number(prestadorId)
    if (!pid) throw new Error('ID de prestador inválido.')

    await apagarLinhas('prestador_estabelecimentos', 'veterinario_id', pid)
    await apagarLinhas('prestador_estabelecimentos', 'estabelecimento_id', pid)
    await apagarLinhas('prestador_laboratorios_solicitacao', 'prestador_id', pid)
    await apagarLinhas('prestador_procedimentos', 'prestador_id', pid)
    await apagarLinhas('prestador_cidades', 'prestador_id', pid)
    await apagarLinhas('prestador_especialidades', 'prestador_id', pid)
    await apagarLinhas('prestador_certificados_conclusao', 'prestador_id', pid)
    await apagarLinhas('prestador_responsaveis', 'prestador_id', pid)

    const { error: errPag } = await supabase.from('pagamentos_registros').delete().eq('prestador_id', pid)
    if (errPag && !/relation|does not exist/i.test(errPag.message || '')) {
        throw new Error(`pagamentos_registros: ${errPag.message}`)
    }

    await limparReferencia('formulario_cred_entradas', 'prestador_id', pid)
    await limparReferencia('veterinarios', 'prestador_id', pid)

    await apagarLinhaObrigatoria('prestadores', 'id', pid, 'prestador')
}
