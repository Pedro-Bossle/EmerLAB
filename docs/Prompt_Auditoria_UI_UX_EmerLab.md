# Auditoria completa de UI/UX, responsividade e Design System --- EmerLab

## Papel e missão

Atue como um **Senior UI/UX Designer e Senior Front-end Engineer**,
especializado em produtos SaaS, dashboards administrativos e aplicações
web responsivas.

Sua missão é realizar uma auditoria completa de todas as telas, páginas,
componentes e modais do **EmerLab**, identificando e corrigindo
problemas de layout, responsividade, acessibilidade, consistência visual
e usabilidade.

**Não entregue apenas um diagnóstico ou uma lista de sugestões.**
Analise, implemente, teste e valide as melhorias diretamente no projeto.

O resultado esperado é um sistema com aparência profissional, moderno,
limpo e minimalista, com uma experiência realmente adaptada a desktop,
telas médias e dispositivos móveis.

------------------------------------------------------------------------

# 1. Objetivos principais

1.  Revisar individualmente todas as rotas, páginas, módulos,
    componentes e modais.
2.  Garantir uma experiência adequada em três categorias de
    dispositivos:
    -   **Desktop:** monitores grandes e convencionais.
    -   **Telas médias:** notebooks, tablets e larguras intermediárias.
    -   **Mobile:** smartphones, inclusive telas pequenas.
3.  Corrigir problemas de layout, hierarquia visual, navegação,
    formulários, tabelas e interações.
4.  Criar ou aprimorar um **Design System** com componentes
    reutilizáveis e padrões centralizados.
5.  Reduzir duplicações e inconsistências entre telas.
6.  Preservar todas as funcionalidades, regras de negócio e integrações
    existentes.
7.  Validar visualmente e funcionalmente as alterações.

Cada interface deve ser adaptada ao contexto do dispositivo, e não
simplesmente reduzida proporcionalmente.

------------------------------------------------------------------------

# 2. Diretrizes visuais

Preserve a identidade visual atual do EmerLab e aprimore sua execução.

Priorize:

-   Design limpo, moderno e minimalista.
-   Hierarquia visual clara.
-   Espaçamentos consistentes.
-   Tipografia legível e bem dimensionada.
-   Componentes visualmente equilibrados.
-   Bordas, sombras e arredondamentos discretos.
-   Uso inteligente e consistente de cores.
-   Ícones coerentes entre si.
-   Botões com dimensões e hierarquia adequadas.
-   Redução de elementos visuais desnecessários.
-   Boa densidade de informação, sem poluição visual.
-   Estados de interação claros e previsíveis.

Evite:

-   Elementos excessivamente grandes.
-   Cards desnecessários.
-   Espaçamentos exagerados.
-   Informações repetidas.
-   Botões que ocupem espaço sem necessidade.
-   Textos cortados ou sobrepostos.
-   Interfaces excessivamente carregadas.
-   Scroll horizontal acidental.
-   Layouts que pareçam apenas versões reduzidas do desktop.

**Não redesenhe o sistema inteiro sem necessidade.** Evolua o visual
existente, mantendo a identidade e a consistência do produto. Não copie
interfaces de referência; use-as apenas como inspiração de qualidade e
maturidade visual.

------------------------------------------------------------------------

# 3. Auditoria responsiva

Analise todas as telas nas seguintes resoluções de referência:

  Categoria            Resolução
  ---------------- -------------
  Desktop            1920 × 1080
  Notebook            1366 × 768
  Tablet              768 × 1024
  Mobile               390 × 844
  Mobile pequeno       320 × 640

Não limite os ajustes a essas resoluções. Utilize layouts fluidos e
breakpoints adequados para larguras intermediárias.

## 3.1 Desktop

Verifique:

-   Aproveitamento adequado do espaço horizontal.
-   Alinhamento dos elementos.
-   Largura e centralização dos conteúdos.
-   Organização de menus e barras laterais.
-   Proporção entre cards, tabelas e formulários.
-   Hierarquia das informações.
-   Ausência de espaços vazios excessivos.
-   Boa distribuição dos elementos na tela.
-   Legibilidade e facilidade de localizar ações.

## 3.2 Telas médias

Verifique:

-   Adaptação da sidebar e da navegação.
-   Redimensionamento e reorganização de cards.
-   Reorganização de grids.
-   Ajuste de tabelas.
-   Redução inteligente de espaçamentos.
-   Reorganização de formulários.
-   Ausência de sobreposição.
-   Manutenção de uma navegação intuitiva.

## 3.3 Mobile

Verifique:

-   Navegação adaptada para dispositivos móveis.
-   Sidebar substituída por menu apropriado, quando necessário.
-   Conteúdos organizados preferencialmente em coluna.
-   Cards ocupando a largura disponível.
-   Botões acessíveis e fáceis de tocar.
-   Formulários adaptados para telas pequenas.
-   Campos com largura adequada.
-   Textos sem cortes.
-   Cabeçalhos reorganizados.
-   Ações principais facilmente acessíveis.
-   Ausência de rolagem horizontal indevida.
-   Boa utilização do espaço vertical.

Priorize a experiência de uso com uma mão sempre que possível, sem
comprometer a clareza ou esconder ações importantes.

------------------------------------------------------------------------

# 4. Mapeamento completo do sistema

Antes de implementar alterações:

1.  Examine a estrutura atual do projeto.
2.  Identifique a tecnologia, bibliotecas, padrões e arquitetura
    utilizados.
3.  Mapeie todas as rotas e páginas.
4.  Identifique todos os módulos e funcionalidades.
5.  Localize componentes compartilhados e componentes duplicados.
6.  Identifique todos os modais e diálogos.
7.  Localize tabelas, formulários, filtros, pesquisas e elementos de
    navegação.
8.  Identifique estilos globais, tokens, temas e breakpoints existentes.

Revise individualmente:

-   Todas as páginas e rotas.
-   Todos os módulos.
-   Dashboards.
-   Listagens.
-   Cadastros.
-   Edições.
-   Detalhamentos.
-   Configurações.
-   Relatórios.
-   Filtros e pesquisas.
-   Tabelas.
-   Formulários.
-   Menus e dropdowns.
-   Cabeçalhos e rodapés.
-   Barras laterais.
-   Componentes compartilhados.
-   Estados vazios, de carregamento, erro e sucesso.

Não ignore páginas secundárias ou telas que não aparecem diretamente no
menu principal.

Crie um checklist de auditoria para acompanhar o progresso por tela e
por resolução.

------------------------------------------------------------------------

# 5. Auditoria de modais e diálogos

Todos os modais e diálogos do sistema devem passar por uma revisão
individual.

## 5.1 Desktop

Verifique:

-   Dimensões adequadas ao conteúdo.
-   Centralização.
-   Largura proporcional à finalidade.
-   Organização dos campos.
-   Cabeçalho e rodapé bem definidos.
-   Hierarquia clara entre título, conteúdo e ações.

## 5.2 Telas médias

Verifique:

-   Redimensionamento adequado.
-   Limites de altura.
-   Rolagem interna quando necessária.
-   Botões sem sobreposição.
-   Conteúdo legível e organizado.

## 5.3 Mobile

Verifique:

-   Modal dentro dos limites da viewport.
-   Largura adaptada à tela.
-   Altura máxima respeitando a área visível.
-   Conteúdo com rolagem interna.
-   Cabeçalho e botão de fechar acessíveis.
-   Botões de ação visíveis e utilizáveis.
-   Campos ocupando a largura disponível.
-   Teclado virtual sem comprometer a utilização dos formulários.

Quando fizer sentido, utilize um layout de tela cheia ou bottom sheet no
mobile, em vez de manter um modal desktop reduzido.

Nenhum modal pode apresentar:

-   Conteúdo cortado.
-   Botões inacessíveis.
-   Campos sobrepostos.
-   Rolagem horizontal.
-   Cabeçalho ou rodapé permanentemente fora da área visível.
-   Fechamento impossível ou pouco intuitivo.

------------------------------------------------------------------------

# 6. Tabelas e listagens

Dê atenção especial às tabelas, pois são elementos importantes em
sistemas administrativos.

## Desktop

-   Preserve a visualização tabular quando adequada.
-   Organize as colunas de forma equilibrada.
-   Evite larguras desnecessárias.
-   Mantenha ações e informações importantes acessíveis.
-   Garanta boa leitura de cabeçalhos, linhas e estados.

## Telas médias

-   Avalie a redução ou reorganização de colunas.
-   Ajuste espaçamentos e larguras.
-   Preserve a legibilidade.
-   Evite comprimir excessivamente os dados.

## Mobile

-   Não force tabelas largas dentro de telas pequenas.
-   Avalie a transformação em cards ou listagens verticais.
-   Quando necessário, utilize rolagem horizontal controlada e
    visualmente identificável.
-   Priorize informações essenciais sem eliminar dados importantes.
-   Mantenha ações individuais acessíveis.
-   Disponibilize outra forma de consultar informações que não caibam na
    visualização inicial.

A solução deve respeitar o contexto de cada tabela. Não aplique uma
transformação genérica a todas.

------------------------------------------------------------------------

# 7. Formulários e interações

Revise todos os formulários do sistema.

Verifique:

-   Organização e agrupamento dos campos.
-   Labels e placeholders.
-   Dimensões dos inputs.
-   Selects e dropdowns.
-   Campos de data.
-   Máscaras e formatação.
-   Validações.
-   Mensagens de erro e sucesso.
-   Botões de salvar, cancelar e demais ações.
-   Estados de carregamento e envio.
-   Feedback visual das interações.
-   Campos obrigatórios e opcionais.

No desktop, aproveite o espaço disponível sem deixar os formulários
excessivamente largos.

No mobile, priorize campos em coluna única, exceto quando uma divisão em
duas colunas realmente melhorar a experiência.

Garanta que o teclado virtual não impeça o acesso aos campos e às ações
principais.

------------------------------------------------------------------------

# 8. Design System e componentes reutilizáveis

Uma das prioridades deste trabalho é estabelecer uma padronização visual
e estrutural entre todas as telas do EmerLab.

Analise os componentes existentes e identifique elementos que aparecem
repetidamente com implementações diferentes.

Sempre que possível, transforme esses elementos em **componentes
reutilizáveis, centralizados e configuráveis**, evitando duplicação de
código e inconsistências visuais.

Antes de criar um componente, verifique se já existe uma implementação
equivalente. Aproveite e evolua o que já está funcionando, em vez de
criar uma segunda versão sem necessidade.

## 8.1 Componentes que devem ser padronizados

### Navegação e estrutura

-   Sidebar.
-   Menu mobile.
-   Header.
-   Breadcrumbs.
-   Cabeçalhos de páginas.
-   Navegação por abas.

### Pesquisa e filtros

-   Searchbars.
-   Campos de pesquisa com ícones.
-   Filtros individuais.
-   Filtros combinados.
-   Seletores de período.
-   Dropdowns.
-   Botões para limpar filtros.

### Modais e diálogos

-   Modal padrão.
-   Modal de cadastro.
-   Modal de edição.
-   Modal de visualização.
-   Modal de confirmação.
-   Modal de exclusão.
-   Modal de alerta.
-   Modal de seleção.
-   Diálogos de ações.

### Formulários

-   Inputs de texto.
-   Inputs numéricos.
-   Inputs monetários.
-   Campos de data.
-   Textareas.
-   Selects.
-   Autocomplete.
-   Upload de arquivos.
-   Campos com máscaras.
-   Grupos e seções de campos.

### Elementos de interface

-   Botões primários, secundários, terciários e destrutivos.
-   Cards.
-   Badges de status.
-   Tooltips.
-   Dropdowns de ações.
-   Alertas.
-   Toasts e notificações.
-   Paginação.
-   Tabelas.
-   Estados vazios.
-   Skeletons de carregamento.
-   Indicadores de carregamento.

## 8.2 Padronização de modais

Crie ou aprimore uma estrutura centralizada para os modais do sistema.

Todos devem compartilhar, quando aplicável:

-   Mesmo padrão de cabeçalho.
-   Mesmo posicionamento do título e botão de fechar.
-   Mesmo espaçamento interno.
-   Mesmo padrão de rodapé.
-   Mesma hierarquia de botões.
-   Mesmo comportamento de abertura e fechamento.
-   Mesmo tratamento de responsividade.
-   Mesmo padrão de animação, se houver.

A estrutura deve aceitar configurações específicas, como:

-   Título e descrição.
-   Conteúdo.
-   Largura ou variante de tamanho.
-   Altura máxima.
-   Ações do rodapé.
-   Botão de fechamento.
-   Comportamento responsivo.
-   Rolagem interna.
-   Estados de carregamento ou bloqueio, quando necessários.

Não crie um único modal rígido para todas as situações. Crie uma
estrutura reutilizável que permita diferentes conteúdos e comportamentos
sem perder a padronização.

Preserve particularidades funcionais de cada modal, como confirmações,
validações, formulários e fluxos específicos.

## 8.3 Padronização de searchbars e filtros

Todas as barras de pesquisa devem seguir o mesmo padrão visual e
comportamental.

Padronize:

-   Altura.
-   Bordas e arredondamento.
-   Ícone de pesquisa.
-   Placeholder.
-   Espaçamento interno.
-   Estado de foco.
-   Estado desabilitado.
-   Botão para limpar pesquisa.
-   Comportamento em telas pequenas.

Os filtros também devem compartilhar uma identidade visual consistente.
Sempre que possível, utilize componentes configuráveis para permitir
combinações diferentes sem desenvolver uma implementação nova para cada
tela.

Preserve o comportamento específico de cada pesquisa, incluindo
debounce, submit, filtros associados e integração com os dados
existentes.

## 8.4 Arquitetura de componentes

Organize os componentes em uma estrutura lógica, respeitando a
arquitetura e as convenções já utilizadas no projeto.

Uma possibilidade de organização, caso faça sentido:

``` text
components/
  ui/
    Button
    Input
    Select
    Modal
    Dialog
    Badge
    Tooltip
    Dropdown
    Searchbar
    DatePicker
    Toast
    Skeleton
  layout/
    Header
    Sidebar
    MobileNavigation
    PageHeader
  tables/
    DataTable
    TablePagination
    TableActions
    EmptyState
  forms/
    FormField
    FormActions
    FormSection
```

Essa estrutura é apenas uma referência. Não reorganize o projeto inteiro
sem necessidade. Adapte a solução à arquitetura atual.

## 8.5 Design tokens

Identifique e centralize os padrões visuais do projeto, utilizando
variáveis ou tokens para:

-   Cores.
-   Tipografia.
-   Tamanhos de fonte.
-   Espaçamentos.
-   Bordas.
-   Arredondamentos.
-   Sombras.
-   Alturas de componentes.
-   Breakpoints.
-   Transições.

Evite valores diferentes para elementos que deveriam compartilhar o
mesmo padrão. Utilize os recursos já existentes no projeto, como CSS
variables, tema da biblioteca ou configuração do framework.

## 8.6 Responsividade dos componentes compartilhados

Todos os componentes reutilizáveis devem ser responsivos
individualmente.

Exemplos:

-   Um modal deve funcionar em desktop, tablet e mobile.
-   Uma searchbar deve se adaptar à largura disponível.
-   Um formulário deve reorganizar seus campos.
-   Um dropdown deve permanecer dentro da viewport.
-   Um botão deve preservar dimensões e acessibilidade.
-   Uma tabela deve possuir estratégia adequada para dispositivos
    pequenos.

Não basta adaptar cada página. Os próprios componentes precisam ter
comportamento responsivo.

## 8.7 Migração das telas existentes

Após estabelecer ou aprimorar os componentes padronizados:

1.  Identifique todas as telas que possuem implementações próprias
    desses elementos.
2.  Substitua implementações duplicadas pelos componentes reutilizáveis,
    quando apropriado.
3.  Preserve todas as funcionalidades e regras de negócio.
4.  Garanta que particularidades de cada tela possam ser configuradas
    por propriedades ou composição.
5.  Teste os componentes em todas as telas que os utilizam.
6.  Remova estilos e implementações antigas que se tornarem
    comprovadamente desnecessários.
7.  Verifique se nenhuma tela permaneceu com uma versão antiga sem
    justificativa.

Uma alteração no componente global de modal, por exemplo, deve permitir
atualizar o padrão de todos os modais do sistema sem precisar editar
cada tela individualmente.

------------------------------------------------------------------------

# 9. Acessibilidade e usabilidade

Além da responsividade visual, verifique:

-   Contraste adequado.
-   Tamanho mínimo de textos legíveis.
-   Áreas de toque adequadas.
-   Navegação por teclado.
-   Estados de foco visíveis.
-   Identificação clara dos campos.
-   Mensagens de erro compreensíveis.
-   Hierarquia semântica.
-   Feedback das ações.
-   Estados vazios.
-   Estados de carregamento.
-   Uso adequado de atributos acessíveis e rótulos.

Não sacrifique a usabilidade para manter um layout visualmente compacto.

------------------------------------------------------------------------

# 10. Regras de implementação e preservação do sistema

1.  Antes de modificar qualquer arquivo, compreenda a estrutura atual do
    projeto.
2.  Identifique a tecnologia, bibliotecas, padrões e arquitetura
    existentes.
3.  Faça o inventário de todas as rotas, telas e componentes.
4.  Preserve a identidade visual do EmerLab.
5.  Preserve todas as funcionalidades existentes.
6.  Não remova campos, informações, botões ou ações para facilitar a
    responsividade.
7.  Não altere regras de negócio.
8.  Não altere integrações, APIs, banco de dados ou autenticação sem
    necessidade.
9.  Não substitua componentes funcionais por versões simplificadas que
    percam recursos.
10. Evite duplicação desnecessária de código.
11. Não crie CSS isolado para resolver problemas que deveriam ser
    corrigidos no componente compartilhado.
12. Respeite os padrões de nomenclatura e organização existentes.
13. Não faça mudanças visuais aleatórias sem considerar a consistência
    geral.
14. Preserve a compatibilidade com navegadores modernos.
15. Não introduza dependências novas sem necessidade; avalie primeiro as
    ferramentas já instaladas.
16. Não considere uma tela responsiva apenas porque não apresenta erros
    de CSS. Ela precisa continuar prática, intuitiva e funcional em cada
    dispositivo.
17. Não faça alterações destrutivas em dados ou configurações.
18. Se encontrar uma limitação técnica ou funcional, registre-a em vez
    de contorná-la removendo funcionalidades.

------------------------------------------------------------------------

# 11. Processo obrigatório de execução

Siga esta sequência de trabalho.

## Etapa 1 --- Mapeamento

-   Examine a estrutura do projeto.
-   Identifique todas as rotas.
-   Liste todas as páginas e módulos.
-   Identifique componentes compartilhados.
-   Identifique todos os modais.
-   Localize tabelas, formulários e elementos de navegação.
-   Identifique os padrões visuais e responsivos existentes.
-   Crie um checklist de acompanhamento.

## Etapa 2 --- Diagnóstico

Para cada tela, identifique os problemas em:

-   Desktop.
-   Telas médias.
-   Mobile.

Classifique os problemas por prioridade:

-   **CRÍTICO:** impede o uso ou oculta funcionalidades.
-   **ALTO:** prejudica significativamente a experiência.
-   **MÉDIO:** apresenta inconsistência ou dificuldade de utilização.
-   **BAIXO:** melhoria visual ou refinamento.

Registre os problemas encontrados e as correções planejadas.

## Etapa 3 --- Design System e componentes globais

-   Revise os componentes compartilhados existentes.
-   Defina os padrões visuais e tokens.
-   Padronize modais, searchbars, filtros, botões, inputs, tabelas e
    demais elementos recorrentes.
-   Implemente ou aprimore componentes reutilizáveis.
-   Valide os componentes isoladamente antes de migrar todas as telas.

Comece pelos componentes globais e compartilhados, pois eles impactam
várias páginas.

## Etapa 4 --- Implementação nas telas

-   Percorra individualmente todas as páginas e módulos.
-   Aplique os componentes padronizados.
-   Corrija os problemas responsivos.
-   Preserve as particularidades funcionais de cada tela.
-   Não pare após corrigir o layout global.
-   Atualize o checklist conforme cada tela for concluída.

## Etapa 5 --- Testes visuais e funcionais

Utilize o navegador e as ferramentas de inspeção disponíveis no ambiente
para testar as telas.

Se Playwright ou outra ferramenta de automação visual estiver
disponível, utilize-a. Não presuma que está instalada: verifique o
ambiente e aproveite as ferramentas existentes.

Teste as resoluções:

-   1920 × 1080.
-   1366 × 768.
-   768 × 1024.
-   390 × 844.
-   320 × 640.

Verifique também:

-   Abertura e fechamento dos modais.
-   Navegação entre páginas.
-   Abertura e posicionamento de dropdowns.
-   Utilização de pesquisas e filtros.
-   Preenchimento e envio de formulários.
-   Acesso aos botões de ação.
-   Rolagem vertical.
-   Ausência de overflow horizontal acidental.
-   Comportamento do teclado virtual em formulários mobile.
-   Consistência dos componentes compartilhados em diferentes telas.

Não considere os testes concluídos apenas porque a aplicação iniciou sem
erros.

## Etapa 6 --- Revisão final e regressões

Faça uma segunda passagem pelas telas corrigidas.

-   Procure inconsistências que possam ter surgido durante as
    alterações.
-   Verifique se uma melhoria global não prejudicou outras páginas.
-   Teste novamente os componentes compartilhados em seus diferentes
    contextos.
-   Corrija os problemas encontrados antes de encerrar.
-   Execute verificações de build, lint e testes disponíveis no projeto.

------------------------------------------------------------------------

# 12. Critérios de aceitação

O trabalho só estará concluído quando os itens aplicáveis abaixo forem
atendidos:

## Auditoria e responsividade

-   [ ] Todas as rotas foram mapeadas.
-   [ ] Todas as páginas foram revisadas.
-   [ ] Todos os modais foram revisados.
-   [ ] Todas as tabelas foram avaliadas.
-   [ ] Todos os formulários foram avaliados.
-   [ ] Desktop está adequado.
-   [ ] Telas médias estão adequadas.
-   [ ] Mobile está adequado.
-   [ ] Não há elementos cortados ou sobrepostos.
-   [ ] Não há rolagem horizontal acidental.
-   [ ] Botões e ações continuam funcionais.

## Design System e reutilização

-   [ ] Modais seguem uma estrutura compartilhada.
-   [ ] Searchbars seguem o mesmo padrão.
-   [ ] Botões possuem variantes padronizadas.
-   [ ] Inputs e selects são consistentes.
-   [ ] Filtros possuem identidade visual unificada.
-   [ ] Tabelas compartilham padrões de apresentação.
-   [ ] Toasts e alertas são consistentes.
-   [ ] Design tokens estão centralizados ou organizados conforme a
    arquitetura existente.
-   [ ] Componentes compartilhados são responsivos.
-   [ ] Telas existentes utilizam os componentes padronizados quando
    apropriado.
-   [ ] Não há duplicações desnecessárias.
-   [ ] Funcionalidades originais foram preservadas.

## Qualidade e validação

-   [ ] Identidade visual consistente.
-   [ ] Acessibilidade básica revisada.
-   [ ] Testes visuais executados nas resoluções de referência.
-   [ ] Interações principais testadas.
-   [ ] Build e verificações disponíveis executados.
-   [ ] Não foram introduzidas regressões conhecidas.

Se algum item não puder ser validado, informe claramente o motivo. Não
marque como concluído algo que não foi testado.

------------------------------------------------------------------------

# 13. Relatório de entrega

Ao finalizar, apresente um relatório contendo:

1.  Quantidade de telas e rotas mapeadas.
2.  Quantidade de telas revisadas.
3.  Quantidade de modais revisados.
4.  Componentes compartilhados criados ou aprimorados.
5.  Principais problemas encontrados.
6.  Principais melhorias implementadas.
7.  Arquivos modificados e breve descrição das alterações.
8.  Testes realizados e respectivas resoluções.
9.  Resultado de build, lint e testes disponíveis.
10. Problemas que ainda precisam de atenção.
11. Itens que não puderam ser testados ou concluídos, com justificativa.

Inclua uma tabela de acompanhamento com os nomes reais encontrados no
projeto:

  --------------------------------------------------------------------------------
  Tela/Módulo    Desktop        Médio          Mobile         Status
  -------------- -------------- -------------- -------------- --------------------
  Nome real da   OK/Pendente    OK/Pendente    OK/Pendente    Concluído/Pendente
  tela                                                        

  --------------------------------------------------------------------------------

Inclua também uma relação dos componentes reutilizáveis e das telas que
passaram a utilizá-los.

------------------------------------------------------------------------

# 14. Diretriz final

Quero que o EmerLab tenha a qualidade visual e a experiência de
utilização de um software SaaS profissional.

Utilize como referências de qualidade interfaces como Linear, Stripe e
Vercel: organização, clareza, consistência, minimalismo e excelente
usabilidade. Não copie essas interfaces; utilize-as apenas como
referência de maturidade visual.

O resultado deve ser:

-   **Desktop:** bem aproveitado, organizado e confortável para
    operações administrativas.
-   **Telas médias:** adaptado, sem elementos espremidos ou sobrepostos.
-   **Mobile:** navegação própria, conteúdos reorganizados, tabelas
    adaptadas e modais realmente utilizáveis.
-   **Componentes:** padronizados, reutilizáveis, configuráveis e fáceis
    de manter.
-   **Código:** consistente, organizado e sem duplicações
    desnecessárias.

O mais importante: cada tela deve parecer projetada para o dispositivo
em que está sendo utilizada. Não quero apenas um desktop que funciona no
celular. Quero um EmerLab verdadeiramente responsivo, com uma linguagem
visual única e uma arquitetura sustentável.

**Comece pelo mapeamento completo e prossiga até a implementação e
validação final. Não interrompa o trabalho após apresentar o
diagnóstico.**

Se o escopo for grande, trabalhe em etapas, mantendo o checklist
atualizado e avançando até concluir todas as telas. Não declare o
trabalho finalizado enquanto houver itens pendentes sem justificativa
explícita.
