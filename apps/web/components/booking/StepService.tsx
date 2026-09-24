import Link from 'next/link';
import type { ReactNode, Ref } from 'react';
import { findService, formatPrice, isTopicTier, splitVip, topicTiers, type Service } from '@/lib/services';
import { focusRingWithin } from './styles';
import TopicPicker from './TopicPicker';

/** 一張方案卡（原生 radio，方向鍵可切換） */
function PlanCard({
  value,
  on,
  onSelect,
  title,
  sub,
  price,
}: {
  value: string;
  on: boolean;
  onSelect: () => void;
  title: string;
  sub: string;
  price: ReactNode;
}) {
  return (
    <label
      className={`relative grid cursor-pointer grid-cols-[22px_1fr_auto] items-center gap-3 rounded-[14px] px-[14px] py-4 md:gap-4 md:px-5 md:py-[18px] ${focusRingWithin} ${
        on ? 'border-2 border-rose-600 bg-selected' : 'border border-line bg-white'
      }`}
    >
      <input type="radio" name="bk-svc" value={value} checked={on} onChange={onSelect} className="sr-only" />
      <span
        aria-hidden="true"
        className="box-content flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-rose-600"
      >
        <span className={`h-[10px] w-[10px] rounded-full ${on ? 'bg-rose-600' : 'bg-transparent'}`} />
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-[17px] font-bold text-ink-900">{title}</span>
        <span className="text-[13px] text-ink-500">{sub}</span>
      </span>
      <span className="text-[18px] font-bold text-rose-800">{price}</span>
    </label>
  );
}

/**
 * Step 1 選擇方案：單選列表
 * 自選主題的幾個價位合成一張卡（放在第一個價位的排序位置），選了之後下方展開主題勾選
 * VIP 諮詢（vipOnly）放在最後的「VIP 會員」區塊：用堂數預約，不顯示價格
 */
export default function StepService({
  services,
  selected,
  onPick,
  topics,
  onToggleTopic,
  topicNote,
  onTopicNote,
  notice,
  headingRef,
}: {
  services: Service[];
  selected: string | null;
  onPick: (id: string) => void;
  topics: string[];
  onToggleTopic: (topic: string) => void;
  topicNote: string;
  onTopicNote: (value: string) => void;
  /** API 退回 Step 1 時的訊息（例：主題數量不足） */
  notice: string | null;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const { plans, vip } = splitVip(services);
  const tiers = topicTiers(plans);
  const anchor = plans.find(isTopicTier)?.id;
  const topicOn = isTopicTier(findService(services, selected));
  const minutes = tiers.map((t) => t.minutes);
  const lo = Math.min(...minutes);
  const hi = Math.max(...minutes);

  return (
    <div className="flex flex-col gap-[14px]">
      <h2 ref={headingRef} id="bk-step-title" tabIndex={-1} className="font-serif text-[22px] font-bold text-ink-900 outline-none">
        選擇諮詢方案
      </h2>
      {notice && (
        <p role="alert" className="rounded-[10px] border border-rose-600/30 bg-soft px-[14px] py-3 text-[14px] text-rose-800">
          {notice}
        </p>
      )}
      <div role="radiogroup" aria-labelledby="bk-step-title" className="flex flex-col gap-[14px]">
        {plans.map((s) => {
          if (!isTopicTier(s)) {
            return (
              <PlanCard
                key={s.id}
                value={s.id}
                on={selected === s.id}
                onSelect={() => onPick(s.id)}
                title={s.name}
                sub={`${s.minutes} 分鐘 · ${s.tagline}`}
                price={formatPrice(s.price)}
              />
            );
          }
          if (s.id !== anchor) return null;
          return (
            <PlanCard
              key="topics"
              value="topics"
              on={topicOn}
              onSelect={() => onPick(tiers[0].id)}
              title={tiers[0].short}
              sub={`${lo === hi ? lo : `${lo}～${hi}`} 分鐘 · ${tiers[0].tagline}`}
              price={
                <>
                  {formatPrice(tiers[0].price)}
                  <span className="text-[13px] font-normal"> 起</span>
                </>
              }
            />
          );
        })}
        {vip.length > 0 && (
          <p className="mt-2 flex items-center gap-3 text-[13px] tracking-[.2em] text-rose-accent" aria-hidden="true">
            <span className="h-px flex-1 bg-rose-600/20" />
            VIP 會員
            <span className="h-px flex-1 bg-rose-600/20" />
          </p>
        )}
        {vip.map((s) => (
          <PlanCard
            key={s.id}
            value={s.id}
            on={selected === s.id}
            onSelect={() => onPick(s.id)}
            title={s.name}
            sub={`${s.minutes} 分鐘 · 輸入 VIP 卡號，使用堂數預約`}
            price={<span className="text-[15px]">VIP 堂數</span>}
          />
        ))}
      </div>
      {topicOn && <TopicPicker tiers={tiers} topics={topics} onToggle={onToggleTopic} note={topicNote} onNote={onTopicNote} />}
      {vip.length > 0 && (
        <p className="text-[13px] leading-[1.8] text-ink-500">
          想要更划算？
          <Link href="/vip" className="text-rose-800 underline underline-offset-4">
            VIP 包堂方案
          </Link>
          堂數越多、每堂越便宜。
        </p>
      )}
    </div>
  );
}
