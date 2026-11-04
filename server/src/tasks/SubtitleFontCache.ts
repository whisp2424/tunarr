import fs from 'node:fs/promises';
import path from 'node:path';
import z from 'zod';
import { fileExists } from '../util/fsUtil.ts';

const AttachmentProbe = z.object({
  streams: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      codec_name: z.string().optional(),
      tags: z.object({ mimetype: z.string().optional() }).optional(),
    }),
  ),
});

const FontMimeTypes = new Set([
  'application/x-truetype-font',
  'application/x-font-ttf',
  'application/vnd.ms-opentype',
  'application/x-font-opentype',
  'font/ttf',
  'font/otf',
  'font/sfnt',
]);

type Run = (executable: string, args: string[]) => Promise<string>;

/** Populate atomically, including an empty directory for sources without fonts. */
export async function cacheSubtitleFonts({
  source,
  destination,
  ffmpeg,
  ffprobe,
  run,
}: {
  source: string;
  destination: string;
  ffmpeg: string;
  ffprobe: string;
  run: Run;
}): Promise<void> {
  if (await fileExists(destination)) {
    return;
  }

  const output = await run(ffprobe, [
    '-v',
    'error',
    '-select_streams',
    't',
    '-show_entries',
    'stream=index,codec_name:stream_tags=mimetype',
    '-of',
    'json',
    source,
  ]);
  const { streams } = AttachmentProbe.parse(JSON.parse(output));
  const fonts = streams.filter(
    (stream) =>
      stream.codec_name === 'ttf' ||
      stream.codec_name === 'otf' ||
      FontMimeTypes.has((stream.tags?.mimetype ?? '').toLowerCase()),
  );

  await fs.mkdir(path.dirname(destination), { recursive: true });
  const staging = await fs.mkdtemp(`${destination}.tmp-`);
  try {
    if (fonts.length > 0) {
      // Never use container-provided filenames. They may collide or contain paths.
      const dumpArgs = fonts.flatMap((font) => [
        `-dump_attachment:${font.index}`,
        path.join(staging, `${font.index}.ttf`),
      ]);
      await run(ffmpeg, [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        ...dumpArgs,
        '-i',
        source,
        '-map',
        '0:v:0',
        '-c:v',
        'copy',
        '-frames:v',
        '1',
        '-f',
        'null',
        '-',
      ]);
    }
    try {
      await fs.rename(staging, destination);
    } catch (error) {
      if (!(await fileExists(destination))) {
        throw error;
      }
    }
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
