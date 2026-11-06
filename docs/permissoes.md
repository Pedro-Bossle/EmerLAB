# Permissões e acessos

## Modelo

Cada **ferramenta** do menu (`permissionCatalog.js`, `PERMISSION_CATALOG`) tem até quatro **ações**:
`read` (Ver), `create` (Adicionar), `update` (Editar) e `delete` (Excluir). A chave gravada é
`<ferramenta>.<ação>` (ex.: `credenciamento.cadastro.update`). Só existem as ações que a ferramenta realmente usa.

Existem também ~24 chaves **legadas** (`contratos.view`, `credenciamento.edit`…). Elas são **derivadas** das chaves por
ferramenta (`syncLegacyFromAcl`) e continuam gravadas por compatibilidade com código e RLS antigos. Não edite as
legadas à mão: elas refletem o que as ferramentas permitem.

> As chaves legadas são **amplas** (`contratos.edit` liga se *qualquer* ferramenta de Contratos tiver escrita).
> Por isso o servidor deve autorizar pela **ferramenta** (como o Clicksign faz em
> `src/lib/clicksign/clicksignPermissao.js`), e não pela chave legada.

## Níveis na tela

A tela de acessos usa quatro níveis por ferramenta (`permissoesNiveis.js`):

| Nível | O que liga |
|---|---|
| Sem acesso | nada |
| Ver | `read` |
| Editar | `read` + `create` + `update` (onde a ferramenta suporta) |
| Total | tudo o que a ferramenta suporta, inclusive `delete` |

Uma ferramenta só mostra os níveis que existem para ela (ex.: ferramenta só de leitura não tem «Editar»). O modo
**Avançado** mostra a matriz Ver/Adicionar/Editar/Excluir. Marcações fora dos níveis padrão aparecem como
«Personalizado».

## Gravação

- A tela grava o conjunto **completo**: toda chave ACL fica `true` ou `false` (`sanitizarPermissionsParaSalvar`).
- Um `false` gravado é uma decisão e **é respeitado**. O sistema só infere acesso para chave **ausente**
  (ferramenta criada depois que o perfil foi salvo) e nunca para perfil completo
  (`completarAclFerramentasCredenciamento`).
- «Salvar alterações» é um botão só, mostra o que muda antes de gravar e pede confirmação reforçada para itens
  sensíveis (Gerenciar acessos, Dev Tool, Excluir).
- O servidor recebe `permissionsBefore` (como a tela viu ao abrir) e responde **409** se outra pessoa alterou o perfil
  nesse meio-tempo.
- Ninguém remove de si mesmo «Gerenciar acessos» (tela e servidor).

## Migração dos perfis antigos

Perfis salvos antes desta mudança dependem de herança implícita. Para torná-la explícita **sem alterar o acesso
efetivo de ninguém**:

```bash
node scripts/materializar-permissoes.mjs          # simulação (não grava; não mostra e-mails)
node scripts/materializar-permissoes.mjs --apply  # grava
```

Depois da migração, o administrador pode revisar e revogar o que não faz sentido na tela de acessos.

## Para quem cria uma ferramenta nova

1. Inclua a ferramenta em `PERMISSION_CATALOG` com **somente as ações que o servidor/tela realmente verificam**.
2. No servidor, autorize por `hasAcl(profile.permissions, '<ferramenta>', '<ação>')`.
3. Não crie ação (ex.: «Excluir») que nada verifica: a tela promete algo que não existe.
