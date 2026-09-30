import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { validateSong, newSong, type Song } from "@eight-bit/core";

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
export type SaveResult = { song: Song; saved: true };

/** One portable JSON file per demo. No Git, notation copies, or run logs. */
export class Library {
  private locks = new Map<string, Promise<unknown>>();
  private fingerprints = new Map<string, string>();
  constructor(public readonly root: string) { this.root = path.resolve(root); }
  async init() { await fs.mkdir(this.root, { recursive: true }); }
  async close() { await Promise.allSettled([...this.locks.values()]); }
  private async serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(fn);
    this.locks.set(key, task);
    try { return await task; }
    finally { if (this.locks.get(key) === task) this.locks.delete(key); }
  }
  private async file(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      throw new Error("INVALID_SONG_ID");
    const file = path.join(this.root, id + ".json");
    try { if ((await fs.lstat(file)).isSymbolicLink()) throw new Error("PATH_ESCAPE"); }
    catch (error) { if (!missing(error)) throw error; }
    return file;
  }
  private hash(raw: string) { return createHash("sha256").update(raw).digest("hex"); }
  private async read(id: string) {
    const raw = await fs.readFile(await this.file(id), "utf8");
    const song = validateSong(JSON.parse(raw));
    if (song.id !== id) throw new Error("SONG_ID_MISMATCH");
    return { song, raw };
  }
  async load(id: string): Promise<Song> {
    const { song, raw } = await this.read(id);
    this.fingerprints.set(id, this.hash(raw));
    return song;
  }
  async list() {
    await this.init();
    const files = await fs.readdir(this.root, { withFileTypes: true });
    const summaries = await Promise.all(files
      .filter((file) => file.isFile() && /^[0-9a-f-]{36}\.json$/i.test(file.name))
      .map(async (file) => {
        const id = file.name.slice(0, -5);
        try {
          const { song } = await this.read(id);
          return { id, title: song.title, updatedAt: song.updatedAt, revision: song.revision, available: true, error: undefined };
        } catch (error) {
          return { id, title: "Unreadable song", updatedAt: "", revision: null, available: false, error: error instanceof Error ? error.message : "Invalid song" };
        }
      }));
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  private async atomic(file: string, raw: string) {
    const temp = path.join(this.root, ".write-" + crypto.randomUUID() + ".tmp");
    try {
      const handle = await fs.open(temp, "wx");
      try { await handle.writeFile(raw); await handle.sync(); }
      finally { await handle.close(); }
      for (let attempt = 0; ; attempt++) {
        try { await fs.rename(temp, file); break; }
        catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (attempt >= 5 || (code !== "EPERM" && code !== "EBUSY")) throw error;
          await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
        }
      }
    } finally { await fs.unlink(temp).catch(() => {}); }
  }
  private async write(song: Song): Promise<SaveResult> {
    validateSong(song);
    const raw = JSON.stringify(song, null, 2) + "\n";
    await this.atomic(await this.file(song.id), raw);
    this.fingerprints.set(song.id, this.hash(raw));
    return { song, saved: true };
  }
  async create(title?: string) {
    return this.serial("create", async () => {
      const songs = await this.list();
      const highest = Math.max(0, ...songs.map((song) => Number(/^Untitled (\d+)$/.exec(song.title)?.[1] || 0)));
      const song = newSong(crypto.randomUUID());
      song.title = title?.trim().slice(0, 120) || "Untitled " + (highest + 1);
      return (await this.write(song)).song;
    });
  }
  async update(id: string, mutate: (song: Song) => Song, expected: number) {
    return this.serial(id, async () => {
      const { song, raw } = await this.read(id);
      if (song.revision !== expected) throw new Error("STALE_REVISION");
      const fingerprint = this.fingerprints.get(id);
      if (fingerprint && fingerprint !== this.hash(raw))
        throw new Error("EXTERNAL_EDIT: reopen the song before saving");
      const next = mutate(structuredClone(song));
      if (next.id !== id || next.createdAt !== song.createdAt) throw new Error("IMMUTABLE_ID");
      next.revision = song.revision + 1;
      next.updatedAt = new Date().toISOString();
      return this.write(next);
    });
  }
  async duplicate(id: string) {
    return this.serial("create", async () => {
      const copy = structuredClone(await this.load(id));
      copy.id = crypto.randomUUID();
      copy.title = (copy.title + " Copy").slice(0, 120);
      copy.createdAt = copy.updatedAt = new Date().toISOString();
      copy.revision = 0;
      return (await this.write(copy)).song;
    });
  }
}
