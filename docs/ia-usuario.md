# IA no EmerLAB — guia do utilizador

A IA (Gemini, Google) ajuda a **sugerir estabelecimentos veterinários e pet** para o catálogo de prospectos. A chave da Google fica no servidor: o browser nunca a recebe.

## Onde usar

**Credenciamento → Catálogo de prospectos** (`/credenciamento/prospectos-osm`).

É preciso ter permissão para ver essa ferramenta. Sem ela, a tela indica que não há acesso.

## Prospectar uma cidade

1. Escolha **UF** e **cidade**.
2. (Opcional) Filtre categorias na lista já gravada.
3. Clique em **Prospectar**.

A IA devolve até **20 estabelecimentos reais** da cidade (clínicas veterinárias, pet shops, banho e tosa, hospedagem pet). Os nomes e endereços entram na tabela. O **mapa** usa Nominatim só para colocar o pin — não é uma busca OpenStreetMap/Overpass.

Cada coleta pode demorar até alguns minutos. Quando termina, aparece quantos locais foram atualizados.

## Chip de uso (barra de filtros)

Junto da pesquisa / Prospectar aparece algo como:

`Gemini 12/20 RPM · 80/1000 hoje`

- **RPM** — pedidos neste servidor **neste minuto**, face ao limite do plano.
- **hoje** — pedidos **neste dia** (o dia da Google AI Studio fecha à meia-noite no horário do Pacífico).

Isto **não** é a quota exacta da conta Google Cloud. É o que o EmerLAB conta neste processo.

Se o chip mostrar 0 restantes ou a coleta falhar por cota / rate limit, espere um pouco e tente de novo.

## O que a IA não faz

- Não envia a chave da Google para o seu computador.
- Se a IA falhar, **não** passa automaticamente para OpenStreetMap. A coleta fica por concluir até haver cota ou o serviço voltar.
- Não inventa coordenadas: se o endereço não geocodificar, o local pode aparecer na lista sem pin no mapa.

## AI Test (só Dev Tool)

Quem tem a permissão **Dev Tool** vê **AI Test** no menu (`/aitest`): um playground para enviar um prompt e ver a resposta do modelo. Serve para confirmar que a API está configurada. **Não** substitui a tela de prospectos.

## Problemas frequentes

| Situação | O que fazer |
| --- | --- |
| “Selecione a cidade para prospectar.” | Escolha UF e cidade antes de Prospectar. |
| Coleta falhou / Gemini indisponível | Tente mais tarde; pode ser sobrecarga ou limite do plano. |
| Chip em 0 RPM ou 0 hoje | Limite atingido neste servidor — aguarde o minuto ou o dia. |
| Locais sem pin no mapa | O endereço não foi geocodificado; o registo na lista continua válido. |
| Sem permissão | Peça acesso à ferramenta de prospectos (ou Dev Tool, no caso do AI Test). |
