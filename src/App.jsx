import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { DialogosHost } from './components/ui/DialogosHost';
import { SkeletonPagina } from './components/ui/States';
const Layout2 = lazy(() => import('./components/Layout2/Layout2'));
import PrivateRoute from './components/PrivateRoute/PrivateRoute';

// Cada página vira um arquivo próprio: o login e o formulário público não baixam o app inteiro.
const Home = lazy(() => import('./pages/Home/Home'));
const Login = lazy(() => import('./pages/Login/Login'));
const Supertabeladoc = lazy(() => import('./pages/Supertabela/Supertabela_doc/Supertabeladoc'));
const Supertabelamain = lazy(() => import('./pages/Supertabela/Supertabela_main/Supertabelamain'));
const Supertabelacidades = lazy(() => import('./pages/Supertabela/Supertabela_cidades/Supertabelacidades'));
const Supertabelaplanos = lazy(() => import('./pages/Supertabela/Supertabela_planos/Supertabelaplanos'));
const ImpressaoPlanos = lazy(() => import('./pages/Planos/ImpressaoPlanos/ImpressaoPlanos'));
const Supertabelaprocedimentos = lazy(() => import('./pages/Supertabela/Supertabela_procedimentos/Supertabelaprocedimentos'));
const Supertabelanegociacoes = lazy(() => import('./pages/Supertabela/Supertabela_negociacoes/Supertabelanegociacoes'));
/* Credenciamento documentação — inativo por hora
const Credenciamento_doc = lazy(() => import('./pages/Credenciamento/Credenciamento_doc/Credenciamento_doc'));
*/
const CredenciamentoKanban = lazy(() => import('./pages/Credenciamento/CredenciamentoKanban/CredenciamentoKanban'));
/* Credenciamento_main (Processos tabela) substituído pelo Kanban */
const CredenciamentoCadastroLista = lazy(() => import('./pages/Credenciamento/Credenciamento_cadastro/CredenciamentoCadastroLista'));
const CredenciamentoCadastroForm = lazy(() => import('./pages/Credenciamento/Credenciamento_cadastro/CredenciamentoCadastroForm'));
const CredenciamentoMapa = lazy(() => import('./pages/Credenciamento/Credenciamento_mapa/CredenciamentoMapa'));
const CredenciamentoEmerRadar = lazy(() => import('./pages/Credenciamento/Credenciamento_emer_radar/CredenciamentoEmerRadar'));
/* Catálogo OSM legado — rota redireciona para Emer-Radar
const CredenciamentoProspectosOsm = lazy(() => import('./pages/Credenciamento/Credenciamento_prospectos_osm/CredenciamentoProspectosOsm'));
*/
const CredenciamentoImportKmz = lazy(() => import('./pages/Credenciamento/Credenciamento_import_kmz/CredenciamentoImportKmz'));
const CredenciamentoQuemRealiza = lazy(() => import('./pages/Credenciamento/QuemRealiza/CredenciamentoQuemRealiza'));
const CredenciamentoEspecialidadesCidade = lazy(() => import('./pages/Credenciamento/EspecialidadesCidade/CredenciamentoEspecialidadesCidade'));
const CredenciamentoFormularioConfig = lazy(() => import('./pages/Credenciamento/Formulario/CredenciamentoFormularioConfig'));
const CredenciamentoFormularioInbox = lazy(() => import('./pages/Credenciamento/Formulario/CredenciamentoFormularioInbox'));
const CredenciamentoEspecialidadesRc = lazy(() => import('./pages/Credenciamento/EspecialidadesRc/CredenciamentoEspecialidadesRc'));
const CredenciamentoFormularioPublico = lazy(() => import('./pages/Credenciamento/Formulario/CredenciamentoFormularioPublico'));
const ConfigImportarCredenciados = lazy(() => import('./pages/Configuracoes/ImportarCredenciados/ConfigImportarCredenciados'));
const ConfigExportarCredenciados = lazy(() => import('./pages/Configuracoes/ExportarCredenciados/ConfigExportarCredenciados'));
const ConfigConferenciaLaboratorio = lazy(() => import('./pages/Configuracoes/ConferenciaLaboratorio/ConfigConferenciaLaboratorio'));
const ConfigObservacoesHonorarios = lazy(() => import('./pages/Configuracoes/ObservacoesHonorarios/ConfigObservacoesHonorarios'));
const ConfigObservacoesPlanos = lazy(() => import('./pages/Configuracoes/ObservacoesPlanos/ConfigObservacoesPlanos'));
const ConfigImpressaoEtiquetas = lazy(() => import('./pages/Configuracoes/ImpressaoEtiquetas/ConfigImpressaoEtiquetas'));
const GerenciamentoAcessos = lazy(() => import('./pages/Administrativo/GerenciamentoAcessos/GerenciamentoAcessos'));
const AdminAuditoria = lazy(() => import('./pages/Administrativo/Auditoria/AdminAuditoria'));
const AlterarSenha = lazy(() => import('./pages/AlterarSenha/AlterarSenha'));
const ComprasValorVenda = lazy(() => import('./pages/Compras/ValorVenda/ComprasValorVenda'));
const ComprasOrcamento = lazy(() => import('./pages/Compras/Orcamento/ComprasOrcamento'));
const ContratosEmerdog = lazy(() => import('./pages/Contratos/ContratosEmerdog'));
const ClicksignEmerdog = lazy(() => import('./pages/Contratos/ClicksignEmerdog'));
const PagamentosRegistro = lazy(() => import('./pages/Pagamentos/PagamentosRegistro'));
const PagamentosCaixa = lazy(() => import('./pages/Pagamentos/PagamentosCaixa'));
const RepasseMensalPublico = lazy(() => import('./pages/RepasseMensal/RepasseMensalPublico'));
const NotFound = lazy(() => import('./pages/NotFound/NotFound'));
function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <DialogosHost />
      <Suspense fallback={<SkeletonPagina className="mx-auto max-w-3xl" />}>
      <Routes>
        {/* Sem layout */}
        <Route path="/" element={<Login />} />
        {/* Sem PrivateRoute: o link do e-mail cria sessão assíncrona; PrivateRoute
            redirecionava para / antes dos tokens e o Login acabava na home. */}
        <Route path="/alterar-senha" element={<AlterarSenha />} />
        <Route path="/ser_parceiro" element={<CredenciamentoFormularioPublico />} />
        <Route path="/ser-parceiro" element={<Navigate to="/ser_parceiro" replace />} />
        {/* Link único do repasse mensal (sem login): o token é a credencial. */}
        <Route path="/repasse_mensal/:token" element={<RepasseMensalPublico />} />
        <Route path="/credenciamento/cadastro-publico" element={<CredenciamentoFormularioPublico />} />
        <Route path="/credenciamento/cadastro-publico/:slug" element={<CredenciamentoFormularioPublico />} />
        <Route path="/emerzap" element={<Navigate to="/home" replace />} />
        {/* Home pós-login: Layout2 (sidebar) */}
        <Route element={<Layout2 />}>
          <Route
            path="/home"
            element={
              <PrivateRoute>
                <Home />
              </PrivateRoute>
            }
          />
        </Route>
        <Route element={<Layout2 />}>
          <Route
            path="/supertabeladoc"
            element={
              <PrivateRoute permission="supertabela.view" toolId="supertabela.doc">
                <Supertabeladoc />
              </PrivateRoute>
            }
          />
        </Route>
        <Route element={<Layout2 />}>
          <Route
            path="/supertabelamain"
            element={
              <PrivateRoute permission="supertabela.view" toolId="supertabela.main">
                <Supertabelamain />
              </PrivateRoute>
            }
          />
        </Route>
        <Route element={<Layout2 />}>
          <Route
            path="/supertabela/cidades"
            element={
              <PrivateRoute permission="supertabela.view" toolId="supertabela.cidades">
                <Supertabelacidades />
              </PrivateRoute>
            }
          />
        </Route>
        <Route element={<Layout2 />}>
          <Route
            path="/planos/impressao"
            element={
              <PrivateRoute permission="planos.view" toolId="planos.impressao">
                <ImpressaoPlanos />
              </PrivateRoute>
            }
          />
          <Route
            path="/supertabela/planos/impressao"
            element={<Navigate to="/planos/impressao" replace />}
          />
        </Route>
        <Route element={<Layout2 />}>
          <Route
            path="/supertabela/planos"
            element={
              <PrivateRoute permission="supertabela.view" toolId="supertabela.planos">
                <Supertabelaplanos />
              </PrivateRoute>
            }
          />
        </Route>
        <Route element={<Layout2 />}>
          <Route
            path="/supertabela/procedimentos"
            element={
              <PrivateRoute permission="supertabela.view" toolId="supertabela.procedimentos">
                <Supertabelaprocedimentos />
              </PrivateRoute>
            }
          />
        </Route>
        <Route element={<Layout2 />}>
          <Route
            path="/supertabela/negociacoes"
            element={
              <PrivateRoute
                permission="supertabela.view"
                screenPermission="supertabela.negociacoes.view"
                toolId="supertabela.negociacoes"
              >
                <Supertabelanegociacoes />
              </PrivateRoute>
            }
          />
        </Route>
        <Route element={<Layout2 />}>
          <Route
            path="/credenciamento/principal"
            element={
              <PrivateRoute permission="credenciamento.view" toolId="credenciamento.processos">
                <CredenciamentoKanban />
              </PrivateRoute>
            }
          />
          <Route
            path="/credenciamento/cadastro"
            element={
              <PrivateRoute
                permission="credenciamento.view"
                screenPermission="credenciamento.cadastro.view"
                toolId="credenciamento.cadastro"
              >
                <CredenciamentoCadastroLista />
              </PrivateRoute>
            }
          />
          <Route
            path="/credenciamento/cadastro/:id"
            element={
              <PrivateRoute
                permission="credenciamento.view"
                screenPermission="credenciamento.cadastro.view"
                toolId="credenciamento.cadastro"
              >
                <CredenciamentoCadastroForm />
              </PrivateRoute>
            }
          />
          <Route
            path="/credenciamento/emer-radar"
            element={
              <PrivateRoute permission="credenciamento.view" toolId="credenciamento.prospectos_osm">
                <CredenciamentoEmerRadar />
              </PrivateRoute>
            }
          />
          <Route
            path="/credenciamento/prospectos-osm"
            element={<Navigate to="/credenciamento/emer-radar" replace />}
          />
          <Route
            path="/credenciamento/mapa"
            element={
              <PrivateRoute permission="credenciamento.view" toolId="credenciamento.mapa">
                <CredenciamentoMapa />
              </PrivateRoute>
            }
          />
          <Route
            path="/credenciamento/import-kmz"
            element={
              <PrivateRoute permission="credenciamento.view" toolId="credenciamento.import_kmz">
                <CredenciamentoImportKmz />
              </PrivateRoute>
            }
          />
          <Route
            path="/credenciamento/quem-realiza"
            element={
              <PrivateRoute
                permission="credenciamento.view"
                screenPermission="credenciamento.quem_realiza.view"
                toolId="credenciamento.quem_realiza"
              >
                <CredenciamentoQuemRealiza />
              </PrivateRoute>
            }
          />
          <Route
            path="/credenciamento/especialidades-cidade"
            element={
              <PrivateRoute permission="credenciamento.view" toolId="credenciamento.especialidades_cidade">
                <CredenciamentoEspecialidadesCidade />
              </PrivateRoute>
            }
          />
          <Route
            path="/credenciamento/formulario"
            element={
              <PrivateRoute permission="credenciamento.view" toolId="credenciamento.formulario">
                <CredenciamentoFormularioConfig />
              </PrivateRoute>
            }
          />
          <Route
            path="/credenciamento/formulario/entradas"
            element={
              <PrivateRoute
                permission="credenciamento.view"
                screenPermission="credenciamento.formulario.inbox"
                toolId="credenciamento.formulario_inbox"
              >
                <CredenciamentoFormularioInbox />
              </PrivateRoute>
            }
          />
          <Route
            path="/credenciamento/especialidades-rc"
            element={
              <PrivateRoute permission="credenciamento.view" toolId="credenciamento.especialidades_rc">
                <CredenciamentoEspecialidadesRc />
              </PrivateRoute>
            }
          />
          <Route
            path="/configuracoes/importar-credenciados"
            element={
              <PrivateRoute
                permission="credenciamento.view"
                toolId="configuracoes.importar_credenciados"
              >
                <ConfigImportarCredenciados />
              </PrivateRoute>
            }
          />
          <Route
            path="/configuracoes/exportar-credenciados"
            element={
              <PrivateRoute
                permission="credenciamento.view"
                toolId="configuracoes.exportar_credenciados"
              >
                <ConfigExportarCredenciados />
              </PrivateRoute>
            }
          />
          <Route
            path="/configuracoes/conferencia-laboratorio"
            element={
              <PrivateRoute
                permission="credenciamento.view"
                toolId="configuracoes.conferencia_laboratorio"
              >
                <ConfigConferenciaLaboratorio />
              </PrivateRoute>
            }
          />
          <Route
            path="/configuracoes/observacoes-honorarios"
            element={
              <PrivateRoute
                permission="credenciamento.view"
                toolId="configuracoes.observacoes_honorarios"
              >
                <ConfigObservacoesHonorarios />
              </PrivateRoute>
            }
          />
          <Route
            path="/configuracoes/observacoes-planos"
            element={
              <PrivateRoute
                permission="credenciamento.view"
                toolId="configuracoes.observacoes_planos"
              >
                <ConfigObservacoesPlanos />
              </PrivateRoute>
            }
          />
          <Route
            path="/configuracoes/impressao-etiquetas"
            element={
              <PrivateRoute
                permission="credenciamento.view"
                toolId="configuracoes.impressao_etiquetas"
              >
                <ConfigImpressaoEtiquetas />
              </PrivateRoute>
            }
          />
        </Route>
        <Route element={<Layout2 />}>
          <Route
            path="/administrativo/acessos"
            element={
              <PrivateRoute permission="access.manage" toolId="admin.acessos">
                <GerenciamentoAcessos />
              </PrivateRoute>
            }
          />
          <Route
            path="/administrativo/auditoria"
            element={
              <PrivateRoute permission="access.manage" toolId="admin.auditoria">
                <AdminAuditoria />
              </PrivateRoute>
            }
          />
          <Route
            path="/administrativo/qualidade"
            element={<Navigate to="/administrativo/auditoria?aba=qualidade" replace />}
          />
        </Route>
        <Route element={<Layout2 />}>
          <Route
            path="/credenciamentodoc"
            element={<Navigate to="/credenciamento/principal" replace />}
          />
        </Route>
        <Route element={<Layout2 />}>
          <Route
            path="/compras/valor-venda"
            element={
              <PrivateRoute permission="compras.view" toolId="compras.valor_venda">
                <ComprasValorVenda />
              </PrivateRoute>
            }
          />
        </Route>
        <Route element={<Layout2 />}>
          <Route
            path="/compras/orcamento"
            element={
              <PrivateRoute permission="compras.view" toolId="compras.orcamento">
                <ComprasOrcamento />
              </PrivateRoute>
            }
          />
        </Route>
        <Route element={<Layout2 />}>
          <Route
            path="/contratos/gerar"
            element={
              <PrivateRoute permission="contratos.view" toolId="contratos.gerar_pdf">
                <ContratosEmerdog />
              </PrivateRoute>
            }
          />
          <Route
            path="/contratos/clicksign"
            element={
              <PrivateRoute permission="contratos.view" toolId="contratos.clicksign">
                <ClicksignEmerdog />
              </PrivateRoute>
            }
          />
        </Route>
        <Route element={<Layout2 />}>
          <Route
            path="/pagamentos/registro"
            element={
              <PrivateRoute permission="pagamentos.view" toolId="pagamentos.registro">
                <PagamentosRegistro />
              </PrivateRoute>
            }
          />
          {/* O Resumo virou a fila «Aprovados a pagar» do Registro. */}
          <Route path="/pagamentos/resumo" element={<Navigate to="/pagamentos/registro?fila=pagar" replace />} />
          <Route
            path="/pagamentos/caixa"
            element={
              <PrivateRoute permission="pagamentos.view" toolId="pagamentos.caixa">
                <PagamentosCaixa />
              </PrivateRoute>
            }
          />
          <Route path="/pagamentos/cadastro" element={<Navigate to="/pagamentos/registro" replace />} />
          <Route path="/pagamentos/todos" element={<Navigate to="/pagamentos/registro" replace />} />
          <Route path="/pagamentos/pendencias" element={<Navigate to="/pagamentos/registro?fila=pagar" replace />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
export default App


/*
> Fazer Documentações
> Iniciar Super Tabela
> Iniciar Credenciamento
> Iniciar Formulários
> Iniciar Planos
> Iniciar Contratos
> Iniciar Pagamentos
> Iniciar Emercast
*/