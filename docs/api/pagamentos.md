# API de Pagamentos

Guia para o sistema que paga os prestadores da Emerdog e precisa **avisar o EmerLAB** de que um repasse foi pago, com o comprovante. Você não precisa conhecer o EmerLAB: um **registro** é uma linha de repasse mensal a um prestador (competência mês/ano, prestador, tipo de repasse, valor, se já foi pago).

Leia antes o [README](README.md) (autenticação, erros, limites). Referência de cada rota: [openapi.json](openapi.json) ou https://api.emerlab.com.br/docs.

## Regras de segurança

- A chave é `emer_pag_…` e é um **segredo de servidor**. Guarde em variável de ambiente ou cofre de segredos; nunca em navegador, app ou repositório.
- **Toda requisição que traga o cabeçalho `Origin` é recusada com `403 origem_nao_permitida`.** Chame sempre de um servidor (`curl`, Node, Python…), nunca de uma página.
- Escopos: `pagamentos:ler` (consultas) e `pagamentos:escrever` (marcar pago, anexar comprovante, desfazer). A chave pode ter um ou os dois.
- Não há lista de IPs permitidos em uso (o sistema de pagamentos não tem IP fixo). Em caso de vazamento, peça a revogação ou a rotação da chave a um administrador do EmerLAB.
- As respostas **nunca** trazem chave PIX, e-mails nem caminhos de arquivos, e **nunca** são guardadas em cache (`Cache-Control: no-store`).
- A API só altera uma coisa em um registro: a flag `pago`. Valor, prestador e competência são somente leitura.
- Só as **escritas** são auditadas (com o nome e o prefixo da chave); as consultas não.

## Fluxo

```
1. GET  /v1/pagamentos/registros?mes=10&ano=2026&pago=false   → acha o registro (id UUID)
2. POST /v1/pagamentos/registros/{id}/pago                    → marca como pago           (opcional se for anexar o comprovante)
3. POST /v1/pagamentos/registros/{id}/comprovantes            → anexa o comprovante (e marca como pago)
4. GET  /v1/pagamentos/registros/{id}                         → confere comprovantes e eventos
```

O passo 3 já marca o registro como pago. Use o passo 2 sozinho quando só quer registrar o pagamento, sem arquivo.

### 1. Listar registros

```bash
curl "https://api.emerlab.com.br/v1/pagamentos/registros?mes=10&ano=2026&pago=false&por_pagina=50" \
  -H "Authorization: Bearer emer_pag_EXEMPLO_NAO_E_UMA_CHAVE"
```

Filtros opcionais: `mes` (1 a 12), `ano` (4 dígitos), `pago` (`true`/`false`), `prestador_id`, e a [paginação](README.md#paginação) padrão (`pagina`, `por_pagina`). Filtro malformado: `400 parametro_invalido`. Total em `X-Total-Count` (aqui é uma chamada de servidor, então o cabeçalho é legível).

```json
[
  {
    "id": "3f2b8c1e-5a4d-4e7b-9c10-2d6a8b7e1f00",
    "competencia": { "mes": 10, "ano": 2026 },
    "prestador_id": 456,
    "prestador_nome": "Prestador Exemplo Ltda",
    "tipo_repasse": "nota",
    "valor": 272.0,
    "pago": false,
    "tem_relatorio": true,
    "tem_comprovante": false
  }
]
```

- `id` é um UUID. Id que não seja UUID responde `404 registro_nao_encontrado`.
- `tem_relatorio` diz se o registro tem relatório de repasse. **Veja a limitação mais abaixo.**

### 2. Marcar como pago

```bash
curl -X POST "https://api.emerlab.com.br/v1/pagamentos/registros/3f2b8c1e-5a4d-4e7b-9c10-2d6a8b7e1f00/pago" \
  -H "Authorization: Bearer emer_pag_EXEMPLO_NAO_E_UMA_CHAVE" \
  -H "Content-Type: application/json" \
  -d '{"data_pagamento":"2026-11-05","valor":272.00}'
```

O corpo é opcional. `data_pagamento` (`AAAA-MM-DD`) e `valor` (número maior que zero), se enviados, são validados e guardados no histórico. Resposta `200`:

```json
{ "ja_estava_pago": false, "registro": { "id": "3f2b8c1e-5a4d-4e7b-9c10-2d6a8b7e1f00", "pago": true, "...": "..." } }
```

**Idempotente:** repetir a chamada num registro que já está pago devolve `200` com `"ja_estava_pago": true`, sem novo evento e sem erro. Pode repetir à vontade em caso de timeout.

### 3. Anexar o comprovante

O envio é **somente JSON** (não há `multipart/form-data`): o arquivo vai codificado em base64 no campo `arquivo_base64`.

| Campo                 | Obrigatório | Descrição                                                                                         |
| --------------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| `arquivo_base64`      | sim         | Conteúdo do arquivo em base64 (aceita o prefixo `data:...;base64,`)                                |
| `nome`                | não         | Nome original. Só informativo                                                                     |
| `data_pagamento`      | sim         | `AAAA-MM-DD`                                                                                      |
| `valor`               | sim         | Valor pago, maior que zero                                                                        |
| `notificar_prestador` | não         | Padrão `false`. Com `true`, o prestador recebe o e-mail "Pagamento realizado" com o comprovante anexado |

Regras do arquivo:

- Tipos aceitos: **PDF, PNG e JPEG**, reconhecidos pelo **conteúdo** do arquivo (a extensão e o `nome` não valem). Outro tipo: `422 arquivo_invalido`.
- Tamanho máximo **3 MB** depois de decodificado. Em base64 isso dá cerca de 4 MB, e o corpo da requisição aceita até cerca de **4,4 MiB**. Acima disso: `413`. Os dois códigos `413` (`arquivo_grande`, do arquivo; `payload_grande`, do corpo) significam o mesmo para você: **o arquivo é grande demais**. Reduza ou comprima antes de reenviar.

```bash
BASE64=$(base64 -w0 comprovante.pdf)   # no macOS: base64 -i comprovante.pdf
curl -X POST "https://api.emerlab.com.br/v1/pagamentos/registros/3f2b8c1e-5a4d-4e7b-9c10-2d6a8b7e1f00/comprovantes" \
  -H "Authorization: Bearer emer_pag_EXEMPLO_NAO_E_UMA_CHAVE" \
  -H "Content-Type: application/json" \
  -d "{\"arquivo_base64\":\"$BASE64\",\"nome\":\"comprovante.pdf\",\"data_pagamento\":\"2026-11-05\",\"valor\":272.00,\"notificar_prestador\":false}"
```

Resposta `201` (novo) ou `200` (já existia):

```json
{
  "ja_existia": false,
  "notificado": false,
  "comprovante": {
    "id": "9a7c2e44-1b3d-4f65-8a90-c0d1e2f3a4b5",
    "data_pagamento": "2026-11-05",
    "valor": 272.0,
    "forma": "pix",
    "enviado_em": "2026-11-05T14:32:10.000Z"
  }
}
```

Efeitos: o arquivo é guardado, o comprovante é registrado e o registro fica **pago**. Com `notificar_prestador: true`, o e-mail sai pelo mesmo modelo que o painel do EmerLAB usa; se o prestador não tem e-mail no cadastro, a resposta é `422 prestador_sem_email` e **nada é gravado** (o mesmo vale se o envio do e-mail falhar: nenhum comprovante fica gravado e a chamada pode ser repetida).

### Limitação atual: registro sem relatório de repasse

Alguns registros não têm relatório de repasse (`"tem_relatorio": false`). Para eles:

- **marcar como pago funciona**;
- **anexar comprovante ainda não**: a resposta é `409 registro_sem_relatorio`, e repetir não adianta.

Isso se resolve com uma mudança no banco de dados do EmerLAB, planejada para uma próxima versão. Até lá, para esses registros use só o passo 2 (marcar como pago) e envie o comprovante por outro canal. Quando a mudança for aplicada, o mesmo pedido passa a funcionar, sem alterar o seu código.

### 4. Consultar o detalhe

```bash
curl "https://api.emerlab.com.br/v1/pagamentos/registros/3f2b8c1e-5a4d-4e7b-9c10-2d6a8b7e1f00" \
  -H "Authorization: Bearer emer_pag_EXEMPLO_NAO_E_UMA_CHAVE"
```

Traz os campos do registro mais `comprovantes` (do mais antigo ao mais novo) e `eventos` (`tipo`, `criado_em` e `origem`: `api`, `painel`, `prestador` ou `sistema`; nunca o nome de quem agiu).

### Desfazer um pagamento

```bash
curl -X DELETE "https://api.emerlab.com.br/v1/pagamentos/registros/3f2b8c1e-5a4d-4e7b-9c10-2d6a8b7e1f00/pago" \
  -H "Authorization: Bearer emer_pag_EXEMPLO_NAO_E_UMA_CHAVE" \
  -H "Content-Type: application/json" \
  -d '{"motivo":"Pagamento lançado no registro errado"}'
```

- `motivo` é **obrigatório** (mínimo 5 caracteres; guarda até 500) e vai para a auditoria. Também pode ir na query (`?motivo=...`).
- Volta `pago` para falso e **remove as linhas de comprovante** do registro. Os **arquivos continuam guardados** no armazenamento do EmerLAB; só deixam de estar ligados ao registro.
- Registro que não está pago e não tem comprovantes: `409 nao_esta_pago`.
- Resposta: `{ "comprovantes_removidos": 1, "registro": { … } }`.

## Idempotência e repetição segura

| Operação                       | Se repetir                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Marcar como pago               | `200` com `ja_estava_pago: true`. Nenhum efeito novo                                                 |
| Anexar o **mesmo arquivo** (mesmo SHA-256) no mesmo registro | `200` com `ja_existia: true` e o comprovante que já existe. Nada é regravado e **nenhum e-mail** é enviado |
| Anexar arquivo **diferente**   | Vira um segundo comprovante                                                                          |
| Desfazer                       | Segunda vez: `409 nao_esta_pago`                                                                     |

- O cabeçalho `Idempotency-Key` é **aceito e ignorado**: a idempotência vem do conteúdo, não da chave. Pode enviá-lo, mas não confie nele.
- **A regra dos 45 segundos.** Se o mesmo comprovante chega novamente **menos de 45 s depois** do original, a resposta é `409 comprovante_em_processamento` com o cabeçalho `Retry-After` (segundos). Significa que a primeira chamada pode ainda estar terminando (por exemplo, enviando o e-mail). **Espere o `Retry-After` e repita**: você receberá `200` com `ja_existia: true`.
- `500 comprovante_inconsistente` quer dizer que o servidor não conseguiu terminar de forma consistente (por exemplo, gravou o comprovante, mas não conseguiu marcar o registro como pago). **A chamada é segura de repetir**: ela conclui o que faltou. Espere alguns segundos e reenvie o mesmo pedido.

## Tratamento de erros

| Situação                                         | O que fazer                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| `401 chave_invalida`                             | Chave errada, revogada ou expirada. Não repita; fale com o administrador |
| `403 escopo_insuficiente`                        | A chave não tem o escopo (`pagamentos:escrever`)                         |
| `403 origem_nao_permitida`                       | A chamada tem cabeçalho `Origin` (veio de navegador?). Chame do servidor |
| `404 registro_nao_encontrado`                    | Confira o UUID                                                           |
| `400` (`parametro_invalido`, `data_pagamento_invalida`, `valor_invalido`, `motivo_obrigatorio`, `arquivo_obrigatorio`, `corpo_invalido`) | Erro do pedido; corrija, não repita igual |
| `413 arquivo_grande` / `payload_grande`          | Arquivo grande demais (máximo 3 MB)                                      |
| `422 arquivo_invalido` / `prestador_sem_email`   | Corrija o arquivo ou cadastre o e-mail do prestador                       |
| `409 registro_sem_relatorio`                     | Limitação atual (acima). Não repita                                      |
| `409 comprovante_em_processamento`               | Espere `Retry-After` e repita                                            |
| `429 limite_excedido`                            | Espere `Retry-After` e repita (padrão: 60 chamadas por minuto)           |
| `500` (`comprovante_inconsistente`, `erro_interno`) e erros de rede | Repita com espera crescente (por exemplo 2 s, 4 s, 8 s) |

Lista completa e formato do erro: [README](README.md#erros).

## Exemplo em Node.js

Node 18 ou superior (usa `fetch` nativo). Marca um registro como pago com o comprovante, com repetição segura.

```js
import { readFile } from 'node:fs/promises'

const BASE = 'https://api.emerlab.com.br'
const CHAVE = process.env.EMERLAB_CHAVE_PAGAMENTOS // emer_pag_… (segredo de servidor)

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

async function chamar(metodo, caminho, corpo, tentativas = 5) {
    for (let i = 0; i < tentativas; i++) {
        const resposta = await fetch(BASE + caminho, {
            method: metodo,
            headers: { Authorization: `Bearer ${CHAVE}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
            body: corpo ? JSON.stringify(corpo) : undefined,
        })
        const dados = resposta.status === 204 ? null : await resposta.json().catch(() => null)
        if (resposta.ok) return { status: resposta.status, dados, total: resposta.headers.get('X-Total-Count') }

        const codigo = dados?.erro?.codigo
        const repetivel =
            resposta.status === 429 || resposta.status >= 500 || codigo === 'comprovante_em_processamento'
        if (!repetivel || i === tentativas - 1) {
            const erro = new Error(dados?.erro?.mensagem || `HTTP ${resposta.status}`)
            erro.codigo = codigo
            erro.status = resposta.status
            throw erro
        }
        const espera = Number(resposta.headers.get('Retry-After')) * 1000 || 2 ** (i + 1) * 1000
        await dormir(espera)
    }
}

async function pagarComComprovante({ registroId, arquivo, nome, dataPagamento, valor }) {
    const bytes = await readFile(arquivo)
    return chamar('POST', `/v1/pagamentos/registros/${registroId}/comprovantes`, {
        arquivo_base64: bytes.toString('base64'),
        nome,
        data_pagamento: dataPagamento,
        valor,
        notificar_prestador: false,
    })
}

// 1) acha os registros do mês ainda não pagos
const lista = await chamar('GET', '/v1/pagamentos/registros?mes=10&ano=2026&pago=false&por_pagina=100')
console.log(`${lista.total} registros a pagar`)

// 2) paga um deles com o comprovante
const registro = lista.dados[0]
try {
    const r = await pagarComComprovante({
        registroId: registro.id,
        arquivo: './comprovante.pdf',
        nome: 'comprovante.pdf',
        dataPagamento: '2026-11-05',
        valor: registro.valor,
    })
    console.log(r.dados.ja_existia ? 'Comprovante já estava lá' : 'Comprovante anexado')
} catch (e) {
    if (e.codigo === 'registro_sem_relatorio') {
        // Limitação atual: marca só como pago e envia o comprovante por outro canal.
        await chamar('POST', `/v1/pagamentos/registros/${registro.id}/pago`, { data_pagamento: '2026-11-05', valor: registro.valor })
    } else {
        throw e
    }
}
```

O exemplo repete em 429, 5xx e `comprovante_em_processamento` (respeitando `Retry-After`) e não repete erros do próprio pedido (400, 404, 413, 422, 409 `registro_sem_relatorio`).
