import type { LineupItem } from '../db/derived_types/Lineup.ts';
import { isNonEmptyString } from '../util/index.ts';

type GuideEntry = {
  lineupItem: LineupItem;
  startTimeMs: number;
  isPaused?: boolean;
};

export function groupCustomShowGuideBlocks<T extends GuideEntry>(
  entries: T[],
  shows: ReadonlyMap<string, string>,
): (T & { customBlockTitle?: string })[] {
  const result: (T & { customBlockTitle?: string })[] = [];
  for (const entry of entries) {
    const item = entry.lineupItem;
    const title =
      item.type === 'content' &&
      isNonEmptyString(item.customShowId) &&
      !entry.isPaused
        ? shows.get(item.customShowId)
        : undefined;
    const previous = result.at(-1);
    if (
      isNonEmptyString(title) &&
      previous &&
      previous.customBlockTitle === title &&
      previous.lineupItem.type === 'content' &&
      item.type === 'content' &&
      previous.lineupItem.customShowId === item.customShowId &&
      previous.startTimeMs + previous.lineupItem.durationMs ===
        entry.startTimeMs
    ) {
      previous.lineupItem = {
        ...previous.lineupItem,
        durationMs: previous.lineupItem.durationMs + item.durationMs,
      };
    } else {
      result.push(
        isNonEmptyString(title)
          ? { ...entry, customBlockTitle: title }
          : { ...entry },
      );
    }
  }
  return result;
}
