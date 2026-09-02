import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, buildUserMessage } from "../src/agent/prompts.js";

describe("SYSTEM_PROMPT", () => {
  it("should include the expected prompt sections", () => {
    const sections = ["procedure", "rules", "security", "output_format", "examples"];

    for (const section of sections) {
      expect(SYSTEM_PROMPT).toContain(`<${section}>`);
      expect(SYSTEM_PROMPT).toContain(`</${section}>`);
    }
  });
});

describe("buildUserMessage", () => {
  it("should wrap the ticket content in <ticket> tags", () => {
    const content = "This is a test message.";

    expect(buildUserMessage(content)).toBe(`<ticket>\n${content}\n</ticket>`);
  });
});
