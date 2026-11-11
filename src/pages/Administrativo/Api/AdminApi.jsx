import React, { useState } from 'react'
import { PageHeader } from '../../../components/ui'
import AdminApiChaves from './AdminApiChaves.jsx'
import AdminApiTestar from './AdminApiTestar.jsx'
import './AdminApi.css'

const ABAS = [
    { id: 'chaves', rotulo: 'Chaves' },
    { id: 'testar', rotulo: 'Testar' },
]

export default function AdminApi() {
    const [aba, setAba] = useState('chaves')

    return (
        <div className="el-page admin_api">
            <PageHeader
                kicker="Administrativo"
                title="API"
                description="Chaves da API pública do EmerLAB (rede credenciada e pagamentos) e um console para testar as rotas."
            />
            <div className="ek-segmented admin_api_abas" role="group" aria-label="Seções da API">
                {ABAS.map((a) => (
                    <button
                        key={a.id}
                        type="button"
                        className={`ek-segmented__opt${aba === a.id ? ' is-active' : ''}`}
                        aria-pressed={aba === a.id}
                        onClick={() => setAba(a.id)}
                    >
                        {a.rotulo}
                    </button>
                ))}
            </div>
            {/* Trocar de aba desmonta o painel: a chave digitada no testador some do estado. */}
            {aba === 'chaves' ? <AdminApiChaves /> : <AdminApiTestar />}
        </div>
    )
}
