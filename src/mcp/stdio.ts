import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createMcpServer } from "./server.js";
import { traceProcess, traceTransport } from "./trace.js";

// Trace process failures, including handshake failures.
traceProcess();

const server = createMcpServer();
const transport = new StdioServerTransport();

await server.connect(transport);

// Trace transport activity after handlers are installed.
traceTransport(transport);

console.error("triager MCP server connected over stdio");
