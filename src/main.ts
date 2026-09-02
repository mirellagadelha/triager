import Fastify from "fastify";
import Anthropic from "@anthropic-ai/sdk";

import { RealClient } from "./llm/client.js";
import { runTriage } from "./agent/loop.js";

const app = Fastify({ logger: true });

const client = new RealClient(new Anthropic());

app.post<{ Body: { ticket?: string } }>("/triage", async (request, reply) => {
  const ticket = request.body?.ticket;

  if (typeof ticket !== "string" || ticket.trim() === "") {
    reply.status(400).send({ error: "Ticket field is required." });

    return;
  }

  const result = await runTriage(client, ticket, {
    model: process.env.MODEL_DEFAULT ?? "claude-sonnet-5",
    maxIterations: Number(process.env.MAX_LOOP_ITERATIONS ?? 8),
  });

  request.log.info(
    {
      iterations: result.iterations,
      usage: result.usage,
      tools: result.toolCalls,
    },
    `Triage completed for ticket: "${ticket}".`,
  );

  return reply.code(result.stoppedAtLimit ? 504 : 200).send(result);
});

app.get("/health", async () => {
  return { status: "ok" };
});

const port = Number(process.env.PORT ?? 3000);

await app.listen({ port, host: "0.0.0.0" });
