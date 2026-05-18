import { EMERDOG_PARCERIA_CONTRATANTE } from '../emerdogDadosFixos.js'
import { maskCNPJ } from '../mascarasDocumento.js'
import { L, LCampo } from './linhasUtil.js'

/** @param {Record<string,string>} d */
export function getLinhasParceria(d) {
    const E = EMERDOG_PARCERIA_CONTRATANTE

    return [
        L('Contrato de Parceria Comercial – Descontos Exclusivos', { style: 'bold', size: 12, gap: 2, align: 'center' }),
        L('CONTRATO DE PARCERIA COMERCIAL', { style: 'bold', size: 13, gap: 6, align: 'center' }),

        L('Pelo presente instrumento particular, de um lado:', { gap: 2 }),
        L(
            `${E.razaoSocial}, pessoa jurídica de direito privado, inscrita no CNPJ sob nº ${E.cnpj}, estabelecida na ${E.endereco}, registrada e homologada junto ao Conselho Regional de Medicina Veterinária sob nº CRMV ${E.crmv}, doravante denominada EMERDOG;`,
            { align: 'justify', gap: 3 },
        ),
        L('E, de outro lado, a pessoa jurídica abaixo identificada, doravante denominada PARCEIRA:', { gap: 2 }),
        LCampo('Razão Social', d.razaoSocial),
        LCampo('CNPJ', maskCNPJ(d.cnpj)),
        LCampo('Endereço', d.enderecoCompleto),
        LCampo('Responsável legal', d.responsavelLegal),
        LCampo('E-mail responsável legal', d.emailResponsavel),
        LCampo('Contato responsável legal', d.contatoResponsavel, { gap: 4 }),

        L(
            'As partes acima qualificadas, em conjunto denominadas "PARTES", resolvem celebrar o presente CONTRATO DE PARCERIA COMERCIAL, que será regido pelas cláusulas e condições seguintes:',
            { gap: 5 },
        ),

        L('CLÁUSULA 1ª – DO OBJETO', { style: 'bold', size: 12, gap: 3 }),
        L(
            '1.1. O presente contrato tem por objeto a formalização de parceria comercial entre a EMERDOG e a PARCEIRA, visando oferecer benefícios e descontos exclusivos aos clientes da EMERDOG, mediante condições previamente acordadas entre as partes.',
            { gap: 4 },
        ),

        L('CLÁUSULA 2ª – DAS OBRIGAÇÕES', { style: 'bold', size: 12, gap: 3 }),
        L('2.1. A PARCEIRA compromete-se a:', { gap: 2 }),
        L(
            'a) Conceder aos clientes da EMERDOG os descontos e benefícios estipulados neste contrato e em seus anexos, especialmente aqueles constantes no documento denominado “Tabela de Benefícios Exclusivos”, que integrará o presente instrumento para todos os fins de direito;',
            { indent: 5 },
        ),
        L('b) Manter atualizadas as condições comerciais previstas na “Tabela de Benefícios Exclusivos”;', { indent: 5 }),
        L(
            'c) Garantir que os serviços e/ou produtos ofertados aos clientes da EMERDOG possuam qualidade compatível com o padrão de mercado e estejam em conformidade com a legislação vigente;',
            { indent: 5 },
        ),
        L(
            'd) Disponibilizar atendimento adequado aos clientes identificados como beneficiários da parceria, mediante apresentação de documento ou credencial fornecida pela EMERDOG;',
            { indent: 5 },
        ),
        L(
            'e) Preservar a imagem da EMERDOG, abstendo-se de práticas publicitárias, comerciais ou de mercado que possam prejudicar a reputação da parceria.',
            { indent: 5, gap: 4 },
        ),

        L('CLÁUSULA 3ª – DAS OBRIGAÇÕES', { style: 'bold', size: 12, gap: 3 }),
        L('3.1. A EMERDOG compromete-se a:', { gap: 2 }),
        L(
            'a) Divulgar a parceria, de forma ética e transparente, em seus canais oficiais de comunicação, destacando os benefícios oferecidos pela PARCEIRA aos seus clientes;',
            { indent: 5 },
        ),
        L(
            'b) Fornecer à PARCEIRA, sempre que necessário, os meios de identificação dos clientes beneficiários (tais como credenciais digitais, documentos comprobatórios ou plataforma própria de validação);',
            { indent: 5 },
        ),
        L(
            'c) Garantir que a divulgação da parceria respeite a identidade visual, normas de marca e diretrizes comerciais previamente estabelecidas pela PARCEIRA;',
            { indent: 5 },
        ),
        L(
            'd) Comunicar à PARCEIRA qualquer irregularidade ou reclamação formal apresentada por clientes em relação aos serviços e/ou produtos ofertados, a fim de possibilitar a pronta correção;',
            { indent: 5 },
        ),
        L(
            'e) Atuar de forma a preservar a boa imagem da PARCEIRA, zelando pela reputação da parceria perante clientes e terceiros.',
            { indent: 5, gap: 2 },
        ),
        L(
            'Parágrafo Único. A EMERDOG não será, em hipótese alguma, responsável pela execução, qualidade, prazo ou resultado dos serviços e/ou produtos oferecidos pela PARCEIRA aos clientes, limitando-se sua atuação à intermediação e divulgação da parceria.',
            { style: 'italic', gap: 4 },
        ),

        L('CLÁUSULA 4ª – DA VIGÊNCIA', { style: 'bold', size: 12, gap: 3 }),
        L(
            '4.1. O presente contrato terá vigência de 12 (doze) meses, contados a partir da data de sua assinatura digital, renovando-se automaticamente por iguais períodos, salvo manifestação expressa em contrário por qualquer das partes, mediante notificação por escrito com antecedência mínima de 30 (trinta) dias.',
            { gap: 2 },
        ),
        L(
            '4.2. A renovação automática não implicará em alteração das condições aqui estabelecidas, salvo ajuste formal entre as partes, por meio de aditivo contratual ou atualização da “Tabela de Benefícios Exclusivos”.',
            { gap: 4 },
        ),

        L('CLÁUSULA 5ª – DA RESCISÃO', { style: 'bold', size: 12, gap: 3 }),
        L(
            '5.1. O presente contrato poderá ser rescindido por qualquer das partes, imotivadamente, mediante comunicação por escrito à outra parte, com antecedência mínima de 30 (trinta) dias.',
            { gap: 2 },
        ),
        L('5.2. Constituem motivos de rescisão imediata e de pleno direito, independentemente de aviso prévio:', { gap: 2 }),
        L('a) O descumprimento de quaisquer obrigações previstas neste contrato;', { indent: 5 }),
        L('b) A prática de atos que atentem contra a imagem, a honra ou a reputação da outra parte;', { indent: 5 }),
        L('c) A decretação de falência, recuperação judicial ou extrajudicial de qualquer das partes;', { indent: 5 }),
        L('d) O não cumprimento da legislação aplicável aos serviços ou produtos objeto da parceria.', { indent: 5, gap: 2 }),
        L(
            '5.3. A rescisão do presente contrato não prejudicará a validade das obrigações assumidas em relação a clientes que tenham contratado serviços ou adquirido produtos durante sua vigência, devendo estas serem honradas pela PARCEIRA até o seu integral cumprimento.',
            { gap: 4 },
        ),

        L('CLÁUSULA 6ª – DA RESPONSABILIDADE', { style: 'bold', size: 12, gap: 3 }),
        L(
            '6.1. Cada parte responderá exclusiva e individualmente por suas obrigações trabalhistas, previdenciárias, fiscais, tributárias, cíveis e comerciais, não existindo qualquer vínculo de solidariedade entre EMERDOG e PARCEIRA.',
            { gap: 2 },
        ),
        L(
            '6.2. A EMERDOG não será, em hipótese alguma, responsável por vícios, defeitos, atrasos, má execução ou qualquer outra falha nos serviços e/ou produtos oferecidos pela PARCEIRA aos clientes, cabendo a esta última responder integralmente perante os consumidores e órgãos de fiscalização.',
            { gap: 2 },
        ),
        L(
            '6.3. A eventual utilização, pela PARCEIRA, da marca, nome ou imagem da EMERDOG em materiais de divulgação deverá ser previamente autorizada por escrito, sendo vedado qualquer uso que possa induzir o consumidor a erro quanto à natureza da parceria.',
            { gap: 4 },
        ),

        L('CLÁUSULA 7ª – DA CONFIDENCIALIDADE', { style: 'bold', size: 12, gap: 3 }),
        L(
            '7.1. As PARTES obrigam-se a manter sigilo absoluto sobre todas as informações técnicas, comerciais, estratégicas e operacionais obtidas em razão deste contrato, não podendo divulgá-las a terceiros sem prévia e expressa autorização por escrito da outra parte.',
            { gap: 2 },
        ),
        L(
            '7.2. O dever de confidencialidade subsistirá pelo prazo de 24 (vinte e quatro) meses após o término ou rescisão deste contrato, independentemente do motivo.',
            { gap: 2 },
        ),
        L('7.3. Não se enquadram na obrigação de confidencialidade as informações que:', { gap: 2 }),
        L('a) Forem de conhecimento público à época da celebração deste contrato;', { indent: 5 }),
        L('b) Venham a se tornar públicas por ato diverso da quebra de sigilo;', { indent: 5 }),
        L('c) Forem comprovadamente conhecidas pela parte receptora antes da assinatura do presente contrato;', { indent: 5 }),
        L(
            'd) Forem exigidas por autoridade judicial ou administrativa competente, hipótese em que a parte reveladora deverá ser previamente comunicada.',
            { indent: 5, gap: 4 },
        ),

        L('CLÁUSULA 8ª – DA PROTEÇÃO DE DADOS (LGPD)', { style: 'bold', size: 12, gap: 3 }),
        L(
            '8.1. As PARTES comprometem-se a cumprir integralmente a Lei nº 13.709/2018 (Lei Geral de Proteção de Dados Pessoais – LGPD), adotando todas as medidas técnicas e administrativas necessárias para garantir a segurança, confidencialidade e o uso adequado dos dados pessoais eventualmente tratados em razão deste contrato.',
            { gap: 2 },
        ),
        L(
            '8.2. A EMERDOG poderá compartilhar com a PARCEIRA, quando necessário, dados pessoais estritamente indispensáveis à validação da condição de cliente beneficiário, sendo vedada à PARCEIRA a utilização desses dados para finalidade diversa da prevista neste contrato.',
            { gap: 2 },
        ),
        L(
            '8.3. A PARCEIRA declara-se Controladora dos dados pessoais de seus próprios clientes, responsabilizando-se integralmente por sua coleta, armazenamento e tratamento, eximindo a EMERDOG de qualquer responsabilidade nesse aspecto.',
            { gap: 2 },
        ),
        L(
            '8.4. Em caso de incidente de segurança que resulte em acesso não autorizado, perda, destruição, alteração ou divulgação indevida de dados pessoais relacionados à parceria, a parte responsável deverá comunicar imediatamente a outra parte e adotar todas as medidas cabíveis para mitigar os danos.',
            { gap: 4 },
        ),

        L('CLÁUSULA 9ª – DA ASSINATURA', { style: 'bold', size: 12, gap: 3 }),
        L(
            '9.1. O presente contrato será firmado exclusivamente em meio eletrônico, por meio da plataforma de assinaturas digitais Clicksign, cuja validade jurídica é reconhecida pela legislação brasileira, nos termos da Medida Provisória nº 2.200-2/2001, que instituiu a Infraestrutura de Chaves Públicas Brasileira – ICP-Brasil.',
            { gap: 2 },
        ),
        L(
            '9.2. As PARTES reconhecem que a assinatura digital realizada por meio da plataforma Clicksign possui a mesma eficácia probatória que a assinatura física, gerando plenos efeitos legais e obrigacionais.',
            { gap: 4 },
        ),

        L('CLÁUSULA 10ª – DO FORO', { style: 'bold', size: 12, gap: 3 }),
        L(
            '10.1. Para dirimir quaisquer dúvidas ou controvérsias oriundas deste contrato, as PARTES elegem o foro da Comarca de Caxias do Sul/RS, com renúncia expressa a qualquer outro, por mais privilegiado que seja.',
            { style: 'italic', gap: 4 },
        ),

        L(
            'E, por estarem justas e perfeitas, firmam o presente instrumento em meio eletrônico, por intermédio da plataforma digital Clicksign, sendo a versão assinada armazenada eletronicamente e acessível a ambas as PARTES, com plena validade jurídica e força probatória.',
            { gap: 8 },
        ),
    ]
}
