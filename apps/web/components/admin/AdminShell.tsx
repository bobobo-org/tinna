'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { adminRequest } from '@/lib/admin/api';
import { getSession, signOut } from '@/lib/admin/session';
import { btnGhost } from './ui';

export const ADMIN_NAV = [
  { href: '/admin', label: '總覽' },
  { href: '/admin/bookings', label: '預約' },
] as const;

type State =
  | { status: 'checking' }
  | { status: 'ready'; email: string }
  | { status: 'forbidden'; email: string }
  | { status: 'error'; message: string };

const AdminContext = createContext<{ email: string } | null>(null);

/** 目前登入的管理者（AdminShell 內才有值） */
export function useAdmin() {
  return useContext(AdminContext);
}

function isActive(pathname: string, href: string) {
  return href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * 後台外框：確認已登入且在管理者名單內（GET /admin/me），否則導到 /admin/login
 * <html> 加 .admin-mode：隱藏前台的頁尾與流光（globals.css）
 */
export default function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === '/admin/login';
  const [state, setState] = useState<State>({ status: 'checking' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('admin-mode');
    return () => root.classList.remove('admin-mode');
  }, []);

  const toLogin = useCallback(() => {
    router.replace(`/admin/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }, [router]);

  useEffect(() => {
    if (isLogin) return;
    let alive = true;
    void (async () => {
      const s = await getSession();
      if (!alive) return;
      if (!s) return toLogin();
      try {
        const me = await adminRequest<{ email: string }>('/admin/me');
        if (alive) setState({ status: 'ready', email: me.email });
      } catch (e) {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 401) return toLogin();
        if (e instanceof ApiError && e.status === 403) return setState({ status: 'forbidden', email: s.email });
        setState({ status: 'error', message: e instanceof ApiError ? e.message : '無法連線，請稍後再試' });
      }
    })();
    return () => {
      alive = false;
    };
  }, [isLogin, toLogin, attempt]);

  const logout = async () => {
    await signOut();
    router.replace('/admin/login');
  };

  if (isLogin) return <div className="bg-booking px-4 py-10 md:py-16">{children}</div>;

  return (
    <div className="min-h-[70vh] bg-booking pb-16">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-4 pt-6 md:px-8 md:pt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/admin" className="font-serif text-[24px] font-bold tracking-[.12em] text-ink-900">
            緣舍後台
          </Link>
          {state.status === 'ready' && (
            <div className="flex items-center gap-3 text-[13px] text-ink-500">
              <span className="hidden md:inline">{state.email}</span>
              <button type="button" onClick={logout} className={btnGhost}>
                登出
              </button>
            </div>
          )}
        </div>

        {state.status === 'ready' && (
          <nav aria-label="後台選單" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
            <ul className="flex min-w-max gap-2">
              {ADMIN_NAV.map((item) => {
                const on = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={on ? 'page' : undefined}
                      className={`block rounded-pill px-4 py-2 text-[14px] ${
                        on ? 'bg-rose-800 font-bold text-white' : 'border border-rose-600/20 bg-white text-rose-800 hover:bg-soft'
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        {state.status === 'checking' && <p className="py-16 text-center text-[15px] text-ink-500">確認登入狀態中…</p>}
        {state.status === 'forbidden' && (
          <div className="flex flex-col items-center gap-4 py-16 text-center text-[15px] text-ink-600">
            <p>這個帳號（{state.email || '目前登入的 Email'}）沒有後台權限。</p>
            <button type="button" onClick={logout} className={btnGhost}>
              換一個帳號登入
            </button>
          </div>
        )}
        {state.status === 'error' && (
          <div className="flex flex-col items-center gap-4 py-16 text-center text-[15px] text-ink-600">
            <p>{state.message}</p>
            <button
              type="button"
              onClick={() => {
                setState({ status: 'checking' });
                setAttempt((n) => n + 1);
              }}
              className={btnGhost}
            >
              重試
            </button>
          </div>
        )}
        {state.status === 'ready' && <AdminContext.Provider value={{ email: state.email }}>{children}</AdminContext.Provider>}
      </div>
    </div>
  );
}
