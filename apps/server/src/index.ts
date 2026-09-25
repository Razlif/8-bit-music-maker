import { createApp } from "./app.js";
import { getConfig } from "./config.js";
const config = getConfig();
const { app } = await createApp(config);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
await app.listen({ host: "127.0.0.1", port: config.port });
console.log(`8-bit Music Maker: http://127.0.0.1:${config.port}`);
