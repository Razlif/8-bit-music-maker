// Isolated browser-test server. Never opens the user's library or calls a model.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createApp } from "./app.js";
import { getConfig } from "./config.js";
const songsDir = await fs.mkdtemp(path.join(os.tmpdir(), "chip-browser-"));
const config = { ...getConfig(), songsDir, port: 3101, openaiKey: undefined };
const { app } = await createApp(config, undefined, ["http://127.0.0.1:5174"]);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app
      .close()
      .then(() => fs.rm(songsDir, { recursive: true, force: true }))
      .then(() => process.exit(0));
  });
await app.listen({ host: "127.0.0.1", port: 3101 });
