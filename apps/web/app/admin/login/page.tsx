'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Notice, btnPrimary, inputSm, labelSm } from '@/components/admin/ui';
import {
  AuthError,
  adoptSession,
  getSession,
  parseAuthFragment,
  requestPasswordReset,
  signIn,
  signUp,
  updatePassword,
} from '@/lib/admin/session';

type Mode = 'login' | 'signup' | 'forgot' | 'reset';

const MIN_PASSWORD = 8;

/** 登入後要回去的頁面（只接受 /admin 底下的路徑，避免被導到外站） */
function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get('next') ?? '';
  return next.startsWith('/admin') && !next.startsWith('/admin/login') ? next : '/admin';
}

export default function AdminLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resetTokens, setResetTokens] = useState<{ access: string; refresh: string } | null>(null);

  // 確認信／重設密碼信的連結會帶 #access_token=…；已登入就直接進後台
  useEffect(() => {
    const frag = parseAuthFragment(window.location.hash);
    if (frag) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      if (frag.type === 'recovery') {
        setResetTokens({ access: frag.accessToken, refresh: frag.refreshToken });
        setMode('reset');
        return;
      }
      adoptSession(frag.accessToken, frag.refreshToken, frag.expiresIn);
      router.replace(nextPath());
      return;
    }
    void getSession().then((s) => {
      if (s) router.replace(nextPath());
    });
  }, [router]);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setInfo(null);
    setPassword('');
    setPassword2('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setInfo(null);
    const back = `${window.location.origin}/admin/login`;
    if ((mode === 'signup' || mode === 'reset') && password.length < MIN_PASSWORD) {
      setError(`密碼至少 ${MIN_PASSWORD} 個字元`);
      return;
    }
    if ((mode === 'signup' || mode === 'reset') && password !== password2) {
      setError('兩次輸入的密碼不一樣');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') {
        await signIn(email, password);
        router.replace(nextPath());
        return;
      }
      if (mode === 'signup') {
        const s = await signUp(email, password, back);
        if (s) {
          router.replace(nextPath());
          return;
        }
        switchMode('login');
        setInfo('已寄出確認信，請到信箱點「確認」連結。確認後回到這裡用 Email 與密碼登入即可（若連結開啟後出現錯誤頁面，直接關掉回來登入）。');
        return;
      }
      if (mode === 'forgot') {
        await requestPasswordReset(email, back);
        setInfo('如果這個 Email 有後台帳號，重設密碼的信已經寄出，請到信箱點連結設定新密碼。');
        return;
      }
      if (mode === 'reset' && resetTokens) {
        await updatePassword(resetTokens.access, resetTokens.refresh, password);
        router.replace(nextPath());
      }
    } catch (err) {
      setError(err instanceof AuthError ? err.message : '發生錯誤，請稍後再試');
    } finally {
      setBusy(false);
    }
  };

  const title = { login: '後台登入', signup: '第一次使用：設定密碼', forgot: '忘記密碼', reset: '設定新密碼' }[mode];
  const needEmail = mode !== 'reset';
  const needPassword = mode !== 'forgot';
  const needConfirm = mode === 'signup' || mode === 'reset';

  return (
    <div className="mx-auto flex w-full max-w-[420px] flex-col gap-5 rounded-[20px] border border-rose-600/[.16] bg-white p-6 shadow-form md:p-8">
      <h1 className="font-serif text-[24px] font-bold text-ink-900">{title}</h1>
      <p className="text-[13px] leading-[1.8] text-ink-500">只有網站管理者的 Email 可以使用後台。</p>
      {error && <Notice tone="error">{error}</Notice>}
      {info && <Notice tone="ok">{info}</Notice>}

      <form onSubmit={submit} className="flex flex-col gap-4">
        {needEmail && (
          <label className={labelSm}>
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputSm}
            />
          </label>
        )}
        {needPassword && (
          <label className={labelSm}>
            {mode === 'login' ? '密碼' : `新密碼（至少 ${MIN_PASSWORD} 個字元）`}
            <input
              type="password"
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputSm}
            />
          </label>
        )}
        {needConfirm && (
          <label className={labelSm}>
            再輸入一次新密碼
            <input
              type="password"
              required
              autoComplete="new-password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              className={inputSm}
            />
          </label>
        )}
        <button type="submit" disabled={busy} className={btnPrimary}>
          {busy ? '處理中…' : { login: '登入', signup: '設定密碼並寄出確認信', forgot: '寄出重設密碼信', reset: '儲存新密碼並登入' }[mode]}
        </button>
      </form>

      <div className="flex flex-wrap justify-between gap-2 border-t border-line-4 pt-4 text-[13px]">
        {mode !== 'login' ? (
          <button type="button" onClick={() => switchMode('login')} className="text-rose-800 underline-offset-4 hover:underline">
            回到登入
          </button>
        ) : (
          <>
            <button type="button" onClick={() => switchMode('signup')} className="text-rose-800 underline-offset-4 hover:underline">
              第一次使用：設定密碼
            </button>
            <button type="button" onClick={() => switchMode('forgot')} className="text-rose-800 underline-offset-4 hover:underline">
              忘記密碼
            </button>
          </>
        )}
      </div>
    </div>
  );
}
