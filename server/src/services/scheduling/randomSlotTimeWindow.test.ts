import dayjs from '@/util/dayjs.js';
import { describe, expect, test } from 'vitest';
import { randomSlotTimeWindow } from './randomSlotTimeWindow.ts';

describe('random slot time windows', () => {
  const overnight = {
    startMinute: 22 * 60,
    endMinute: 2 * 60,
    boundary: 'finish',
  } as const;
  test('recognizes both sides of midnight and excludes the end', () => {
    expect(
      randomSlotTimeWindow(dayjs('2024-01-01T23:00:00'), overnight).end?.format(
        'YYYY-MM-DD HH:mm',
      ),
    ).toBe('2024-01-02 02:00');
    expect(
      randomSlotTimeWindow(dayjs('2024-01-02T01:00:00'), overnight).end?.format(
        'YYYY-MM-DD HH:mm',
      ),
    ).toBe('2024-01-02 02:00');
    const closed = randomSlotTimeWindow(
      dayjs('2024-01-02T02:00:00'),
      overnight,
    );
    expect(closed.end).toBeNull();
    expect(closed.nextStart.format('YYYY-MM-DD HH:mm')).toBe(
      '2024-01-02 22:00',
    );
  });

  test('uses wall-clock boundaries across daylight saving changes', () => {
    const previous = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const range = {
        startMinute: 60,
        endMinute: 240,
        boundary: 'finish',
      } as const;
      const spring = randomSlotTimeWindow(
        dayjs(new Date(2024, 2, 10, 1, 30)),
        range,
      );
      expect(spring.end?.format('YYYY-MM-DD HH:mm Z')).toBe(
        '2024-03-10 04:00 -04:00',
      );
      const fall = randomSlotTimeWindow(
        dayjs(new Date(2024, 10, 3, 1, 30)),
        range,
      );
      expect(fall.end?.format('YYYY-MM-DD HH:mm Z')).toBe(
        '2024-11-03 04:00 -05:00',
      );
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});
