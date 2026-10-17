import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { dataDirs } from 'xdg-basedir';
import parse from 'xdg-parse';

type DesktopFile = Record<string, Record<string, string>>;

export async function readDesktopEntries(): Promise<DesktopFile[]> {
  const entries = new Map<string, DesktopFile>();

  // XDG directories are ordered from highest to lowest priority.
  for (const dir of dataDirs) {
    const applications = join(dir, 'applications');
    const files = await readdir(applications).catch(() => [] as string[]);
    const parsed = await Promise.all(files.filter(file => /\.desktop$/i.test(file)).map(async file => {
      try {
        const entry = parse(await readFile(join(applications, file), 'utf8'));
        return [file, entry] as const;
      } catch {
        // A malformed or unreadable launcher must not prevent other icons loading.
        return null;
      }
    }));

    for (const result of parsed) {
      if (result && !entries.has(result[0])) entries.set(...result);
    }
  }

  return [...entries.values()].filter(entry => entry['Desktop Entry']);
}
