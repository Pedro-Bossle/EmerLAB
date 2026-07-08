import fs from 'node:fs/promises'
import path from 'node:path'
import chromium from '@sparticuz/chromium'
import puppeteerCore from 'puppeteer-core'
import { PDFDocument } from 'pdf-lib'
import { createClient } from '@supabase/supabase-js'
import { config as dotenvConfig } from 'dotenv'
import { aguardarImagensIcones, carregarIconesRcParaHtml } from '../src/lib/rc/rcPdfIcones.js'
import { aplicarCarimboRcDocumento } from '../src/lib/rc/rcPdfCarimbo.js'
import { montarNomeArquivoRc } from '../src/lib/rc/rcPdfNomeArquivo.js'
import { buildMapaOrdemRc, ordenarLinhasRc } from '../src/lib/rc/ordenarCardsRc.js'

dotenvConfig({ path: path.resolve(process.cwd(), '.env.local') })
dotenvConfig()

const TEMPLATE_PDF_PATH = path.resolve(process.cwd(), 'src', 'assets', 'rc', 'template_rc.pdf')

const isServerless = !!(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.LAMBDA_TASK_ROOT
)

const launchBrowser = async () => {
    if (isServerless) {
        // Imports estáticos no topo do arquivo: o empacotamento da Vercel rastreia
        // @sparticuz/chromium e puppeteer-core; import() dinâmico costuma omitir binários.
        return puppeteerCore.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        })
    }
    const { default: puppeteer } = await import('puppeteer')
    return puppeteer.launch({ headless: true })
}

const normalizarTexto = (texto) =>
    String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase()

const escaparHtml = (valor) =>
    String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')

const formatarTelefone = (valor) => {
    const digitos = String(valor || '').replace(/\D/g, '').slice(0, 11)
    if (!digitos) return '-'
    if (digitos.length <= 2) return `(${digitos}`
    if (digitos.length <= 6) return `(${digitos.slice(0, 2)}) ${digitos.slice(2)}`
    if (digitos.length <= 10) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`
    return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`
}

const textoCredenciado = (descricao) => normalizarTexto(descricao).includes('CREDENCIAD')

const chunk = (arr, size) => {
    const out = []
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
    return out
}

const ptParaIn = (pt) => `${Number(pt) / 72}in`

const getSupabase = () => {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const supabaseKey = serviceRoleKey || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY
    if (!supabaseUrl || !supabaseKey) {
        throw new Error(
            'Variáveis do Supabase ausentes. Defina SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_ANON_KEY). Como fallback local, também aceitamos VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY/PUBLISHABLE_KEY.'
        )
    }
    return {
        client: createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } }),
        usandoServiceRole: !!serviceRoleKey,
    }
}

const carregarBase = async () => {
    const { client: supabase, usandoServiceRole } = getSupabase()
    const [
        { data: prestadores, error: ePrestadores },
        { data: cidades, error: eCidades },
        { data: situacoes, error: eSituacoes },
        { data: especialidades, error: eEspecialidades },
        { data: prestadorCidades, error: ePrestadorCidades },
        { data: prestadorEspecialidades, error: ePrestadorEspecialidades },
        { data: prestadorEstabelecimentos, error: ePrestadorEstabelecimentos },
    ] = await Promise.all([
        supabase
            .from('prestadores')
            .select('id,nome,telefone,cidade_id,endereco,modalidade,especialidade_id,situacao_id,ativo')
            .eq('ativo', true),
        supabase.from('cidades_credenciamento').select('id,nome'),
        supabase.from('situacoes').select('id,descricao,ativo').eq('ativo', true),
        supabase.from('especialidades').select('id,nome,tipo,ordem_rc'),
        supabase.from('prestador_cidades').select('prestador_id,cidade_id,principal'),
        supabase.from('prestador_especialidades').select('prestador_id,especialidade_id,principal'),
        supabase.from('prestador_estabelecimentos').select('veterinario_id,estabelecimento_id,principal'),
    ])
    const erros = [ePrestadores, eCidades, eSituacoes, eEspecialidades, ePrestadorCidades, ePrestadorEspecialidades, ePrestadorEstabelecimentos]
        .filter(Boolean)
        .map((e) => e.message)
    if (erros.length) throw new Error(`Erro ao carregar base: ${erros.join(' | ')}`)

    if (!prestadores?.length && !usandoServiceRole) {
        throw new Error(
            'A chave atual não tem permissão para ler os dados de RC (RLS). Use SUPABASE_SERVICE_ROLE_KEY no .env.local para gerar o PDF.'
        )
    }

    return {
        prestadores: prestadores || [],
        cidades: cidades || [],
        situacoes: situacoes || [],
        especialidades: especialidades || [],
        prestadorCidades: prestadorCidades || [],
        prestadorEspecialidades: prestadorEspecialidades || [],
        prestadorEstabelecimentos: prestadorEstabelecimentos || [],
    }
}

const montarCards = (base, cidadesSelecionadas) => {
    const cidadePorId = new Map(base.cidades.map((c) => [Number(c.id), c]))
    const situacaoPorId = new Map(base.situacoes.map((s) => [Number(s.id), s]))
    const especialidadePorId = new Map(base.especialidades.map((e) => [Number(e.id), e]))
    const prestadorPorId = new Map(base.prestadores.map((p) => [Number(p.id), p]))
    const cidadesPorPrestador = new Map()
    const especialidadesPorPrestador = new Map()
    const estabelecimentosPorVeterinario = new Map()

    base.prestadorCidades.forEach((item) => {
        const chave = Number(item.prestador_id)
        if (!cidadesPorPrestador.has(chave)) cidadesPorPrestador.set(chave, [])
        cidadesPorPrestador.get(chave).push(item)
    })
    base.prestadorEspecialidades.forEach((item) => {
        const chave = Number(item.prestador_id)
        if (!especialidadesPorPrestador.has(chave)) especialidadesPorPrestador.set(chave, [])
        especialidadesPorPrestador.get(chave).push(item)
    })
    base.prestadorEstabelecimentos.forEach((item) => {
        const chave = Number(item.veterinario_id)
        if (!estabelecimentosPorVeterinario.has(chave)) estabelecimentosPorVeterinario.set(chave, [])
        estabelecimentosPorVeterinario.get(chave).push(item)
    })

    const linhas = base.prestadores.map((prestador) => {
        const cidadesDoPrestador = cidadesPorPrestador.get(Number(prestador.id)) || []
        const cidadePrincipalRel = cidadesDoPrestador.find((item) => item.principal)
        const cidadePrincipalId = Number(prestador.cidade_id || cidadePrincipalRel?.cidade_id || 0)
        const cidadePrincipalNome = cidadePorId.get(cidadePrincipalId)?.nome || '-'
        const cidadesSecundarias = cidadesDoPrestador
            .filter((item) => !item.principal && Number(item.cidade_id) !== cidadePrincipalId)
            .map((item) => cidadePorId.get(Number(item.cidade_id))?.nome)
            .filter(Boolean)
        const especialidadesDoPrestador = especialidadesPorPrestador.get(Number(prestador.id)) || []
        const especialidadePrincipalRel = especialidadesDoPrestador.find((item) => item.principal)
        const especialidadePrincipalId = Number(prestador.especialidade_id || especialidadePrincipalRel?.especialidade_id || 0)
        const especialidadePrincipalObj = especialidadePorId.get(especialidadePrincipalId)
        const especialidadePrincipalNome = especialidadePrincipalObj?.nome || '-'
        const tipoEspecialidade = normalizarTexto(especialidadePrincipalObj?.tipo || '')
        const nomesEspecialidadesPrestador = especialidadesDoPrestador
            .map((rel) => especialidadePorId.get(Number(rel.especialidade_id))?.nome)
            .filter(Boolean)
        const temEspecialidadeDomiciliar = nomesEspecialidadesPrestador.some((nome) =>
            normalizarTexto(nome).includes('DOMICILIAR')
        )
        const situacaoDescricao = situacaoPorId.get(Number(prestador.situacao_id))?.descricao || '-'
        const estabelecimentosVinculados = (estabelecimentosPorVeterinario.get(Number(prestador.id)) || [])
            .map((rel) => prestadorPorId.get(Number(rel.estabelecimento_id)))
            .filter(Boolean)
        const nomesClinicasVinculadas = [
            ...new Set(estabelecimentosVinculados.map((item) => String(item.nome || '').trim()).filter(Boolean)),
        ]
        const telefonesVinculados = [...new Set(estabelecimentosVinculados.map((item) => String(item.telefone || '').trim()).filter(Boolean))]
        const modalidadesVinculadas = [...new Set(estabelecimentosVinculados.map((item) => String(item.nome || '').trim()).filter(Boolean))]
        const telefoneEfetivo = estabelecimentosVinculados.length ? telefonesVinculados.join(' | ') || prestador.telefone || '' : prestador.telefone || ''
        const modalidadeEfetiva = estabelecimentosVinculados.length ? modalidadesVinculadas.join(' | ') || prestador.modalidade || '' : prestador.modalidade || ''
        const modalidadeOriginal = String(prestador.modalidade || '')
        const temModalidadeVolante = normalizarTexto(modalidadeOriginal).includes('VOLANTE')
        return {
            id: Number(prestador.id),
            nome: prestador.nome || '-',
            cidadePrincipalNome,
            cidadesSecundarias,
            especialidadePrincipalNome,
            especialidadePrincipalId,
            tipoEspecialidade,
            situacaoDescricao,
            telefoneEfetivo,
            modalidadeEfetiva,
            endereco: prestador.endereco || '',
            telefone: prestador.telefone || '',
            temEspecialidadeDomiciliar,
            possuiVinculoClinica: estabelecimentosVinculados.length > 0,
            nomesClinicasVinculadas,
            temModalidadeVolante,
        }
    })

    const alvoNorm = cidadesSelecionadas.map((c) => normalizarTexto(c))
    const mapaOrdem = buildMapaOrdemRc(base.especialidades)
    const filtrados = linhas
        .filter((item) => textoCredenciado(item.situacaoDescricao))
        .filter((item) => {
            const cidadesItem = [item.cidadePrincipalNome, ...item.cidadesSecundarias].map(normalizarTexto)
            return alvoNorm.some((cidade) => cidadesItem.includes(cidade))
        })
    return ordenarLinhasRc(filtrados, mapaOrdem)
}

const gerarHtmlCards = (cardsPorPagina, pageWidthPt, pageHeightPt, icones) => {
    const pageWidthIn = Number(pageWidthPt) / 72
    const pageHeightIn = Number(pageHeightPt) / 72
    const { estetoscopio, telefone: telefoneIcon } = icones
    const pages = cardsPorPagina
        .map((cards) => {
            const blocos = cards
                .map((item) => {
                    const especialidade = escaparHtml(item.especialidadePrincipalNome || '-')
                    const nome = escaparHtml(item.nome || '-')
                    let atendimentoLabel
                    if (item.temEspecialidadeDomiciliar) {
                        atendimentoLabel = 'Atendimento Domiciliar'
                    } else if (item.possuiVinculoClinica && item.nomesClinicasVinculadas?.length) {
                        const lista = item.nomesClinicasVinculadas
                        const conector = lista.length === 1 ? `na ${lista[0]}` : `em: ${lista.join(', ')}`
                        atendimentoLabel = `Atendimentos ${conector}`
                    } else if (item.temModalidadeVolante) {
                        atendimentoLabel = 'Atendimento em clínicas parceiras'
                    } else {
                        const baseAtendimento = String(item.modalidadeEfetiva || item.endereco || '-').trim()
                        atendimentoLabel = baseAtendimento.replace(/^atendimento[\s:-]*/i, '').trim() || '-'
                    }
                    const atendimento = escaparHtml(atendimentoLabel)
                    const telefone = escaparHtml(formatarTelefone(item.telefoneEfetivo || item.telefone || '-'))
                    return `
                        <article class="card">
                            <header class="card-topo">${especialidade}</header>
                            <div class="card-corpo">
                                <h3>${nome}</h3>
                                <p><img class="icon" src="${estetoscopio}" alt="" width="12" height="12" /><span>${atendimento}</span></p>
                                <p><img class="icon" src="${telefoneIcon}" alt="" width="12" height="12" /><span>${telefone}</span></p>
                            </div>
                        </article>
                    `
                })
                .join('')
            return `<section class="sheet"><div class="grade">${blocos}</div></section>`
        })
        .join('')

    return `
        <!doctype html>
        <html lang="pt-BR">
          <head>
            <meta charset="utf-8" />
            <style>
              @page { size: ${pageWidthIn}in ${pageHeightIn}in; margin: 0; }
              html, body { margin: 0; padding: 0; }
              body { font-family: Arial, Helvetica, sans-serif; background: transparent; }
              .sheet { width: ${pageWidthIn}in; height: ${pageHeightIn}in; box-sizing: border-box; padding: 98pt 14pt 98pt; page-break-after: always; }
              .sheet:last-child { page-break-after: auto; }
              .grade {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                grid-template-rows: repeat(5, minmax(0, 1fr));
                gap: 12pt;
                height: 100%;
                align-items: stretch;
              }
              .card { border-radius: 16pt; border: .8pt solid #d9e6f0; background: #fff; overflow: hidden; min-height: 0; }
              .card-topo { height: 24pt; display: flex; align-items: center; justify-content: center; background: #1c3455; color: #fff; font-weight: 700; font-size: 13pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 8pt; }
              .card-corpo { padding: 8pt 10pt 7pt; display: grid; gap: 7pt; min-height: 0; }
              .card-corpo h3 { margin: 0; text-align: center; color: #1a2e4a; font-size: 12pt; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
              .card-corpo p { margin: 0; color: #5e7188; font-size: 10pt; display: grid; grid-template-columns: 12pt 1fr; align-items: start; gap: 6pt; }
              .card-corpo p span:last-child {
                overflow-wrap: anywhere;
                word-break: break-word;
                white-space: normal;
                line-height: 1.18;
              }
              .icon { width: 12pt; height: 12pt; display: block; object-fit: contain; margin-top: 1pt; }
            </style>
          </head>
          <body>${pages}</body>
        </html>
    `
}

const gerarPdfBuffer = async (cidadesSelecionadas) => {
    const base = await carregarBase()
    const cards = montarCards(base, cidadesSelecionadas)
    if (!cards.length) throw new Error('Nenhum prestador credenciado encontrado para as cidades selecionadas.')

    const templateBytes = await fs.readFile(TEMPLATE_PDF_PATH)
    const templateDoc = await PDFDocument.load(templateBytes)
    const pageRef = templateDoc.getPage(templateDoc.getPageCount() > 1 ? 1 : 0)
    const { width, height } = pageRef.getSize()

    const browser = await launchBrowser()
    let overlayBytes
    try {
        const icones = await carregarIconesRcParaHtml(browser)
        const page = await browser.newPage()
        await page.setContent(
            gerarHtmlCards(chunk(cards, 10), width, height, icones),
            { waitUntil: 'domcontentloaded' }
        )
        await aguardarImagensIcones(page)
        overlayBytes = await page.pdf({
            printBackground: true,
            width: ptParaIn(width),
            height: ptParaIn(height),
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
        })
    } finally {
        await browser.close()
    }

    const overlayDoc = await PDFDocument.load(overlayBytes)
    const finalDoc = await PDFDocument.create()
    const templateCardsIndex = templateDoc.getPageCount() > 1 ? 1 : 0

    if (templateDoc.getPageCount() >= 1) {
        const [capa] = await finalDoc.copyPages(templateDoc, [0])
        finalDoc.addPage(capa)
    }

    for (let i = 0; i < overlayDoc.getPageCount(); i += 1) {
        const [basePage] = await finalDoc.copyPages(templateDoc, [templateCardsIndex])
        const page = finalDoc.addPage(basePage)
        const overlayPage = await finalDoc.embedPage(overlayDoc.getPage(i))
        const { width: pw, height: ph } = page.getSize()
        page.drawPage(overlayPage, { x: 0, y: 0, width: pw, height: ph })
    }

    await aplicarCarimboRcDocumento(finalDoc, { cidades: cidadesSelecionadas })

    return Buffer.from(await finalDoc.save())
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Método não permitido.' })
        return
    }
    try {
        const cidades = Array.isArray(req.body?.cidades)
            ? req.body.cidades.map((c) => String(c || '').trim()).filter(Boolean)
            : []
        if (!cidades.length) {
            res.status(400).json({ error: 'Selecione ao menos uma cidade.' })
            return
        }
        const pdfBuffer = await gerarPdfBuffer(cidades)
        const nomeArquivo = montarNomeArquivoRc(cidades)
        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`)
        res.status(200).send(pdfBuffer)
    } catch (error) {
        res.status(500).json({ error: error?.message || 'Falha ao gerar RC.' })
    }
}
