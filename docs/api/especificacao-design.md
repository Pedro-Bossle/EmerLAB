# API pública da Rede Credenciada e API de Pagamentos — desenho

Data: 2026-11-05 · Estado: **aguardando revisão** · Autor: Pedro Bossle (EmerLAB) com Claude

## 1. Objetivo

1. **API da Rede Credenciada** (somente leitura): o novo site público da Emerdog (que será refeito) passa a buscar os credenciados **direto do EmerLAB**, que é a fonte oficial. Hoje a página `https://www.emerdog.com.br/rede-credenciada/` lê um Supabase separado (`credenciados_v2`, 547 ativos), sem relação com o EmerLAB.
2. **API de Pagamentos** (servidor a servidor): um sistema externo marca registros de repasse como pagos e anexa comprovantes.
3. **Chaves de API**: gerador, revogação e controle de permissões, com tela de gestão no EmerLAB.
4. **Documentação** para quem vai refazer o site e para quem integrar os pagamentos: guia em Markdown, especificação OpenAPI e exemplos de código. Quem lê **não conhece o EmerLAB**, então o texto não pode pressupor nada do sistema.

Fora de escopo: alterar o código do site (será refeito por outra equipe), webhooks, cadastro de prestadores por API, escrita na rede.

## 2. Resultado do levantamento do site atual

Página `/rede-credenciada/` (renderizada no navegador; o HTML inicial não traz os dados):

- **Filtros:** estado (MG, PR, RS), cidade (depende do estado), especialidade (≈ 40 opções) e o botão "Buscar na rede". Não existe filtro de plano.
- **Lista:** "547 credenciados encontrados", "Mostrando 1–18 de 547", paginação de 18 em 18, ordem por nome.
- **Consulta usada:** `credenciados_v2` com junções `credenciados_v2_procedimentos` e `credenciados_v2_cidades`, filtro `ativo = true`, `order=nome,id`.
- **Card:**

  | Elemento do card                                       | Campo de origem                                         |
  | ------------------------------------------------------ | ------------------------------------------------------- |
  | Etiqueta principal (ex.: "Fisioterapeuta")             | `especialidade_primaria`                                |
  | Etiquetas secundárias (ex.: "Clinica", "Integrativa")  | `especialidade_secundaria` (texto separado por vírgula) |
  | Título                                                 | `nome`                                                  |
  | "Cidade: Caxias do Sul, RS" ou "Cidades: A, B, C · RS" | `cidade_principal`, `uf`, lista de `cidades`            |
  | Endereço (só em alguns cards, os de tipo local)        | `endereco`                                              |
  | Telefone                                               | `telefone` / `celular`                                  |
  | Botão "Ver detalhes do credenciado"                    | abre o detalhe                                          |

- **Detalhe:** procedimentos agrupados por categoria (ex.: SESSÕES → Avaliação Fisiátrica, Sessão de Fisioterapia…), botão "Entre em contato". Hoje **não mostra** desconto.
- Campos internos que a página recebe e não exibe: `vinculo_modo` (`atende_em_clinica`, `veterinarios_vinculados`…) e `atende_em_id`.

## 3. Decisões já tomadas (com o Pedro)

- **Fonte:** a API lê o EmerLAB. Não haverá cópia para o Supabase do site.
- **Busca por cidade:** casa quando a cidade é a **principal** (endereço do cadastro) **ou** qualquer uma da lista **"cidades que atende"**.
- **Resposta por credenciado:** contatos, **endereço apenas para o tipo "Local"**, procedimentos que realiza e **porcentagens de desconto**.
- **Pagamentos:** consumidor é um **sistema externo servidor a servidor**.

## 4. Arquitetura

```
Site novo (navegador)  ──chave pública "rede:ler" + origem──►  /api/v1/rede/*
Sistema financeiro     ──chave secreta "pagamentos:*"──────►  /api/v1/pagamentos/*
                                    │
                     roteador único /api/v1  (autenticação por chave, escopo, limite, auditoria)
                                    │
                    Supabase (service role, somente no servidor)
```

- **Onde roda:** um roteador novo `api/_lib/apiV1Handler.js`, exposto por reescrita `/api/v1/(.*)` para uma função Vercel **já existente** (padrão do `repasse-mensal` em `api/email.js?_fn=…`), para não aumentar a contagem de funções do plano. O plano de implementação confere o limite vigente antes de decidir entre multiplexar ou criar função própria.
- **Acesso a dados:** cliente Supabase com service role **só no servidor**; a API nunca devolve linhas cruas — cada rota monta um objeto público explícito (lista de campos permitidos).
- **Versionamento:** prefixo `/api/v1`. Mudança que quebra contrato vira `/api/v2`.
- **URL base canônica:** `https://api.emerlab.com.br`. Neste documento as rotas aparecem como `/api/v1/...`; no subdomínio o prefixo `/api` some (`https://api.emerlab.com.br/v1/rede/credenciados`). As duas formas chegam ao mesmo roteador, e a documentação usa a canônica.
- **Formato:** JSON UTF-8; datas ISO 8601; valores monetários em número com ponto decimal.
- **Erros:** `{ "erro": { "codigo": "chave_invalida", "mensagem": "…" } }` com HTTP 400/401/403/404/409/413/422/429/500.

## 5. Chaves de API

**Tabela `api_chaves`** (RLS ligada, sem política de leitura para `anon`/`authenticated`; só o servidor acessa):

| Coluna                                                                 | Descrição                                                                         |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `id` uuid                                                              | identificador                                                                     |
| `nome`                                                                 | rótulo ("Site novo – produção")                                                   |
| `prefixo`                                                              | primeiros 8 caracteres, exibido na tela para identificar a chave                  |
| `hash`                                                                 | SHA-256 da chave completa (a chave inteira **aparece uma única vez**, na criação) |
| `escopos` text[]                                                       | `rede:ler`, `pagamentos:ler`, `pagamentos:escrever`                               |
| `origens_permitidas` text[]                                            | obrigatório para chave com `rede:ler`; ex.: `https://www.emerdog.com.br`          |
| `limite_por_minuto` int                                                | padrão 120 (rede) e 60 (pagamentos)                                               |
| `ips_permitidos` text[]                                                | opcional; recomendado para pagamentos                                             |
| `criada_em`, `criada_por`, `expira_em`, `revogada_em`, `ultimo_uso_em` | controle                                                                          |

- Formato da chave: `emer_rede_<32 caracteres>` e `emer_pag_<32 caracteres>` (o prefixo do tipo ajuda a identificar vazamento).
- Envio: cabeçalho `Authorization: Bearer <chave>` ou `X-Api-Key`.
- **Chave da rede é pública por natureza** (vai no navegador). Proteção: escopo só de leitura de dados públicos, checagem do cabeçalho `Origin`, limite de requisições e revogação rápida. **Chave de pagamentos nunca vai ao navegador**; quem receber uma chave `pagamentos:*` em origem de navegador recebe 403.
- **Tela de gestão em Administrativo > API** (`/administrativo/api`, visível só a quem tem `access.manage`), com duas abas. **Chaves:** gerar (mostra a chave uma vez), listar, editar escopos/origens/limite, revogar, girar chave, ver último uso. **Testar:** o administrador informa uma chave, escolhe a rota e os parâmetros, define uma origem simulada e executa; o servidor roda a requisição em processo e mostra status, cabeçalhos, tempo e corpo. Métodos de escrita exigem confirmação explícita, e a chave informada nunca é registrada.
- **IP fixo:** o sistema de pagamentos não tem IP fixo, então `ips_permitidos` fica opcional e sem uso inicial. A proteção das chaves `pagamentos:*` é o segredo, a expiração opcional, o limite por minuto e a revogação imediata.
- **Auditoria:** cada chamada de pagamentos grava em `audit_logs` e em `repasse_eventos` o nome e o prefixo da chave.

## 6. API da Rede Credenciada (`rede:ler`)

### 6.1 Rotas

| Rota                                 | Descrição                                                           |
| ------------------------------------ | ------------------------------------------------------------------- |
| `GET /api/v1/rede/credenciados`      | lista paginada                                                      |
| `GET /api/v1/rede/credenciados/{id}` | um credenciado                                                      |
| `GET /api/v1/rede/filtros`           | UFs, cidades por UF, especialidades e planos para montar os filtros |

Parâmetros de `GET /credenciados`:

| Parâmetro              | Descrição                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `uf`                   | sigla; restringe às cidades da UF                                                                                      |
| `cidade`               | nome do município (sem acento e sem diferenciar maiúsculas); casa a **cidade principal ou qualquer cidade que atende** |
| `especialidade`        | id ou nome; casa a primária ou as secundárias                                                                          |
| `tipo`                 | `local`: tem alguma especialidade do tipo Local (principal ou secundária); `especialidade`: não tem nenhuma            |
| `plano`                | opcional; id ou chave (`basico`, `classico`, `avancado`, `ultra`)                                                      |
| `q`                    | busca por nome                                                                                                         |
| `pagina`, `por_pagina` | padrão 1 e 18; máximo 100                                                                                              |

Cabeçalhos de resposta: `X-Total-Count`, `Cache-Control: public, s-maxage=300, stale-while-revalidate=3600`, `Access-Control-Allow-Origin` apenas para a origem autorizada, `X-RateLimit-*`.

### 6.2 Regras de negócio

- **Quem entra:** prestador `ativo` com situação "Credenciado" (mesma regra de `situacaoDescricaoEhCredenciado`).
- **Cidades de um credenciado:** cidade principal do endereço + `prestador_cidades` ("cidades que atende"). **Veterinário vinculado a clínica** (`prestador_estabelecimentos`) herda as cidades e a UF da clínica, como na busca "Quem realiza" do Zap (`zap-emerlab/server/quemRealiza.js`).
- **Equivalência de município:** "Porto Alegre e Região" casa com "Porto Alegre" (mesma normalização já usada no Zap).
- **Filtro `plano`:** mantém só os credenciados que atendem alguma cidade em que o plano tem tabela (`planos_cidade`) e corta os procedimentos pela hierarquia Básico ⊂ Clássico ⊂ Avançado ⊂ Ultra (`planosHierarquia.js`). "Apenas Loja" não é aceito. Sem `plano`, a busca é só por cidade.
- **Endereço:** devolvido quando o credenciado tem **alguma especialidade do tipo `Local`**, seja a **principal ou uma secundária** (`prestador_especialidades`). No cadastro do EmerLAB, o tipo `Local` inclui: Clínica 24h, Clínica, Consultório, Hospital, Laboratório, Farmácia, PetShop, Comércio, Banho e Tosa, Crematório, Hotel, Recreação e Adestramento. Quem só tem especialidades do tipo `Especialidade` (veterinários e afins) devolve `endereco: null`. Na base de 09/11/2026: 642 prestadores ativos, 160 com especialidade principal `Local` e 1 só com secundária `Local`.
- **Descontos:** `prestador_beneficios` com `incluir = true`, juntando `beneficios_catalogo` (nome e grupo); `percentual` e `percentual_max` (faixa); observações de `prestador_beneficios_obs`.

### 6.3 Objeto `credenciado`

```json
{
  "id": 123,
  "nome": "Ami Centro de Reabilitação",
  "tipo": "especialidade",
  "especialidade_principal": "Fisioterapeuta",
  "especialidades_secundarias": ["Clinica", "Integrativa"],
  "contatos": { "telefone": "(54) 9259-5078", "celular": "(54) 9259-5078", "whatsapp_url": "https://wa.me/555492595078" },
  "cidade_principal": { "nome": "Caxias do Sul", "uf": "RS" },
  "cidades_atende": [{ "nome": "Caxias do Sul", "uf": "RS" }],
  "endereco": {
    "logradouro": "Rua Antônio Ribeiro Mendes", "numero": "2138", "complemento": null, "bairro": "Santa Catarina",
    "cidade": "Caxias do Sul", "uf": "RS", "cep": null,
    "texto": "Rua Antônio Ribeiro Mendes, 2138 — Santa Catarina — Caxias do Sul/RS"
  },
  "procedimentos": [
    { "categoria": "Sessões", "itens": [{ "codigo": "SESS-002", "nome": "Sessão de Fisioterapia", "nome_alternativo": null }] }
  ],
  "descontos": {
    "itens": [{ "nome": "Banho e tosa", "grupo": "Serviços", "percentual": 10, "percentual_max": 15 }],
    "observacoes": null
  }
}
```

`tipo` é o tipo da especialidade **principal** (`local` ou `especialidade`). `endereco` traz `{ logradouro, numero, complemento, bairro, cidade, uf, cep, texto }` quando o credenciado tem alguma especialidade `Local` (principal ou secundária), como o exemplo acima (principal Fisioterapeuta, secundária Clínica); caso contrário é `null`. Nunca saem CPF/CNPJ, PIX, e-mail interno, situação, dados de cadastro ou observações internas. O `id` é o do EmerLAB.

### 6.4 Desempenho

Uma leitura única em lote das tabelas necessárias, montagem em memória com cache de 5 minutos por instância (invalidado quando o cache vence) e `s-maxage` na borda, para que o site não gere carga contínua no Supabase (plano Micro).

## 7. API de Pagamentos (`pagamentos:*`)

| Rota                                                             | Escopo                | Descrição                                                                                                           |
| ---------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/pagamentos/registros?mes=&ano=&pago=&prestador_id=` | `pagamentos:ler`      | registros de repasse: `id`, competência, prestador, tipo de repasse, valor, `pago`, e se há relatório e comprovante |
| `GET /api/v1/pagamentos/registros/{id}`                          | `pagamentos:ler`      | detalhe, comprovantes e eventos                                                                                     |
| `POST /api/v1/pagamentos/registros/{id}/pago`                    | `pagamentos:escrever` | marca como pago. Corpo: `{ "data_pagamento": "2026-11-05", "valor": 272.00 }` (opcionais)                           |
| `POST /api/v1/pagamentos/registros/{id}/comprovantes`            | `pagamentos:escrever` | anexa o comprovante                                                                                                 |
| `DELETE /api/v1/pagamentos/registros/{id}/pago`                  | `pagamentos:escrever` | desfaz, com `motivo` obrigatório (mesma regra de `desfazer-pagamento`)                                              |

**Comprovante:** `multipart/form-data` (`arquivo`, `data_pagamento`, `valor`, `notificar_prestador`) ou JSON com `arquivo_base64` e `nome`. PDF, PNG ou JPG, até 3 MB (limite do corpo da Vercel). O arquivo vai para o bucket `repasse-documentos`, com o mesmo caminho do fluxo atual (`AAAA-MM/<relatorio>/comprovante/`), e a linha entra em `repasse_comprovantes`.

**Comportamentos:**

- **Idempotência:** `Idempotency-Key` opcional; repetir `pago` num registro já pago devolve `200` com `"ja_estava_pago": true`, sem novo evento. Comprovante repetido (mesmo hash de arquivo no mesmo registro) devolve o existente.
- **Notificação ao prestador:** o fluxo atual do painel **envia e-mail ao prestador** com o comprovante. Para a API, `notificar_prestador` é **falso por padrão** (o sistema externo normalmente já avisa); com `true` usa o mesmo e-mail do painel.
- **Registro sem relatório de repasse:** `pago` funciona; o comprovante é gravado ligado ao registro (`registro_id`) e o relatório fica nulo.
- **Auditoria:** cada escrita gera evento `comprovante_enviado`/`pagamento_marcado`/`pagamento_desfeito` com autor `api:<nome da chave>`.
- Sem desmarcar pago por outro caminho: a única mudança em `pagamentos_registros` é a flag `pago`.

## 8. Documentação (entrega para os responsáveis pelo site)

- `docs/api/README.md`: visão geral, autenticação, erros, limites, versionamento, paginação, CORS.
- `docs/api/rede-credenciada.md`: guia de integração do site, o mapa **card → campo da API**, como montar os filtros em cascata (UF → cidade → especialidade → plano), exemplos `curl`, `fetch` e React, e recomendações de cache.
- `docs/api/pagamentos.md`: fluxo completo (listar → marcar pago → anexar), exemplos `curl` e Node, tratamento de erros e idempotência.
- `docs/api/openapi.json`: especificação OpenAPI 3.1 das duas APIs (para Postman/Swagger e geração de cliente).
- Página de documentação servida em `https://api.emerlab.com.br/docs` (HTML estático a partir do OpenAPI, sem login), para a equipe do site consultar sem acesso ao repositório.
- Cada exemplo usa chaves fictícias; nenhuma chave real aparece na documentação.

## 9. Segurança

- Chaves guardadas só como hash; mostradas uma vez; revogação imediata (consulta o hash a cada chamada, com cache de 30 s).
- Limite por chave e por IP (o `rateLimit.js` atual é por instância; a tabela `api_chaves` registra `ultimo_uso_em`; contador global fica como melhoria se houver abuso).
- Origem: `Origin` obrigatório e igual a uma origem permitida para chaves de navegador; chaves `pagamentos:*` recusam requisição com `Origin`.
- Corpo limitado (3 MB para comprovante, 256 KB para JSON).
- Resposta pública montada por lista fixa de campos; testes garantem que os campos proibidos não aparecem.
- Registros de uso e falhas de autenticação em `audit_logs`.

## 10. Testes

- Unidade: geração/validação de chave, escopo, origem, limite, montagem do objeto público (sem campos proibidos), regra de cidade (principal, lista, vet vinculado, "e Região"), corte por plano, idempotência de `pago` e do comprovante.
- Integração no padrão do `apiRepasseMensal.test.js` (banco simulado).
- Verificação final contra a base real em modo leitura: conferir que a contagem de credenciados e as cidades de amostra batem com o cadastro.

## 11. Implantação

1. Migração `api_chaves` (e colunas de auditoria necessárias): testada antes numa **branch do Supabase**, e aplicada em produção só com autorização, fora do horário de pico.
2. Código da API e tela de chaves.
3. Gerar uma chave de teste, validar com `curl`, publicar a documentação.
4. Entregar a chave de produção à equipe do site e a de pagamentos ao financeiro, por canal seguro.

## 12. Pontos para confirmar na revisão

1. **E-mail ao prestador** com `notificar_prestador = false` por padrão na API de pagamentos.
2. **Parâmetro `plano`** como filtro opcional (cidades do plano + corte de procedimentos). Sem o parâmetro, a busca é só por cidade.
3. **Limite de funções Vercel:** o plano de implementação confere o limite atual do plano antes de decidir multiplexar ou criar função própria.
4. **Contagem:** o EmerLAB tem 640 prestadores ativos; o site mostra 547. A diferença (situação "Credenciado" e filtros) será conferida contra a base real antes da entrega.
