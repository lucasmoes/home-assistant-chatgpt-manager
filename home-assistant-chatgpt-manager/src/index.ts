import { loadConfig } from "./config.js";
import { createBridge } from "./app.js";
const config = loadConfig();
const bridge = createBridge(config);
bridge.server.listen(config.port, "0.0.0.0", () => {
  console.log(`[home-assistant-chatgpt-manager] port=${config.port}; oauth=${!!config.publicUrl}; write_access=${config.writeAccess}`);
});
async function shutdown() {
  bridge.server.close(async () => { await bridge.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
