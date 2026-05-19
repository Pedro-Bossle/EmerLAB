/**
 * Vercel: /api/clicksign/* → mesmo proxy que o Vite usa em dev (clicksign-proxy.js).
 * Ex.: POST /api/clicksign/envelopes
 */
export { default } from '../clicksign-proxy.js'
