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

// A WATI respondeu "limite": a aba toda espera antes de atualizar de novo (ver usarAtualizacao)
let limiteAte = 0
export const emLimiteWati = () => Date.now() < limiteAte

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
        if (resp.status === 429 || dados.codigo === 'limite') limiteAte = Date.now() + 30000
        throw new ApiError(dados.erro || `Erro ${resp.status}`, resp.status, dados.codigo)
    }
    return dados
}

// nome: como o arquivo aparece ao salvar (a WATI guarda com um UUID)
export const urlMidia = (arquivo, waId, nome) =>
    `/api/media?arquivo=${encodeURIComponent(arquivo)}&waId=${encodeURIComponent(waId || '')}${nome ? `&nome=${encodeURIComponent(nome)}` : ''}`

export function arquivoParaBase64(file) {
    return new Promise((resolve, reject) => {
        const leitor = new FileReader()
        leitor.onload = () => resolve(String(leitor.result))
        leitor.onerror = () => reject(new Error('Não foi possível ler o arquivo.'))
        leitor.readAsDataURL(file)
    })
}
