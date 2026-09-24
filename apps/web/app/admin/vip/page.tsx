'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import GiftSender from '@/components/admin/GiftSender';
import { Badge, Card, Empty, Notice, btnGhost, btnPrimary, inputSm, labelSm } from '@/components/admin/ui';
import { ApiError } from '@/lib/api';
import {
  BOOKING_STATUS_LABELS,
  adminRequest,
  type AdminVipBooking,
  type AdminVipMember,
  type AdminVipPlan,
} from '@/lib/admin/api';
import { downloadCsv } from '@/lib/admin/format';
import { taipeiToday } from '@/lib/booking/time';
import { formatPrice } from '@/lib/services';

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : '發生錯誤，請稍後再試');
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

// ---------------------------------------------------------------------
// VIP 會員：查詢、生日月份（寄生日禮）、調整堂數與期限
// ---------------------------------------------------------------------

function MemberEditor({ member, onSaved }: { member: AdminVipMember; onSaved: (m: AdminVipMember) => void }) {
  const [total, setTotal] = useState(String(member.sessionsTotal));
  const [used, setUsed] = useState(String(member.sessionsUsed));
  const [expiresOn, setExpiresOn] = useState(member.expiresOn);
  const [note, setNote] = useState(member.note ?? '');
  const [bookings, setBookings] = useState<AdminVipBooking[] | null>(null);
  const [gift, setGift] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    adminRequest<{ bookings: AdminVipBooking[] }>(`/admin/vip-members/${member.id}`)
      .then((r) => alive && setBookings(r.bookings))
      .catch(() => alive && setBookings([]));
    return () => {
      alive = false;
    };
  }, [member.id]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await adminRequest<{ member: AdminVipMember }>(`/admin/vip-members/${member.id}`, {
        method: 'PATCH',
        body: { sessionsTotal: Number(total), sessionsUsed: Number(used), expiresOn, note: note.trim() || null },
      });
      onSaved(r.member);
      setMsg({ tone: 'ok', text: '已儲存' });
    } catch (err) {
      setMsg({ tone: 'error', text: errMsg(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-[12px] border border-rose-600/20 bg-soft-2 p-4">
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2 text-[14px] text-ink-700">
        <div>
          <dt className="text-ink-500">Email</dt>
          <dd className="[overflow-wrap:anywhere]">{member.email}</dd>
        </div>
        <div>
          <dt className="text-ink-500">手機</dt>
          <dd>{member.phone}</dd>
        </div>
        <div>
          <dt className="text-ink-500">生日</dt>
          <dd>{member.birthDate ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-ink-500">成為 VIP</dt>
          <dd>{member.createdAt.slice(0, 10)}</dd>
        </div>
      </dl>
      <form onSubmit={save} className="flex flex-col gap-3">
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-[repeat(3,minmax(0,1fr))]">
          <label className={labelSm}>
            總堂數
            <input type="number" min={0} max={1000} required value={total} onChange={(e) => setTotal(e.target.value)} className={inputSm} />
          </label>
          <label className={labelSm}>
            已使用
            <input type="number" min={0} max={1000} required value={used} onChange={(e) => setUsed(e.target.value)} className={inputSm} />
          </label>
          <label className={labelSm}>
            使用期限（含當天）
            <input type="date" required value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} className={inputSm} />
          </label>
        </div>
        <label className={labelSm}>
          備註（只有後台看得到，例：生日禮已寄出）
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className={inputSm} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className={btnPrimary}>
            {busy ? '儲存中…' : '儲存'}
          </button>
          {!gift && (
            <button type="button" onClick={() => setGift(true)} className={btnGhost}>
              寄贈品／生日禮
            </button>
          )}
        </div>
      </form>
      {gift && <GiftSender member={member} onClose={() => setGift(false)} />}
      <div className="flex flex-col gap-2">
        <h3 className="text-[14px] font-bold text-ink-700">VIP 預約紀錄</h3>
        {bookings === null && <p className="text-[13px] text-ink-500">讀取中…</p>}
        {bookings?.length === 0 && <p className="text-[13px] text-ink-500">還沒有用堂數預約</p>}
        {bookings && bookings.length > 0 && (
          <ul className="flex flex-col divide-y divide-line-4 rounded-[10px] bg-white px-3 text-[14px]">
            {bookings.map((b) => (
              <li key={b.orderNo} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  {b.date} {b.time}・{b.serviceName}
                </span>
                <span className="text-ink-500">
                  {BOOKING_STATUS_LABELS[b.status]}・{b.orderNo}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MembersCard() {
  const [search, setSearch] = useState('');
  const [birthMonth, setBirthMonth] = useState('');
  const [members, setMembers] = useState<AdminVipMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (q: { search: string; birthMonth: string }) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.search.trim()) params.set('search', q.search.trim());
      if (q.birthMonth) params.set('birthMonth', q.birthMonth);
      const r = await adminRequest<{ members: AdminVipMember[] }>(`/admin/vip-members?${params}`);
      setMembers(r.members);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load({ search: '', birthMonth: '' });
  }, [load]);

  const thisMonth = String(Number(taipeiToday().slice(5, 7)));

  const exportCsv = () => {
    if (!members) return;
    downloadCsv(`vip-members${birthMonth ? `-birth${birthMonth}` : ''}.csv`, [
      ['卡號', '姓名', 'Email', '手機', '生日', '方案', '總堂數', '已使用', '剩餘', '使用期限', '備註', '成為 VIP'],
      ...members.map((m) => [
        m.cardNo,
        m.name,
        m.email,
        m.phone,
        m.birthDate ?? '',
        m.planName,
        m.sessionsTotal,
        m.sessionsUsed,
        m.sessionsLeft,
        m.expiresOn,
        m.note ?? '',
        m.createdAt.slice(0, 10),
      ]),
    ]);
  };

  return (
    <Card
      title="VIP 會員"
      actions={
        <button type="button" onClick={exportCsv} disabled={!members || members.length === 0} className={btnGhost}>
          下載 CSV
        </button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load({ search, birthMonth });
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <label className={`${labelSm} min-w-[200px] flex-1`}>
          搜尋（姓名／Email／卡號／手機）
          <input value={search} onChange={(e) => setSearch(e.target.value)} className={inputSm} />
        </label>
        <label className={labelSm}>
          生日月份
          <select value={birthMonth} onChange={(e) => setBirthMonth(e.target.value)} className={inputSm}>
            <option value="">全部</option>
            {MONTHS.map((m) => (
              <option key={m} value={String(m)}>
                {m} 月
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={loading} className={btnPrimary}>
          {loading ? '查詢中…' : '查詢'}
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            setSearch('');
            setBirthMonth(thisMonth);
            void load({ search: '', birthMonth: thisMonth });
          }}
          className={btnGhost}
        >
          本月壽星（寄生日禮）
        </button>
      </form>
      {error && <Notice tone="error">{error}</Notice>}
      {members && members.length === 0 && <Empty>沒有符合的 VIP 會員</Empty>}
      {members && members.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-line text-left text-ink-500">
                <th className="py-2 pr-3 font-normal">卡號</th>
                <th className="py-2 pr-3 font-normal">姓名</th>
                <th className="py-2 pr-3 font-normal">方案</th>
                <th className="py-2 pr-3 text-right font-normal">剩餘堂數</th>
                <th className="py-2 pr-3 font-normal">使用期限</th>
                <th className="py-2 pr-3 font-normal">生日</th>
                <th className="py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <MemberRow
                  key={m.id}
                  m={m}
                  open={open === m.id}
                  onToggle={() => setOpen((o) => (o === m.id ? null : m.id))}
                  onSaved={(next) => setMembers((list) => list?.map((x) => (x.id === next.id ? next : x)) ?? null)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function MemberRow({
  m,
  open,
  onToggle,
  onSaved,
}: {
  m: AdminVipMember;
  open: boolean;
  onToggle: () => void;
  onSaved: (m: AdminVipMember) => void;
}) {
  return (
    <>
      <tr className="border-b border-line-4 align-top">
        <td className="py-2 pr-3 font-mono text-[13px] text-ink-900">{m.cardNo}</td>
        <td className="py-2 pr-3 text-ink-900">{m.name}</td>
        <td className="py-2 pr-3">{m.planName}</td>
        <td className="py-2 pr-3 text-right">
          <b className="text-rose-800">{m.sessionsLeft}</b> / {m.sessionsTotal}
        </td>
        <td className="py-2 pr-3">
          {m.expiresOn} {m.expired && <Badge>已過期</Badge>}
        </td>
        <td className="py-2 pr-3">{m.birthDate ?? '—'}</td>
        <td className="py-2 text-right">
          <button type="button" onClick={onToggle} aria-expanded={open} className="text-[13px] text-rose-800 underline underline-offset-4">
            {open ? '收起' : '詳細／調整'}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="pb-4 pt-2">
            <MemberEditor member={m} onSaved={onSaved} />
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------
// VIP 方案（價格、堂數、有效天數、上下架）
// ---------------------------------------------------------------------

type PlanForm = { id: string; name: string; sessions: string; price: string; validDays: string; description: string; sort: string; active: boolean };

const EMPTY_PLAN: PlanForm = { id: '', name: '', sessions: '', price: '', validDays: '365', description: '', sort: '0', active: true };

function toPlanForm(p: AdminVipPlan): PlanForm {
  return {
    id: p.id,
    name: p.name,
    sessions: String(p.sessions),
    price: String(p.price),
    validDays: String(p.validDays),
    description: p.description ?? '',
    sort: String(p.sort),
    active: p.active,
  };
}

function PlanEditor({ editing, onDone, onCancel }: { editing: AdminVipPlan | null; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState<PlanForm>(editing ? toPlanForm(editing) : EMPTY_PLAN);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof PlanForm>(k: K, v: PlanForm[K]) => setF((p) => ({ ...p, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: f.name.trim(),
      sessions: Number(f.sessions),
      price: Number(f.price),
      validDays: Number(f.validDays),
      description: f.description.trim() || null,
      sort: Number(f.sort || 0),
      active: f.active,
    };
    try {
      if (editing) await adminRequest(`/admin/vip-plans/${editing.id}`, { method: 'PATCH', body });
      else await adminRequest('/admin/vip-plans', { method: 'POST', body: { ...body, id: f.id.trim().toLowerCase() } });
      onDone();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const per = Number(f.sessions) > 0 && Number(f.price) > 0 ? Math.round(Number(f.price) / Number(f.sessions)) : null;

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-[12px] border border-rose-600/20 bg-soft-2 p-4">
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-[repeat(4,minmax(0,1fr))]">
        <label className={labelSm}>
          代號（英文小寫，建立後不能改）
          <input required disabled={!!editing} value={f.id} onChange={(e) => set('id', e.target.value)} placeholder="例：vip-30" maxLength={32} className={inputSm} />
        </label>
        <label className={labelSm}>
          名稱
          <input required value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="例：VIP 30 堂" maxLength={40} className={inputSm} />
        </label>
        <label className={labelSm}>
          堂數
          <input required type="number" min={1} max={200} value={f.sessions} onChange={(e) => set('sessions', e.target.value)} className={inputSm} />
        </label>
        <label className={labelSm}>
          價格（元）{per !== null && <span className="text-ink-400">每堂 {formatPrice(per)}</span>}
          <input required type="number" min={1} value={f.price} onChange={(e) => set('price', e.target.value)} className={inputSm} />
        </label>
        <label className={labelSm}>
          有效天數
          <input required type="number" min={1} max={3650} value={f.validDays} onChange={(e) => set('validDays', e.target.value)} className={inputSm} />
        </label>
        <label className={labelSm}>
          排序（小的在前）
          <input type="number" value={f.sort} onChange={(e) => set('sort', e.target.value)} className={inputSm} />
        </label>
        <label className={`${labelSm} col-span-2`}>
          說明（顯示在方案卡上）
          <input value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="例：每堂 90 分鐘，共 45 小時" maxLength={200} className={inputSm} />
        </label>
      </div>
      <label className="flex items-center gap-2 text-[14px] text-ink-700">
        <input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />
        上架（網站上看得到、可以購買）
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={btnPrimary}>
          {busy ? '儲存中…' : editing ? '儲存' : '新增方案'}
        </button>
        <button type="button" onClick={onCancel} className={btnGhost}>
          取消
        </button>
      </div>
    </form>
  );
}

function PlansCard() {
  const [plans, setPlans] = useState<AdminVipPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminVipPlan | 'new' | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await adminRequest<{ plans: AdminVipPlan[] }>('/admin/vip-plans');
      setPlans(r.plans);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card
      title="VIP 方案"
      actions={
        <button type="button" onClick={() => setEditing('new')} className={btnGhost}>
          新增方案
        </button>
      }
    >
      <p className="text-[13px] leading-[1.8] text-ink-500">
        價格、堂數改了只影響之後的購買；已購買的 VIP 堂數與期限不變（要調整請到上方會員資料）。
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      {editing === 'new' && (
        <PlanEditor
          editing={null}
          onCancel={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      {plans && plans.length === 0 && <Empty>還沒有方案</Empty>}
      {plans && plans.length > 0 && (
        <ul className="flex flex-col gap-3">
          {plans.map((p) =>
            editing !== 'new' && editing?.id === p.id ? (
              <li key={p.id}>
                <PlanEditor
                  editing={p}
                  onCancel={() => setEditing(null)}
                  onDone={() => {
                    setEditing(null);
                    void load();
                  }}
                />
              </li>
            ) : (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line px-4 py-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[15px] font-bold text-ink-900">
                    {p.name} {!p.active && <Badge>未上架</Badge>}
                  </span>
                  <span className="text-[13px] text-ink-500">
                    {p.sessions} 堂・{formatPrice(p.price)}（每堂 {formatPrice(Math.round(p.price / p.sessions))}）・{p.validDays} 天內有效・{p.id}
                  </span>
                </div>
                <button type="button" onClick={() => setEditing(p)} className={btnGhost}>
                  編輯
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </Card>
  );
}

export default function AdminVipPage() {
  return (
    <div className="flex flex-col gap-5">
      <MembersCard />
      <PlansCard />
    </div>
  );
}
