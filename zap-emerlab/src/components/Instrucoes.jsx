import { MOD } from '../atalhos.js'

// Aba "Instruções de uso" das Configurações: o que funciona diferente da WATI/WhatsApp e pede atenção
const mod = MOD.join('+')

const SECOES = [
    {
        titulo: 'O que fica só no painel (não vai para a WATI)',
        itens: [
            ['E-mail e notas internas do contato', 'Ficam no banco do painel e não aparecem na WATI. Para dados que precisam estar na WATI (nome, cidade, situação…), use os atributos da WATI no perfil.'],
            ['Respostas rápidas', 'As respostas rápidas da WATI não vêm para o painel (a API não as disponibiliza). Cadastre em Administração → Respostas rápidas, ou use "Importar planilha" para trazer várias de uma vez.'],
            ['Regras das respostas rápidas', 'Respostas com regras (locais, departamentos, clientes, atributos) aparecem no topo, marcadas como "indicada", quando batem com o contato aberto; as que não batem vão para o fim, depois da divisória "Não se aplicam a este contato". As regras usam a UF, a cidade e os atributos do contato na WATI: contato sem esses dados preenchidos não bate com regra de local. A regra services {código, código} não muda a ordem: só diz de quais procedimentos o {services.content} do texto lista quem realiza na cidade do contato (mesma busca do Credenciamento > Quem realiza), um prestador por linha; sem UF e cidade no contato a lista não é preenchida e a mensagem não sai.'],
            ['Rascunhos', 'O texto digitado e não enviado fica guardado por conversa enquanto a página está aberta. Recarregar a página apaga os rascunhos.'],
        ],
    },
    {
        titulo: 'O que vai para a WATI',
        itens: [
            ['Atributos da WATI (no perfil do contato)', 'Editar e salvar atualiza o contato na WATI de verdade: vale para broadcasts, templates e automações de lá.'],
            ['Etiquetas: sugestões e sync com a WATI', 'No perfil, as sugestões vêm do catálogo da WATI (quando a API expõe) e das etiquetas já usadas nas conversas do painel. Digite para filtrar. Adicionar/remover aplica na conversa da WATI se a tag já existir lá com o mesmo nome (a API não cria tags novas); se não existir, fica só no painel e aparece um aviso.'],
            ['Assumir, transferir e status', 'Atribuir atendente, mudar status (aberta/pendente/resolvida) e trocar de departamento com equipe WATI configurada também são enviados à WATI.'],
        ],
    },
    {
        titulo: 'Janela de 24 horas',
        itens: [
            ['Fora da janela, só template', 'Se o cliente não escreve há mais de 24h, o WhatsApp só aceita templates aprovados. O campo de mensagem fica bloqueado e aparece "Enviar template".'],
            ['Instagram e Messenger não têm templates', 'Nesses canais, depois de 24h sem o cliente escrever, só dá para responder quando ele mandar mensagem de novo.'],
            ['Mensagem que não saiu', 'Fica no chat com aviso vermelho e as opções "Tentar de novo", "Descartar" ou "Enviar template", conforme o motivo.'],
        ],
    },
    {
        titulo: 'WATI aberta = online para o robô',
        itens: [
            [
                'Mantenha a WATI aberta enquanto atende',
                'O Emerzap não consegue marcar você como online na WATI pela API. Sem a WATI aberta (aba ou app), o robô auxiliar e o round-robin tratam o operador como offline e a distribuição fica incorreta. Deixe a WATI logada em segundo plano ao usar este painel.',
            ],
        ],
    },
    {
        titulo: 'Lista de conversas e fila',
        itens: [
            ['Prévia e mensagens novas: melhor com o webhook', 'Com o webhook da WATI configurado, a prévia da última mensagem e o número de mensagens novas de cada conversa atualizam na hora. Sem ele, o painel confere na WATI algumas conversas a cada atualização da lista (as ativas nas últimas 48h, uma a cada ~20 s no máximo): os números chegam, mas com atraso, e conversas paradas há mais de 48h não são reconferidas.'],
            ['Como as mensagens novas são contadas', 'É o número de mensagens do cliente depois da última resposta da equipe (pelo painel ou pela WATI). Abrir a conversa zera. Na primeira vez que o painel vê uma conversa, só conta como nova se a última mensagem do cliente tiver menos de 24h.'],
            ['Atualização a cada poucos segundos', 'A lista atualiza a cada 10 s e a conversa aberta a cada 5 s, só com a aba visível. Não é instantâneo como no WhatsApp.'],
            ['Resolvida reabre sozinha', 'Se o cliente escrever numa conversa resolvida, ela volta para "aberta".'],
            ['Trocar de departamento libera o atendente', 'Ao transferir para outro departamento, a conversa volta para a fila desse departamento, sem atendente. Atendentes de outros departamentos deixam de vê-la.'],
        ],
    },
    {
        titulo: 'Envio de arquivos',
        itens: [
            ['Limite de 3 MB', 'Arquivos maiores são recusados antes do envio: comprima ou mande um link.'],
            ['Colar e arrastar', 'Ctrl+V com imagem copiada ou arrastar um arquivo para a conversa abre a prévia de envio.'],
        ],
    },
    {
        titulo: 'Teclado',
        itens: [
            ['Atalhos no padrão do WhatsApp Web', `Usam ${mod} (ex.: ${mod}+N nova conversa, ${mod}+Shift+] próxima conversa). Ctrl+/ mostra a lista completa.`],
            ['Esc', 'Fecha primeiro o que estiver por cima (sugestões, emojis, resposta, perfil, janelas) e, por último, a conversa.'],
            ['Teclado ABNT2', 'O AltGr conta como Ctrl+Alt no Windows. Os atalhos ignoram as combinações que geram caracteres (ex.: AltGr+E = °), mas se algum atalho disparar sem querer ao digitar, avise o administrador.'],
        ],
    },
]

export default function Instrucoes() {
    return (
        <div className="config-secao instrucoes">
            <p className="ajuda">Pontos em que o painel funciona diferente da WATI ou do WhatsApp e pedem atenção.</p>
            {SECOES.map((s) => (
                <section key={s.titulo} className="instrucoes-secao">
                    <h3>{s.titulo}</h3>
                    <dl>
                        {s.itens.map(([t, d]) => (
                            <div key={t} className="instrucoes-item">
                                <dt>{t}</dt>
                                <dd>{d}</dd>
                            </div>
                        ))}
                    </dl>
                </section>
            ))}
        </div>
    )
}
