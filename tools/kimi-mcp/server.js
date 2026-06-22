/**
 * kimi-mcp — Custom MCP server wrapping Kimi Code CLI v0.6+
 *
 * V2: Uses `kimi acp` (Agent Client Protocol, JSON-RPC over stdio)
 * for full multimodal support including image analysis.
 *
 * Falls back to `kimi -p` for text-only queries if ACP is unavailable.
 *
 * Protocol: MCP over stdio (JSON-RPC 2.0)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";

const KIMI_BIN = process.env.KIMI_BIN || "kimi";

// ---------------------------------------------------------------------------
// ACP Client — persistent `kimi acp` process
// ---------------------------------------------------------------------------

class AcpClient {
  constructor() {
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.outputBuffer = "";
    this.agentHandlers = new Map();
    this.started = false;
    this.startPromise = null;
  }

  async start() {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this._doStart();
    return this.startPromise;
  }

  async _doStart() {
    this.proc = spawn(KIMI_BIN, ["acp"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.proc.stdout.on("data", (d) => this._onData(d.toString()));
    this.proc.stderr.on("data", () => {}); // logs go to stderr, ignore
    this.proc.on("error", () => { this.proc = null; });

    // Initialize handshake
    const initResp = await this._send("initialize", {
      clientInfo: { name: "kimi-mcp", version: "2.0.0" },
    });
    this.capabilities = initResp.capabilities || {};

    // Authenticate (may fail silently if already logged in)
    try {
      await this._send("authenticate", { method_id: "login" });
    } catch (_) {
      // Already authenticated — continue
    }

    this.started = true;
  }

  _onData(data) {
    this.outputBuffer += data;
    const lines = this.outputBuffer.split("\n");
    this.outputBuffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        this._dispatch(msg);
      } catch (_) {
        // Skip malformed lines (e.g. stderr leakage)
      }
    }
  }

  _dispatch(msg) {
    if (msg.id != null && !msg.method) {
      // Response to our request
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      }
    } else if (msg.method) {
      // Agent → Client call
      const handler = this.agentHandlers.get(msg.method);
      if (handler) handler(msg);
      else {
        // Auto-respond to unknown methods
        if (msg.id != null) {
          this._respond(msg.id, {});
        }
      }
    }
  }

  _respond(id, result) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  }

  _send(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACP ${method} timeout`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });

      const req = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      this.proc.stdin.write(req + "\n");
    });
  }

  /**
   * Send a prompt (text + optional images) and collect the streaming response.
   * Returns concatenated text output.
   */
  async prompt({ text, images, cwd, timeout }) {
    await this.start();
    timeout = timeout || 300;

    // Create session
    const { sessionId } = await this._send("session/new", { cwd: cwd || process.cwd() });

    // Set auto mode
    await this._send("session/set_config_option", {
      sessionId, configId: "mode", value: "auto",
    });

    // Build content blocks
    const blocks = [];
    if (text) {
      blocks.push({ type: "text", text });
    }
    if (images && images.length > 0) {
      for (const img of images) {
        blocks.push({
          type: "image",
          data: img.data,
          mimeType: img.mimeType || "image/png",
        });
      }
    }

    // Collect streaming chunks
    const chunks = [];
    let lastChunkTime = Date.now();
    let done = false;

    const onUpdate = (msg) => {
      const params = msg.params || {};
      const events = params.events || [];
      for (const evt of events) {
        if (evt.type === "agent_message_chunk") {
          chunks.push(evt.content || "");
          lastChunkTime = Date.now();
        }
      }
      if (params.done) done = true;
    };

    const onPermission = (msg) => {
      // Auto-approve tool calls
      if (msg.id != null) {
        this._respond(msg.id, { approved: true });
      }
    };

    this.agentHandlers.set("session/update", onUpdate);
    this.agentHandlers.set("session/request_permission", onPermission);

    try {
      // Send prompt
      await this._send("session/prompt", { sessionId, prompt: blocks });

      // Wait for completion: done flag OR idle timeout (5s without new chunks)
      const deadline = Date.now() + timeout * 1000;
      while (!done && Date.now() < deadline) {
        if (Date.now() - lastChunkTime > 5000) break; // idle timeout
        await sleep(200);
      }
    } finally {
      this.agentHandlers.delete("session/update");
      this.agentHandlers.delete("session/request_permission");
    }

    return chunks.join("").trim() || "(empty response)";
  }

  /** Whether ACP image support is available (promptCapabilities.image) */
  get supportsImages() {
    return this.started && this.capabilities?.promptCapabilities?.image === true;
  }

  close() {
    if (this.proc) {
      try { this.proc.kill(); } catch (_) {}
      this.proc = null;
    }
    this.started = false;
    this.startPromise = null;
  }
}

let acpInstance = null;
let acpFailed = false;   // Set true if ACP is unavailable — skip retries

async function getAcp() {
  if (acpFailed) throw new Error("ACP unavailable (previously failed)");
  if (!acpInstance) acpInstance = new AcpClient();
  try {
    await acpInstance.start();
  } catch (e) {
    acpFailed = true;
    acpInstance = null;
    throw e;
  }
  return acpInstance;
}

// ---------------------------------------------------------------------------
// Fallback: `kimi -p` for text-only queries when ACP is unavailable
// ---------------------------------------------------------------------------

function runKimiText(prompt, opts) {
  return new Promise((resolve, reject) => {
    const args = ["-p", prompt, "--output-format", "text"];
    if (opts?.model) args.unshift("-m", opts.model);

    const child = spawn(KIMI_BIN, args, {
      cwd: opts?.cwd || process.cwd(),
      timeout: (opts?.timeout || 300) * 1000,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`Kimi CLI exited ${code}: ${stderr.slice(0, 500)}`));
      else {
        const cleaned = stdout.split("\n")
          .filter((l) => !l.startsWith("To resume this session:"))
          .map((l) => l.startsWith("• ") ? l.slice(2) : l)
          .join("\n").trim();
        resolve(cleaned);
      }
    });
    child.on("error", (e) => reject(new Error(`spawn failed: ${e.message}`)));
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Unified runner: ACP preferred, CLI fallback
// ---------------------------------------------------------------------------

async function runKimi(text, opts) {
  // Try ACP first
  try {
    const acp = await getAcp();
    return await acp.prompt({
      text,
      images: opts?.images || [],
      cwd: opts?.cwd,
      timeout: opts?.timeout,
    });
  } catch (e) {
    // ACP failed — fall back to text-only CLI
    if (opts?.images?.length) {
      throw new Error(
        `ACP unavailable and images require multimodal input. ACP error: ${e.message}. ` +
        "Falling back to text-only CLI which cannot process images. " +
        "Ensure kimi acp mode is accessible."
      );
    }
    // Text-only fallback
    return runKimiText(text, opts);
  }
}

async function runKimiVision({ text, images, cwd, timeout }) {
  // Vision REQUIRES ACP
  const acp = await getAcp();
  if (!acp.supportsImages) {
    throw new Error("ACP connected but promptCapabilities.image is false. Cannot analyze images.");
  }
  return acp.prompt({ text, images, cwd, timeout: timeout || 180 });
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function agentPrompt(task, workFolder) {
  return [
    "You are an AI agent. Complete the following task autonomously.",
    workFolder ? `Working directory: ${workFolder}` : "",
    "---", task, "---",
    "Provide your complete response. Include full code if writing code.",
  ].filter(Boolean).join("\n");
}

function thinkPrompt(problem, context) {
  return [
    "Analyze the following problem thoroughly. Do not take actions.",
    context ? `Context: ${context}` : "",
    "---", problem, "---",
    "Provide your complete analysis.",
  ].filter(Boolean).join("\n");
}

function testPrompt(target, instructions, workFolder) {
  return [
    "Generate comprehensive tests with edge cases.",
    workFolder ? `Working directory: ${workFolder}` : "",
    instructions ? `Instructions: ${instructions}` : "",
    "---", `Target: ${target}`, "---",
    "Output complete test code.",
  ].filter(Boolean).join("\n");
}

function reviewPrompt(codeOrPath, focus, workFolder) {
  return [
    "Review the following code. Analyze bugs, security, performance, and style.",
    workFolder ? `Working directory: ${workFolder}` : "",
    focus ? `Focus: ${focus}` : "Focus: all (bugs, security, performance, style)",
    "---", codeOrPath, "---",
    "Provide structured review categorized by severity.",
  ].filter(Boolean).join("\n");
}

function researchPrompt(question, context) {
  return [
    "Research the following question thoroughly.",
    context ? `Context: ${context}` : "",
    "---", question, "---",
    "Provide a comprehensive answer with citations.",
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({ name: "kimi-mcp", version: "2.0.0" });

server.tool("kimi_agent",
  "Full autonomous agent using Kimi Code CLI (ACP protocol).",
  {
    prompt: z.string().describe("Task description"),
    workFolder: z.string().optional().describe("Working directory"),
    timeout: z.number().optional().describe("Timeout (seconds, default 300)"),
  },
  async ({ prompt, workFolder, timeout }) => {
    const result = await runKimi(agentPrompt(prompt, workFolder), { cwd: workFolder, timeout: timeout || 300 });
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool("kimi_think",
  "Extended reasoning without taking actions.",
  {
    problem: z.string().describe("Problem to analyze"),
    context: z.string().optional(),
    timeout: z.number().optional().describe("Timeout (seconds, default 120)"),
  },
  async ({ problem, context, timeout }) => {
    const result = await runKimi(thinkPrompt(problem, context), { timeout: timeout || 120 });
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool("kimi_test",
  "Generate comprehensive tests with edge cases.",
  {
    target: z.string().describe("Code or file path"),
    instructions: z.string().optional(),
    workFolder: z.string().optional(),
    timeout: z.number().optional().describe("Timeout (seconds, default 300)"),
  },
  async ({ target, instructions, workFolder, timeout }) => {
    const result = await runKimi(testPrompt(target, instructions, workFolder), { cwd: workFolder, timeout: timeout || 300 });
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool("kimi_review",
  "Code review: bugs, security, performance, style.",
  {
    code_or_path: z.string().describe("Code snippet or file path"),
    focus: z.enum(["bugs", "security", "performance", "style", "all"]).optional(),
    workFolder: z.string().optional(),
    timeout: z.number().optional().describe("Timeout (seconds, default 300)"),
  },
  async ({ code_or_path, focus, workFolder, timeout }) => {
    const result = await runKimi(reviewPrompt(code_or_path, focus, workFolder), { cwd: workFolder, timeout: timeout || 300 });
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool("kimi_research",
  "Research and analysis.",
  {
    question: z.string().describe("Research topic"),
    context: z.string().optional(),
    workFolder: z.string().optional(),
    timeout: z.number().optional().describe("Timeout (seconds, default 300)"),
  },
  async ({ question, context, workFolder, timeout }) => {
    const result = await runKimi(researchPrompt(question, context), { cwd: workFolder, timeout: timeout || 300 });
    return { content: [{ type: "text", text: result }] };
  }
);

// --- kimi_read_media (vision via ACP) ---
function getPngInfo(buf) {
  if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: "PNG" };
}

server.tool("kimi_read_media",
  "Analyze images using Kimi's multimodal vision (ACP protocol). Sends the image directly to the model for visual analysis.",
  {
    path: z.string().describe("Absolute path to image file (PNG, JPG, etc.)"),
    question: z.string().optional().describe("Question about the image"),
    expectedBehavior: z.string().optional().describe("Expected behavior for comparison"),
  },
  async ({ path, question, expectedBehavior }) => {
    const ext = (path.split(".").pop() || "png").toLowerCase();
    const buf = readFileSync(path);
    const b64 = buf.toString("base64");
    const pngInfo = ext === "png" ? getPngInfo(buf) : null;
    const mimeMap = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
    const mime = mimeMap[ext] || "image/png";

    const text = [
      "=== CANVAS VISUAL VERIFICATION ===",
      question || "Analyze this screenshot thoroughly. Describe what you see.",
      pngInfo ? `Image: ${pngInfo.width}x${pngInfo.height} ${pngInfo.format}, ${(buf.length / 1024).toFixed(1)} KB` : `File: ${(buf.length / 1024).toFixed(1)} KB`,
      expectedBehavior ? `EXPECTED (from README): ${expectedBehavior}` : "",
      expectedBehavior ? "Compare the actual rendered output against this expectation. Report ALL discrepancies." : "",
      "",
      "Key checks:",
      "- Correct colors and shapes",
      "- No rendering artifacts (black screen, white screen, flickering)",
      "- Layout and positioning matches expected",
      "- Any visual anomalies",
    ].filter(Boolean).join("\n");

    try {
      const result = await runKimiVision({
        text,
        images: [{ data: b64, mimeType: mime }],
        timeout: 180,
      });
      return { content: [{ type: "text", text: result }] };
    } catch (e) {
      // If ACP vision fails, return the error clearly
      return { content: [{ type: "text", text: `VISUAL_VERIFICATION_FAILED: ${e.message}` }] };
    }
  }
);

server.tool("kimi_read_file",
  "Read a text file (up to 1000 lines).",
  {
    path: z.string().describe("Absolute file path"),
    offset: z.number().optional().describe("Line offset (0-based)"),
    limit: z.number().optional().describe("Max lines (default 1000)"),
  },
  async ({ path, offset, limit }) => {
    const content = readFileSync(path, "utf-8");
    const lines = content.split("\n");
    const start = offset || 0;
    const end = limit ? start + limit : Math.min(start + 1000, lines.length);
    return { content: [{ type: "text", text: lines.slice(start, end).join("\n") }] };
  }
);

server.tool("kimi_write_file",
  "Create or overwrite a file.",
  {
    path: z.string().describe("Absolute file path"),
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
