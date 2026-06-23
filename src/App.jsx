import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home/Home';
import Login from './pages/Login/Login';
import Layout from './components/Layout/Layout';
import Layout2 from './components/Layout2/Layout2';
import PrivateRoute from './components/PrivateRoute/PrivateRoute'
import Supertabeladoc from './pages/Supertabela/Supertabela_doc/Supertabeladoc';
import Supertabelamain from './pages/Supertabela/Supertabela_main/Supertabelamain';
import Supertabelacidades from './pages/Supertabela/Supertabela_cidades/Supertabelacidades';
import Supertabelaplanos from './pages/Supertabela/Supertabela_planos/Supertabelaplanos';
import Supertabelaprocedimentos from './pages/Supertabela/Supertabela_procedimentos/Supertabelaprocedimentos';
import Supertabelanegociacoes from './pages/Supertabela/Supertabela_negociacoes/Supertabelanegociacoes';
/* Credenciamento documentação — inativo por hora
import Credenciamento_doc from './pages/Credenciamento/Credenciamento_doc/Credenciamento_doc';
*/
import Credenciamento_main from './pages/Credenciamento/Credenciamento_main/Credenciamento_main';
import CredenciamentoCadastroLista from './pages/Credenciamento/Credenciamento_cadastro/CredenciamentoCadastroLista';
import CredenciamentoCadastroForm from './pages/Credenciamento/Credenciamento_cadastro/CredenciamentoCadastroForm';
import CredenciamentoQuemRealiza from './pages/Credenciamento/QuemRealiza/CredenciamentoQuemRealiza';
import CredenciamentoFormularioConfig from './pages/Credenciamento/Formulario/CredenciamentoFormularioConfig';
import CredenciamentoFormularioInbox from './pages/Credenciamento/Formulario/CredenciamentoFormularioInbox';
import CredenciamentoFormularioPublico from './pages/Credenciamento/Formulario/CredenciamentoFormularioPublico';
import GerenciamentoAcessos from './pages/Administrativo/GerenciamentoAcessos/GerenciamentoAcessos';
import ComprasValorVenda from './pages/Compras/ValorVenda/ComprasValorVenda';
import ComprasOrcamento from './pages/Compras/Orcamento/ComprasOrcamento';
import ContratosEmerdog from './pages/Contratos/ContratosEmerdog';
import ClicksignEmerdog from './pages/Contratos/ClicksignEmerdog';
import PagamentosRegistro from './pages/Pagamentos/PagamentosRegistro';
import NotFound from './pages/NotFound/NotFound';
function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        {/* Sem layout */}
        <Route path="/" element={<Login />} />
        <Route path="/credenciamento/cadastro-publico" element={<CredenciamentoFormularioPublico />} />
        <Route path="/credenciamento/cadastro-publico/:slug" element={<CredenciamentoFormularioPublico />} />
        {/* Com layout */}
        <Route element={<Layout />}>
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
              <PrivateRoute permission="supertabela.view">
                <Supertabeladoc />
              </PrivateRoute>
            }
          />
        </Route>
        <Route element={<Layout2 />}>
          <Route
            path="/supertabelamain"
            element={
              <PrivateRoute permission="supertabela.view">
                <Supertabelamain />
              </PrivateRoute>
            }
          />
        </Route>
        <Route element={<Layout2 />}>
          <Route
            path="/supertabela/cidades"
            element={
              <PrivateRoute permission="supertabela.view">
                <Supertabelacidades />
              </PrivateRoute>
            }
          />
        </Route>
        <Route element={<Layout2 />}>
          <Route
            path="/supertabela/planos"
            element={
              <PrivateRoute permission="supertabela.view">
                <Supertabelaplanos />
              </PrivateRoute>
            }
          />
        </Route>
        <Route element={<Layout2 />}>
          <Route
            path="/supertabela/procedimentos"
            element={
              <PrivateRoute permission="supertabela.view">
                <Supertabelaprocedimentos />
              </PrivateRoute>
            }
          />
        </Route>
        <Route element={<Layout2 />}>
          <Route
            path="/supertabela/negociacoes"
            element={
              <PrivateRoute permission="supertabela.view" screenPermission="supertabela.negociacoes.view">
                <Supertabelanegociacoes />
              </PrivateRoute>
            }
          />
        </Route>
        <Route element={<Layout2 />}>
          <Route
            path="/credenciamento/principal"
            element={
              <PrivateRoute permission="credenciamento.view">
                <Credenciamento_main />
              </PrivateRoute>
            }
          />
          <Route
            path="/credenciamento/cadastro"
            element={
              <PrivateRoute permission="credenciamento.view" screenPermission="credenciamento.cadastro.view">
                <CredenciamentoCadastroLista />
              </PrivateRoute>
            }
          />
          <Route
            path="/credenciamento/cadastro/:id"
            element={
              <PrivateRoute permission="credenciamento.view" screenPermission="credenciamento.cadastro.view">
                <CredenciamentoCadastroForm />
              </PrivateRoute>
            }
          />
          <Route
            path="/credenciamento/quem-realiza"
            element={
              <PrivateRoute permission="credenciamento.view" screenPermission="credenciamento.quem_realiza.view">
                <CredenciamentoQuemRealiza />
              </PrivateRoute>
            }
          />
          <Route
            path="/credenciamento/formulario"
            element={
              <PrivateRoute permission="credenciamento.view">
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
              >
                <CredenciamentoFormularioInbox />
              </PrivateRoute>
            }
          />
        </Route>
        <Route element={<Layout2 />}>
          <Route
            path="/administrativo/acessos"
            element={
              <PrivateRoute permission="access.manage">
                <GerenciamentoAcessos />
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
              <PrivateRoute permission="compras.view">
                <ComprasValorVenda />
              </PrivateRoute>
            }
          />
        </Route>
        <Route element={<Layout2 />}>
          <Route
            path="/compras/orcamento"
            element={
              <PrivateRoute permission="compras.view">
                <ComprasOrcamento />
              </PrivateRoute>
            }
          />
        </Route>
        <Route element={<Layout2 />}>
          <Route
            path="/contratos/gerar"
            element={
              <PrivateRoute permission="contratos.view">
                <ContratosEmerdog />
              </PrivateRoute>
            }
          />
          <Route
            path="/contratos/clicksign"
            element={
              <PrivateRoute permission="contratos.view">
                <ClicksignEmerdog />
              </PrivateRoute>
            }
          />
        </Route>
        <Route element={<Layout2 />}>
          <Route
            path="/pagamentos/registro"
            element={
              <PrivateRoute permission="pagamentos.view">
                <PagamentosRegistro />
              </PrivateRoute>
            }
          />
          <Route path="/pagamentos/cadastro" element={<Navigate to="/pagamentos/registro" replace />} />
          <Route path="/pagamentos/todos" element={<Navigate to="/pagamentos/registro" replace />} />
          <Route path="/pagamentos/pendencias" element={<Navigate to="/pagamentos/registro" replace />} />
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