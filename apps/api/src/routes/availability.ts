import { Hono } from 'hono';
import type { AppDeps } from '../deps';
import { computeMonth, isAllowedMonth, monthRange } from '../lib/availability';
import { apiError } from '../lib/http';
import { TIMEZONE } from '../lib/time';

export function availabilityRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get('/availability', async (c) => {
    const now = deps.now();
    const month = c.req.query('month') ?? '';
    if (!isAllowedMonth(month, now)) {
      const message = '只能查詢本月與之後兩個月的時段';
      return apiError(c, 400, 'validation', message, { month: message });
    }

    let durationMinutes: number | undefined;
    const serviceId = c.req.query('service');
    if (serviceId) {
      const svc = await deps.db.getActiveService(serviceId);
      if (!svc) {
        const message = '找不到這個方案';
        return apiError(c, 400, 'validation', message, { service: message });
      }
      durationMinutes = svc.minutes;
    }

    const range = monthRange(month);
    const [weekly, overrides, busy] = await Promise.all([
      deps.db.listWeeklySlots(),
      deps.db.listOverrides(range.firstDate, range.lastDate),
      deps.db.listBusyBookings(range.from, range.to),
    ]);
    const days = computeMonth(month, { now, weekly, overrides, busy, durationMinutes });
    return c.json({ month, timezone: TIMEZONE, days });
  });

  return app;
}
