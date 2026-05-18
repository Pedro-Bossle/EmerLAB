import { EMERDOG_CONTRATANTE, EMERDOG_RAZAO_VOLANTES } from '../emerdogDadosFixos.js'
import { maskCNPJ, maskCPF } from '../mascarasDocumento.js'
import { L, LCampo } from './linhasUtil.js'

/** @param {Record<string,string>} d */
export function getLinhasVolantes(d) {
    const E = EMERDOG_CONTRATANTE
    const R = EMERDOG_RAZAO_VOLANTES
    const pj = d.docTipo === 'cnpj'

    return [
        L(
            `Pelo presente instrumento e na melhor forma de direito, de um lado, a empresa ${R}, pessoa jurídica de direito privado, regularmente inscrita no CNPJ sob o nº ${E.cnpj}, com sede na ${E.endereco}, inscrita e homologada junto ao Conselho Regional de Medicina Veterinária portadora do CRMV ${E.crmv}, mantenedora do plano de Assistência e terceirização de Serviços Médicos Veterinários, a seguir denominada simplesmente Contratante, de outro lado, nomeada Contratada:`,
            { align: 'justify', gap: 4 },
        ),
        LCampo('Razão Social ou Nome', pj ? d.razaoSocial : d.nomeCompleto),
        LCampo('CNPJ ou CPF', pj ? maskCNPJ(d.cnpj) : maskCPF(d.cpf)),
        LCampo('CRMV', d.crmv),
        LCampo('E-mail', d.email),
        LCampo('Modelo de Atendimento', d.modeloAtendimento),
        LCampo('Especialidade', d.especialidade),
        LCampo('Contato para agendamento de consultas/exames', d.contatoAgendamento),
        LCampo('Endereço', d.enderecoCompleto, { gap: 5 }),

        L('Capítulo I – DO OBJETO', { style: 'bold', size: 12, gap: 3 }),
        L(null, {
            gap: 4,
            segments: [
                { t: '1.1 - A ', bold: false },
                { t: 'Contratada', bold: true },
                {
                    t: ' se compromete a prestar serviços aos animais encaminhados por Intermediação da Contratante, serviço este enquadrado como Procedimentos Médicos Veterinários, na forma e nas condições estipuladas neste contrato.',
                    bold: false,
                },
            ],
        }),

        L('Capítulo II – DOS SERVIÇOS', { style: 'bold', size: 12, gap: 3 }),
        L(
            '2.1 - Considerando as qualificações expostas no presente instrumento, os serviços ora pactuados entre ambas as partes, intituladas Contratada e Contratante, se caracterizarão pelo detalhamento abaixo descrito:',
            { gap: 2 },
        ),
        L(
            'a) Realização de atendimentos ou procedimentos médico-veterinários, sempre que houver necessidade concreta identificada com base em critérios técnicos e profissionais.',
            { indent: 5 },
        ),
        L(
            'b) Antes de proceder a qualquer atendimento aos clientes da Contratante, a Contratada deverá assegurar-se de que o procedimento em questão está habilitado e disponível para uso no sistema fornecido pela Contratante, conforme estabelecido no processo de credenciamento.',
            { indent: 5 },
        ),
        L(
            'c) O devido preenchimento em sistema, cedido pela parte Contratante, registrando no mesmo, os procedimentos que venham a ser efetuados assim como possíveis complicações ou solicitações que sejam subsequentes, permitindo assim, o pleno conhecimento por parte da Contratante e o direito de deferimento de prontuários gerados;',
            { indent: 5 },
        ),
        L(
            'd) Em caso de complicações nos procedimentos executados, deverá ser comprovado através de imagens e relatos clínicos, além da necessidade de anexo ao sistema dos devidos documentos;',
            { indent: 5 },
        ),
        L(
            'e) A Contratante dispõe para a Contratada o seu próprio sistema (sistema.emerdog.com.br), gerando um usuário para que se obtenha acesso dentro da plataforma, esta que terá os dados da Contratada protegidos e assegurados pela lei 13.709/2018 de LGPD (Lei Geral de Proteção de Dados).',
            { indent: 5 },
        ),
        L(
            'f) Em caso de cancelamento com menos de uma hora de antecedência, ou na eventualidade de não comparecimento do cliente, será cobrada uma taxa correspondente a 50% do valor total dos serviços agendados. Este valor é calculado somando-se os custos individuais de cada serviço incluído no agendamento (por exemplo, a soma de uma consulta e mensuração). Tal medida visa compensar os custos operacionais e de planejamento inerentes ao agendamento e à reserva de tempo, que não podem ser eficientemente realocados em um prazo tão curto. A política de cancelamento será claramente comunicada ao cliente no momento do agendamento, exigindo sua concordância com estes termos.',
            { indent: 5, gap: 4 },
        ),

        L('Capítulo III – DOS ANIMAIS', { style: 'bold', size: 12, gap: 3 }),
        L(
            '3.1- São considerados beneficiários para efeito do serviço ora contratado, todos aqueles que estão regularmente inscritos por seus “titulares” (tutores), nos planos regulamentados pela Contratante.',
            { gap: 4 },
        ),

        L('Capítulo IV – DA IDENTIFICAÇÃO', { style: 'bold', size: 12, gap: 3 }),
        L(
            '4.1 - Para a efetivação da prestação dos serviços e procedimentos acordados, é imprescindível a realização de algumas etapas de verificação, descritas a seguir:',
            { gap: 2 },
        ),
        L(
            'a) Confirmação da identidade do tutor por meio da verificação do CPF fornecido, assegurando que o mesmo é de fato cliente da Contratante.',
            { indent: 5 },
        ),
        L(
            'b) Avaliação da disponibilidade do procedimento, incluindo a verificação de carências, limites previamente alcançados ou eventuais inadimplências junto ao departamento financeiro da Contratante.',
            { indent: 5 },
        ),
        L(
            'c) Análise da fotografia do animal para certificar-se de que o pet em questão é de fato o animal registrado e evitar possíveis fraudes por parte do representante do animal.',
            { indent: 5, gap: 4 },
        ),

        L('Capítulo V – DA REMUNERAÇÃO E REAJUSTE', { style: 'bold', size: 12, gap: 3 }),
        L(
            '5.1- Pelos serviços avençados neste instrumento, a Contratante pagará à Contratada, os valores de acordo com o documento “EMERDOG – Honorários Clínicos” podendo ser reajustada somente mediante negociação e firmação entre as partes, ou na hipótese de ser constatado desequilíbrio econômico-financeiro deste instrumento. A Contratante pagará a Contratada até o décimo quinto (15) dia útil de cada mês através de Depósito/Transferência Bancária/PIX em conta corrente nomeada pela Contratada.',
            { gap: 2 },
        ),
        L('5.2- Termos de pagamento em relação à Nota Fiscal Eletrônica (NFS-e) e Recibos de Pagamento de Autônomos (RPA):', { gap: 2 }),
        L(
            'a) Na hipótese de a Contratada possuir registro de pessoa jurídica, emitindo notas fiscais, a quitação ocorrerá posteriormente à recepção da Nota Fiscal Eletrônica (NF-e).',
            { indent: 5 },
        ),
        L(
            'b) Em situações em que a Contratada exerce suas atividades de forma autônoma, identificada pelo seu número de CPF, o repasse mensal será efetuado mediante a celebração de Recibo de Pagamento Autônomo (RPA), sendo a quantia reduzida em 11%, correspondente aos encargos fiscais determinados pelas autoridades fiscalizadoras.',
            { indent: 5, gap: 2 },
        ),
        L(
            '5.3- A Contratada tem ciência que na falta de algum requisito no preenchimento do sistema sobre o atendimento, este não será reconhecido e subsequentemente indeferido e sem remuneração se o mesmo não for justificado.',
            { gap: 2 },
        ),
        L(
            '5.4- Caso a Contratada efetue o atendimento ao beneficiário que se encontra em atraso de mensalidade ou com carências pendentes de cumprimento, os procedimentos não serão reconhecidos pela Contratante, conclusos de que não será efetuada a remuneração.',
            { gap: 2 },
        ),
        L('5.5- Sobre as Diferenças/Coparticipação', { style: 'bold', size: 11, gap: 2 }),
        L(
            '5.5.1- Participação conjunta com outrem, caracterizando o valor que o beneficiário pagará de diferença em procedimentos específicos dentro do âmbito da medicina veterinária, sendo estes expostos pelo sistema no momento da conclusão do prontuário, devendo ser cobrado ao finalizar o atendimento diretamente do tutor.',
            { indent: 4 },
        ),
        L(
            '5.5.2- Os valores de diferença/coparticipação serão expostos em sistema ao finalizar o prontuário nas instalações (sistema) fornecido pela Contratante.',
            { indent: 4 },
        ),
        L(
            '5.5.3- Conforme o número de procedimentos efetuados, torna-se acumulativo e sem direito a desconto (para o tutor) sob o valor totalitário.',
            { indent: 4 },
        ),
        L(
            '5.5.4- A assinatura deste documento, deixa claro que a Contratada está ciente dos valores mencionados em formato tabelado, acordado no documento “EMERDOG – Honorários Clínicos”, além de estar a par do sistema de diferenças/coparticipação estipulado pela Contratante.',
            { indent: 4, gap: 4 },
        ),

        L('Capítulo VI – Do uso e Direito de Imagem', { style: 'bold', size: 12, gap: 3 }),
        L('6.1- Ao assinar este instrumento, a Contratada designa total direito de uso de imagem nas seguintes situações:', { gap: 2 }),
        L('a) Inserir as informações da Contratada na “Rede Credenciada” da Contratante;', { indent: 5 }),
        L('b) Uso de Nome e Logo da Contratada para divulgação nas plataformas digitais da Contratante.', { indent: 5, gap: 2 }),
        L('6.2- Ao assinar este instrumento, a Contratante designa total direito de uso de imagem nas seguintes situações:', { gap: 2 }),
        L('a) Efetuar a divulgação de que a própria Contratada está presente na “Rede Credenciada” da Contratante;', { indent: 5 }),
        L('b) Uso de Nome e Logo da Contratante para divulgação nas plataformas digitais da Contratada.', { indent: 5, gap: 4 }),

        L('Capítulo VII – DO PRAZO E DA RESCISÃO', { style: 'bold', size: 12, gap: 3 }),
        L(
            '7.1- O presente instrumento possui a validade inicial de 6 (seis) meses, dado início na data de sua assinatura, com a possibilidade de rescisão sujeita a cobrança de multa sob cancelamento de contrato caso não esteja respeitado a seguinte exigência:',
            { gap: 2 },
        ),
        L(
            '7.1.1- Caso a vontade de rescisão de contrato surgir, a Contratada possui o compromisso de comunicar à Contratante com um prazo de 30 (trinta) dias de antecedência.',
            { indent: 4, gap: 2 },
        ),
        L(
            '7.2- Próximo do término do Contrato entre as partes, caso não seja demonstrada a vontade de encerramento, o mesmo será renovado automaticamente.',
            { gap: 4 },
        ),

        L('Capítulo VIII – DAS DISPOSIÇÕES GERAIS', { style: 'bold', size: 12, gap: 3 }),
        L(
            '8.1- Toda a responsabilidade Técnica, Civil e Criminal decorrente dos atendimentos prestados aos animais beneficiários da Contratante caberá exclusivamente a Contratada e a seus profissionais que atuarem nesses atendimentos. Caso a Contratante venha a ser acionada judicialmente em decorrência de qualquer desses atendimentos, fica-lhe assegurado o direito de regresso, nos termos da lei, em face da Contratada, por quaisquer indenizações ou pagamentos que lhe venham a ser impostos, inclusive por custas despesas processuais e honorários advocatícios, sem ônus à Contratante, podendo a mesma propor a ação judicial cabível, pelos danos causados ao seu nome e imagem.',
            { gap: 2 },
        ),
        L(
            '8.2- Será também de exclusiva responsabilidade da Contratada o pagamento de todos os encargos tributários decorrentes dos serviços ora contratados, bem como pelas obrigações trabalhistas, previdenciárias, fiscais e quaisquer outras existentes ou que venham a ser criadas, relativamente a seus empregados e sua organização.',
            { gap: 2 },
        ),
        L('8.3- Os casos omissos serão resolvidos, de comum acordo, entre ambas as partes.', { gap: 2 }),
        L(
            '8.4- Para cumprimento do ora avençado, a Contratada compromete-se estar compatível com as normas éticas e técnicas emanadas pelo Conselho Federal de Medicina Veterinária.',
            { gap: 2 },
        ),
        L(
            '8.5- A Contratada atenderá os animais beneficiários indicados pela Contratante dentro do seu horário de atendimento e conforme a sua própria logística.',
            { gap: 2 },
        ),
        L(
            '8.6- Fica expressamente vedado às partes transferir a terceiros, total ou parcialmente, o termo do presente instrumento.',
            { gap: 2 },
        ),
        L(
            '8.7 - Por estarem juntos e contratados as partes elegem de comum acordo o Foro Central de Caxias do Sul – RS, para que sejam dirimidas quaisquer dúvidas ou questões oriundas no presente contrato, com renúncia expressa de qualquer outro fato, por mais privilégio que seja.',
            { style: 'italic', gap: 8 },
        ),
    ]
}
