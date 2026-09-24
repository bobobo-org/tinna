// 自選主題：客人勾選的主題（依優先順序）＋備註＋想問的問題 → 存進 bookings.questions
// （老師的新訂單通知信與 Supabase 後台都看得到，不必另外加欄位）

export function composeTopicQuestions(topics: string[], note: string, questions: string): string {
  const parts = [`【自選主題・依優先順序】\n${topics.map((t, i) => `${i + 1}. ${t}`).join('\n')}`];
  if (note.trim()) parts.push(`【備註】\n${note.trim()}`);
  if (questions.trim()) parts.push(`【想問的問題】\n${questions.trim()}`);
  return parts.join('\n\n');
}
