import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home/Home';
import Login from './pages/Login/Login';
import Layout2 from './components/Layout2/Layout2';
import PrivateRoute from './components/PrivateRoute/PrivateRoute'
import Supertabeladoc from './pages/Supertabela/Supertabela_doc/Supertabeladoc';
import Supertabelamain from './pages/Supertabela/Supertabela_main/Supertabelamain';
import Supertabelacidades from './pages/Supertabela/Supertabela_cidades/Supertabelacidades';
import Supertabelaplanos from './pages/Supertabela/Supertabela_planos/Supertabelaplanos';
import ImpressaoPlanos from './pages/Planos/ImpressaoPlanos/ImpressaoPlanos';
import Supertabelaprocedimentos from './pages/Supertabela/Supertabela_procedimentos/Supertabelaprocedimentos';
import Supertabelanegociacoes from './pages/Supertabela/Supertabela_negociacoes/Supertabelanegociacoes';
/* Credenciamento documentação — inativo por hora
import Credenciamento_doc from './pages/Credenciamento/Credenciamento_doc/Credenciamento_doc';
*/
import Credenciamento_main from './pages/Credenciamento/Credenciamento_main/Credenciamento_main';
import CredenciamentoCadastroLista from './pages/Credenciamento/Credenciamento_cadastro/CredenciamentoCadastroLista';
import CredenciamentoCadastroForm from './pages/Credenciamento/Credenciamento_cadastro/CredenciamentoCadastroForm';
import CredenciamentoMapa from './pages/Credenciamento/Credenciamento_mapa/CredenciamentoMapa';
import CredenciamentoProspectosOsm from './pages/Credenciamento/Credenciamento_prospectos_osm/CredenciamentoProspectosOsm';
import CredenciamentoImportKmz from './pages/Credenciamento/Credenciamento_import_kmz/CredenciamentoImportKmz';
import CredenciamentoQuemRealiza from './pages/Credenciamento/QuemRealiza/CredenciamentoQuemRealiza';
import CredenciamentoEspecialidadesCidade from './pages/Credenciamento/EspecialidadesCidade/CredenciamentoEspecialidadesCidade';
import CredenciamentoFormularioConfig from './pages/Credenciamento/Formulario/CredenciamentoFormularioConfig';
import CredenciamentoFormularioInbox from './pages/Credenciamento/Formulario/CredenciamentoFormularioInbox';
import CredenciamentoEspecialidadesRc from './pages/Credenciamento/EspecialidadesRc/CredenciamentoEspecialidadesRc';
import CredenciamentoFormularioPublico from './pages/Credenciamento/Formulario/CredenciamentoFormularioPublico';
import ConfigImportarCredenciados from './pages/Configuracoes/ImportarCredenciados/ConfigImportarCredenciados';
import ConfigExportarCredenciados from './pages/Configuracoes/ExportarCredenciados/ConfigExportarCredenciados';
import ConfigConferenciaLaboratorio from './pages/Configuracoes/ConferenciaLaboratorio/ConfigConferenciaLaboratorio';
import GerenciamentoAcessos from './pages/Administrativo/GerenciamentoAcessos/GerenciamentoAcessos';
import AdminAuditoria from './pages/Administrativo/Auditoria/AdminAuditoria';
import AiTest from './pages/AiTest/AiTest';
import ComprasValorVenda from './pages/Compras/ValorVenda/ComprasValorVenda';
import ComprasOrcamento from './pages/Compras/Orcamento/ComprasOrcamento';
import ContratosEmerdog from './pages/Contratos/ContratosEmerdog';
import ClicksignEmerdog from './pages/Contratos/ClicksignEmerdog';
import PagamentosRegistro from './pages/Pagamentos/PagamentosRegistro';
import PagamentosResumo from './pages/Pagamentos/PagamentosResumo';
import NotFound from './pages/NotFound/NotFound';
function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        {/* Sem layout */}
        <Route path="/" element={<Login />} />
        <Route path="/ser_parceiro" element={<CredenciamentoFormularioPublico />} />
        <Route path="/ser-parceiro" element={<Navigate to="/ser_parceiro" replace />} />
        <Route path="/credenciamento/cadastro-publico" element={<CredenciamentoFormularioPublico />} />
        <Route path="/credenciamento/cadastro-publico/:slug" element={<CredenciamentoFormularioPublico />} />
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
                <Credenciamento_main />
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
            path="/credenciamento/prospectos-osm"
            element={
              <PrivateRoute permission="credenciamento.view" toolId="credenciamento.prospectos_osm">
                <CredenciamentoProspectosOsm />
              </PrivateRoute>
            }
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
            path="/aitest"
            element={
              <PrivateRoute permission="dev.tools">
                <AiTest />
              </PrivateRoute>
            }
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
          <Route
            path="/pagamentos/resumo"
            element={
              <PrivateRoute permission="pagamentos.view" toolId="pagamentos.resumo">
                <PagamentosResumo />
              </PrivateRoute>
            }
          />
          <Route path="/pagamentos/cadastro" element={<Navigate to="/pagamentos/registro" replace />} />
          <Route path="/pagamentos/todos" element={<Navigate to="/pagamentos/registro" replace />} />
          <Route path="/pagamentos/pendencias" element={<Navigate to="/pagamentos/resumo" replace />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
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