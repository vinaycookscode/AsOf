import Fastify from "fastify";
import { todayRoutes } from "./routes/today.js";
import { standupRoutes } from "./routes/standup.js";
import { askRoutes } from "./routes/ask.js";
import { feedbackRoutes } from "./routes/feedback.js";
import { settingsRoutes } from "./routes/settings.js";

const PORT = Number(process.env.API_PORT ?? 4000);

const app = Fastify({ logger: true });

await app.register(todayRoutes);
await app.register(standupRoutes);
await app.register(askRoutes);
await app.register(feedbackRoutes);
await app.register(settingsRoutes);

app
  .listen({ port: PORT, host: "127.0.0.1" })
  .then(() => app.log.info(`AsOf API listening on http://localhost:${PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
