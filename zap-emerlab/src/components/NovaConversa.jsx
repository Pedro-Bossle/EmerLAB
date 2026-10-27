import { useState } from 'react'
import Modal from './Modal.jsx'

/** Celular BR sem o 9º dígito (ex.: 41 9508-9447 → falta o 9). Fixo tem 8 dígitos e começa em 2–5. */
function celularBrSemNove(waId) {
    if (!waId.startsWith('55') || waId.length !== 12) return false
    const resto = waId.slice(4) // após 55 + DDD
    return resto.length === 8 && resto[0] >= '6' && resto[0] <= '9'
}

export default function NovaConversa({ aoFechar, aoAbrir }) {
    const [numero, setNumero] = useState('')
    const digitos = numero.replace(/\D/g, '')
    // sem DDI, assume Brasil
    const waId = digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos
    const valido = waId.length >= 12 && waId.length <= 15
    const faltaNove = valido && celularBrSemNove(waId)
    const waIdCorrigido = faltaNove ? `${waId.slice(0, 4)}9${waId.slice(4)}` : waId

    return (
        <Modal titulo="Nova conversa" aoFechar={aoFechar}>
            <form
                onSubmit={(e) => {
                    e.preventDefault()
                    if (valido) aoAbrir(faltaNove ? waIdCorrigido : waId)
                }}
            >
                <label className="campo">
                    <span>Número do WhatsApp</span>
                    <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="(51) 99999-9999 ou +55 51 99999-9999" inputMode="tel" autoFocus />
                </label>
                {faltaNove ? (
                    <p className="ajuda" role="status">
                        Parece celular sem o 9º dígito. Ao abrir, usaremos <strong>{waIdCorrigido}</strong>.
                    </p>
                ) : (
                    <p className="ajuda">Para iniciar contato com quem não escreveu nas últimas 24h, o WhatsApp exige um template aprovado — o painel vai oferecer essa opção ao abrir.</p>
                )}
                <div className="modal-acoes">
                    <button type="button" className="botao botao-secundario" onClick={aoFechar}>
                        Cancelar
                    </button>
                    <button className="botao" disabled={!valido}>
                        Abrir conversa
                    </button>
                </div>
            </form>
        </Modal>
    )
}
