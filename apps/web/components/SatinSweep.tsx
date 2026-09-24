import { SHINE } from '@/lib/site';

/** 全頁一道流光（README §4.3）。prefers-reduced-motion 時整層不顯示。 */
export default function SatinSweep() {
  if (!SHINE) return null;
  return (
    <div
      aria-hidden="true"
      data-satin-sweep
      className="pointer-events-none fixed inset-0 z-30 overflow-hidden mix-blend-soft-light motion-reduce:hidden"
    >
      <div className="absolute left-0 top-[-20%] h-[140%] w-[22vw] animate-satin-sweep bg-sweep" />
    </div>
  );
}
