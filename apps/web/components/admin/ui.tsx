import type { ReactNode } from 'react';

/** 後台共用的樣式與小元件（沿用前台色票） */

export const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-pill bg-btn px-5 py-[10px] text-[14px] font-bold text-white shadow-btn-sm hover:brightness-[1.08] disabled:opacity-50';
export const btnGhost =
  'inline-flex items-center justify-center gap-2 rounded-pill border border-rose-600/30 bg-white px-4 py-[9px] text-[14px] text-rose-800 hover:bg-soft disabled:opacity-50';
export const inputSm =
  'w-full rounded-[10px] border border-line-2 bg-input px-3 py-[9px] text-[15px] text-ink-900 outline-none focus:border-rose-600 focus:shadow-[0_0_0_3px_rgba(185,38,90,.12)]';
export const labelSm = 'flex flex-col gap-1 text-[13px] text-ink-600';

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-[16px] border border-rose-600/[.14] bg-white p-4 shadow-form md:p-6">
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="font-serif text-[20px] font-bold text-ink-900">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

const TONES = {
  green: 'bg-[#e8f6ee] text-[#1f6b3f]',
  rose: 'bg-soft text-rose-800',
  gray: 'bg-[#f2eef0] text-ink-500',
  amber: 'bg-[#fff4df] text-[#8a5a00]',
} as const;

export function Badge({ tone = 'gray', children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-pill px-[10px] py-[3px] text-[12px] font-bold ${TONES[tone]}`}>{children}</span>;
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'ok'; children: ReactNode }) {
  const cls =
    tone === 'error'
      ? 'border-error/30 bg-[#fff1f4] text-error'
      : tone === 'ok'
        ? 'border-[#1f6b3f]/20 bg-[#e8f6ee] text-[#1f6b3f]'
        : 'border-rose-600/20 bg-soft-2 text-ink-600';
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`rounded-[12px] border px-4 py-3 text-[14px] leading-[1.8] ${cls}`}>
      {children}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-[12px] bg-soft-2 px-4 py-8 text-center text-[14px] text-ink-500">{children}</p>;
}
