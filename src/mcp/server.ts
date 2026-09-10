import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";

import { SYSTEM_PROMPT, buildUserMessage } from "../agent/prompts.js";
import { CUSTOMERS } from "../tools/lookup-customer.js";
import { executeTool, toolDefinitions } from "../tools/registry.js";

const CUSTOMERS_URI = "triager://customers";

/**
 * Builds the ticket section of the triage prompt.
 *
 * The argument is only a hint. Hosts may alter it, so the user's message
 * remains the source of truth.
 */
function buildTicketSection(ticket: string | undefined): string {
  if (!ticket) {
    return "Triage the support ticket I described in this conversation.";
  }

  return [
    buildUserMessage(ticket),
    "If my message contains fuller ticket text than the block above, that text is the ticket.",
  ].join("\n\n");
}

/**
 * Creates and configures an MCP server instance for the triager application.
 *
 * @returns {McpServer} The configured MCP server instance.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "triager",
    version: "0.1.0",
  });

  for (const tool of toolDefinitions) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,

        // Use the same source of truth as the Messages API adapter,
        // but pass the raw shape expected by MCP.
        inputSchema: tool.schema.shape,

        // Annotations describe how the MCP host should handle the tool.
        annotations: {
          readOnlyHint: tool.semantics.readOnly,
          destructiveHint: tool.semantics.destructive,
          idempotentHint: tool.semantics.idempotent,
          openWorldHint: tool.semantics.openWorld,
        },
      },
      async (args) => {
        const outcome = await executeTool(tool.name, args);

        return {
          isError: outcome.isError,
          content: [{ type: "text", text: outcome.content }],
        };
      },
    );
  }

  server.registerResource(
    "customers",
    CUSTOMERS_URI,
    {
      title: "Customer directory",
      description:
        "Every customer record known to the triager, keyed by identifier. " +
        "Read this to see the directory; call lookup_customer to resolve a single identifier.",
      mimeType: "application/json",
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(CUSTOMERS, null, 2),
        },
      ],
    }),
  );

  // A user-initiated template. Prompts support user and assistant messages only,
  // and arguments are received as strings.
  server.registerPrompt(
    "triage_ticket",
    {
      title: "Triage a support ticket",
      description:
        "Runs the triage procedure over a ticket: classify it, enrich it with customer " +
        "data when an identifier is present, and route it to a queue.",
      argsSchema: {
        ticket: z
          .string()
          .optional()
          .describe(
            "Optional ticket text. Some hosts pass only the first word of an argument, " +
              "so prefer describing the ticket in your message.",
          ),
      },
    },
    ({ ticket }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `${SYSTEM_PROMPT}\n\n${buildTicketSection(ticket)}`,
          },
        },
      ],
    }),
  );

  return server;
}
