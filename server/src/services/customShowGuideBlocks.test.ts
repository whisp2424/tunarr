import { describe, expect, test } from 'vitest';
import type { LineupItem } from '../db/derived_types/Lineup.ts';
import { groupCustomShowGuideBlocks } from './customShowGuideBlocks.ts';

const entry = (id: string, show: string, startTimeMs: number) => ({
  startTimeMs,
  lineupItem: {
    type: 'content',
    id,
    customShowId: show,
    durationMs: 10,
  } satisfies LineupItem,
});

describe('custom show guide blocks', () => {
  test('combines consecutive enabled shows without changing the lineup', () => {
    const entries = [
      entry('a', 'one', 0),
      entry('b', 'one', 10),
      entry('c', 'two', 20),
      entry('d', 'one', 30),
    ];
    const blocks = groupCustomShowGuideBlocks(
      entries,
      new Map([['one', 'My show']]),
    );
    expect(
      blocks.map((block) => [
        block.startTimeMs,
        block.lineupItem.durationMs,
        block.customBlockTitle,
      ]),
    ).toEqual([
      [0, 20, 'My show'],
      [20, 10, undefined],
      [30, 10, 'My show'],
    ]);
    expect(entries[0].lineupItem.durationMs).toBe(10);
  });

  test('does not combine gaps, different shows with the same name, or paused entries', () => {
    const entries = [
      entry('a', 'one', 0),
      entry('b', 'two', 10),
      entry('c', 'one', 30),
      { ...entry('d', 'one', 40), isPaused: true },
    ];
    const blocks = groupCustomShowGuideBlocks(
      entries,
      new Map([
        ['one', 'Same'],
        ['two', 'Same'],
      ]),
    );
    expect(blocks).toHaveLength(4);
    expect(blocks[3].customBlockTitle).toBeUndefined();
  });
});
