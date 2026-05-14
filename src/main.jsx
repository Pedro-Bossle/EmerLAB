import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/responsive-app.css'
import './pages/Supertabela/Supertabela_cidades/Supertabelacidades.css'
import './pages/Supertabela/Supertabela_planos/Supertabelaplanos.css'
import './pages/Supertabela/Supertabela_procedimentos/Supertabelaprocedimentos.css'
import './pages/Supertabela/Supertabela_negociacoes/Supertabelanegociacoes.css'
import './pages/Credenciamento/Credenciamento_main/Credenciamento_main.css'
import './pages/Credenciamento/Credenciamento_doc/Credenciamento_doc.css'
import './pages/Administrativo/GerenciamentoAcessos/GerenciamentoAcessos.css'
import './pages/Compras/ValorVenda/ComprasValorVenda.css'
import './pages/Compras/Orcamento/ComprasOrcamento.css'
import './pages/Contratos/ContratosEmerdog.css'
import './pages/Contratos/ClicksignEmerdog.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
