import { cn } from '../../lib/cn'

export function Card({ className, children, ...props }) {
  return (
    <div className={cn('ek-card', className)} {...props}>
      {children}
    </div>
  )
}

/** Cabeçalho de página do UI Kit. `el-page-header` fica como alias das regras legadas (alinhamento à esquerda). */
export function PageHeader({ className, kicker, title, description, actions }) {
  return (
    <header className={cn('ek-page-header el-page-header', className)}>
      <div className="el-page-header__text min-w-0 flex-1">
        {kicker ? <span className="ek-page-header__kicker el-page-header__kicker">{kicker}</span> : null}
        <h1 className="ek-page-header__title el-page-header__title">{title}</h1>
        {description ? <p className="ek-page-header__desc el-page-header__desc">{description}</p> : null}
      </div>
      {actions ? <div className="ek-page-header__actions el-page-header__actions">{actions}</div> : null}
    </header>
  )
}
