import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  validateSong,
  serializeNotation,
  newSong,
  type Song,
} from "@eight-bit/core";
const exec = promisify(execFile);
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT";
export type SaveResult = {
  song: Song;
  history: "committed" | "pending";
  saved: true;
};
export class Library {
  private locks = new Map<string, Promise<unknown>>();
  private ready?: Promise<void>;
  private fingerprints = new Map<string, string>();
  private owner = crypto.randomUUID();
  constructor(
    public readonly root: string,
    private readonly git: typeof exec = exec,
  ) {
    this.root = path.resolve(root);
  }
  async init() {
    return (this.ready ??= this.initialize());
  }
  private async initialize() {
    await fs.mkdir(this.root, { recursive: true });
    const lock = path.join(this.root, ".library.lock");
    try {
      const file = await fs.open(lock, "wx");
      try {
        await file.writeFile(
          JSON.stringify({ pid: process.pid, owner: this.owner }),
        );
        await file.sync();
      } finally {
        await file.close();
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error(
          "LIBRARY_LOCKED: another server or an unverified stale lock owns this library",
        );
      throw e;
    }
  }
  async close() {
    await Promise.allSettled([...this.locks.values()]);
    if (!this.ready) return;
    await this.ready;
    const file = path.join(this.root, ".library.lock");
    const lock = JSON.parse(await fs.readFile(file, "utf8"));
    if (lock.owner === this.owner) await fs.unlink(file);
  }
  private async serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(fn);
    this.locks.set(id, task);
    try {
      return await task;
    } finally {
      if (this.locks.get(id) === task) this.locks.delete(id);
    }
  }
  private async dir(id: string, create = false) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      throw new Error("INVALID_SONG_ID");
    await this.init();
    const dir = path.join(this.root, id);
    if (create) await fs.mkdir(dir, { recursive: true });
    const real = await fs.realpath(dir),
      root = await fs.realpath(this.root),
      relative = path.relative(root, real);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      relative === ""
    )
      throw new Error("PATH_ESCAPE");
    // App-managed subpaths may not redirect writes via symlinks/junctions.
    for (const name of [
      "song.json",
      "song.txt",
      ".local",
      ".git",
      ".gitignore",
    ]) {
      try {
        if ((await fs.lstat(path.join(dir, name))).isSymbolicLink())
          throw new Error("PATH_ESCAPE");
      } catch (e) {
        if (!missing(e)) throw e;
      }
    }
    return dir;
  }
  private hash(raw: string) {
    return createHash("sha256").update(raw).digest("hex");
  }
  private async read(id: string): Promise<{ song: Song; raw: string }> {
    const raw = await fs.readFile(
        path.join(await this.dir(id), "song.json"),
        "utf8",
      ),
      song = validateSong(JSON.parse(raw));
    if (song.id !== id) throw new Error("SONG_ID_MISMATCH");
    serializeNotation(song);
    return { song, raw };
  }
  async load(id: string): Promise<Song> {
    const { song, raw } = await this.read(id);
    if (!this.fingerprints.has(id)) this.fingerprints.set(id, this.hash(raw));
    return song;
  }
  async list() {
    await this.init();
    const dirs = await fs.readdir(this.root, { withFileTypes: true });
    const out = [];
    for (const d of dirs.filter((d) => d.isDirectory())) {
      try {
        const song = await this.load(d.name);
        out.push({
          id: song.id,
          title: song.title,
          updatedAt: song.updatedAt,
          revision: song.revision,
          available: true,
          history: await this.historyState(d.name),
        });
      } catch (e) {
        out.push({
          id: d.name,
          title: "Unavailable song",
          updatedAt: null,
          revision: null,
          available: false,
          error: e instanceof Error ? e.message : "Invalid song",
        });
      }
    }
    return out;
  }
  private async atomic(file: string, text: string) {
    const temp = path.join(
        path.dirname(file),
        ".write-" + crypto.randomUUID() + ".tmp",
      ),
      handle = await fs.open(temp, "wx");
    try {
      await handle.writeFile(text);
      await handle.sync();
    } finally {
      await handle.close();
    }
    // Windows can transiently lock a file while a reader, indexer, or security
    // scanner has it open. Keep atomic replacement, but retry that narrow case.
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await fs.rename(temp, file);
        return;
      } catch (e: any) {
        const transient = e?.code === "EPERM" || e?.code === "EBUSY";
        if (!transient || attempt === 5) {
          await fs.unlink(temp).catch(() => {});
          throw e;
        }
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
  }
  private async historyState(id: string): Promise<"committed" | "pending"> {
    try {
      await fs.access(path.join(await this.dir(id), ".local", "pending.json"));
      return "pending";
    } catch (e) {
      if (!missing(e)) throw e;
      return "committed";
    }
  }
  private async finishHistory(id: string): Promise<"committed" | "pending"> {
    const dir = await this.dir(id),
      song = await this.load(id),
      pending = path.join(dir, ".local", "pending.json");
    let marker: { proposalId?: string } = {};
    try {
      marker = JSON.parse(await fs.readFile(pending, "utf8"));
    } catch (e) {
      if (!missing(e)) throw e;
      await fs.mkdir(path.join(dir, ".local"), { recursive: true });
      await this.atomic(pending, JSON.stringify({ revision: song.revision }));
    }
    try {
      await this.atomic(
        path.join(dir, "song.txt"),
        serializeNotation(song) + "\n",
      );
      await fs.writeFile(
        path.join(dir, ".gitignore"),
        "/.local/\n/exports/\n/.write-*.tmp\n",
      );
      await this.git("git", ["init", "-q"], { cwd: dir });
      await this.git(
        "git",
        ["add", "--", "song.json", "song.txt", ".gitignore"],
        {
          cwd: dir,
        },
      );
      const status = await this.git(
        "git",
        ["diff", "--cached", "--name-only"],
        {
          cwd: dir,
        },
      );
      if (status.stdout.trim())
        await this.git(
          "git",
          [
            "-c",
            "user.name=8-bit Music Maker",
            "-c",
            "user.email=local@8bit-music-maker.invalid",
            "commit",
            "-m",
            "revision " +
              song.revision +
              (marker.proposalId ? " proposal " + marker.proposalId : ""),
          ],
          { cwd: dir },
        );
      if (marker.proposalId)
        await this.atomic(
          path.join(dir, ".local", "accepted-" + marker.proposalId + ".json"),
          JSON.stringify({ song, history: "committed", saved: true }),
        );
      await fs.unlink(pending).catch((e) => {
        if (!missing(e)) throw e;
      });
      return "committed";
    } catch {
      return "pending";
    }
  }
  async retryHistory(id: string) {
    return this.serial(id, async () => ({
      history: await this.finishHistory(id),
    }));
  }
  async accepted(
    id: string,
    proposalId: string,
  ): Promise<SaveResult | undefined> {
    if (!/^[0-9a-f-]{36}$/i.test(proposalId))
      throw new Error("INVALID_PROPOSAL");
    try {
      return JSON.parse(
        await fs.readFile(
          path.join(
            await this.dir(id),
            ".local",
            "accepted-" + proposalId + ".json",
          ),
          "utf8",
        ),
      );
    } catch (e) {
      if (!missing(e)) throw e;
    }
    const dir = await this.dir(id);
    try {
      const p = JSON.parse(
        await fs.readFile(path.join(dir, ".local", "pending.json"), "utf8"),
      );
      if (p.proposalId === proposalId) {
        const song = await this.load(id);
        if (song.revision === p.revision)
          return { song, history: "pending", saved: true };
      }
    } catch (e) {
      if (!missing(e)) throw e;
    }
  }
  private async saveLocked(
    input: Song,
    expectedRevision?: number,
    commit = true,
    proposalId?: string,
  ): Promise<SaveResult> {
    const song = validateSong(input),
      notation = serializeNotation(song),
      dir = await this.dir(song.id, true);
    if (proposalId) {
      const accepted = await this.accepted(song.id, proposalId);
      if (accepted) return accepted;
    }
    let current: { song: Song; raw: string } | undefined;
    try {
      current = await this.read(song.id);
    } catch (e) {
      if (!missing(e)) throw e;
    }
    if (current) {
      if (
        (await this.historyState(song.id)) === "pending" &&
        (await this.finishHistory(song.id)) === "pending"
      )
        throw new Error("HISTORY_PENDING");
      if (
        expectedRevision === undefined ||
        current.song.revision !== expectedRevision ||
        song.revision !== current.song.revision + 1
      )
        throw new Error("STALE_REVISION");
      const fingerprint = this.fingerprints.get(song.id);
      if (fingerprint && fingerprint !== this.hash(current.raw))
        throw new Error("EXTERNAL_EDIT: reopen after reviewing changes");
      if (song.createdAt !== current.song.createdAt)
        throw new Error("IMMUTABLE_CREATED_AT");
    } else if (expectedRevision !== undefined)
      throw new Error("STALE_REVISION");
    await fs.mkdir(path.join(dir, ".local"), { recursive: true });
    if (current)
      await this.atomic(path.join(dir, ".local", "previous.json"), current.raw);
    // Marker is written before replacement; its revision distinguishes interrupted pre-save writes.
    await this.atomic(
      path.join(dir, ".local", "pending.json"),
      JSON.stringify({ revision: song.revision, proposalId }),
    );
    const raw = JSON.stringify(song, null, 2) + "\n";
    try {
      await this.atomic(path.join(dir, "song.json"), raw);
    } catch (e) {
      await fs.unlink(path.join(dir, ".local", "pending.json")).catch(() => {});
      throw e;
    }
    this.fingerprints.set(song.id, this.hash(raw));
    let history: "committed" | "pending" = "pending";
    if (commit) history = await this.finishHistory(song.id);
    const result: SaveResult = { song, history, saved: true };
    if (proposalId)
      await this.atomic(
        path.join(dir, ".local", "accepted-" + proposalId + ".json"),
        JSON.stringify(result),
      ).catch(() => {});
    return result;
  }
  async save(
    song: Song,
    expectedRevision?: number,
    commit = true,
    proposalId?: string,
  ) {
    return this.serial(song.id, () =>
      this.saveLocked(song, expectedRevision, commit, proposalId),
    );
  }
  async create(title = "Untitled Loop") {
    const song = newSong(crypto.randomUUID());
    song.title = title.trim().slice(0, 120) || song.title;
    song.music.tracks.forEach((t) => (t.id = crypto.randomUUID()));
    return (await this.save(song)).song;
  }
  async update(
    id: string,
    mutate: (song: Song) => Song,
    expected: number,
    proposalId?: string,
  ) {
    return this.serial(id, async () => {
      if (proposalId) {
        const accepted = await this.accepted(id, proposalId);
        if (accepted) return accepted;
      }
      const song = await this.load(id);
      if (song.revision !== expected) throw new Error("STALE_REVISION");
      const next = mutate(structuredClone(song));
      if (next.id !== song.id) throw new Error("IMMUTABLE_ID");
      next.revision = song.revision + 1;
      next.updatedAt = new Date().toISOString();
      return this.saveLocked(next, expected, true, proposalId);
    });
  }
  async rename(id: string, title: string, expectedRevision?: number) {
    const revision = expectedRevision ?? (await this.load(id)).revision;
    return (
      await this.update(id, (s) => ({ ...s, title: title.trim() }), revision)
    ).song;
  }
  async duplicate(id: string) {
    const next = structuredClone(await this.load(id));
    next.id = crypto.randomUUID();
    next.createdAt = next.updatedAt = new Date().toISOString();
    next.revision = 0;
    next.title = (next.title + " Copy").slice(0, 120);
    for (const t of next.music.tracks) {
      t.id = crypto.randomUUID();
      for (const n of t.notes) n.id = crypto.randomUUID();
    }
    return (await this.save(next)).song;
  }
  async history(id: string) {
    const dir = await this.dir(id);
    try {
      const { stdout } = await this.git(
        "git",
        ["log", "--format=%H%x09%s", "--", "song.json"],
        { cwd: dir },
      );
      return stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [commit, ...message] = line.split("\t");
          return { commit, message: message.join("\t") };
        });
    } catch {
      return [];
    }
  }
  async restore(id: string, commit: string, expected: number) {
    if (!(await this.history(id)).some((x) => x.commit === commit))
      throw new Error("UNKNOWN_HISTORY");
    const { stdout } = await this.git("git", ["show", commit + ":song.json"], {
      cwd: await this.dir(id),
    });
    const old = validateSong(JSON.parse(stdout));
    return this.update(
      id,
      (current) => ({
        ...current,
        title: old.title,
        brief: old.brief,
        music: old.music,
      }),
      expected,
    );
  }
  async recordRun(id: string, runId: string, summary: unknown) {
    if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new Error("INVALID_RUN_ID");
    const dir = await this.dir(id);
    await fs.mkdir(path.join(dir, ".local"), { recursive: true });
    await this.atomic(
      path.join(dir, ".local", "run-" + runId + ".json"),
      JSON.stringify(summary, null, 2),
    );
  }
  async readRun(id: string, runId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new Error("INVALID_RUN_ID");
    const file = path.join(
      await this.dir(id),
      ".local",
      "run-" + runId + ".json",
    );
    if ((await fs.lstat(file)).isSymbolicLink()) throw new Error("PATH_ESCAPE");
    return JSON.parse(await fs.readFile(file, "utf8"));
  }
  async listRuns(id: string) {
    const local = path.join(await this.dir(id), ".local");
    const result = [];
    for (const name of await fs.readdir(local)) {
      if (!/^run-[0-9a-f-]{36}\.json$/i.test(name)) continue;
      const runId = name.slice(4, -5);
      try {
        const r = await this.readRun(id, runId);
        result.push({
          id: runId,
          status: r.status,
          startedAt: r.startedAt,
          stage: r.stage,
          deadlineAt: r.deadlineAt,
          updatedAt: r.updatedAt,
          endedAt: r.endedAt,
          modelStream: r.modelStream,
          passage: r.passage,
          error: r.error,
        });
      } catch {
        /* One corrupt diagnostic must not hide the others. */
      }
    }
    return result.sort((a, b) =>
      (b.startedAt ?? "").localeCompare(a.startedAt ?? ""),
    );
  }
  async recover() {
    await this.init();
    for (const item of await this.list())
      if (item.available)
        await this.serial(item.id, async () => {
          const dir = await this.dir(item.id),
            current = await this.load(item.id);
          try {
            const marker = JSON.parse(
              await fs.readFile(
                path.join(dir, ".local", "pending.json"),
                "utf8",
              ),
            );
            if (marker.revision !== current.revision)
              await fs.unlink(path.join(dir, ".local", "pending.json"));
          } catch (e) {
            if (!missing(e)) throw e;
          }
          await this.finishHistory(item.id);
          const local = path.join(dir, ".local");
          for (const name of await fs.readdir(local))
            if (/^run-[0-9a-f-]{36}\.json$/i.test(name)) {
              try {
                const record = JSON.parse(
                  await fs.readFile(path.join(local, name), "utf8"),
                );
                if (record.status === "running")
                  await this.atomic(
                    path.join(local, name),
                    JSON.stringify({ ...record, status: "interrupted" }),
                  );
              } catch {
                /* Corrupt diagnostic logs never replace music. */
              }
            }
        });
  }
}
