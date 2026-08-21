# Checklist migração Tailwind EmerLAB

## Fundação
- [x] Tailwind 3 + PostCSS + Autoprefixer
- [x] Tokens (brand, status, fonts Syne/Manrope)
- [x] cn() + componentes ui/ (Button, Input, Badge, Card, Modal, Drawer, States, ResponsiveTable)
- [x] darkMode via body.dark-mode

## Navegação
- [x] Layout2 Tailwind + sidebar desktop
- [x] Bottom nav mobile (5 hubs) + drawer
- [x] ACL filtrado (permissionCatalog)
- [x] Overlays com padding bottom no mobile

## Rotas shell
- [x] Login, NotFound, Home

## Operações
- [x] Compras (valor venda, orçamento)
- [x] Pagamentos (registro, resumo)
- [x] Contratos (gerar, clicksign)
- [x] Impressão planos

## Credenciamento
- [x] Processos, cadastro lista/form, mapa, prospectos
- [x] Quem realiza, especialidades, KMZ
- [x] Formulário config/inbox/público

## SuperTabela + Config + Admin
- [x] Main, cidades, planos, procedimentos, negociações, doc
- [x] Import/export + Conferência Lab (stack mobile + paginação touch)
- [x] Acessos + Auditoria

## Qualidade
- [x] Build produção OK
- [x] Vitest 47/47 OK
- [x] CSS legado de Layout2/Sidebar/Login/404 removido do bundle global
- [x] Coexistência: CSS de páginas densas mantido até parity total

## Funcionalidades preservadas
- [x] Supabase / PrivateRoute / ACL
- [x] PDF / Clicksign / mapa / uploads / paginação / cópia orçamento / criar user admin
