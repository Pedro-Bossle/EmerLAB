import { supabase } from './supabase.js'
import { logoutSessao } from './authSession.js'
import { avisar } from './dialogos.js'

/** Encerra a sessão da pessoa e volta ao login; avisa se a conexão falhar. */
export async function sairDaConta(navigate) {
    await logoutSessao({
        navigate,
        onError: () => avisar({ titulo: 'Não foi possível sair', mensagem: 'Verifique a conexão e tente de novo.' }),
    })
}

/** Envia ao e-mail da própria pessoa o link para criar uma nova senha. */
export async function pedirRedefinicaoDeSenha() {
    const refreshed = await supabase.auth.refreshSession()
    const session = refreshed.data?.session || (await supabase.auth.getSession()).data?.session
    const token = session?.access_token
    if (!token) {
        avisar({ titulo: 'Sua sessão expirou', mensagem: 'Entre de novo para pedir a redefinição de senha.' })
        return
    }
    try {
        const resp = await fetch('/api/admin-users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
                action: 'resetOwnPassword',
                redirectTo: `${window.location.origin}/alterar-senha?from=recovery`,
            }),
        })
        const json = await resp.json().catch(() => ({}))
        if (!resp.ok || json?.ok === false) throw new Error(json?.error || 'Erro ao enviar redefinição de senha')
        avisar({
            titulo: 'E-mail de redefinição enviado',
            mensagem: 'Abra o link que chegou no seu e-mail para criar a nova senha. Confira também a caixa de spam.',
        })
    } catch (error) {
        avisar({ titulo: 'Não foi possível enviar o e-mail', mensagem: error?.message || 'Tente de novo em alguns minutos.' })
    }
}
