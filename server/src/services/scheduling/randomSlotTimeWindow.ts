import dayjs from '@/util/dayjs.js';
import type { RandomSlot } from '@tunarr/types/api';

/** Resolves daily wall-clock boundaries in the server's local time zone. */
export function randomSlotTimeWindow(
  time: dayjs.Dayjs,
  window: NonNullable<RandomSlot['timeWindow']>,
): { end: dayjs.Dayjs | null; nextStart: dayjs.Dayjs } {
  const local = new Date(+time);
  const boundary = (dayOffset: number, minute: number) =>
    dayjs(
      new Date(
        local.getFullYear(),
        local.getMonth(),
        local.getDate() + dayOffset,
        Math.floor(minute / 60),
        minute % 60,
      ),
    );
  const start = boundary(0, window.startMinute);
  const end = boundary(0, window.endMinute);
  if (window.startMinute === window.endMinute) {
    return { end: boundary(1, window.endMinute), nextStart: time };
  }
  if (window.startMinute < window.endMinute) {
    if (+time >= +start && +time < +end)
      return { end, nextStart: boundary(1, window.startMinute) };
    return {
      end: null,
      nextStart: +time < +start ? start : boundary(1, window.startMinute),
    };
  }
  if (+time >= +start)
    return {
      end: boundary(1, window.endMinute),
      nextStart: boundary(1, window.startMinute),
    };
  if (+time < +end) return { end, nextStart: start };
  return { end: null, nextStart: start };
}
