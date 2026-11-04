import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { FileStreamSource } from '../stream/types.ts';
import { binaries } from '../testing/ffmpeg/FfmpegTestFixtures.ts';
import {
  ExternalSubtitleStream,
  SubtitleMethods,
} from '../ffmpeg/builder/MediaStream.ts';
import { SubtitlesInputSource } from '../ffmpeg/builder/input/SubtitlesInputSource.ts';
import { SubtitleFilter } from '../ffmpeg/builder/filter/SubtitleFilter.ts';
import { cacheSubtitleFonts } from './SubtitleFontCache.ts';

const fontPath = spawnSync('fc-match', ['-f', '%{file}', 'Carlito'], {
  encoding: 'utf8',
}).stdout;
const fontFamily = spawnSync('fc-match', ['-f', '%{family[0]}', 'Carlito'], {
  encoding: 'utf8',
}).stdout;

test.skipIf(!binaries || !fontPath || !fontFamily)(
  'extracts an attached font and renders styled ASS text',
  async () => {
    if (!binaries) throw new Error('FFmpeg is unavailable');
    const temp = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tunarr-font-render-'),
    );
    try {
      const mkv = path.join(temp, 'video.mkv');
      const ass = path.join(temp, 'subtitles.ass');
      const fonts = path.join(temp, 'cached fonts');
      const run = async (executable: string, args: string[]) => {
        const result = spawnSync(executable, args, {
          encoding: 'utf8',
          maxBuffer: 10_000_000,
        });
        if (result.status !== 0) throw new Error(result.stderr);
        return result.stdout;
      };
      await run(binaries.ffmpeg, [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=black:s=320x180:d=0.1',
        '-attach',
        fontPath,
        '-metadata:s:t',
        'mimetype=application/x-truetype-font',
        '-c:v',
        'ffv1',
        mkv,
      ]);
      await fs.writeFile(
        ass,
        `[Script Info]\nScriptType: v4.00+\nPlayResX: 320\nPlayResY: 180\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${fontFamily},48,&H000000FF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,10,10,10,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,Styled text\n`,
      );
      await cacheSubtitleFonts({
        source: mkv,
        destination: fonts,
        ffmpeg: binaries.ffmpeg,
        ffprobe: binaries.ffprobe,
        run,
      });
      expect((await fs.readdir(fonts)).length).toBe(1);
      const input = new SubtitlesInputSource(
        new FileStreamSource(ass),
        [new ExternalSubtitleStream('ass', SubtitleMethods.Burn)],
        SubtitleMethods.Burn,
        fonts,
      );
      const result = spawnSync(
        binaries.ffmpeg,
        [
          '-hide_banner',
          '-f',
          'lavfi',
          '-i',
          'color=black:s=320x180:d=0.1',
          '-vf',
          new SubtitleFilter(input).filter,
          '-frames:v',
          '1',
          '-pix_fmt',
          'rgb24',
          '-f',
          'rawvideo',
          'pipe:1',
        ],
        { maxBuffer: 1_000_000 },
      );
      expect(result.status, result.stderr.toString()).toBe(0);
      expect(result.stderr.toString()).toContain('Loading font file');
      let redPixels = 0;
      for (let i = 0; i < result.stdout.length; i += 3) {
        if (
          (result.stdout[i] ?? 0) > 100 &&
          (result.stdout[i + 1] ?? 0) < 60 &&
          (result.stdout[i + 2] ?? 0) < 60
        )
          redPixels++;
      }
      expect(redPixels).toBeGreaterThan(50);
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  },
);
