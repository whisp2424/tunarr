import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheSubtitleFonts } from './SubtitleFontCache.ts';

let temp: string;
beforeEach(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'tunarr-fonts-'));
});
afterEach(async () => {
  await fs.rm(temp, { recursive: true, force: true });
});

describe('subtitle font cache', () => {
  it('extracts only fonts using safe filenames and reuses the completed cache', async () => {
    const destination = path.join(temp, 'cache', 'program');
    const run = vi.fn(async (executable: string, args: string[]) => {
      if (executable === 'ffprobe') {
        return JSON.stringify({
          streams: [
            {
              index: 4,
              codec_name: 'ttf',
              tags: { filename: '../../unsafe.ttf' },
            },
            { index: 5, codec_name: 'bin', tags: { mimetype: 'image/jpeg' } },
            { index: 6, codec_name: 'otf' },
          ],
        });
      }
      for (const index of [4, 6]) {
        const position = args.indexOf(`-dump_attachment:${index}`);
        const filename = args[position + 1];
        if (!filename || position < 0) throw new Error('missing output');
        await fs.writeFile(filename, `font ${index}`);
      }
      expect(args).not.toContain('-dump_attachment:5');
      return '';
    });
    const request = {
      source: 'movie.mkv',
      destination,
      ffmpeg: 'ffmpeg',
      ffprobe: 'ffprobe',
      run,
    };
    await cacheSubtitleFonts(request);
    expect(await fs.readdir(destination)).toEqual(['4.ttf', '6.ttf']);
    expect(await fs.readFile(path.join(destination, '4.ttf'), 'utf8')).toBe(
      'font 4',
    );
    await cacheSubtitleFonts(request);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not publish a partial cache and retries after extraction fails', async () => {
    const destination = path.join(temp, 'program');
    const run = vi.fn(async (executable: string) => {
      if (executable === 'ffprobe')
        return JSON.stringify({ streams: [{ index: 3, codec_name: 'ttf' }] });
      throw new Error('failed to extract');
    });
    const request = {
      source: 'movie.mkv',
      destination,
      ffmpeg: 'ffmpeg',
      ffprobe: 'ffprobe',
      run,
    };
    await expect(cacheSubtitleFonts(request)).rejects.toThrow(
      'failed to extract',
    );
    expect(await fs.readdir(temp)).toEqual([]);
    await expect(cacheSubtitleFonts(request)).rejects.toThrow(
      'failed to extract',
    );
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('records a successful probe with no fonts so it is not repeated', async () => {
    const run = vi.fn(async () => JSON.stringify({ streams: [] }));
    const request = {
      source: 'movie.mkv',
      destination: path.join(temp, 'program'),
      ffmpeg: 'ffmpeg',
      ffprobe: 'ffprobe',
      run,
    };
    await cacheSubtitleFonts(request);
    await cacheSubtitleFonts(request);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
