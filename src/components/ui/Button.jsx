import { buttonClassName } from './buttonStyles'

export { buttonClassName }

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  type = 'button',
  children,
  ...props
}) {
  return (
    <button type={type} className={buttonClassName({ className, variant, size })} {...props}>
      {children}
    </button>
  )
}
