import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global-styles.css'
import App from './App.jsx'
import MsalAppProvider from './components/Outlook/MsalAppProvider.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MsalAppProvider>
      <App />
    </MsalAppProvider>
  </StrictMode>,
)
