'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Badge, Card, Empty, Notice, btnGhost, btnPrimary, inputSm, labelSm } from '@/components/admin/ui';
import { ApiError } from '@/lib/api';
import {
  ORDER_KIND_LABELS,
  adminRequest,
  type AdminKol,
  type AdminReferralCode,
  type ReferralStats,
} from '@/lib/admin/api';
import { downloadCsv } from '@/lib/admin/format';
import { taipeiMonth } from '@/lib/booking/time';
import { formatPrice } from '@/lib/services';

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : '發生錯誤，請稍後再試');

// ---------------------------------------------------------------------
// 成效與佣金
// ---------------------------------------------------------------------

function StatsCard({ reloadKey }: { reloadKey: number }) {
  const [month, setMonth] = useState(taipeiMonth());
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    adminRequest<ReferralStats>(`/admin/referral-stats?from=${month}-01`)
      .then((s) => alive && setStats(s))
      .catch((e) => alive && setError(errMsg(e)));
    return () => {
      alive = false;
    };
  }, [month, reloadKey]);

  const totals = stats?.kols.reduce(
    (t, k) => ({
      orders: t.orders + k.orders,
      revenue: t.revenue + k.revenue,
      discount: t.discount + k.discount,
      commission: t.commission + k.commission,
    }),
    { orders: 0, revenue: 0, discount: 0, commission: 0 },
  );

  const exportCsv = () => {
    if (!stats) return;
    downloadCsv(`referrals-${month}.csv`, [
      ['時間', '類型', '推薦碼', 'KOL', '訂單編號', '原價', '折扣', '實付', '佣金', '狀態'],
      ...stats.uses.map((u) => [
        u.createdAt.replace('T', ' ').slice(0, 16),
        ORDER_KIND_LABELS[u.kind],
        u.code,
        u.kolName,
        u.orderNo,
        u.originalAmount,
        u.discountAmount,
        u.finalAmount,
        u.commissionAmount,
        u.state === 'paid' ? '已付款' : u.state === 'pending' ? '待付款' : '已取消',
      ]),
    ]);
  };

  return (
    <Card
      title="推薦成效與佣金"
      actions={
        <>
          <input
            type="month"
            aria-label="月份"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className={`${inputSm} w-auto`}
          />
          <button type="button" onClick={exportCsv} disabled={!stats || stats.uses.length === 0} className={btnGhost}>
            下載明細 CSV
          </button>
        </>
      }
    >
      <p className="text-[13px] leading-[1.8] text-ink-500">只計算已付款的訂單；佣金 = 折扣後實付金額 × 佣金比例。</p>
      {error && <Notice tone="error">{error}</Notice>}
      {stats && stats.kols.length === 0 && <Empty>還沒有 KOL，先在下方新增</Empty>}
      {stats && stats.kols.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-line text-left text-ink-500">
                <th className="py-2 pr-3 font-normal">KOL</th>
                <th className="py-2 pr-3 text-right font-normal">成交</th>
                <th className="py-2 pr-3 text-right font-normal">成交金額</th>
                <th className="py-2 pr-3 text-right font-normal">折扣</th>
                <th className="py-2 pr-3 text-right font-normal">應付佣金</th>
                <th className="py-2 text-right font-normal">待付款</th>
              </tr>
            </thead>
            <tbody>
              {stats.kols.map((k) => (
                <tr key={k.kolId} className="border-b border-line-4">
                  <td className="py-2 pr-3 text-ink-900">
                    {k.name} {!k.active && <Badge>停用</Badge>}
                  </td>
                  <td className="py-2 pr-3 text-right">{k.orders}</td>
                  <td className="py-2 pr-3 text-right">{formatPrice(k.revenue)}</td>
                  <td className="py-2 pr-3 text-right">{formatPrice(k.discount)}</td>
                  <td className="py-2 pr-3 text-right font-bold text-rose-800">{formatPrice(k.commission)}</td>
                  <td className="py-2 text-right text-ink-500">{k.pending}</td>
                </tr>
              ))}
            </tbody>
            {totals && (
              <tfoot>
                <tr className="font-bold text-ink-900">
                  <td className="py-2 pr-3">合計</td>
                  <td className="py-2 pr-3 text-right">{totals.orders}</td>
                  <td className="py-2 pr-3 text-right">{formatPrice(totals.revenue)}</td>
                  <td className="py-2 pr-3 text-right">{formatPrice(totals.discount)}</td>
                  <td className="py-2 pr-3 text-right text-rose-800">{formatPrice(totals.commission)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------
// 推薦碼表單（新增／編輯）
// ---------------------------------------------------------------------

type CodeForm = {
  code: string;
  discountType: 'percent' | 'amount';
  discountValue: string;
  commissionRate: string;
  appliesBooking: boolean;
  appliesVip: boolean;
  appliesShop: boolean;
  startsOn: string;
  endsOn: string;
  maxUses: string;
};

const EMPTY_CODE: CodeForm = {
  code: '',
  discountType: 'percent',
  discountValue: '10',
  commissionRate: '10',
  appliesBooking: true,
  appliesVip: true,
  appliesShop: true,
  startsOn: '',
  endsOn: '',
  maxUses: '',
};

function toForm(c: AdminReferralCode): CodeForm {
  return {
    code: c.code,
    discountType: c.discountType,
    discountValue: String(c.discountValue),
    commissionRate: String(c.commissionRate),
    appliesBooking: c.appliesBooking,
    appliesVip: c.appliesVip,
    appliesShop: c.appliesShop,
    startsOn: c.startsOn ?? '',
    endsOn: c.endsOn ?? '',
    maxUses: c.maxUses === null ? '' : String(c.maxUses),
  };
}

function CodeEditor({
  kolId,
  editing,
  onDone,
  onCancel,
}: {
  kolId: string;
  editing: AdminReferralCode | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<CodeForm>(editing ? toForm(editing) : EMPTY_CODE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof CodeForm>(k: K, v: CodeForm[K]) => setF((p) => ({ ...p, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      discountType: f.discountType,
      discountValue: Number(f.discountValue),
      commissionRate: Number(f.commissionRate || 0),
      appliesBooking: f.appliesBooking,
      appliesVip: f.appliesVip,
      appliesShop: f.appliesShop,
      startsOn: f.startsOn || null,
      endsOn: f.endsOn || null,
      maxUses: f.maxUses ? Number(f.maxUses) : null,
    };
    try {
      if (editing) await adminRequest(`/admin/referral-codes/${editing.id}`, { method: 'PATCH', body });
      else await adminRequest('/admin/referral-codes', { method: 'POST', body: { ...body, kolId, code: f.code } });
      onDone();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-[12px] border border-rose-600/20 bg-soft-2 p-4">
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-[repeat(4,minmax(0,1fr))]">
        <label className={labelSm}>
          推薦碼
          <input
            required
            disabled={!!editing}
            value={f.code}
            onChange={(e) => set('code', e.target.value.toUpperCase())}
            placeholder="例：AMY10"
            maxLength={20}
            className={`${inputSm} uppercase`}
          />
        </label>
        <label className={labelSm}>
          折扣方式
          <select value={f.discountType} onChange={(e) => set('discountType', e.target.value as CodeForm['discountType'])} className={inputSm}>
            <option value="percent">打折（折扣 %）</option>
            <option value="amount">折抵金額（元）</option>
          </select>
        </label>
        <label className={labelSm}>
          {f.discountType === 'percent' ? '折扣 %（10 = 打 9 折）' : '折抵金額（元）'}
          <input
            required
            type="number"
            min={1}
            max={f.discountType === 'percent' ? 90 : undefined}
            value={f.discountValue}
            onChange={(e) => set('discountValue', e.target.value)}
            className={inputSm}
          />
        </label>
        <label className={labelSm}>
          KOL 佣金 %（實付金額的）
          <input
            type="number"
            min={0}
            max={100}
            step="0.1"
            value={f.commissionRate}
            onChange={(e) => set('commissionRate', e.target.value)}
            className={inputSm}
          />
        </label>
        <label className={labelSm}>
          開始日（選填）
          <input type="date" value={f.startsOn} onChange={(e) => set('startsOn', e.target.value)} className={inputSm} />
        </label>
        <label className={labelSm}>
          結束日（含當天，選填）
          <input type="date" value={f.endsOn} onChange={(e) => set('endsOn', e.target.value)} className={inputSm} />
        </label>
        <label className={labelSm}>
          可用次數（選填）
          <input type="number" min={1} value={f.maxUses} onChange={(e) => set('maxUses', e.target.value)} placeholder="不限" className={inputSm} />
        </label>
      </div>
      <fieldset className="flex flex-wrap gap-4 text-[14px] text-ink-700">
        <legend className="mb-1 text-[13px] text-ink-600">適用於</legend>
        {(
          [
            ['appliesBooking', '預約諮詢'],
            ['appliesVip', 'VIP 包堂'],
            ['appliesShop', '商店商品'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2">
            <input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} />
            {label}
          </label>
        ))}
      </fieldset>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={btnPrimary}>
          {busy ? '儲存中…' : editing ? '儲存修改' : '建立推薦碼'}
        </button>
        <button type="button" onClick={onCancel} className={btnGhost}>
          取消
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------
// KOL 與推薦碼管理
// ---------------------------------------------------------------------

function KolCard({ kol, onChanged }: { kol: AdminKol; onChanged: () => void }) {
  const [editor, setEditor] = useState<'new' | AdminReferralCode | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patchKol = async (body: Record<string, unknown>) => {
    setError(null);
    try {
      await adminRequest(`/admin/kols/${kol.id}`, { method: 'PATCH', body });
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const toggleCode = async (c: AdminReferralCode) => {
    setError(null);
    try {
      await adminRequest(`/admin/referral-codes/${c.id}`, { method: 'PATCH', body: { active: !c.active } });
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const copyLink = async (code: string) => {
    const link = `${window.location.origin}/?ref=${code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt('複製這個分享連結', link);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-[17px] font-bold text-ink-900">
            {kol.name} {!kol.active && <Badge>停用</Badge>}
          </span>
          {(kol.contact || kol.note) && (
            <span className="text-[13px] text-ink-500">{[kol.contact, kol.note].filter(Boolean).join('・')}</span>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setEditor('new')} className={btnGhost}>
            新增推薦碼
          </button>
          <button type="button" onClick={() => void patchKol({ active: !kol.active })} className={btnGhost}>
            {kol.active ? '停用 KOL' : '啟用 KOL'}
          </button>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {editor && (
        <CodeEditor
          key={editor === 'new' ? 'new' : editor.id}
          kolId={kol.id}
          editing={editor === 'new' ? null : editor}
          onDone={() => {
            setEditor(null);
            onChanged();
          }}
          onCancel={() => setEditor(null)}
        />
      )}
      {kol.codes.length === 0 ? (
        <p className="text-[13px] text-ink-500">還沒有推薦碼</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line-4">
          {kol.codes.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-[14px]">
              <b className="w-[110px] text-rose-800">{c.code}</b>
              <span className="text-ink-700">{c.label}</span>
              <span className="text-ink-600">佣金 {c.commissionRate}%</span>
              <span className="text-ink-500">
                {[c.appliesBooking && '預約', c.appliesVip && 'VIP', c.appliesShop && '商店'].filter(Boolean).join('／') || '不適用任何項目'}
              </span>
              {(c.startsOn || c.endsOn) && (
                <span className="text-ink-500">
                  {c.startsOn ?? '即日起'}～{c.endsOn ?? '不限'}
                </span>
              )}
              {c.maxUses !== null && <span className="text-ink-500">限 {c.maxUses} 次</span>}
              <Badge tone={c.active ? 'green' : 'gray'}>{c.active ? '使用中' : '停用'}</Badge>
              <span className="ml-auto flex flex-wrap gap-2">
                <button type="button" onClick={() => void copyLink(c.code)} className={btnGhost}>
                  {copied === c.code ? '已複製' : '複製分享連結'}
                </button>
                <button type="button" onClick={() => setEditor(c)} className={btnGhost}>
                  編輯
                </button>
                <button type="button" onClick={() => void toggleCode(c)} className={btnGhost}>
                  {c.active ? '停用' : '啟用'}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AdminReferralsPage() {
  const [kols, setKols] = useState<AdminKol[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await adminRequest<{ kols: AdminKol[] }>('/admin/kols');
      setKols(r.kols);
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changed = () => {
    void load();
    setReloadKey((n) => n + 1);
  };

  const addKol = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminRequest('/admin/kols', { method: 'POST', body: { name, contact: contact || null } });
      setName('');
      setContact('');
      changed();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <StatsCard reloadKey={reloadKey} />
      <Card title="KOL 與推薦碼">
        <p className="text-[13px] leading-[1.8] text-ink-500">
          每位 KOL 可以有多個推薦碼。把「分享連結」給 KOL，客人點進網站後 30 天內結帳都會自動帶入推薦碼；也可以在付款步驟自己輸入。
        </p>
        <form onSubmit={addKol} className="grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_1fr_auto]">
          <label className={labelSm}>
            KOL 名稱
            <input required value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={inputSm} />
          </label>
          <label className={labelSm}>
            聯絡方式（選填）
            <input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={200} placeholder="IG、LINE、Email…" className={inputSm} />
          </label>
          <button type="submit" disabled={busy || !name.trim()} className={btnPrimary}>
            新增 KOL
          </button>
        </form>
        {error && <Notice tone="error">{error}</Notice>}
        {!kols && !error && <p className="text-[14px] text-ink-500">讀取中…</p>}
        {kols && kols.length === 0 && <Empty>還沒有 KOL</Empty>}
        {kols && kols.map((k) => <KolCard key={k.id} kol={k} onChanged={changed} />)}
      </Card>
    </div>
  );
}
