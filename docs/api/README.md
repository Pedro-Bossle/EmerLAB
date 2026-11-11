# API pública do EmerLAB

Documentação para quem vai integrar com o EmerLAB e **não conhece o sistema**. O EmerLAB é o sistema interno da Emerdog; esta API expõe dois pedaços dele:

| API                    | Para quê                                                                                   | Quem usa                                | Guia                                     |
| ---------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------- | ---------------------------------------- |
| **Rede credenciada**   | Listar os credenciados (clínicas, profissionais, lojas) com contatos, procedimentos e descontos | O site público da Emerdog (navegador)   | [rede-credenciada.md](rede-credenciada.md) |
| **Pagamentos**         | Consultar repasses a prestadores, marcar como pago e anexar o comprovante                  | O sistema financeiro (servidor a servidor) | [pagamentos.md](pagamentos.md)           |

Também há a especificação [OpenAPI 3.1](openapi.json) (para Postman, Swagger/Insomnia e geração de cliente) e a página de consulta rápida em **https://api.emerlab.com.br/docs** (a raiz `https://api.emerlab.com.br/` redireciona para `/docs`), que mostra as mesmas rotas, com parâmetros, exemplos e códigos de erro.

## Em 30 segundos

```bash
curl "https://api.emerlab.com.br/v1/rede/filtros" \
  -H "Authorization: Bearer emer_rede_EXEMPLO_NAO_E_UMA_CHAVE" \
  -H "Origin: https://www.exemplo.com.br"
```

- **URL base:** `https://api.emerlab.com.br`, com rotas `/v1/...` (sem `/api`). As mesmas rotas existem em `/api/v1/...` no domínio principal do EmerLAB; os exemplos usam sempre a URL canônica.
- **Formato:** JSON em UTF-8. Datas em `AAAA-MM-DD` (ou ISO 8601 com hora). Valores em reais, como número com ponto decimal.
- **Versão:** tudo está sob `/v1`. Uma mudança que quebre o contrato vira `/v2`; acrescentar campos novos nas respostas **não** é quebra, então ignore campos que não conhece.

Todas as chaves que aparecem nesta documentação são fictícias (`emer_rede_EXEMPLO_NAO_E_UMA_CHAVE`). Uma chave real só é mostrada uma vez, a quem a cria.

## Como obter uma chave

Uma pessoa com permissão de administrador no EmerLAB cria a chave (veja [Gestão de chaves](#gestão-de-chaves-para-administradores-do-emerlab)) e a entrega por canal seguro. Peça informando:

- **Site:** o nome do projeto e **todos os endereços de onde o site vai chamar a API** (produção, homologação e, se quiser, `http://localhost:5173`). Cada um vira uma "origem permitida".
- **Financeiro:** o nome do sistema. A chave de pagamentos não tem origem nem IP.

## Autenticação

Envie a chave em um destes cabeçalhos:

```
Authorization: Bearer <chave>
X-Api-Key: <chave>
```

Há dois tipos de chave, que **não se misturam**:

| Tipo                   | Formato                | Escopos                                  | Onde pode ficar                                          |
| ---------------------- | ---------------------- | ---------------------------------------- | -------------------------------------------------------- |
| Chave da rede          | `emer_rede_<32 letras e números>` | `rede:ler`                       | No navegador (é pública por natureza)                    |
| Chave de pagamentos    | `emer_pag_<32 letras e números>`  | `pagamentos:ler`, `pagamentos:escrever` | **Somente em servidor.** Nunca no navegador, no app ou no código do site |

### Chave da rede: pública, mas restrita

A chave da rede vai no código do site, então qualquer visitante a vê. A proteção é:

1. **Origem.** A chave só funciona quando a requisição traz o cabeçalho `Origin` igual a uma das origens cadastradas nela. O navegador envia esse cabeçalho sozinho nas chamadas entre domínios. Em `curl` ou em código de servidor (por exemplo, renderização no servidor do site), **você precisa enviá-lo**; sem ele a resposta é `403 origem_nao_permitida`.
2. **Escopo somente leitura** de dados que já são públicos (a rede credenciada). Nenhum dado sensível sai desta API: não há CPF/CNPJ, chave PIX, e-mail interno, situação cadastral nem observações internas.
3. **Limite de requisições por minuto** e **revogação** pelo administrador.

Formato das origens: exatamente `https://host` ou `https://host:porta`, sem caminho e sem curinga (`https://www.exemplo.com.br`, não `https://*.exemplo.com.br` nem `https://www.exemplo.com.br/rede`). Para desenvolvimento local também são aceitas `http://localhost` e `http://127.0.0.1`, com porta opcional.

### Chave de pagamentos: segredo de servidor

- Fica em variável de ambiente do servidor do sistema financeiro.
- **Qualquer requisição que traga o cabeçalho `Origin` é recusada (`403 origem_nao_permitida`)**, porque `Origin` indica navegador. Chame sempre de servidor.
- O sistema de pagamentos não tem IP fixo, então **não há lista de IPs permitidos em uso** (a coluna existe, é opcional e hoje fica vazia). A proteção é o segredo, a expiração opcional da chave, o limite por minuto e a revogação.
- Se a chave vazar, peça a um administrador para **girar** (gera uma nova e revoga a antiga) ou **revogar**.

### Quanto tempo leva para revogar ou editar uma chave

O servidor guarda cada chave em memória por até **30 segundos**: uma chave revogada (ou com origens editadas) pode continuar funcionando, ou só passar a funcionar, por até 30 s.

Além disso, as respostas da rede são guardadas na borda (CDN) por 5 minutos. Uma chave revogada **pode ainda receber, do cache, dados públicos por até 5 minutos**. Isso não vale para pagamentos, que nunca têm cache.

## CORS

- Métodos aceitos: `GET`, `POST` e `OPTIONS` (a pré-verificação `OPTIONS` responde `204`).
- Cabeçalhos de requisição permitidos: `Authorization`, `X-Api-Key` e `Content-Type`.
- `Access-Control-Allow-Origin` só é enviado quando a origem da requisição está cadastrada em alguma chave ativa. Se o navegador reclamar de CORS, a primeira coisa a conferir é se a origem exata do site (esquema, host e porta) está na chave.
- Sempre que o `Access-Control-Allow-Origin` é enviado, vai junto `Access-Control-Expose-Headers: X-Total-Count, X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After`. Ou seja, o navegador, numa origem permitida, consegue ler esses quatro cabeçalhos (por exemplo `response.headers.get('X-Total-Count')`).
- O navegador envia pré-verificação para `DELETE`, `PUT` e `PATCH`, e ela falha, porque `Access-Control-Allow-Methods` é só `GET, POST, OPTIONS`. Portanto esses métodos não podem ser chamados do navegador. A única rota com `DELETE` (`DELETE .../pago`, desfazer pagamento) é exclusiva de servidor a servidor.

## Limites de uso

- Cada chave tem um limite de requisições **por minuto**: padrão **120** (rede) e **60** (pagamentos); o administrador pode alterar por chave.
- Toda resposta de uma chave autenticada e aceita traz `X-RateLimit-Limit` (limite da chave) e `X-RateLimit-Remaining` (o que resta na janela de 1 minuto): sucessos, `429` (com `Remaining: 0`) e erros de corpo depois da autenticação. As respostas `401` e `403` **não** trazem esses cabeçalhos, porque são dadas antes do limitador.
- Ao exceder, a resposta é `429 limite_excedido` com `Retry-After` (segundos até poder tentar de novo). Espere esse tempo; não repita em laço.
- O contador vive em cada instância do servidor. Sob carga, com várias instâncias, o limite efetivo pode ser **maior** que o configurado. Não use o limite como garantia de cota: trate-o como proteção contra abuso.

## Paginação

Rotas de lista (`/v1/rede/credenciados` e `/v1/pagamentos/registros`):

| Parâmetro    | Padrão | Regra                                                                                  |
| ------------ | ------ | -------------------------------------------------------------------------------------- |
| `pagina`     | 1      | Começa em 1. Ausente, não numérico ou menor que 1 vira 1.                              |
| `por_pagina` | 18     | De 1 a 100. Acima de 100 vira 100. Ausente, não numérico ou `0` vira 18 (hoje `por_pagina=0` não é rejeitado). |

- O total de itens (somando todas as páginas) vem no cabeçalho `X-Total-Count`.
- Ordem estável: rede por nome e depois id; pagamentos do mais recente ao mais antigo (ano, mês, nome do prestador, id).
- Página além do fim devolve lista vazia (`[]`), não erro.

## Erros

Toda resposta de erro tem o mesmo formato. Trate pelo `codigo` (estável); a `mensagem` é um texto em português e pode mudar.

```json
{ "erro": { "codigo": "chave_invalida", "mensagem": "Chave de API ausente ou inválida." } }
```

| Código                          | HTTP | Quando                                                                                          |
| ------------------------------- | ---- | ----------------------------------------------------------------------------------------------- |
| `chave_invalida`                | 401  | Chave ausente, desconhecida, revogada ou expirada (as quatro dão a mesma resposta de propósito) |
| `escopo_insuficiente`           | 403  | A chave existe, mas não tem o escopo da rota (ex.: chave da rede chamando pagamentos)           |
| `origem_nao_permitida`          | 403  | Chave da rede: `Origin` ausente ou fora da lista. Chave de pagamentos: qualquer `Origin`        |
| `ip_nao_permitido`              | 403  | A chave tem lista de IPs e o IP da chamada não está nela (recurso opcional, hoje sem uso)       |
| `rota_nao_encontrada`           | 404  | Caminho ou método que não existe (só para chave válida; sem chave válida a resposta é 401)      |
| `limite_excedido`               | 429  | Limite por minuto excedido. Veja `Retry-After`                                                  |
| `payload_grande`                | 413  | Corpo da requisição acima do teto da rota (256 KB; cerca de 4,4 MiB no comprovante)             |
| `corpo_invalido`                | 400  | O corpo não é um objeto JSON válido                                                              |
| `tipo_invalido`                 | 400  | Rede: `tipo` diferente de `local` ou `especialidade`                                            |
| `plano_invalido`                | 400  | Rede: `plano` desconhecido ou "Apenas Loja"                                                      |
| `credenciado_nao_encontrado`    | 404  | Rede: credenciado inexistente, inativo ou fora da situação Credenciado                           |
| `parametro_invalido`            | 400  | Pagamentos: filtro malformado (`mes`, `ano`, `pago`, `prestador_id`) ou `notificar_prestador` que não é booleano |
| `registro_nao_encontrado`       | 404  | Pagamentos: registro inexistente (inclusive id que não é UUID)                                  |
| `data_pagamento_invalida`       | 400  | Pagamentos: `data_pagamento` fora de `AAAA-MM-DD` ou data que não existe                       |
| `valor_invalido`                | 400  | Pagamentos: `valor` ausente (onde é obrigatório) ou não positivo                                |
| `motivo_obrigatorio`            | 400  | Pagamentos: desfazer pagamento sem `motivo` de pelo menos 5 caracteres                          |
| `arquivo_obrigatorio`           | 400  | Pagamentos: `arquivo_base64` ausente                                                             |
| `arquivo_invalido`              | 422  | Pagamentos: base64 inválido, arquivo vazio ou que não é PDF, PNG ou JPEG                        |
| `arquivo_grande`                | 413  | Pagamentos: arquivo acima de 3 MB decodificado                                                   |
| `prestador_sem_email`           | 422  | Pagamentos: `notificar_prestador: true` e o prestador não tem e-mail                            |
| `nao_esta_pago`                 | 409  | Pagamentos: desfazer pagamento de registro que não está pago                                    |
| `registro_sem_relatorio`        | 409  | Pagamentos: comprovante em registro sem relatório de repasse (limitação atual)                  |
| `comprovante_em_processamento`  | 409  | Pagamentos: mesmo comprovante reenviado em menos de 45 s. Repita depois de `Retry-After`        |
| `comprovante_inconsistente`     | 500  | Pagamentos: o servidor não terminou de forma consistente. A chamada é segura de repetir         |
| `erro_interno`                  | 500  | Falha inesperada. A mensagem não traz detalhes                                                  |

`payload_grande` e `arquivo_grande` (ambos 413) significam a mesma coisa para o cliente: **o arquivo é grande demais**.

Os códigos `sem_permissao` e `nao_autenticado` pertencem às rotas de administração das chaves (usadas só pela tela do EmerLAB) e nunca aparecem nas rotas públicas.

## Cache

- Rede (`GET /v1/rede/*`): `Cache-Control: public, s-maxage=300, stale-while-revalidate=3600`. A borda guarda a resposta por 5 minutos e pode servir uma versão mais velha por até 1 hora enquanto atualiza. Uma alteração no cadastro do EmerLAB pode levar alguns minutos para aparecer. Detalhes em [rede-credenciada.md](rede-credenciada.md#cache).
- Todas as respostas trazem `Vary: Origin, Authorization, X-Api-Key`: uma requisição sem chave nunca é atendida com a resposta guardada para outro chamador.
- Se a fonte de dados do EmerLAB ficar fora do ar por pouco tempo, as rotas da rede continuam respondendo com os últimos dados bons (até o servidor ser reiniciado).
- Pagamentos: `Cache-Control: no-store`. Nunca guarde em cache.

## Auditoria

Só as **escritas** de pagamentos (marcar pago, anexar comprovante, desfazer) são auditadas, com o nome e o prefixo da chave (por exemplo `api:Financeiro (emer_pag)`). Consultas (`GET`) não são registradas.

## Gestão de chaves (para administradores do EmerLAB)

Esta seção é para quem administra o EmerLAB. As rotas `/v1/admin/*` que a tela usa **não fazem parte da API pública** e não estão no OpenAPI.

A tela fica em **Administrativo > API** (`/administrativo/api`) e só aparece para quem tem a permissão `access.manage`. Tem duas abas.

### Aba Chaves

- **Criar uma chave da rede (para o site):** botão de nova chave, tipo *rede*; dê um nome que identifique o uso (por exemplo "Site novo – produção"); informe **ao menos uma origem permitida**, uma por linha, no formato `https://host` (ou `https://host:porta`; `http://localhost` e `http://127.0.0.1` valem para desenvolvimento); ajuste o limite por minuto se precisar (padrão 120). Cadastre também as origens de homologação.
- **Criar uma chave de pagamentos (para o financeiro):** tipo *pagamentos*; escolha os escopos (`pagamentos:ler` para consultar, `pagamentos:escrever` para marcar pago e anexar); **não há origens** (chave de servidor); limite padrão 60 por minuto; a lista de IPs é opcional e hoje fica vazia, porque o sistema de pagamentos não tem IP fixo. Uma data de expiração é opcional.
- **A chave completa aparece uma única vez**, na hora da criação (e da rotação). Copie e entregue por canal seguro (gerenciador de senhas, não e-mail nem chat). Depois só se vê o prefixo (8 primeiros caracteres), para identificar a chave. O sistema guarda apenas o hash.
- **Editar:** nome, escopos, origens, limite, IPs e expiração. A alteração vale em até 30 segundos.
- **Girar:** cria uma chave nova com as mesmas regras e revoga a antiga. Use quando suspeitar de vazamento ou ao trocar quem tem acesso; combine a troca com quem usa a chave.
- **Revogar:** a chave para de funcionar em até 30 segundos. Respostas da rede já guardadas no cache da borda podem continuar saindo por até 5 minutos (dados públicos).
- Cada linha mostra o último uso, para achar chaves paradas.

### Aba Testar

Permite experimentar uma rota sem ferramentas externas: cole uma chave (ela **não é registrada**), escolha a rota e os parâmetros, informe a origem simulada (para chaves da rede) e execute. A tela mostra status, cabeçalhos, tempo e corpo. As rotas de escrita (marcar pago, anexar comprovante, desfazer) pedem confirmação explícita, porque **executam de verdade**.

Nunca cole uma chave real em chat, ticket ou documento.

## Para a equipe de desenvolvimento do EmerLAB

- O código das rotas está em `api/_lib/apiV1/` (roteador, rede, pagamentos, chaves) e as regras puras em `src/lib/apiV1/`.
- Estes guias (README, rede-credenciada.md e pagamentos.md) são entregues por um administrador do EmerLAB junto com a chave; a página https://api.emerlab.com.br/docs e o openapi.json bastam como referência dos endpoints.
- Esta documentação é mantida junto do código. O teste `src/lib/apiV1/openapi.test.js` falha se uma rota pública for criada ou removida sem atualizar `docs/api/openapi.json`, se houver algo parecido com uma chave real nos documentos, ou se a página `public/api-docs/` estiver desatualizada.
- Depois de editar `docs/api/openapi.json`, rode `npm run api-docs`: ele copia o arquivo para `public/api-docs/openapi.json` e regenera `public/api-docs/index.html` (HTML estático, sem JavaScript).
- A especificação de projeto, com as decisões, está em [especificacao-design.md](especificacao-design.md). Onde ela e o código diferem, vale o código, e estes guias descrevem o código.
