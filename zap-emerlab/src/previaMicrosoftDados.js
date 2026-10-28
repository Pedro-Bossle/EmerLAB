// Dados de exemplo da prévia de Teams e Outlook (PreviaMicrosoft.jsx). Na integração, vêm do Microsoft Graph:
// chats/canais (/me/chats, /teams/{id}/channels/{id}/messages) e e-mails (/me/mailFolders/{pasta}/messages).
// Pessoas reais da equipe; o conteúdo das mensagens é inventado (a faixa da prévia avisa).

// Canais da equipe Emerdog no Teams: Aviso - Geral, Credenciamento, Escritório Interno, Marketing e Prontuários.
// O conteúdo das mensagens é de exemplo; na integração vem de /teams/{id}/channels/{id}/messages.
export const CONVERSAS_TEAMS = [
    {
        id: 't-credenciamento',
        nome: 'Credenciamento',
        tipo: 'canal',
        naoLidas: 3,
        mensagens: [
            { autor: 'Camila Melos', texto: 'Pessoal, a planilha de clínicas novas de Caxias está no canal.', hora: '16:40', dia: 'Ontem', arquivo: { nome: 'Clinicas_Caxias_novembro.xlsx', tamanho: '84 KB', tipo: 'planilha' } },
            { autor: 'Julia Soares', texto: 'Valeu! Vou cruzar com a lista do sistema amanhã cedo.', hora: '16:52', dia: 'Ontem', reacoes: [['👍', 2]] },
            { autor: 'Camila Melos', texto: '@Pedro consegue validar as 5 primeiras antes do almoço?', hora: '09:12', dia: 'Hoje', mencao: true },
            { autor: 'você', texto: 'Consigo sim, já começo agora.', hora: '09:20', dia: 'Hoje', minha: true },
            { autor: 'Julia Soares', texto: 'Duas delas já mandaram os documentos pelo WhatsApp, estão no Emerzap.', hora: '10:05', dia: 'Hoje' },
        ],
    },
    {
        id: 't-camila',
        nome: 'Camila Melos',
        tipo: 'chat',
        presenca: 'disponivel',
        naoLidas: 1,
        mensagens: [
            { autor: 'Camila Melos', texto: 'Oi, Pedro! Revisou o contrato da clínica nova?', hora: '08:47', dia: 'Hoje' },
            { autor: 'você', texto: 'Ainda não, faço depois da reunião das 11h.', hora: '08:55', dia: 'Hoje', minha: true },
            { autor: 'Camila Melos', texto: 'Combinado. Deixei os pontos de atenção marcados no PDF.', hora: '09:02', dia: 'Hoje', arquivo: { nome: 'Contrato_revisao_v3.pdf', tamanho: '412 KB', tipo: 'pdf' } },
        ],
    },
    {
        id: 't-aviso-geral',
        nome: 'Aviso - Geral',
        tipo: 'canal',
        naoLidas: 1,
        mensagens: [
            { autor: 'Arthur Perotoni', texto: 'Novo modelo de resposta para cancelamento já está nas respostas rápidas do Emerzap.', hora: '17:30', dia: 'Ontem', reacoes: [['🎉', 4], ['👍', 3]] },
            { autor: 'Arthur Perotoni', texto: 'Lembrete: sexta não teremos expediente à tarde por causa da manutenção da rede.', hora: '08:30', dia: 'Hoje', reacoes: [['👍', 6]] },
        ],
    },
    {
        id: 't-reuniao',
        nome: 'Alinhamento semanal',
        tipo: 'reuniao',
        naoLidas: 0,
        mensagens: [
            { autor: 'Letícia Faiber', texto: 'Reunião agendada', hora: '08:00', dia: 'Hoje', reuniao: { titulo: 'Alinhamento semanal', quando: 'Hoje, 11:00 – 11:30' } },
            { autor: 'Letícia Faiber', texto: 'Pauta: metas de credenciamento e fila do WhatsApp.', hora: '08:01', dia: 'Hoje' },
        ],
    },
    {
        id: 't-prontuarios',
        nome: 'Prontuários',
        tipo: 'canal',
        naoLidas: 0,
        mensagens: [
            { autor: 'Letícia Faiber', texto: 'Prontuário do atendimento de ontem em Caxias anexado para conferência.', hora: '18:10', dia: 'Ontem', arquivo: { nome: 'Prontuario_atendimento_exemplo.pdf', tamanho: '236 KB', tipo: 'pdf' } },
            { autor: 'Letícia Faiber', texto: 'Conferido. Falta só a assinatura do veterinário responsável.', hora: '09:40', dia: 'Hoje' },
        ],
    },
    {
        id: 't-escritorio',
        nome: 'Escritório Interno',
        tipo: 'canal',
        naoLidas: 0,
        mensagens: [
            { autor: 'Julia Soares', texto: 'O pedido de material de escritório chega na quinta. Quem precisar de algo, avisa aqui até amanhã.', hora: '14:05', dia: 'Ontem' },
            { autor: 'Camila Melos', texto: 'Preciso de toner para a impressora da recepção.', hora: '14:20', dia: 'Ontem', reacoes: [['👍', 1]] },
        ],
    },
    {
        id: 't-marketing',
        nome: 'Marketing',
        tipo: 'canal',
        naoLidas: 0,
        mensagens: [
            { autor: 'Mayara Santos', texto: 'Arte da campanha de vacinação para aprovação. Feedback até sexta, por favor.', hora: '11:15', dia: 'Segunda-feira', arquivo: { nome: 'Campanha_vacinacao_v2.png', tamanho: '1,8 MB' } },
            { autor: 'Arthur Perotoni', texto: 'Ficou ótima! Só aumentaria o telefone do WhatsApp.', hora: '15:02', dia: 'Segunda-feira', reacoes: [['❤️', 3]] },
        ],
    },
    {
        id: 't-julia',
        nome: 'Julia Soares',
        tipo: 'chat',
        presenca: 'ocupado',
        naoLidas: 0,
        mensagens: [
            { autor: 'você', texto: 'Julia, me passa o contato da clínica de Canoas?', hora: '15:10', dia: 'Ontem', minha: true },
            { autor: 'Julia Soares', texto: '(51) 99999-0000, falar com a recepção.', hora: '15:14', dia: 'Ontem' },
        ],
    },
]

export const EMAILS_OUTLOOK = [
    {
        id: 'e-contrato',
        minutos: 240,
        pasta: 'entrada',
        de: { nome: 'Camila Melos', email: 'camila@emerdog.com.br' },
        para: ['Pedro Bossle'],
        assunto: 'Contrato para revisão – clínica nova',
        lido: false,
        importante: true,
        corpo: ['Oi, Pedro.', 'Segue o contrato com os ajustes que conversamos. Marquei no PDF os três pontos que precisam do seu ok.', 'Se puder revisar até as 14h, consigo enviar para assinatura ainda hoje.', 'Obrigada,\nCamila'],
        anexos: [{ nome: 'Contrato_revisao_v3.pdf', tamanho: '412 KB' }],
    },
    {
        id: 'e-reuniao',
        minutos: 300,
        pasta: 'entrada',
        de: { nome: 'Letícia Faiber', email: 'leticia@emerdog.com.br' },
        para: ['Pedro Bossle', 'Equipe Credenciamento'],
        assunto: 'Convite: Alinhamento semanal',
        lido: false,
        convite: { titulo: 'Alinhamento semanal', quando: 'Hoje, 11:00 – 11:30', local: 'Reunião do Microsoft Teams' },
        corpo: ['Pauta: metas de credenciamento e fila do WhatsApp.'],
    },
    {
        id: 'e-relatorio',
        minutos: 1200,
        pasta: 'entrada',
        de: { nome: 'Relatórios Emerdog', email: 'relatorios@exemplo.com' },
        para: ['Pedro Bossle'],
        assunto: 'Resumo semanal de atendimentos',
        lido: false,
        corpo: ['Resumo da semana:', '• 128 conversas atendidas\n• Primeira resposta em 6 min, em média\n• 94% resolvidas no mesmo dia', 'Detalhes na planilha anexa.'],
        anexos: [{ nome: 'Atendimentos_semana.xlsx', tamanho: '56 KB' }],
    },
    {
        id: 'e-clinica',
        minutos: 1560,
        pasta: 'entrada',
        de: { nome: 'Clínica Vida Animal (exemplo)', email: 'contato@vidaanimal.exemplo.com' },
        para: ['Credenciamento'],
        cc: ['Pedro Bossle'],
        assunto: 'Documentos para credenciamento',
        lido: true,
        sinalizado: true,
        corpo: ['Boa tarde!', 'Seguem o alvará e o CNPJ para o credenciamento. Qualquer pendência, estamos à disposição.', 'Atenciosamente,\nRecepção'],
        anexos: [
            { nome: 'Alvara_2026.pdf', tamanho: '1,2 MB' },
            { nome: 'Cartao_CNPJ.pdf', tamanho: '98 KB' },
        ],
    },
    {
        id: 'e-bruno',
        minutos: 3060,
        pasta: 'entrada',
        de: { nome: 'Julia Soares', email: 'julia@emerdog.com.br' },
        para: ['Pedro Bossle'],
        assunto: 'Re: Lista de clínicas de Porto Alegre',
        lido: true,
        conversa: 3,
        corpo: ['Conferi as 12 primeiras, faltam as da zona sul. Termino amanhã cedo.', 'Abraço,\nJulia'],
    },
    {
        id: 'e-enviado',
        minutos: 2940,
        pasta: 'enviados',
        de: { nome: 'Pedro Bossle', email: 'pedro@emerdog.com.br' },
        para: ['Arthur Perotoni'],
        assunto: 'Ajuste no fluxo de templates',
        lido: true,
        corpo: ['Arthur, o envio de templates no Emerzap já está corrigido. Qualquer coisa me avisa.', 'Pedro'],
    },
]

// Agenda (na integração: GET /me/calendarView). `dia` é relativo a hoje (0 = hoje, 1 = amanhã, -1 = ontem),
// para a prévia sempre mostrar a semana atual com eventos.
export const EVENTOS_AGENDA = [
    {
        id: 'ev-alinhamento',
        titulo: 'Alinhamento semanal',
        dia: 0,
        inicio: '11:00',
        fim: '11:30',
        teams: true,
        local: 'Reunião do Microsoft Teams',
        organizador: 'Letícia Faiber',
        participantes: ['Pedro Bossle', 'Camila Melos', 'Julia Soares', 'Mayara Santos'],
        descricao: 'Pauta: metas de credenciamento e fila do WhatsApp.',
        resposta: 'aceito',
    },
    {
        id: 'ev-contrato',
        titulo: 'Revisão do contrato da clínica nova',
        dia: 0,
        inicio: '14:00',
        fim: '14:45',
        teams: true,
        local: 'Reunião do Microsoft Teams',
        organizador: 'Camila Melos',
        participantes: ['Pedro Bossle', 'Camila Melos'],
        descricao: 'Passar os três pontos marcados no PDF antes de enviar para assinatura.',
    },
    {
        id: 'ev-visita',
        titulo: 'Visita à clínica em Caxias',
        dia: 1,
        inicio: '09:30',
        fim: '11:00',
        local: 'Caxias do Sul',
        organizador: 'Pedro Bossle',
        participantes: ['Pedro Bossle', 'Julia Soares'],
        descricao: 'Apresentar o plano e recolher os documentos do credenciamento.',
        resposta: 'aceito',
    },
    {
        id: 'ev-diretoria',
        titulo: 'Resultado do mês',
        dia: 2,
        inicio: '16:00',
        fim: '17:00',
        teams: true,
        local: 'Reunião do Microsoft Teams',
        organizador: 'Arthur Perotoni',
        participantes: ['Pedro Bossle', 'Letícia Faiber', 'Arthur Perotoni'],
        descricao: 'Fechamento do mês e metas do próximo.',
    },
    {
        id: 'ev-marketing',
        titulo: 'Aprovação da campanha de vacinação',
        dia: -1,
        inicio: '15:00',
        fim: '15:30',
        teams: true,
        local: 'Reunião do Microsoft Teams',
        organizador: 'Mayara Santos',
        participantes: ['Pedro Bossle', 'Mayara Santos', 'Arthur Perotoni'],
        descricao: 'Revisar a arte final.',
        resposta: 'aceito',
    },
]

// ---------- e-mails gerados para a paginação (sempre os mesmos: gerador com semente fixa) ----------

function aleatorio(semente) {
    let t = semente
    return () => {
        t = (t + 0x6d2b79f5) | 0
        let r = Math.imul(t ^ (t >>> 15), 1 | t)
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296
    }
}

const REMETENTES = [
    { nome: 'Camila Melos', email: 'camila@emerdog.com.br', temas: ['credenciamento'] },
    { nome: 'Letícia Faiber', email: 'leticia@emerdog.com.br', temas: ['atendimento', 'equipe'] },
    { nome: 'Julia Soares', email: 'julia@emerdog.com.br', temas: ['vendas'] },
    { nome: 'Mayara Santos', email: 'mayara@emerdog.com.br', temas: ['vendas', 'marketing'] },
    { nome: 'Arthur Perotoni', email: 'arthur@emerdog.com.br', temas: ['equipe', 'financeiro'] },
    { nome: 'Clínica Bem-Estar (exemplo)', email: 'contato@bemestar.exemplo.com', temas: ['clinica'] },
    { nome: 'Hospital Pet Sul (exemplo)', email: 'adm@petsul.exemplo.com', temas: ['clinica'] },
    { nome: 'Financeiro (exemplo)', email: 'financeiro@exemplo.com', temas: ['financeiro'] },
    { nome: 'Assinaturas (exemplo)', email: 'assinaturas@exemplo.com', temas: ['assinatura'] },
]

const TEMAS = {
    credenciamento: [
        ['Documentos pendentes – {clinica}', 'Faltam o alvará e o cartão CNPJ da {clinica}. Já pedi pelo WhatsApp, te aviso quando chegarem.'],
        ['Planilha de credenciados atualizada', 'Atualizei a planilha com as clínicas de {cidade}. Dá uma olhada nas marcadas em amarelo.'],
        ['Visita técnica em {cidade}', 'Consegue confirmar a visita na {clinica} para quinta de manhã?'],
    ],
    atendimento: [
        ['Fila do WhatsApp hoje', 'A fila está com {n} conversas sem resposta. Vou remanejar a Julia para ajudar no Suporte.'],
        ['Novo modelo de resposta', 'Criei uma resposta rápida para segunda via de boleto. Revisa o texto antes de liberar?'],
    ],
    equipe: [
        ['Escala do feriado', 'Segue a escala do feriado. Quem não puder, me avisa até sexta.'],
        ['Reunião de resultados', 'Vamos fechar os números do mês na reunião de sexta. Tragam os indicadores do setor.'],
    ],
    vendas: [
        ['Proposta para {clinica}', 'Enviei a proposta para a {clinica}. Eles pediram desconto no plano anual, podemos dar 5%?'],
        ['Lead do anúncio de {cidade}', 'Chegaram {n} contatos do anúncio de {cidade}. Já distribuí entre a equipe.'],
    ],
    marketing: [['Arte para aprovação', 'Segue a arte da campanha. Preciso do ok até amanhã para publicar.']],
    financeiro: [
        ['Fatura de {mes}', 'A fatura de {mes} está disponível. Vencimento no dia 10.'],
        ['Reembolso aprovado', 'O reembolso da visita a {cidade} foi aprovado e cai na próxima folha.'],
    ],
    // escritos pela própria clínica, na primeira pessoa
    clinica: [
        ['Dúvida sobre o credenciamento', 'Boa tarde! Gostaríamos de saber o prazo para concluir o nosso credenciamento.'],
        ['Atualização de horários', 'Informamos que passamos a atender aos sábados, das 8h às 12h.'],
    ],
    assinatura: [['Documento assinado: contrato {clinica}', 'Todas as partes assinaram o contrato da {clinica}. O documento final está anexo.']],
}

const CLINICAS = ['Clínica Vida Animal', 'Pet Center Serra', 'Clínica Amigo Fiel', 'Vet Norte', 'Hospital Pet Sul', 'Clínica Bem-Estar']
const CIDADES = ['Caxias do Sul', 'Porto Alegre', 'Canoas', 'Bento Gonçalves', 'Farroupilha', 'Novo Hamburgo']
const MESES = ['agosto', 'setembro', 'outubro']

/** ~100 e-mails além dos de cima, espalhados nos últimos 60 dias, em todas as pastas */
export function gerarEmailsExemplo() {
    const r = aleatorio(20261028)
    const de = (l) => l[Math.floor(r() * l.length)]
    const lista = []
    for (let i = 0; i < 104; i++) {
        const rem = de(REMETENTES)
        const [assuntoBase, textoBase] = de(TEMAS[de(rem.temas)])
        // um sorteio por e-mail: assunto e texto falam da mesma clínica e cidade; clínica que escreve fala de si
        const valores = {
            clinica: rem.temas.includes('clinica') ? rem.nome.replace(/\s*\(exemplo\)/, '') : de(CLINICAS),
            cidade: de(CIDADES),
            n: String(3 + Math.floor(r() * 20)),
            mes: de(MESES),
        }
        const troca = (t) => t.replace(/\{(clinica|cidade|n|mes)\}/g, (_, k) => valores[k])
        const minutos = 6 * 60 + Math.floor(r() * 60 * 24 * 60)
        const sorteio = r()
        const pasta = i < 84 ? 'entrada' : i < 94 ? 'enviados' : i < 97 ? 'rascunhos' : i < 101 ? 'arquivo' : 'lixeira'
        const meu = pasta === 'enviados' || pasta === 'rascunhos'
        const assunto = troca(assuntoBase)
        lista.push({
            id: `g-${i}`,
            pasta,
            minutos,
            de: meu ? { nome: 'Pedro Bossle', email: 'pedro@emerdog.com.br' } : { nome: rem.nome, email: rem.email },
            para: meu ? [rem.nome] : ['Pedro Bossle'],
            assunto: meu && pasta === 'enviados' ? `Re: ${assunto}` : assunto,
            // os recentes ficam mais vezes sem ler, como numa caixa de verdade
            lido: meu || minutos > 60 * 24 * 3 || sorteio > 0.45,
            sinalizado: !meu && sorteio > 0.9,
            importante: !meu && sorteio < 0.06,
            corpo: [meu ? 'Oi, tudo bem?' : 'Olá, Pedro.', troca(textoBase), meu ? 'Abraço,\nPedro' : `Obrigado,\n${rem.nome.split(' ')[0]}`],
            anexos: sorteio > 0.72 ? [{ nome: de(['Documento.pdf', 'Planilha.xlsx', 'Proposta.pdf', 'Comprovante.pdf']), tamanho: `${80 + Math.floor(r() * 900)} KB` }] : undefined,
        })
    }
    return lista
}
