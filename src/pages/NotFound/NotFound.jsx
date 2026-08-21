import { Link } from 'react-router-dom'
import './NotFound.css'

const NotFound = () => {
    return (
        <main className="nf">
            <div className="nf_atmosphere" aria-hidden="true" />
            <div className="nf_glow nf_glow--a" aria-hidden="true" />
            <div className="nf_glow nf_glow--b" aria-hidden="true" />

            <p className="nf_watermark" aria-hidden="true">
                404
            </p>

            <div className="nf_stage">
                <p className="nf_brand">EmerLAB</p>
                <h1 className="nf_title">Página não encontrada</h1>
                <p className="nf_lead">
                    Este endereço não existe no Livro de Apoio Base — ou foi movido.
                </p>
                <div className="nf_actions">
                    <Link className="nf_btn nf_btn--primary" to="/home">
                        Ir para a Home
                    </Link>
                    <Link className="nf_btn nf_btn--ghost" to="/">
                        Voltar ao login
                    </Link>
                </div>
            </div>
        </main>
    )
}

export default NotFound
