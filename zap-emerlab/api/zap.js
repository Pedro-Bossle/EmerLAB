// Função serverless única (Vercel). O vercel.json reescreve /api/* → /api/zap?_route=*
import { handle } from '../server/router.js'

export const config = { api: { bodyParser: { sizeLimit: '4.5mb' } } }

export default function handler(req, res) {
    return handle(req, res)
}
