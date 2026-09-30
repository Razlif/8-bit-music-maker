import { expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { Library } from "../src/library.js";

it("keeps one portable file per song; init and listing create no songs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "demo-library-"));
  const lib = new Library(root);
  try {
    await lib.init();
    expect(await lib.list()).toEqual([]);
    expect(await fs.readdir(root)).toEqual([]);
    const [a, b] = await Promise.all([lib.create(), lib.create()]);
    expect([a.title, b.title]).toEqual(["Untitled 1", "Untitled 2"]);
    const result = await lib.update(a.id, song => ({ ...song, title: "Theme" }), 0);
    expect(result.saved).toBe(true);
    const copy = await lib.duplicate(a.id);
    expect(copy.title).toBe("Theme Copy");
    expect(copy.music).toEqual(result.song.music);
    await lib.close();
    const reopened = new Library(root);
    await reopened.init();
    expect((await reopened.load(a.id)).title).toBe("Theme");
    expect((await reopened.create()).title).toBe("Untitled 3");
    expect((await fs.readdir(root)).sort()).toEqual((await reopened.list()).map(s => s.id + ".json").sort());
    await reopened.close();
  } finally { await lib.close(); await fs.rm(root, { recursive: true, force: true }); }
});
it("ignores old subfolders and reports malformed files without hiding valid demos", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "demo-list-"));
  const lib = new Library(root);
  try {
    await fs.mkdir(path.join(root, "old-song"));
    await fs.writeFile(path.join(root, crypto.randomUUID() + ".json"), "broken");
    await lib.create();
    const list = await lib.list();
    expect(list).toHaveLength(2);
    expect(list.filter(s => s.available)).toHaveLength(1);
  } finally { await lib.close(); await fs.rm(root, { recursive: true, force: true }); }
});
