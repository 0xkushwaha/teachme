import { toIcs } from '../../src/modules/bookings/booking.mapper';

describe('iCalendar export', () => {
  const booking = {
    id: '11111111-2222-3333-4444-555555555555',
    status: 'CONFIRMED',
    startAt: new Date('2026-11-02T12:30:00Z'),
    endAt: new Date('2026-11-02T13:30:00Z'),
    subject: { id: 's', name: 'Physics; Mechanics, Part 1', slug: 'physics' },
    teacher: { id: 't', slug: 'x', avatarUrl: null, timezone: 'Asia/Kolkata', user: { fullName: 'Dr. Meera Iyer' } },
  } as never;

  it('escapes RFC 5545 special characters and uses UTC times', () => {
    const ics = toIcs(booking, 'https://meet.google.com/abc-defg-hij', 'https://app.test');
    expect(ics).toContain('SUMMARY:Physics\\; Mechanics\\, Part 1 with Dr. Meera Iyer');
    expect(ics).toContain('DTSTART:20261102T123000Z');
    expect(ics).toContain('DTEND:20261102T133000Z');
    expect(ics).toContain('LOCATION:https://meet.google.com/abc-defg-hij');
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
  });
});
