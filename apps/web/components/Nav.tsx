'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import Pearl from '@/components/Pearl';
import { BOOKING_PATH, NAV_ITEMS, SITE_NAME } from '@/lib/site';

const MENU_ID = 'mobile-menu';

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * 共用 Nav（sticky, z-20）＋手機漢堡選單。
 * 選單開啟時在 <html> 加 .menu-open：globals.css 用它鎖背景捲動，MobileCta 用它隱藏自己。
 */
export default function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // 換頁自動關閉（render 期間比對，不多一次 effect render）
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('menu-open', open);
    return () => root.classList.remove('menu-open');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    // 視窗拉寬到桌機版時一併關閉（桌機版沒有選單，避免捲動一直被鎖住）
    const mq = window.matchMedia('(min-width: 760px)');
    const onMq = () => {
      if (mq.matches) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    mq.addEventListener('change', onMq);
    return () => {
      document.removeEventListener('keydown', onKey);
      mq.removeEventListener('change', onMq);
    };
  }, [open]);

  return (
    <>
      <header className="satin sticky top-0 z-20 flex flex-wrap items-center justify-between gap-4 border-b border-white/70 py-3 pl-[max(16px,env(safe-area-inset-left))] pr-[max(16px,env(safe-area-inset-right))] shadow-nav md:py-4 md:pl-[max(clamp(20px,4vw,48px),env(safe-area-inset-left))] md:pr-[max(clamp(20px,4vw,48px),env(safe-area-inset-right))]">
        {/* 上下各 5px 透明延伸：觸控區 44px，視覺不變 */}
        <Link href="/" onClick={close} className="-my-[5px] flex items-center gap-3 py-[5px]">
          <Pearl variant="logo" className="h-[34px] w-[34px] shadow-logo" />
          <span className="font-serif text-[19px] font-bold tracking-[.18em] text-rose-800 md:text-[22px]">
            {SITE_NAME}
          </span>
        </Link>

        <nav aria-label="主選單" className="hidden flex-nowrap gap-[2px] whitespace-nowrap md:flex">
          {NAV_ITEMS.map((item) => {
            const on = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={on ? 'page' : undefined}
                className="group -my-1 block py-1 focus-visible:outline-none"
              >
                <span
                  className={`block rounded-pill px-3 py-2 text-[15px] font-medium group-hover:bg-white/70 group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-rose-600 ${
                    on ? 'bg-white/75 text-rose-800' : 'text-ink-600'
                  }`}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        <Link
          href={BOOKING_PATH}
          className="group -my-[3px] hidden py-[3px] focus-visible:outline-none md:block"
        >
          <span className="block rounded-pill bg-nav-btn px-[22px] py-[10px] text-[14px] font-bold text-white shadow-nav-btn group-hover:brightness-[1.08] group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-rose-600">
            立即預約
          </span>
        </Link>

        <button
          ref={buttonRef}
          type="button"
          aria-label="選單"
          aria-expanded={open}
          aria-controls={MENU_ID}
          onClick={() => setOpen((v) => !v)}
          className="flex h-11 w-11 flex-col items-center justify-center gap-[5px] rounded-full bg-white/70 shadow-burger md:hidden"
        >
          <span
            className={`block h-[2px] w-[18px] rounded-[2px] bg-rose-800 [transition:transform_.2s] ${
              open ? '[transform:translateY(7px)_rotate(45deg)]' : ''
            }`}
          />
          <span
            className={`block h-[2px] w-[18px] rounded-[2px] bg-rose-800 [transition:opacity_.2s] ${
              open ? 'opacity-0' : ''
            }`}
          />
          <span
            className={`block h-[2px] w-[18px] rounded-[2px] bg-rose-800 [transition:transform_.2s] ${
              open ? '[transform:translateY(-7px)_rotate(-45deg)]' : ''
            }`}
          />
        </button>
      </header>

      {/* 手機選單：遮罩（點擊關閉）＋白色面板。桌機寬度一律不顯示 */}
      <div
        aria-hidden="true"
        onClick={close}
        className={`fixed inset-0 z-[25] touch-none bg-ink-900/[.28] md:hidden ${open ? 'block' : 'hidden'}`}
      />
      <nav
        id={MENU_ID}
        aria-label="主選單"
        className={`fixed left-[max(12px,env(safe-area-inset-left))] right-[max(12px,env(safe-area-inset-right))] top-[76px] z-[26] flex-col rounded-[20px] bg-white p-[10px] shadow-menu md:hidden ${
          open ? 'flex' : 'hidden'
        }`}
      >
        {NAV_ITEMS.map((item) => {
          const on = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={close}
              aria-current={on ? 'page' : undefined}
              className={`flex items-center justify-between rounded-[14px] px-[18px] py-4 text-[17px] font-medium ${
                on ? 'bg-soft text-rose-800' : 'text-ink-600'
              }`}
            >
              <span>{item.label}</span>
              <span aria-hidden="true" className="text-chevron">
                ›
              </span>
            </Link>
          );
        })}
        <Link
          href={BOOKING_PATH}
          onClick={close}
          className="mx-1 mb-1 mt-2 rounded-pill bg-btn p-4 text-center text-[16px] font-bold text-white"
        >
          立即預約
        </Link>
      </nav>
    </>
  );
}
