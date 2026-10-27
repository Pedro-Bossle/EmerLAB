import { useState } from 'react'
import Modal from './Modal.jsx'
import { normalizarWaId } from '../util.js'

export default function NovaConversa({ aoFechar, aoAbrir }) {
    const [numero, setNumero] = useState('')
    const digitos = numero.replace(/\D/g, '')
    // sem DDI, assume Brasil
    const bruto = digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos
    const waId = normalizarWaId(bruto)
    const valido = waId.length >= 12 && waId.length <= 15
    const corrigiuNove = valido && bruto !== waId

    return (
        <Modal titulo="Nova conversa" aoFechar={aoFechar}>
            <form
                onSubmit={(e) => {
                    e.preventDefault()
                    if (valido) aoAbrir(waId)
                }}
            >
                <label className="campo">
                    <span>Número do WhatsApp</span>
                    <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="(51) 99999-9999 ou +55 51 99999-9999" inputMode="tel" autoFocus />
                </label>
                {corrigiuNove ? (
                    <p className="ajuda" role="status">
                        Parece celular sem o 9º dígito. Ao abrir, usaremos <strong>{waId}</strong>.
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
