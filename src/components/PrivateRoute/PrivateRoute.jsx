import { Navigate } from 'react-router-dom'

import { useEffect, useState } from 'react'

import {

    hasPermission,

    podeLerFerramenta,

} from '../../lib/accessControl'

import { LEGACY_SCREEN_TO_TOOL } from '../../lib/permissionCatalog'

import { clearAccessState } from '../../lib/supabase'

import { carregarSessaoEPerfilAcesso } from '../../lib/authSession'



const PrivateRoute = ({ children, permission, screenPermission, toolId }) => {

    const [session, setSession] = useState(undefined)

    const [profile, setProfile] = useState(undefined)



    useEffect(() => {

        let ativo = true

        const carregarSessaoEPermissoes = async () => {

            try {

                const { session: sessaoAtual, profile: perfil, error } = await carregarSessaoEPerfilAcesso()

                if (!ativo) return

                setSession(sessaoAtual)

                if (!sessaoAtual?.user?.id) {

                    clearAccessState()

                    setProfile(null)

                    return

                }

                if (error || !perfil) {

                    clearAccessState()

                    setProfile(null)

                    return

                }

                setProfile(perfil)

            } catch {

                if (!ativo) return

                clearAccessState()

                setSession(null)

                setProfile(null)

            }

        }

        void carregarSessaoEPermissoes()

        return () => {

            ativo = false

        }

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

