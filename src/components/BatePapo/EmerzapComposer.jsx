import React, { useEffect, useRef, useState } from 'react'

const EMOJIS = [
  '😀',
  '😁',
  '😂',
  '🤣',
  '😊',
  '😍',
  '😘',
  '😎',
  '🤩',
  '🥳',
  '😢',
  '😭',
  '😮',
  '😤',
  '👍',
  '👎',
  '👏',
  '🙏',
  '💪',
  '🔥',
  '✨',
  '🎉',
  '❤️',
  '💔',
  '✅',
  '❌',
  '📌',
  '💡',
  '📷',
  '🐶',
]

const LINE_PX = 22
const MAX_LINES = 3
const PAD_Y = 16

function IconFoto({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="9" cy="10.5" r="1.6" fill="currentColor" />
      <path
        d="M5.5 16.5 9.2 12.8a1.2 1.2 0 0 1 1.7 0l2.1 2.1 2.4-2.8a1.2 1.2 0 0 1 1.9.1L18.5 16.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconEmoji({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="9.2" cy="10.2" r="1.15" fill="currentColor" />
      <circle cx="14.8" cy="10.2" r="1.15" fill="currentColor" />
      <path
        d="M8.6 14.2c1.1 1.35 2.5 2 3.4 2s2.3-.65 3.4-2"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * Composer partilhado (web + gaveta): emoji, imagem, multilinha até 3 linhas.
 */
export default function EmerzapComposer({
  variant = 'web',
  texto,
  onTextoChange,
  previewImg,
  onPreviewChange,
  enviando,
  onSubmit,
  fileRef: fileRefProp,
  inputRef: inputRefProp,
  maxLength = 2000,
}) {
  const fileRefLocal = useRef(null)
  const inputRefLocal = useRef(null)
  const fileRef = fileRefProp || fileRefLocal
  const inputRef = inputRefProp || inputRefLocal
  const [emojiAberto, setEmojiAberto] = useState(false)
  const emojiWrapRef = useRef(null)

  const isWeb = variant === 'web'
  const cx = (suffix) => (isWeb ? `emerzap_web_${suffix}` : `bate_papo_float_${suffix}`)
  const iconSize = isWeb ? 20 : 18

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const maxH = LINE_PX * MAX_LINES + PAD_Y
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`
  }, [texto, inputRef])

  useEffect(() => {
    if (!emojiAberto) return undefined
    const onDoc = (e) => {
      if (emojiWrapRef.current?.contains(e.target)) return
      setEmojiAberto(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [emojiAberto])

  const inserirEmoji = (em) => {
    const next = `${texto || ''}${em}`.slice(0, maxLength)
    onTextoChange(next)
    setEmojiAberto(false)
    queueMicrotask(() => inputRef.current?.focus())
  }

  return (
    <>
      {previewImg ? (
        <div className={cx('preview')}>
          <img src={previewImg.url} alt="" />
          <button
            type="button"
            onClick={() => {
              URL.revokeObjectURL(previewImg.url)
              onPreviewChange(null)
            }}
          >
            Remover
          </button>
        </div>
      ) : null}

      <form
        className={isWeb ? 'emerzap_web_composer' : 'bate_papo_float_form'}
        onSubmit={(e) => {
          void onSubmit(e)
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            onPreviewChange({ file: f, url: URL.createObjectURL(f) })
          }}
        />

        <div className={`${cx('composer_tools')}${emojiAberto ? ' is-emoji-open' : ''}`} ref={emojiWrapRef}>
          <button
            type="button"
            className={cx('anexo')}
            aria-label="Anexar imagem"
            onClick={() => fileRef.current?.click()}
          >
            <IconFoto size={iconSize} />
          </button>
          <button
            type="button"
            className={`${cx('emoji_btn')}${emojiAberto ? ' is-active' : ''}`}
            aria-label="Emojis"
            aria-expanded={emojiAberto}
            onClick={() => setEmojiAberto((v) => !v)}
          >
            <IconEmoji size={iconSize} />
          </button>
          {emojiAberto ? (
            <div className={cx('emoji_menu')} role="listbox" aria-label="Escolher emoji">
              {EMOJIS.map((em) => (
                <button key={em} type="button" className={cx('emoji_item')} onClick={() => inserirEmoji(em)}>
                  {em}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <textarea
          ref={inputRef}
          className={cx('input')}
          placeholder="Mensagem"
          value={texto}
          rows={1}
          onChange={(e) => onTextoChange(e.target.value.slice(0, maxLength))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              e.currentTarget.form?.requestSubmit()
            }
          }}
          disabled={enviando}
          maxLength={maxLength}
        />
        <button
          type="submit"
          className={cx('enviar')}
          disabled={enviando || (!String(texto || '').trim() && !previewImg)}
        >
          Enviar
        </button>
      </form>
    </>
  )
}
