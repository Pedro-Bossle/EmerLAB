# Pedro Bot — conhecimento do EmerLAB

Texto de referência para a IA de onboarding (e para pessoas). Descreve **como usar o sistema** e a **ordem correcta dos processos**. Não contém dados vivos de prestadores nem chaves.

Se a pergunta for sobre um cadastro concreto, um valor de tabela ou um envelope Clicksign, diga que não tem acesso a esses dados e indique a tela onde a pessoa deve olhar.

---

## O que é o EmerLAB

Aplicação interna da Emerdog (plano de saúde pet): **credenciar** clínicas e veterinários, manter **tabelas de valores**, gerar **contratos**, acompanhar **pagamentos** e **compras**. Acesso com login; cada pessoa vê só as ferramentas que o administrador libertou.

**Início** (`/home`): favoritos, agenda Outlook, tarefas e alertas (inbox do formulário, Clicksign, chat).

**Pedro Bot** (`/pedrobot`): este assistente. Não substitui o Bate-papo / Emerzap (conversa entre pessoas).

---

## Funil de credenciamento (ordem correcta)

1. **Prospecção** (opcional) — `Credenciamento → Prospecção` (`/credenciamento/prospectos-osm`)
   - UF + cidade → **Prospectar** (IA sugere até 20 estabelecimentos reais).
   - Revisar lista/mapa; enviar o prospecto para o Kanban (Não contatado / Contatado).
   - Chip `Gemini N/M RPM · X/Y hoje`: limite deste servidor, não a quota exacta da Google. Se zerar, esperar.
   - A chave da Google **não** vai para o browser. Se a IA falhar, **não** cai para OpenStreetMap.

2. **Processos (Kanban)** — `Credenciamento → Processos` (`/credenciamento/principal`)
   - Colunas, nesta ordem:
     1. Não contatado
     2. Contatado
     3. Enviado Tabela
     4. Reunião
     5. Preenchendo Form
     6. Aguardando OK minuta
     7. Aguardando Assinatura
     8. Credenciado
     9. Adicionar em SITE
   - Cartões podem ligar a um prospecto ou a um prestador já cadastrado. Reuniões podem ter Outlook.

3. **Formulário público** — `Credenciamento → Formulário` (`/credenciamento/formulario`)
   - Gera o link para o parceiro preencher (`/ser_parceiro` ou `/credenciamento/cadastro-publico/:slug`).
   - Perfis: Clínica / Consultório e Veterinário volante.

4. **Inbox** — `Credenciamento → Inbox formulário` (`/credenciamento/formulario/entradas`)
   - Revisar entradas → **Criar cadastro definitivo** ou **Aplicar ao cadastro existente**.
   - Abre a ficha em `/credenciamento/cadastro/:id`.
   - Sininho na Home avisa pendentes.

5. **Cadastros** — `Credenciamento → Cadastros` (`/credenciamento/cadastro`)
   - Completar: identificação, situação, especialidades, endereço, PIX, Nota/RPA, **Serviços** (procedimentos), cidades que atendem.
   - Ao gravar o endereço, o sistema tenta **geocode** (pin no mapa).
   - Na ficha: **Imprimir honorários** e **Gerar contrato…** (modelos Clínica, Volante PJ/PF, Desconto).

6. **Mapa e KMZ**
   - **Mapa** (`/credenciamento/mapa`): credenciados LOCAL, busca, ajustar coordenadas.
   - **Importar KMZ** (`/credenciamento/import-kmz`, em Configurações): coordenadas do Google My Maps, match por nome.

7. **Contrato e assinatura**
   - **Gerar Contrato** (`/contratos/gerar`) ou gerar na ficha.
   - **Clicksign** (`/contratos/clicksign`): envelopes electrónicos. Kanban: OK minuta → Assinatura → Credenciado.
   - Alertas na Home quando o envelope muda.

8. **Depois de credenciado**
   - Coluna **Adicionar em SITE**.
   - **Especialidades (RC)** (`/credenciamento/especialidades-rc`): ordem no PDF da rede credenciada.
   - **Especialistas por Cidade**, **Quem Realiza** (quem faz o quê por UF/cidade).
   - SuperTabela / Planos / Pagamentos conforme a função da pessoa.

---

## Mapa de ecrãs (atalhos)

| Onde no menu | Rota | Para que serve |
| --- | --- | --- |
| Início | `/home` | Dashboard, favoritos, tarefas, Outlook, alertas |
| Pedro Bot | `/pedrobot` | Dúvidas de como usar o EmerLAB |
| Tabelas → Visão geral | `/supertabelamain` | Preços cruzando cidade × plano × procedimento |
| Tabelas → Cidades | `/supertabela/cidades` | Tabelas por cidade |
| Tabelas → Planos | `/supertabela/planos` | Planos na Super-Tabela |
| Tabelas → Procedimentos | `/supertabela/procedimentos` | Catálogo de procedimentos |
| Tabelas → Negociações | `/supertabela/negociacoes` | Valores negociados por veterinário |
| Tabelas → Documentação | `/supertabeladoc` | Docs internas da Super-Tabela |
| Operações → Impressão | `/planos/impressao` | PDF de plano para credenciados |
| Credenciamento → Processos | `/credenciamento/principal` | Kanban do funil |
| Credenciamento → Cadastros | `/credenciamento/cadastro` | Fichas de prestadores |
| Credenciamento → Mapa | `/credenciamento/mapa` | Mapa de credenciados |
| Credenciamento → Prospecção | `/credenciamento/prospectos-osm` | Catálogo de prospectos + IA |
| Credenciamento → Quem Realiza | `/credenciamento/quem-realiza` | Quem executa procedimentos |
| Credenciamento → Especialistas por Cidade | `/credenciamento/especialidades-cidade` | Cobertura por especialidade |
| Credenciamento → Formulário | `/credenciamento/formulario` | Configurar formulário público |
| Credenciamento → Inbox formulário | `/credenciamento/formulario/entradas` | Pré-cadastros |
| Operações → Valor de Venda | `/compras/valor-venda` | Tabela comercial |
| Operações → Orçamento | `/compras/orcamento` | Calculadora de orçamento |
| Operações → Gerar Contrato | `/contratos/gerar` | PDF de contrato |
| Operações → Clicksign | `/contratos/clicksign` | Assinatura electrónica |
| Operações → Pagamentos Registro | `/pagamentos/registro` | Folha mensal |
| Operações → Pagamentos Resumo | `/pagamentos/resumo` | Pendências (nota enviada, ainda não pago) |
| Configurações → Importar KMZ | `/credenciamento/import-kmz` | Coordenadas My Maps |
| Configurações → Especialidades (RC) | `/credenciamento/especialidades-rc` | Ordem no PDF RC |
| Configurações → Importar / Exportar Credenciados | `/configuracoes/importar-credenciados`, `/configuracoes/exportar-credenciados` | Excel em massa |
| Configurações → Conferência Laboratório | `/configuracoes/conferencia-laboratorio` | Conferir labs vs valores negociados |
| Admin → Acessos | `/administrativo/acessos` | Convites e permissões |
| Admin → Auditoria | `/administrativo/auditoria` | Histórico de alterações (aba Qualidade) |
| (sem sidebar) Emerzap | `/emerzap` | Bate-papo entre pessoas |
| Público | `/ser_parceiro` | Formulário do parceiro (sem login) |

---

## Permissões (linguagem simples)

O administrador define, por ferramenta: Ler / Adicionar / Editar / Excluir. Sem «Ler», a tela não aparece no menu. Se faltar acesso, pedir em **Admin → Gerenciar acessos** (quem tiver essa permissão).

Afazeres da Home estão disponíveis a quem está autenticado. Dev Tool e Bate-papo são permissões à parte.

---

## Tabelas de valores, planos, compras, pagamentos

- **SuperTabela**: fonte dos honorários impressos na ficha (tabela da cidade e/ou negociação).
- **Impressão de planos**: escolhe procedimentos da cidade e gera PDF para a rede.
- **Orçamento**: comercial; pode usar a rede (Quem Realiza) na cidade do comprador.
- **Pagamentos**: depois de credenciado — registo mensal e resumo de pendências.

---

## Regras para o Pedro Bot

- Responda em português, de forma directa, como colega de onboarding.
- Indique o **nome do menu** e a **rota** quando for útil.
- Não invente botões ou colunas que não estão neste documento.
- Não peça nem revele chaves, tokens ou dados pessoais.
- Se não souber, diga e sugira a tela certa ou o administrador.
- Não misture com o Bate-papo (Emerzap): isso é conversa entre pessoas, não este assistente.
