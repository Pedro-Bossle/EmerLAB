import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'
import { PDFDocument } from 'pdf-lib'
import { createClient } from '@supabase/supabase-js'
import { config as dotenvConfig } from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const workspaceRoot = path.resolve(__dirname, '..', '..')
dotenvConfig({ path: path.resolve(workspaceRoot, '.env.local') })
dotenvConfig()

const TEMPLATE_PDF_PATH = path.resolve(workspaceRoot, 'src', 'assets', 'rc', 'template_rc.pdf')
const TMP_OVERLAY_PATH = path.resolve(workspaceRoot, 'tmp', 'rc_overlay.tmp.pdf')

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

const ordemGrupoEspecialidade = (especialidadeNome) => {
    const nome = normalizarTexto(especialidadeNome)
    if (nome.includes('HOSPITAL')) return 0
    if (nome.includes('24H')) return 1
    if (nome.includes('CLINICA')) return 2
    if (nome.includes('CONSULT')) return 3
    if (nome.includes('LABORAT')) return 4
    if (nome.includes('PETSHOP') || nome.includes('PET SHOP') || nome.includes('FARMAC') || nome.includes('COMERC')|| nome.includes('Banho e Tosa')|| nome.includes('Crematório')|| nome.includes('Hotel')|| nome.includes('Recreação')|| nome.includes('Adestramento')) return 6
    return 5
}

const parseArgs = () => {
    const args = process.argv.slice(2)
    const getFlagValue = (flag) => {
        const idx = args.indexOf(flag)
        if (idx === -1) return ''
        return args[idx + 1] || ''
    }
    const cidadesRaw = getFlagValue('--cities')
    const outputRaw = getFlagValue('--out')
    const cidades = cidadesRaw
        .split(',')
        .map((cidade) => cidade.trim())
        .filter(Boolean)

    if (!cidades.length) {
        throw new Error('Uso: npm run rc:pdf -- --cities "Cidade A, Cidade B" [--out "./RC_saida.pdf"]')
    }

    const outputPath = outputRaw
        ? path.resolve(workspaceRoot, outputRaw)
        : path.resolve(workspaceRoot, `RC_${new Date().toISOString().slice(0, 10)}.pdf`)

    return { cidades, outputPath }
}

const carregarBase = async () => {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const supabaseKey =
        serviceRoleKey ||
        process.env.SUPABASE_ANON_KEY ||
        process.env.VITE_SUPABASE_ANON_KEY ||
        process.env.VITE_SUPABASE_PUBLISHABLE_KEY
    if (!supabaseUrl || !supabaseKey) {
        throw new Error(
            'Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_ANON_KEY) no ambiente. Como fallback local, também aceitamos VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY/PUBLISHABLE_KEY.'
        )
    }
    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

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
        supabase.from('especialidades').select('id,nome,tipo'),
        supabase.from('prestador_cidades').select('prestador_id,cidade_id,principal'),
        supabase.from('prestador_especialidades').select('prestador_id,especialidade_id,principal'),
        supabase.from('prestador_estabelecimentos').select('veterinario_id,estabelecimento_id,principal'),
    ])

    const erros = [ePrestadores, eCidades, eSituacoes, eEspecialidades, ePrestadorCidades, ePrestadorEspecialidades, ePrestadorEstabelecimentos]
        .filter(Boolean)
        .map((e) => e.message)
    if (erros.length) throw new Error(`Erro ao carregar base: ${erros.join(' | ')}`)
    if (!prestadores?.length && !serviceRoleKey) {
        throw new Error('A chave atual não tem permissão para ler dados de RC (RLS). Use SUPABASE_SERVICE_ROLE_KEY no .env.local.')
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

const montarPrestadoresRc = (base, cidadesSelecionadas) => {
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
        const situacaoDescricao = situacaoPorId.get(Number(prestador.situacao_id))?.descricao || '-'
        const estabelecimentosVinculados = (estabelecimentosPorVeterinario.get(Number(prestador.id)) || [])
            .map((rel) => prestadorPorId.get(Number(rel.estabelecimento_id)))
            .filter(Boolean)
        const telefonesVinculados = [...new Set(estabelecimentosVinculados.map((item) => String(item.telefone || '').trim()).filter(Boolean))]
        const modalidadesVinculadas = [...new Set(estabelecimentosVinculados.map((item) => String(item.nome || '').trim()).filter(Boolean))]
        const telefoneEfetivo = estabelecimentosVinculados.length ? telefonesVinculados.join(' | ') || prestador.telefone || '' : prestador.telefone || ''
        const modalidadeEfetiva = estabelecimentosVinculados.length ? modalidadesVinculadas.join(' | ') || prestador.modalidade || '' : prestador.modalidade || ''
        return {
            id: Number(prestador.id),
            nome: prestador.nome || '-',
            cidadePrincipalNome,
            cidadesSecundarias,
            especialidadePrincipalNome,
            tipoEspecialidade,
            situacaoDescricao,
            telefoneEfetivo,
            modalidadeEfetiva,
            endereco: prestador.endereco || '',
            telefone: prestador.telefone || '',
        }
    })

    const alvoNorm = cidadesSelecionadas.map((c) => normalizarTexto(c))
    const selecionados = linhas
        .filter((item) => textoCredenciado(item.situacaoDescricao))
        .filter((item) => {
            const cidadesItem = [item.cidadePrincipalNome, ...item.cidadesSecundarias].map(normalizarTexto)
            return alvoNorm.some((cidade) => cidadesItem.includes(cidade))
        })
        .sort((a, b) => {
            const oa = ordemGrupoEspecialidade(a.especialidadePrincipalNome)
            const ob = ordemGrupoEspecialidade(b.especialidadePrincipalNome)
            if (oa !== ob) return oa - ob
            const e = a.especialidadePrincipalNome.localeCompare(b.especialidadePrincipalNome, 'pt-BR', { sensitivity: 'base' })
            if (e !== 0) return e
            return a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' })
        })

    return selecionados
}

const gerarHtmlCards = (cardsPorPagina, pageWidthPt, pageHeightPt) => {
    const pageWidthIn = Number(pageWidthPt) / 72
    const pageHeightIn = Number(pageHeightPt) / 72
    const pages = cardsPorPagina
        .map((cards) => {
            const blocos = cards
                .map((item) => {
                    const especialidade = escaparHtml(item.especialidadePrincipalNome || '-')
                    const nome = escaparHtml(item.nome || '-')
                    const baseAtendimento = String(item.modalidadeEfetiva || item.endereco || '-').trim()
                    const atendimentoLabel = baseAtendimento.replace(/^atendimento[\s:-]*/i, '').trim() || '-'
                    const atendimento = escaparHtml(atendimentoLabel)
                    const telefone = escaparHtml(formatarTelefone(item.telefoneEfetivo || item.telefone || '-'))
                    return `
                        <article class="card">
                            <header class="card-topo">${especialidade}</header>
                            <div class="card-corpo">
                                <h3>${nome}</h3>
                                <p><span class="icon icon-service"></span><span>${atendimento}</span></p>
                                <p><span class="icon icon-phone"></span><span>${telefone}</span></p>
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
              .sheet {
                width: ${pageWidthIn}in;
                height: ${pageHeightIn}in;
                box-sizing: border-box;
                padding: 98pt 14pt 98pt;
                page-break-after: always;
              }
              .sheet:last-child { page-break-after: auto; }
              .grade {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                grid-template-rows: repeat(5, minmax(0, 1fr));
                gap: 12pt;
                height: 100%;
                align-items: stretch;
              }
              .card {
                border-radius: 16pt;
                border: 0.8pt solid #d9e6f0;
                background: #fff;
                overflow: hidden;
                min-height: 0;
              }
              .card-topo {
                height: 24pt;
                display: flex;
                align-items: center;
                justify-content: center;
                background: #1c3455;
                color: #fff;
                font-weight: 700;
                font-size: 13pt;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                padding: 0 8pt;
              }
              .card-corpo {
                padding: 8pt 10pt 7pt;
                display: grid;
                gap: 7pt;
                min-height: 0;
              }
              .card-corpo h3 {
                margin: 0;
                text-align: center;
                color: #1a2e4a;
                font-size: 12pt;
                font-weight: 700;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
              }
              .card-corpo p {
                margin: 0;
                color: #5e7188;
                font-size: 10pt;
                display: grid;
                grid-template-columns: 14pt 1fr;
                align-items: center;
                gap: 6pt;
              }
              .card-corpo p span:last-child {
                overflow-wrap: anywhere;
                word-break: break-word;
                white-space: normal;
                line-height: 1.18;
              }
              .icon {
                width: 12pt;
                height: 12pt;
                border-radius: 3pt;
                background: #b8e8f4;
                display: inline-block;
                position: relative;
              }
              .icon::before, .icon::after { content: ""; position: absolute; }
              .icon-service::before {
                width: 5pt; height: 5pt; border-radius: 50%; background: #fff; left: 3.5pt; top: 4pt;
              }
              .icon-service::after {
                width: 7pt; height: 7pt; border-radius: 50%; border: 1.3pt solid #fff; left: 2.3pt; top: 2pt; opacity: .7;
              }
              .icon-phone::before {
                width: 6pt; height: 1.4pt; background: #fff; transform: rotate(-38deg); left: 3pt; top: 5.5pt;
              }
              .icon-phone::after {
                width: 2.5pt; height: 2.5pt; border-radius: 50%; background: #fff; left: 2.6pt; top: 3pt; box-shadow: 4.8pt 4.4pt 0 #fff;
              }
            </style>
          </head>
          <body>${pages}</body>
        </html>
    `
}

const chunk = (arr, size) => {
    const resultado = []
    for (let i = 0; i < arr.length; i += size) resultado.push(arr.slice(i, i + size))
    return resultado
}

const ptParaIn = (pt) => `${Number(pt) / 72}in`

const gerarOverlayComPuppeteer = async (cards, pageWidthPt, pageHeightPt) => {
    await fs.mkdir(path.dirname(TMP_OVERLAY_PATH), { recursive: true })
    const browser = await puppeteer.launch({ headless: true })
    try {
        const page = await browser.newPage()
        const html = gerarHtmlCards(chunk(cards, 10), pageWidthPt, pageHeightPt)
        await page.setContent(html, { waitUntil: 'networkidle0' })
        await page.pdf({
            path: TMP_OVERLAY_PATH,
            printBackground: true,
            width: ptParaIn(pageWidthPt),
            height: ptParaIn(pageHeightPt),
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
        })
    } finally {
        await browser.close()
    }
}

const comporPdfFinal = async (outputPath) => {
    const [templateBytes, overlayBytes] = await Promise.all([fs.readFile(TEMPLATE_PDF_PATH), fs.readFile(TMP_OVERLAY_PATH)])
    const templateDoc = await PDFDocument.load(templateBytes)
    const overlayDoc = await PDFDocument.load(overlayBytes)
    const finalDoc = await PDFDocument.create()
    const totalTemplate = templateDoc.getPageCount()
    const paginaCardsTemplateIndex = totalTemplate > 1 ? 1 : 0

    if (totalTemplate >= 1) {
        const [capa] = await finalDoc.copyPages(templateDoc, [0])
        finalDoc.addPage(capa)
    }

    for (let i = 0; i < overlayDoc.getPageCount(); i += 1) {
        const [base] = await finalDoc.copyPages(templateDoc, [paginaCardsTemplateIndex])
        const page = finalDoc.addPage(base)
        const embedded = await finalDoc.embedPage(overlayDoc.getPage(i))
        const { width, height } = page.getSize()
        page.drawPage(embedded, { x: 0, y: 0, width, height })
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, await finalDoc.save())
}

const main = async () => {
    const { cidades, outputPath } = parseArgs()
    const base = await carregarBase()
    const cards = montarPrestadoresRc(base, cidades)
    if (!cards.length) throw new Error('Nenhum prestador credenciado encontrado para as cidades informadas.')

    const templateDoc = await PDFDocument.load(await fs.readFile(TEMPLATE_PDF_PATH))
    const pageRef = templateDoc.getPage(templateDoc.getPageCount() > 1 ? 1 : 0)
    const { width, height } = pageRef.getSize()

    await gerarOverlayComPuppeteer(cards, width, height)
    await comporPdfFinal(outputPath)
    await fs.rm(TMP_OVERLAY_PATH, { force: true })
    console.log(`RC gerada com sucesso em: ${outputPath}`)
}

main().catch((error) => {
    console.error(`Falha ao gerar RC: ${error.message}`)
    process.exitCode = 1
})
