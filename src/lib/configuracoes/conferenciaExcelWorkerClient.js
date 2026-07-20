let workerSingleton = null
let seq = 0

function obterWorker() {
    if (typeof Worker === 'undefined') return null
    if (workerSingleton) return workerSingleton
    try {
        workerSingleton = new Worker(new URL('./conferenciaExcel.worker.js', import.meta.url), {
            type: 'module',
        })
        return workerSingleton
    } catch {
        workerSingleton = null
        return null
    }
}

/**
 * Parse Excel na Web Worker; fallback na thread principal se Worker indisponível.
 */
export async function parsearExcelConferenciaViaWorker(buffer, opts = {}) {
    const worker = obterWorker()
    if (!worker) {
        const { parsearExcelConferenciaLaboratorio } = await import('./conferenciaLaboratorioExcel.js')
        return parsearExcelConferenciaLaboratorio(buffer, opts)
    }

    const id = `xlsx-${Date.now()}-${(seq += 1)}`
    return new Promise((resolve, reject) => {
        const onMessage = (event) => {
            if (event.data?.id !== id) return
            worker.removeEventListener('message', onMessage)
            worker.removeEventListener('error', onError)
            if (event.data.ok) resolve(event.data.result)
            else reject(new Error(event.data.error || 'Falha ao ler Excel no worker.'))
        }
        const onError = (err) => {
            worker.removeEventListener('message', onMessage)
            worker.removeEventListener('error', onError)
            reject(err?.message ? err : new Error('Worker Excel falhou.'))
        }
        worker.addEventListener('message', onMessage)
        worker.addEventListener('error', onError)
        // Sem transfer: ExcelJS no worker precisa do buffer intacto no clone estruturado.
        worker.postMessage({ id, buffer, opts })
    })
}
