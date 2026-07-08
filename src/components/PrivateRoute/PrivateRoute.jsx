import { Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
    hasPermission,
    normalizarProfileAcesso,
    setStoredAccessProfile,
    usuarioSomenteLeituraGlobal,
    podeLerFerramenta,
} from '../../lib/accessControl'
import { LEGACY_SCREEN_TO_TOOL } from '../../lib/permissionCatalog'
import { clearAccessState, supabase, setReadOnlyFlag } from '../../lib/supabase'

const PrivateRoute = ({ children, permission, screenPermission, toolId }) => {
    const [session, setSession] = useState(undefined)
    const [profile, setProfile] = useState(undefined)

    useEffect(() => {
        const carregarSessaoEPermissoes = async () => {
            const { data } = await supabase.auth.getSession()
            const sessaoAtual = data.session
            setSession(sessaoAtual)
            if (!sessaoAtual?.user?.id) {
                clearAccessState()
                setProfile(null)
                return
            }
            let { data: profileData, error } = await supabase
                .from('profiles')
                .select('id, name, email, credenciamento_read_only, permissions')
                .eq('id', sessaoAtual.user.id)
                .single()
            if (error && String(error.message || '').includes('email')) {
                const fallback = await supabase
                    .from('profiles')
                    .select('id, name, credenciamento_read_only, permissions')
                    .eq('id', sessaoAtual.user.id)
                    .single()
                profileData = fallback.data
                error = fallback.error
            }
            if (error) {
                clearAccessState()
                setProfile(null)
                return
            }
            const perfilNormalizado = normalizarProfileAcesso(profileData)
            setStoredAccessProfile(perfilNormalizado)
            setReadOnlyFlag(usuarioSomenteLeituraGlobal(perfilNormalizado))
            setProfile(perfilNormalizado)
        }
        carregarSessaoEPermissoes()
    }, [])

    if (session === undefined) return <p>Carregando...</p>
    if (!session) return <Navigate to="/" replace />
    if ((permission || screenPermission || toolId) && profile === undefined) return <p>Carregando...</p>
    if (permission && (!profile || !hasPermission(profile, permission))) return <Navigate to="/home" replace />
    if (screenPermission && (!profile || !hasPermission(profile, screenPermission))) {
        return <Navigate to="/home" replace />
    }
    const toolParaLer = toolId || (screenPermission && LEGACY_SCREEN_TO_TOOL[screenPermission])
    if (toolParaLer && (!profile || !podeLerFerramenta(profile.permissions, toolParaLer))) {
        return <Navigate to="/home" replace />
    }

    return children
}

export default PrivateRoute