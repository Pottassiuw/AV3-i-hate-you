import cron from "node-cron";
import { setTimeout } from "node:timers/promises";
import { createDatabase } from "./database.js";
import { getConfig } from "./config.js";
import { processNext, scheduleDaily } from "./modules/jobs/service.js";

const db = createDatabase(getConfig().databaseUrl);
const expression = process.env.ANALYTICS_CRON ?? "0 2 * * *";
if (!cron.validate(expression)) throw new Error("ANALYTICS_CRON inválido.");
let stopping = false;
const scheduled = cron.schedule(
  expression,
  async () => {
    try {
      await scheduleDaily(db);
    } catch {
      console.error("Não foi possível agendar os relatórios diários.");
    }
  },
  { timezone: "UTC", noOverlap: true },
);
function stop() {
  stopping = true;
  void scheduled.stop();
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  await db.$connect();
  console.log("Worker iniciado; relatórios diários em UTC:", expression);
  // Catch-up no reinício; chave diária evita duplicação entre workers.
  await scheduleDaily(db);
  while (!stopping) {
    try {
      if (await processNext(db)) continue;
    } catch {
      console.error("Fila indisponível; nova tentativa em 1 segundo.");
    }
    await setTimeout(1_000);
  }
} finally {
  await scheduled.destroy();
  await db.$disconnect();
}
