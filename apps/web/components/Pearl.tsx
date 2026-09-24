/**
 * 珍珠圓（Logo／步驟號／完成勾）。
 * variant="logo" 是 Logo 用的 42% 色標，其餘用 40%（README §4.2）。
 */
export default function Pearl({
  variant = 'default',
  className = '',
  children,
}: {
  variant?: 'default' | 'logo';
  className?: string;
  children?: React.ReactNode;
}) {
  const bg = variant === 'logo' ? 'bg-pearl-logo' : 'bg-pearl';
  return (
    <span
      aria-hidden={children ? undefined : true}
      className={`flex shrink-0 items-center justify-center rounded-full ${bg} ${className}`}
    >
      {children}
    </span>
  );
}
