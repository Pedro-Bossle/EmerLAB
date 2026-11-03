# EmerLAB UI Kit

Padrão visual único para as telas do EmerLAB.

| O quê | Onde |
|---|---|
| CSS (tokens e componentes) | `src/styles/emerlab-kit.css` (já importado em `src/main.jsx`) |
| Regra do Cursor | `.cursor/rules/emerlab-ui-kit.mdc` (ativa ao editar `src/**/*.jsx` e `src/**/*.css`) |

Tudo é prefixado (`--ek-*`, `.ek-*`). **Importar o kit não muda nenhuma tela existente.** As telas passam a seguir o padrão à medida que forem migradas (§9).

---

## 1. Por que existe

O app tem dois sistemas visuais convivendo:

- **Componentes novos** (`src/components/ui`, Tailwind): campos de 44 px, botões em pílula, cores de `tailwind.config.js`.
- **CSS legado por tela** (`pag_reg_*`, `supertabela*_filters`, `compras_*`…):
  - campos de cerca de 36 px;
  - raios de 4, 6, 7, 8, 9, 10, 12 e 14 px;
  - blur de 4, 6, 8, 10 e 14 px;
  - 13 breakpoints diferentes;
  - rótulos ora centralizados, ora à esquerda;
  - quatro tons de fundo no modo escuro.

Exemplo: a barra de filtros de **Supertabela › Planos** tem os rótulos centralizados, e a de **Supertabela › Main** os tem à esquerda. As alturas de campo, checkbox e segmentado também são diferentes. O kit resolve isso com uma regra só para cada coisa.

---

## 2. Decisões

| Tema | Padrão |
|---|---|
| Rótulo de campo | em cima, **à esquerda**, 13 px, peso 600, sem caixa alta |
| Título de barra ("Filtros") | dentro da barra, 13 px, caixa alta, cinza |
| Altura de controle | **40 px** (44 px em tela de toque), igual para campo, select, dropdown, botão, checkbox-chip e segmentado |
| Ação dentro de tabela | 32 px (`ek-btn--sm`) |
| Raio | controle 10 · card, barra e tabela 14 · modal 16 · pílula só em badge |
| Espaços | 4 · 8 · 12 · 16 · 24 · 32 |
| Laterais da página | 16 (celular) · 24 (tablet) · 32 (desktop) · largura máx. 1600 |
| Blur | só em barra fixa (12 px + saturação) e fundo de modal (4 px). Painel de dropdown é opaco |
| Breakpoints | 639 px (celular) e 1023 px (tablet) |
| Fonte | Manrope; Syne só no título da página |
| Cores | as de `tailwind.config.js` (`brand #1a6fa3`, `ink #142033`…) |

---

## 3. Tokens

### Cores

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--ek-brand` | `#1a6fa3` | `#4fa6dc` | botão principal, seleção |
| `--ek-brand-deep` | `#165f8c` | `#3b93cb` | hover do principal |
| `--ek-brand-pale` | `#e7f4fc` | `#16324a` | hover de opção, botão suave, trilho do segmentado |
| `--ek-ink` | `#142033` | `#e8f1f8` | texto principal |
| `--ek-ink-soft` | `#3d5168` | `#b9cadb` | rótulos, células |
| `--ek-ink-muted` | `#5a7488` | `#9eb4c8` | dicas, títulos de barra |
| `--ek-page` | `#f4f8fb` | `#0d1520` | fundo da página |
| `--ek-surface` | `#ffffff` | `#121c2a` | cards, tabelas, modal, dropdown |
| `--ek-surface-tint` | `#f7fbfe` | `#152433` | barra de filtros |
| `--ek-field` | `#ffffff` | `#0f1e2e` | campos |
| `--ek-line` / `--ek-line-strong` | `#d8e6ef` / `#bfd7e8` | branco 10% / 18% | bordas |
| `--ek-th-bg` | `#1e3148` | `#0b1622` | cabeçalho de tabela |
| `--ek-ok` / `-bg` | `#0a7a4a` / `#e8f8ef` | `#8fd9a8` / `#163a26` | sucesso |
| `--ek-warn` / `-bg` | `#a16207` / `#fef6e7` | `#e8cf7a` / `#3a3218` | atenção |
| `--ek-erro` / `-bg` | `#b91c1c` / `#fef2f2` | `#f2a5a5` / `#3d1c1f` | erro |
| `--ek-info` / `-bg` | `#1f7eb8` / `#e8f4fc` | `#9fd0f2` / `#16324a` | informação |

O modo escuro usa o mesmo seletor do app (`body.dark-mode`), e todas as variáveis trocam sozinhas. **Não escreva `body.dark-mode .x { color: … }` em tela nova.**

### Medidas

`--ek-control-h` 40 px · `--ek-control-h-sm` 32 px · `--ek-touch` 44 px · `--ek-r-control` 10 px · `--ek-r-card` 14 px · `--ek-r-modal` 16 px · `--ek-gutter` 16/24/32 px · `--ek-s1…s6` 4…32 px.

### Camadas

sticky 20 · sidebar 30 · nav 40 · dropdown 60 · drawer 80 · modal 90 · toast 100 (iguais ao `tailwind.config.js`).

---

## 4. Página

```html
<main class="ek-page">
  <header class="ek-page-header">
    <div>
      <span class="ek-page-header__kicker">Supertabela</span>
      <h1 class="ek-page-header__title">Planos</h1>
      <p class="ek-page-header__desc">Valores de procedimentos por cidade, plano e tamanho.</p>
    </div>
    <div class="ek-page-header__actions">…botões…</div>
  </header>
  …
</main>
```

- Título sempre à esquerda.
- No celular, as ações do cabeçalho ocupam a largura toda e dividem o espaço.
- O espaço inferior já desconta a barra de navegação inferior (4,25 rem).

---

## 5. Barra de filtros (menu flutuante)

```html
<section class="ek-toolbar ek-toolbar--sticky">
  <h2 class="ek-toolbar__title">Filtros</h2>
  <div class="ek-toolbar__row">
    <label class="ek-field ek-field--grow">…Busca…</label>
    <div class="ek-field">…Cidade (ek-dropdown)…</div>
    <label class="ek-field">…Plano (ek-select)…</label>
    <div class="ek-toolbar__actions">…ek-check / ek-btn / ek-segmented…</div>
  </div>
</section>
```

- `ek-toolbar--sticky` gruda no topo com fundo de vidro (`--ek-glass` + `--ek-blur`). Com `.is-stuck`, ganha sombra e fica mais baixa (ver o snippet do IntersectionObserver na regra do Cursor). Abaixo de um cabeçalho fixo, use `--ek-sticky-top`.
- Itens alinham pela base: rótulo em cima, controle embaixo, todos com a mesma altura.
- Larguras: `ek-field` (padrão, mínimo 180 px), `ek-field--grow` (busca) e `ek-field--fixed` (conteúdo).
- No tablet, dois campos por linha. No celular, um por linha; checkbox-chips e botões dividem a linha em dois; o segmentado ocupa a largura toda.

---

## 6. Controles

| Componente | Classe | Observação |
|---|---|---|
| Campo de texto | `ek-input` | `aria-invalid="true"` deixa a borda vermelha |
| Busca | `ek-search` > `ek-search__icon` + `ek-input` (+ `ek-search__clear`) | |
| Select nativo | `ek-select` | seta igual à do dropdown |
| Texto longo | `ek-textarea` | |
| Dropdown com busca e grupos | `ek-dropdown` (`__trigger`, `__panel`, `__search`, `__group`, `__option`, `__empty`) | `.is-open`, `.is-selected`, `.is-active`; no celular vira folha inferior |
| Botão | `ek-btn` + `--secondary` · `--soft` · `--ghost` · `--danger` · `--success` · `--sm` · `--icon` · `--block` | |
| Checkbox como controle | `ek-check` | fica azul quando marcado ("Ativar edição", "Adição em massa") |
| Alternador | `ek-segmented` > `ek-segmented__opt[aria-pressed]` | "Visualização: Ver diferenças / Carências e limites" |
| Rótulo / dica / erro | `ek-label` · `ek-hint` · `ek-error` | |

Quando usar cada botão:

- **principal** (`ek-btn`): uma ação por área;
- **secundário**: Exportar, Cancelar;
- **suave** (`--soft`): ferramentas da tela, como "Gerenciar tabelas";
- **fantasma** (`--ghost`): ícones e ações discretas;
- **perigo** (`--danger`): excluir.

---

## 7. Conteúdo

- **Card:** `ek-card` (+ `ek-card__title`).
- **Tabela:** `ek-table-wrap` > `ek-table`. Cabeçalho escuro e fixo, linhas zebradas, `ek-num` para valores. Com `ek-table--stack` e `td[data-label]`, a tabela vira lista de cartões no celular.
- **Status:** `ek-badge` + `--ok` · `--warn` · `--erro` · `--info`.
- **Aviso:** `ek-banner` + `--ok` · `--warn` · `--erro`.
- **Vazio:** `ek-empty`.
- **Modal:** `ek-modal-overlay` > `ek-modal` (`--lg`) > `__head` · `__body` · `__foot`. No celular vira folha inferior.

---

## 8. Mobile

| Largura | Comportamento |
|---|---|
| ≥ 1024 px | layout completo, laterais de 32 px |
| 640–1023 px | laterais de 24 px, filtros dois por linha, ações da barra numa linha própria |
| < 640 px | laterais de 16 px, um campo por linha, dropdown e modal como folha inferior, tabelas `--stack` como cartões, título 22 px |
| tela de toque | controles com 44 px de altura e opções do dropdown com 44 px |

A página nunca rola na horizontal. Só a tabela rola dentro do `ek-table-wrap`.

---

## 9. Migração das telas legadas

1. Trocar o contêiner da tela (`.pag_reg`, `.supertabelaplanos`…) por `ek-page` e o título por `ek-page-header`.
2. Trocar a barra de filtros pela `ek-toolbar` (tabela de equivalência na regra do Cursor).
3. Trocar botões, campos, checkbox e alternadores pelas classes do kit.
4. Apagar do CSS da tela o que ficou sem uso, inclusive as regras dela em `responsive-app.css`.
5. Conferir nos modos claro e escuro, em 1280 px e 390 px.

Ordem sugerida (telas mais usadas e mais divergentes primeiro): Supertabela (Main, Planos, Cidades, Procedimentos) → Pagamentos (Registro, Resumo) → Credenciamento → Compras.

`src/components/ui` (Button, Input, Select…) continua valendo. Num passo seguinte, ele pode passar a usar as mesmas medidas do kit (40 px e raio 10), para que componentes novos e telas migradas fiquem idênticos.
