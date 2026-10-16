// Reading and writing the settings file (settingsFile.ts) in the music folder.
// Client-only (File System Access API).

import { parseSettingsFile, SETTINGS_FILE, type SettingsFile } from "./settingsFile";

/** Our settings file in the folder's root: `ai-dj-mixer-settings.json`, else any .json file that is one of ours. */
export async function readSettingsFile(dir: FileSystemDirectoryHandle): Promise<{ name: string; file: SettingsFile } | null> {
  try {
    const handle = await dir.getFileHandle(SETTINGS_FILE);
    const file = parseSettingsFile(await (await handle.getFile()).text());
    if (file) return { name: SETTINGS_FILE, file };
  } catch {
    /* not there */
  }
  for await (const entry of dir.values()) {
    if (entry.kind !== "file" || entry.name === SETTINGS_FILE || !entry.name.toLowerCase().endsWith(".json")) continue;
    const f = await (entry as FileSystemFileHandle).getFile();
    if (f.size > 20_000_000) continue;
    const file = parseSettingsFile(await f.text());
    if (file) return { name: entry.name, file };
  }
  return null;
}

/** May the app write into the folder? (Folders without a permission model — the browser's own storage — may.) */
export async function canWrite(dir: FileSystemDirectoryHandle): Promise<boolean> {
  if (!dir.queryPermission) return true;
  return (await dir.queryPermission({ mode: "readwrite" })) === "granted";
}

/** Ask to write into the folder (needs a click: Chrome shows its "edit files" prompt). */
export async function requestWrite(dir: FileSystemDirectoryHandle): Promise<boolean> {
  if (!dir.requestPermission) return canWrite(dir);
  return (await dir.requestPermission({ mode: "readwrite" })) === "granted";
}

export async function writeSettingsFile(dir: FileSystemDirectoryHandle, file: SettingsFile): Promise<void> {
  const handle = await dir.getFileHandle(SETTINGS_FILE, { create: true });
  const w = await handle.createWritable();
  await w.write(JSON.stringify(file, null, 2));
  await w.close();
}
