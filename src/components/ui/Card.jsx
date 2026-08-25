import { cn } from '../../lib/cn'

export function Card({ className, children, ...props }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-line bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#1a2838] md:p-5',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function PageHeader({
  className,
  kicker,
  title,
  description,
  actions,
}) {
  return (
    <header
      className={cn(
        'el-page-header mb-6 flex w-full flex-col gap-4 border-b border-line/70 pb-5 text-left dark:border-white/10 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="el-page-header__text min-w-0 flex-1 text-left">
        {kicker ? (
          <p className="el-page-header__kicker mb-1.5 text-[0.7rem] font-bold uppercase tracking-[0.12em] text-brand">
            {kicker}
          </p>
        ) : null}
        <h1 className="el-page-header__title font-sans text-[1.7rem] font-extrabold leading-tight tracking-tight text-[#123e59] dark:text-[#e8f1f8] md:text-[2rem]">
          {title}
        </h1>
        {description ? (
          <p className="el-page-header__desc mt-2 max-w-2xl text-[0.95rem] font-medium leading-relaxed text-ink-soft dark:text-[#9eb4c8]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="el-page-header__actions flex flex-wrap items-center justify-start gap-2 sm:justify-end">
          {actions}
        </div>
      ) : null}
    </header>
  )
}
