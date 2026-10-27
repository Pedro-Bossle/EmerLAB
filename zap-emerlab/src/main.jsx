import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.jsx'
import { aplicarTema, PADRAO } from './tema.js'
import { ler } from './util.js'

// aplica o tema antes do primeiro render para não "piscar" claro no modo escuro
aplicarTema({ ...PADRAO, ...ler('zap.prefs', {}) })

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <App />
    </StrictMode>,
)
