import { it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Library } from "../src/library.js";
it("failed replacement preserves the saved song and removes the temporary file", async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), "demo-write-")), lib = new Library(root);
 try {
  const song = await lib.create();
  const spy = vi.spyOn(fs, "rename").mockRejectedValue(new Error("disk failure"));
  try { await expect(lib.update(song.id, s => ({ ...s, title: "lost" }), 0)).rejects.toThrow("disk failure"); }
  finally { spy.mockRestore(); }
  expect(await lib.load(song.id)).toEqual(song);
  expect(await fs.readdir(root)).toEqual([song.id + ".json"]);
 } finally { await lib.close(); await fs.rm(root, {recursive:true, force:true}); }
});
it("retries transient Windows locks on the song file", async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), "demo-lock-")), lib = new Library(root);
 try {
  const song = await lib.create(), original = fs.rename.bind(fs); let attempts = 0;
  const spy = vi.spyOn(fs, "rename").mockImplementation(async (a,b) => {
    if (attempts++ < 2) throw Object.assign(new Error("locked"), { code: "EPERM" });
    return original(a,b);
  });
  try { await lib.update(song.id, s => ({ ...s, title: "Saved" }), 0); }
  finally { spy.mockRestore(); }
  expect(attempts).toBe(3);
  expect((await lib.load(song.id)).title).toBe("Saved");
 } finally { await lib.close(); await fs.rm(root,{recursive:true,force:true}); }
});
