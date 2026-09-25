import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { Library } from "../src/library.js";
describe("song library", () => {
  it("creates, reloads, renames, and duplicates songs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "eight-bit-"));
    try {
      const lib = new Library(root);
      const song = await lib.create("Test Loop");
      expect(song.revision).toBe(0);
      expect((await lib.load(song.id)).title).toBe("Test Loop");
      const renamed = await lib.rename(song.id, "Renamed");
      expect(renamed.revision).toBe(1);
      const copy = await lib.duplicate(song.id);
      expect(copy.id).not.toBe(song.id);
      expect(copy.title).toBe("Renamed Copy");
      expect((await lib.list()).filter((x) => x.available)).toHaveLength(2);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
