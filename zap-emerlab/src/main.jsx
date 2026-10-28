import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.jsx'
import ErroTela from './ErroTela.jsx'
import { aplicarTema, PADRAO } from './tema.js'
import { ler } from './util.js'
import { iniciarDicas } from './dicas.js'

// aplica o tema antes do primeiro render para não "piscar" claro no modo escuro
aplicarTema({ ...PADRAO, ...ler('zap.prefs', {}) })
iniciarDicas()

// Depois de um deploy, a aba aberta pode pedir um arquivo que não existe mais: recarrega uma vez em vez de
// quebrar. A trava de 30 s evita recarregar em loop se o erro for outro.
window.addEventListener('vite:preloadError', (evento) => {
    try {
        const ultimo = Number(sessionStorage.getItem('zap_recarga_deploy') || 0)
        if (Date.now() - ultimo < 30000) return
        sessionStorage.setItem('zap_recarga_deploy', String(Date.now()))
    } catch {
        // sem sessionStorage: recarrega mesmo assim
    }
    evento.preventDefault()
    window.location.reload()
})

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <ErroTela>
            <App />
        </ErroTela>
    </StrictMode>,
)
