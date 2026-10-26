// Ícones do Lucide (traço uniforme em grade 24×24), com nomes em português
import {
    ArrowLeft,
    ArrowLeftRight,
    Check,
    CheckCheck,
    ChevronDown,
    CircleAlert,
    CircleCheck,
    Clock,
    Download,
    EllipsisVertical,
    FileText,
    Hourglass,
    Image,
    Inbox,
    Info,
    LayoutTemplate,
    ListFilter,
    Lock,
    LogOut,
    Mail,
    MapPin,
    MessageSquarePlus,
    Mic,
    Moon,
    Paperclip,
    Pencil,
    Plus,
    Reply,
    RotateCcw,
    Search,
    SendHorizontal,
    Settings,
    Shield,
    Smile,
    Sun,
    Trash2,
    User,
    UserPlus,
    Users,
    Video,
    WifiOff,
    X,
    Zap,
} from 'lucide-react'

const ICONES = {
    busca: Search,
    menu: EllipsisVertical,
    novo: MessageSquarePlus,
    enviar: SendHorizontal,
    clipe: Paperclip,
    raio: Zap,
    emoji: Smile,
    voltar: ArrowLeft,
    fechar: X,
    check: Check,
    checkDuplo: CheckCheck,
    relogio: Clock,
    erro: CircleAlert,
    documento: FileText,
    usuario: User,
    pessoaMais: UserPlus,
    transferir: ArrowLeftRight,
    concluir: CircleCheck,
    pendente: Hourglass,
    template: LayoutTemplate,
    engrenagem: Settings,
    escudo: Shield,
    sair: LogOut,
    lua: Moon,
    sol: Sun,
    editar: Pencil,
    lixo: Trash2,
    mais: Plus,
    filtro: ListFilter,
    responder: Reply,
    baixo: ChevronDown,
    tentar: RotateCcw,
    info: Info,
    offline: WifiOff,
    cadeado: Lock,
    vazio: Inbox,
    equipe: Users,
    imagem: Image,
    microfone: Mic,
    video: Video,
    local: MapPin,
    baixar: Download,
    email: Mail,
}

export default function Icone({ nome, tamanho = 22, className, titulo, traco = 2 }) {
    const Comp = ICONES[nome] || Info
    return (
        <Comp
            size={tamanho}
            strokeWidth={traco}
            absoluteStrokeWidth={false}
            className={`icone ${className || ''}`}
            aria-hidden={titulo ? undefined : true}
            role={titulo ? 'img' : undefined}
            aria-label={titulo}
            focusable="false"
        />
    )
}
