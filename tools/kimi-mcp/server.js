/**
 * kimi-mcp — Custom MCP server wrapping Kimi Code CLI v0.6+
 *
 * Replaces the deprecated kimi-code-mcp npm package which relied on
 * the removed --print flag from older Kimi CLI versions.
 *
 * Uses `kimi -p "..." --output-format text` for non-interactive operations.
 * Protocol: MCP over stdio (JSON-RPC 2.0)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";

const KIMI_BIN = process.env.KIMI_BIN || "kimi";

// ---------------------------------------------------------------------------
// Run `kimi -p` and return cleaned stdout
// ---------------------------------------------------------------------------

function runKimi(prompt, opts) {
  return new Promise((resolve, reject) => {
    const args = ["-p", prompt, "--output-format", "text"];
    if (opts?.model) {
      args.unshift("-m", opts.model);
    }

    const child = spawn(KIMI_BIN, args, {
      cwd: opts?.cwd || process.cwd(),
      timeout: (opts?.timeout || 300) * 1000,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Kimi CLI exited with code ${code}: ${stderr.slice(0, 500)}`));
      } else {
        const cleaned = stdout
          .split("\n")
          .filter((l) => !l.startsWith("To resume this session:"))
          .map((l) => l.startsWith("• ") ? l.slice(2) : l)
          .join("\n")
          .trim();
        resolve(cleaned);
      }
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn Kimi CLI: ${err.message}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function agentPrompt(task, workFolder) {
  return [
    "You are an AI agent. Complete the following task autonomously.",
    workFolder ? `Working directory: ${workFolder}` : "",
    "---",
    task,
    "---",
    "Provide your complete response. If you need to write code, include the full code.",
  ].filter(Boolean).join("\n");
}

function thinkPrompt(problem, context) {
  return [
    "Analyze the following problem thoroughly. Do not take any actions — just reason through it.",
    context ? `Context: ${context}` : "",
    "---",
    problem,
    "---",
    "Provide your complete analysis.",
  ].filter(Boolean).join("\n");
}

function testPrompt(target, instructions, workFolder) {
  return [
    "Generate comprehensive tests for the following target. Include edge cases.",
    workFolder ? `Working directory: ${workFolder}` : "",
    instructions ? `Instructions: ${instructions}` : "",
    "---",
    `Target: ${target}`,
    "---",
    "Output complete test code.",
  ].filter(Boolean).join("\n");
}

function reviewPrompt(codeOrPath, focus, workFolder) {
  return [
    "Review the following code. Analyze bugs, security, performance, and style.",
    workFolder ? `Working directory: ${workFolder}` : "",
    focus ? `Focus area: ${focus}` : "Focus: all (bugs, security, performance, style)",
    "---",
    codeOrPath,
    "---",
    "Provide a structured review with findings categorized by severity.",
  ].filter(Boolean).join("\n");
}

function researchPrompt(question, context) {
  return [
    "Research the following question thoroughly.",
    context ? `Context: ${context}` : "",
    "---",
    question,
    "---",
    "Provide a comprehensive answer with citations where possible.",
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "kimi-mcp",
  version: "1.0.0",
});

server.tool(
  "kimi_agent",
  "Full autonomous agent for complex multi-step tasks using Kimi Code CLI v0.6+.",
  {
    prompt: z.string().describe("Task description for the agent"),
    workFolder: z.string().optional().describe("Working directory (absolute path)"),
    timeout: z.number().optional().describe("Timeout in seconds (default: 300)"),
    model: z.string().optional().describe("Model override"),
  },
  async ({ prompt, workFolder, timeout, model }) => {
    const result = await runKimi(agentPrompt(prompt, workFolder), {
      cwd: workFolder, timeout: timeout || 300, model,
    });
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "kimi_think",
  "Extended reasoning and analysis without taking actions.",
  {
    problem: z.string().describe("Problem or question to analyze"),
    context: z.string().optional().describe("Additional context"),
    timeout: z.number().optional().describe("Timeout in seconds (default: 120)"),
  },
  async ({ problem, context, timeout }) => {
    const result = await runKimi(thinkPrompt(problem, context), {
      timeout: timeout || 120,
    });
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "kimi_test",
  "Generate comprehensive tests with edge cases.",
  {
    target: z.string().describe("Code or file path to generate tests for"),
    instructions: z.string().optional().describe("Specific testing instructions"),
    workFolder: z.string().optional().describe("Working directory (absolute path)"),
    timeout: z.number().optional().describe("Timeout in seconds (default: 300)"),
  },
  async ({ target, instructions, workFolder, timeout }) => {
    const result = await runKimi(testPrompt(target, instructions, workFolder), {
      cwd: workFolder, timeout: timeout || 300,
    });
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "kimi_review",
  "Code review analyzing bugs, security, performance, and style.",
  {
    code_or_path: z.string().describe("Code snippet or file path to review"),
    focus: z.enum(["bugs", "security", "performance", "style", "all"]).optional()
      .describe("Review focus area (default: all)"),
    workFolder: z.string().optional().describe("Working directory (absolute path)"),
    timeout: z.number().optional().describe("Timeout in seconds (default: 300)"),
  },
  async ({ code_or_path, focus, workFolder, timeout }) => {
    const result = await runKimi(reviewPrompt(code_or_path, focus, workFolder), {
      cwd: workFolder, timeout: timeout || 300,
    });
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "kimi_research",
  "Research and analysis with 256K context window.",
  {
    question: z.string().describe("Research question or topic"),
    context: z.string().optional().describe("Additional context or background"),
    workFolder: z.string().optional().describe("Working directory (absolute path)"),
    timeout: z.number().optional().describe("Timeout in seconds (default: 300)"),
  },
  async ({ question, context, workFolder, timeout }) => {
    const result = await runKimi(researchPrompt(question, context), {
      cwd: workFolder, timeout: timeout || 300,
    });
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "kimi_read_file",
  "Read a text file. Returns file content up to 1000 lines.",
  {
    path: z.string().describe("Absolute file path to read"),
    offset: z.number().optional().describe("Line offset (0-based)"),
    limit: z.number().optional().describe("Max lines (default: 1000)"),
  },
  async ({ path, offset, limit }) => {
    const content = readFileSync(path, "utf-8");
    const lines = content.split("\n");
    const start = offset || 0;
    const end = limit ? start + limit : Math.min(start + 1000, lines.length);
    return { content: [{ type: "text", text: lines.slice(start, end).join("\n") }] };
  }
);

server.tool(
  "kimi_write_file",
  "Create or overwrite a file with specified content.",
  {
    path: z.string().describe("Absolute file path to write"),
    content: z.string().describe("Content to write"),
  },
  async ({ path, content }) => {
    mkdirSync(path.replace(/[/\\][^/\\]*$/, ""), { recursive: true });
    writeFileSync(path, content, "utf-8");
    return { content: [{ type: "text", text: `File written: ${path}` }] };
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
