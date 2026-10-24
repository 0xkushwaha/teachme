import { render, referencedVariables } from '../../src/modules/notifications/template-renderer';
import { describeOffset, planReminders } from '../../src/modules/notifications/reminder-scheduler.service';
import { TEMPLATE_DEFAULTS } from '../../src/modules/notifications/templates/defaults';
import { formatInZone } from '../../src/utils/time';

describe('template renderer', () => {
  it('escapes interpolated values to prevent HTML injection', () => {
    expect(render('<p>{{user.name}}</p>', { user: { name: '<img src=x onerror=alert(1)>' } })).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  });
  it('renders conditional sections', () => {
    const t = '{{#if meet.url}}Join {{meet.url}}{{/if}}';
    expect(render(t, { meet: { url: 'https://meet.google.com/abc' } }, false)).toBe('Join https://meet.google.com/abc');
    expect(render(t, { meet: { url: '' } })).toBe('');
  });
  it('every default template only uses variables it declares', () => {
    for (const t of TEMPLATE_DEFAULTS) expect(referencedVariables(t.subject + t.html + t.text).length).toBeGreaterThan(0);
  });
});

describe('reminder planning', () => {
  const now = new Date('2026-11-01T00:00:00Z');
  it('schedules each configured offset before the session', () => {
    const plans = planReminders({ id: 'b1', startAt: new Date('2026-11-03T10:00:00Z') }, [1440, 60], now);
    expect(plans.map((p) => p.fireAt.toISOString())).toEqual(['2026-11-02T10:00:00.000Z', '2026-11-03T09:00:00.000Z']);
  });
  it('skips reminders whose time has already passed', () => {
    const plans = planReminders({ id: 'b1', startAt: new Date('2026-11-01T02:00:00Z') }, [1440, 60], now);
    expect(plans.map((p) => p.offsetMinutes)).toEqual([60]);
  });
  it('uses start-time-specific keys so reschedules create new jobs', () => {
    const a = planReminders({ id: 'b1', startAt: new Date('2026-11-03T10:00:00Z') }, [60], now)[0].key;
    const b = planReminders({ id: 'b1', startAt: new Date('2026-11-03T11:00:00Z') }, [60], now)[0].key;
    expect(a).not.toBe(b);
    expect(a).not.toContain(':');
  });
  it('describes offsets in words', () => {
    expect(describeOffset(1440)).toBe('in 24 hours');
    expect(describeOffset(60)).toBe('in 1 hour');
    expect(describeOffset(30)).toBe('in 30 minutes');
  });
});

describe('timezone display', () => {
  it('renders UTC instants in the recipient timezone', () => {
    const d = new Date('2026-11-02T03:30:00Z');
    expect(formatInZone(d, 'Asia/Kolkata')).toContain('9:00 AM');
    expect(formatInZone(d, 'Europe/London')).toContain('3:30 AM');
  });
});

import { firstName } from '../../src/utils/slug';

describe('greeting names', () => {
  it('skips honorifics', () => {
    expect(firstName('Dr. Meera Iyer')).toBe('Meera');
    expect(firstName('Prof Arjun Mehta')).toBe('Arjun');
    expect(firstName('Lucía Fernández')).toBe('Lucía');
    expect(firstName('Dr.')).toBe('Dr.');
  });
});

import { describeRemaining, isSuperseded } from '../../src/modules/notifications/reminder-scheduler.service';

describe('late reminders', () => {
  it('drops a 24h reminder once the 1h reminder is due', () => {
    expect(isSuperseded(1440, [1440, 60], 50)).toBe(true);
    expect(isSuperseded(1440, [1440, 60], 600)).toBe(false);
    expect(isSuperseded(60, [1440, 60], 50)).toBe(false);
  });
  it('describes the real time remaining', () => {
    expect(describeRemaining(1440)).toBe('in 24 hours');
    expect(describeRemaining(60)).toBe('in 1 hour');
    expect(describeRemaining(52)).toBe('in 52 minutes');
    expect(describeRemaining(300)).toBe('in 5 hours');
  });
});
