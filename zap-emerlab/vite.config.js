import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiPort = Number(process.env.ZAP_API_PORT || 3001)

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5174,
        proxy: {
            '/api': `http://127.0.0.1:${apiPort}`,
        },
    },
})
