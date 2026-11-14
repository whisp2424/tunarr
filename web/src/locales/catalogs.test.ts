import { describe, expect, test } from 'vitest';
import { setupI18n } from '@lingui/core';
import { messages as englishMessages } from './en/messages.po';

// PR CI never compiles the catalogs, so a bad merge only fails the release bundle.

const catalogs = import.meta.glob<string>('./*/messages.po', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const conflictMarker = /<<<<<<<|=======|>>>>>>>/;

describe('lingui catalogs', () => {
  test('English labels for custom-show blocks and slot windows are available', () => {
    const i18n = setupI18n({ locale: 'en', messages: { en: englishMessages } });
    expect(i18n._('0a9aza')).toBe(
      'Show consecutive videos as one block in the guide and channel editor',
    );
    expect(i18n._('iuKHQX')).toBe('Restrict playback to a time range');
    expect(i18n._('xAYSEs')).toBe('Start time');
    expect(i18n._('vTL8gi')).toBe('End time');
    expect(i18n._('oBMGql')).toBe('Window rule');
    expect(i18n._('q32knw')).toBe('Finish within range');
  });

  test('every locale has a catalog', () => {
    expect(Object.keys(catalogs).sort()).toEqual([
      './en/messages.po',
      './es/messages.po',
      './pseudo-LOCALE/messages.po',
      './zh-CN/messages.po',
    ]);
  });

  test.each(Object.entries(catalogs))(
    '%s has no merge conflict markers',
    (_path, contents) => {
      const marked = contents
        .split('\n')
        .filter((line) => conflictMarker.test(line));
      expect(marked).toEqual([]);
    },
  );
});
