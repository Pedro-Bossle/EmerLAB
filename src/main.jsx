import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tailwind.css'
import './styles/global-styles.css'
import './styles/emerlab-kit.css'
import './styles/design-system.css'
import App from './App.jsx'
import ErroTela from './components/ErroTela/ErroTela.jsx'
import MsalAppProvider from './components/Outlook/MsalAppProvider.jsx'
import { instalarRotulosTabelaCartoes } from './lib/tabelaCartoes.js'

instalarRotulosTabelaCartoes()

// Depois de um deploy, a aba aberta pede arquivos de tela (lazy) que não existem mais: recarrega uma vez
// em vez de deixar a página em branco. A trava de 30 s evita recarregar em loop se o erro for outro.
window.addEventListener('vite:preloadError', (evento) => {
  try {
    const ultimo = Number(sessionStorage.getItem('emerlab_recarga_deploy') || 0)
    if (Date.now() - ultimo < 30000) return
    sessionStorage.setItem('emerlab_recarga_deploy', String(Date.now()))
  } catch {
    // sem sessionStorage: recarrega mesmo assim
  }
  evento.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErroTela>
      <MsalAppProvider>
        <App />
      </MsalAppProvider>
    </ErroTela>
  </StrictMode>,
)
