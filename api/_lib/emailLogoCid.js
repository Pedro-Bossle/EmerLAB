/**
 * Logos embutidos (CID) — Outlook e outros clientes muitas vezes não carregam
 * imagens remotas (redirect 308, Safe Links, bloqueio de conteúdo externo).
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const LOGO_CID = Object.freeze({
    azul: 'emerlab-logo-azul',
    branco: 'emerlab-logo-branco',
})

const FILE_BY_VARIANT = Object.freeze({
    azul: 'logo-azul.png',
    branco: 'logo-branco.png',
})

let cache = null

function resolveLogoDir() {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const candidates = [
        path.resolve(process.cwd(), 'public', 'email'),
        path.resolve(process.cwd(), 'email'),
        // api/_lib → ../../public/email (local + includeFiles no Vercel)
        path.resolve(here, '..', '..', 'public', 'email'),
    ]
    for (const dir of candidates) {
        try {
            if (fs.existsSync(path.join(dir, 'logo-azul.png'))) return dir
        } catch {
            /* next */
        }
    }
    return path.resolve(process.cwd(), 'public', 'email')
}

function loadLogos() {
    if (cache) return cache
    const dir = resolveLogoDir()
    const out = {}
    for (const [variant, file] of Object.entries(FILE_BY_VARIANT)) {
        const full = path.join(dir, file)
        if (!fs.existsSync(full)) {
            throw new Error(`Logo de e-mail não encontrado: ${full}`)
        }
        out[variant] = fs.readFileSync(full)
    }
    cache = out
    return cache
}

/** src=cid:... para <img> no HTML. */
export function emailLogoCidSrc(variant = 'azul') {
    const key = variant === 'branco' ? 'branco' : 'azul'
    return `cid:${LOGO_CID[key]}`
}

/** Anexos inline para Resend (contentId). */
export function getEmailLogoAttachments() {
    const logos = loadLogos()
    return [
        {
            filename: 'logo-branco.png',
            content: logos.branco,
            contentType: 'image/png',
            contentId: LOGO_CID.branco,
        },
        {
            filename: 'logo-azul.png',
            content: logos.azul,
            contentType: 'image/png',
            contentId: LOGO_CID.azul,
        },
    ]
}
