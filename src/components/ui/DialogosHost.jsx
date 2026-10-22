import { useEffect, useState } from 'react'
import { registrarHostDialogos } from '../../lib/dialogos'
import { Button } from './Button'
import { Modal } from './Modal'

/** Desenha os pedidos de lib/dialogos.js, um de cada vez. Montar uma vez, perto da raiz. */
export function DialogosHost() {
  const [fila, setFila] = useState([])

  useEffect(() => registrarHostDialogos((pedido) => setFila((atual) => [...atual, pedido])), [])

  const atual = fila[0]
  if (!atual) return null

  const responder = (valor) => {
    atual.resolver(valor)
    setFila((lista) => lista.slice(1))
  }

  const confirmacao = atual.tipo === 'confirmar'
  const footer = confirmacao ? (
    <>
      <Button variant="secondary" onClick={() => responder(false)} className="w-full sm:w-auto">
        {atual.cancelar}
      </Button>
      <Button
        variant={atual.perigo ? 'dangerSolid' : 'primary'}
        onClick={() => responder(true)}
        className="w-full sm:w-auto"
      >
        {atual.confirmar}
      </Button>
    </>
  ) : (
    <Button onClick={() => responder(undefined)} className="w-full sm:w-auto">
      {atual.ok}
    </Button>
  )

  return (
    <Modal open size="sm" title={atual.titulo} onClose={() => responder(confirmacao ? false : undefined)} footer={footer}>
      {atual.mensagem ? (
        <p className="whitespace-pre-line text-base text-ink-soft dark:text-[#c5d6e6]">{atual.mensagem}</p>
      ) : null}
    </Modal>
  )
}
