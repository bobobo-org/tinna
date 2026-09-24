import { formatPrice, tierFor, tierRangeLabel, topicRange, type TopicTier } from '@/lib/services';
import { TOPICS, TOPIC_NOTE_MAX } from '@/lib/topics';
import { focusRing, inputCls } from './styles';

/**
 * 自選主題：勾選主題（先點的排前面＝優先順序）、依題數顯示價位、備註
 * 價位是 services 表的幾列（topicLimit＝該價位最多幾題），題數改變時由 BookingFlow 換成對應的價位
 */
export default function TopicPicker({
  tiers,
  topics,
  onToggle,
  note,
  onNote,
}: {
  tiers: TopicTier[];
  topics: string[];
  onToggle: (topic: string) => void;
  note: string;
  onNote: (value: string) => void;
}) {
  const range = topicRange(tiers);
  if (!range) return null;
  const n = topics.length;
  const tier = n >= range.min ? tierFor(tiers, n) : undefined;
  const full = n >= range.max;

  let status: string;
  if (!tier) status = n === 0 ? `請選 ${range.min} 題以上` : `已選 ${n} 題，再選 ${range.min - n} 題就可以預約`;
  else {
    status = `已選 ${n} 題 · ${formatPrice(tier.price)} · ${tier.minutes} 分鐘`;
    if (n < tier.topicLimit) status += `（再選 ${tier.topicLimit - n} 題不加價）`;
  }

  return (
    <section
      aria-labelledby="bk-topics-title"
      className="flex flex-col gap-3 rounded-[14px] border border-rose-600/20 bg-soft px-[14px] py-4 md:px-5 md:py-5"
    >
      <h3 id="bk-topics-title" className="text-[16px] font-bold text-ink-900">
        勾選想問的主題
      </h3>
      <p id="bk-topics-hint" className="text-[13px] leading-[1.8] text-ink-500">
        依你最想知道的順序點選：先點的排在前面，老師會優先解答。
        {range.min === range.max ? `請選 ${range.min} 題。` : `至少 ${range.min} 題、最多 ${range.max} 題。`}
        想換順序，取消後再依序點選即可。
      </p>

      <div role="group" aria-labelledby="bk-topics-title" aria-describedby="bk-topics-hint" className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {TOPICS.map((t) => {
          const rank = topics.indexOf(t) + 1;
          const on = rank > 0;
          const disabled = !on && full;
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              aria-label={on ? `${t}，第 ${rank} 優先` : t}
              disabled={disabled}
              onClick={() => onToggle(t)}
              className={`flex min-h-[44px] items-center gap-2 rounded-[10px] px-3 py-2 text-left text-[14px] leading-[1.4] ${focusRing} ${
                on ? 'border-2 border-rose-600 bg-selected font-bold text-rose-800' : 'border border-line-2 bg-white text-ink-700'
              } ${disabled ? 'opacity-40' : ''}`}
            >
              <span
                aria-hidden="true"
                className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
                  on ? 'bg-rose-600 text-white' : 'border border-line-2'
                }`}
              >
                {on ? rank : ''}
              </span>
              <span>{t}</span>
            </button>
          );
        })}
      </div>

      <p aria-live="polite" className="text-[14px] font-bold text-rose-800">
        {status}
      </p>
      {n > 0 && (
        <p className="text-[13px] leading-[1.8] text-ink-600">
          優先順序：{topics.map((t, i) => `${i + 1}. ${t}`).join('　')}
        </p>
      )}

      <ul aria-label="題數與價格" className="flex flex-wrap gap-2 text-[12px]">
        {tiers.map((t, i) => (
          <li
            key={t.id}
            className={`rounded-pill px-3 py-1 ${tier?.id === t.id ? 'bg-rose-600 text-white' : 'border border-line-2 bg-white text-ink-600'}`}
          >
            {`${tierRangeLabel(tiers, i)} ${formatPrice(t.price)} · ${t.minutes} 分鐘`}
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-[6px] text-[14px] text-ink-600">
        <label htmlFor="bk-topic-note">備註（選填）</label>
        <textarea
          id="bk-topic-note"
          name="topic_note"
          value={note}
          onChange={(e) => onNote(e.target.value)}
          rows={3}
          maxLength={TOPIC_NOTE_MAX}
          placeholder="想補充說明的狀況，例如：選了「其他」想問的是什麼"
          className={`${inputCls} resize-y`}
        />
      </div>
    </section>
  );
}
