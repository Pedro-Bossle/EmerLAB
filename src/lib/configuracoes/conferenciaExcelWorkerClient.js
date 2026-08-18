let workerSingleton = null
let seq = 0

function obterWorker() {
    if (typeof Worker === 'undefined') return null
    if (workerSingleton) return workerSingleton
    try {
        workerSingleton = new Worker(new URL('./conferenciaExcel.worker.js', import.meta.url), {
            type: 'module',
        })
        workerSingleton.addEventListener('error', () => {
            encerrarWorker()
        })
        return workerSingleton
    } catch {
        workerSingleton = null
        return null
    }
}

function encerrarWorker() {
    try {
        workerSingleton?.terminate()
    } catch {
        /* ignore */
    }
    workerSingleton = null
}

async function parsearNaThreadPrincipal(buffer, opts) {
    const { parsearExcelConferenciaLaboratorio } = await import('./conferenciaLaboratorioExcel.js')
    return parsearExcelConferenciaLaboratorio(buffer, opts)
}

function parsearNoWorker(worker, buffer, opts) {
    const id = `xlsx-${Date.now()}-${(seq += 1)}`
    return new Promise((resolve, reject) => {
        const timer = globalThis.setTimeout(() => {
            cleanup()
            reject(new Error('Tempo esgotado ao ler o Excel no worker.'))
        }, 45000)
        const cleanup = () => {
            globalThis.clearTimeout(timer)
            worker.removeEventListener('message', onMessage)
            worker.removeEventListener('error', onError)
        }
        const onMessage = (event) => {
            if (event.data?.id !== id) return
            cleanup()
            if (event.data.ok) resolve(event.data.result)
            else reject(new Error(event.data.error || 'Falha ao ler Excel no worker.'))
        }
        const onError = (err) => {
            cleanup()
            reject(err?.message ? err : new Error('Worker Excel falhou.'))
        }
        worker.addEventListener('message', onMessage)
        worker.addEventListener('error', onError)
        // Sem transfer: o fallback na thread principal ainda precisa do buffer.
        worker.postMessage({ id, buffer, opts })
    })
}

/**
 * Parse Excel na Web Worker; se falhar (ExcelJS no worker / HTML disfarçado de xlsx),
 * tenta de novo na thread principal.
 */
export async function parsearExcelConferenciaViaWorker(buffer, opts = {}) {
    const worker = obterWorker()
    if (!worker) {
        return parsearNaThreadPrincipal(buffer, opts)
    }

    try {
        return await parsearNoWorker(worker, buffer, opts)
    } catch {
        encerrarWorker()
        return parsearNaThreadPrincipal(buffer, opts)
    }
}
