/**
 * Web Worker: parse de .xlsx da conferência (ExcelJS fora da thread UI).
 */
import { parsearExcelConferenciaLaboratorio } from './conferenciaLaboratorioExcel.js'

self.onmessage = async (event) => {
    const { id, buffer, opts } = event.data || {}
    try {
        const result = await parsearExcelConferenciaLaboratorio(buffer, opts || {})
        self.postMessage({ id, ok: true, result })
    } catch (e) {
        self.postMessage({ id, ok: false, error: e?.message || String(e) })
    }
}
