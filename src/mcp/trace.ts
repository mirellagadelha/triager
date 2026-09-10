import { appendFileSync } from "node:fs";

import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";

const LOG_FILE = "mcp-debug.log";

/**
 * Always write to stderr. Write to the debug file only with MCP_DEBUG.
 */
function write(line: string): void {
  console.error(`[mcp] ${line}`);

  if (!process.env.MCP_DEBUG) {
    return;
  }

  try {
    appendFileSync(LOG_FILE, `${line}\n`);
  } catch {}
}

function stamp(): string {
  return new Date().toISOString();
}

function describe(detail: unknown): string {
  if (detail instanceof Error) {
    return ` ${detail.stack ?? `${detail.name}: ${detail.message}`}`;
  }

  return detail === undefined ? "" : ` ${JSON.stringify(detail)}`;
}

function record(direction: "recv" | "send", message: JSONRPCMessage): void {
  write(`${stamp()} ${direction} ${JSON.stringify(message)}`);
}

function note(event: string, detail?: unknown): void {
  write(`${stamp()} life ${event}${describe(detail)}`);
}

/**
 * Records why the process exits, including crashes and termination signals.
 *
 * Install before connect() so handshake failures are also captured.
 */
export function traceProcess(): void {
  process.on("unhandledRejection", (reason) => {
    note("unhandled rejection", reason);
  });

  process.on("uncaughtException", (error) => {
    note("uncaught exception", error);

    // Exit explicitly after handling the error.
    process.exit(1);
  });

  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(signal, () => {
      note(`signal ${signal}`);
      process.exit(0);
    });
  }

  process.on("exit", (code) => {
    note(`exit code=${code}`);
  });
}

/**
 * Records transport failures and, with MCP_DEBUG, JSON-RPC messages.
 *
 * Wrap after `server.connect()`, so the transport handlers are installed.
 */
export function traceTransport(transport: Transport): void {
  const onError = transport.onerror;
  const onClose = transport.onclose;

  // Always record transport failures.
  transport.onerror = (error: Error) => {
    note("transport error", error);
    onError?.(error);
  };

  transport.onclose = () => {
    note("transport closed");
    onClose?.();
  };

  if (!process.env.MCP_DEBUG) {
    return;
  }

  const deliver = transport.onmessage;
  const send = transport.send.bind(transport);

  transport.onmessage = <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => {
    record("recv", message);
    deliver?.(message, extra);
  };

  transport.send = (message: JSONRPCMessage, options?: TransportSendOptions) => {
    record("send", message);

    return send(message, options);
  };

  note(`tracing enabled, appending to ${LOG_FILE}`);
}
