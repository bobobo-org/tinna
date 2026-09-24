import type { MailConfig } from '../env';
import { errorFields, type Logger } from './log';

// 寄信：以 fetch 呼叫 Resend REST API（POST https://api.resend.com/emails），不裝 SDK。
// RESEND_API_KEY 未設定 → dry-run：只 log 收件人網域與主旨（不 log 地址、內容等個資）。

export interface MailAttachment {
  filename: string;
  content: string; // base64
  contentType?: string;
}

export interface MailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
  attachments?: MailAttachment[];
  /** Resend Idempotency-Key（24 小時內同 key 不會重複寄出） */
  idempotencyKey?: string;
  /** log 用的分類，例如 booking_confirmed */
  tag: string;
}

export interface SendResult {
  ok: boolean;
  dryRun: boolean;
  id?: string;
}

export interface Mailer {
  readonly dryRun: boolean;
  send(msg: MailMessage): Promise<SendResult>;
}

export function emailDomain(addr: string): string {
  const at = addr.lastIndexOf('@');
  return at >= 0 ? addr.slice(at + 1).toLowerCase() : 'invalid';
}

export class ResendMailer implements Mailer {
  readonly dryRun: boolean;

  constructor(
    private readonly cfg: MailConfig,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.dryRun = !cfg.resendApiKey;
  }

  async send(msg: MailMessage): Promise<SendResult> {
    const domains = [...new Set(msg.to.map(emailDomain))].join(',');
    if (!this.cfg.resendApiKey) {
      this.logger.info('mail.dry_run', {
        tag: msg.tag,
        to_domain: domains,
        subject: msg.subject,
        attachments: msg.attachments?.map((a) => a.filename) ?? [],
      });
      return { ok: true, dryRun: true };
    }
    try {
      const res = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cfg.resendApiKey}`,
          'Content-Type': 'application/json',
          ...(msg.idempotencyKey ? { 'Idempotency-Key': msg.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: this.cfg.from,
          to: msg.to,
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          ...(msg.attachments?.length
            ? {
                attachments: msg.attachments.map((a) => ({
                  filename: a.filename,
                  content: a.content,
                  ...(a.contentType ? { content_type: a.contentType } : {}),
                })),
              }
            : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; name?: string; message?: string };
      if (!res.ok) {
        this.logger.error('mail.failed', {
          tag: msg.tag,
          to_domain: domains,
          status: res.status,
          resend_error: body.name,
        });
        return { ok: false, dryRun: false };
      }
      this.logger.info('mail.sent', { tag: msg.tag, to_domain: domains, id: body.id });
      return { ok: true, dryRun: false, id: body.id };
    } catch (e) {
      this.logger.error('mail.failed', { tag: msg.tag, to_domain: domains, ...errorFields(e) });
      return { ok: false, dryRun: false };
    }
  }
}
