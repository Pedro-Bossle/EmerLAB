// Chamadas à API do painel (mesma origem, cookie HttpOnly de sessão)

export class ApiError extends Error {
    constructor(message, status, codigo) {
        super(message)
        this.status = status
        this.codigo = codigo || 'requisicao'
    }
}

// Avisa o painel quando o servidor fica inacessível / volta
let aoConexao = () => {}
export function registrarAoConexao(fn) {
    aoConexao = fn
}

let aoExpirar = () => {}
export function registrarAoExpirar(fn) {
    aoExpirar = fn
}

export async function api(caminho, { method = 'GET', body } = {}) {
    let resp
    try {
        resp = await fetch(`/api/${caminho}`, {
            method,
            credentials: 'same-origin',
            headers: {
                ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                ...(method !== 'GET' ? { 'X-Zap': '1' } : {}),
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        })
    } catch {
        aoConexao(false)
        throw new ApiError('Sem conexão com o servidor. Verifique sua internet.', 0, 'sem_conexao')
    }
    aoConexao(true)
    const dados = await resp.json().catch(() => ({}))
    if (!resp.ok) {
        if (resp.status === 401 && !caminho.startsWith('auth/login')) aoExpirar()
        throw new ApiError(dados.erro || `Erro ${resp.status}`, resp.status, dados.codigo)
    }
    return dados
}

export const urlMidia = (arquivo, waId) => `/api/media?arquivo=${encodeURIComponent(arquivo)}&waId=${encodeURIComponent(waId || '')}`

export function arquivoParaBase64(file) {
    return new Promise((resolve, reject) => {
        const leitor = new FileReader()
        leitor.onload = () => resolve(String(leitor.result))
        leitor.onerror = () => reject(new Error('Não foi possível ler o arquivo.'))
        leitor.readAsDataURL(file)
    })
}
