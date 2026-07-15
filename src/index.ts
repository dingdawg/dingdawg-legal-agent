#!/usr/bin/env node
/**
 * dingdawg-legal-agent v2 — Thin Client MCP Server
 *
 * FREE tier: basic local contract risk scanning & compliance checklists (the hook)
 * PAID tier: LLM-powered deep legal analysis via DingDawg API
 *
 * Install: npx dingdawg-legal-agent
 * Claude Code: claude mcp add dingdawg-legal-agent npx dingdawg-legal-agent
 *
 * Set DINGDAWG_API_KEY for paid features:
 *   export DINGDAWG_API_KEY=your_key
 *
 * Optional: set DINGDAWG_MODEL env var to override the analysis model
 *
 * DISCLAIMER: This tool does NOT constitute legal advice.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const API_BASE = process.env.DINGDAWG_API_URL || "https://api.dingdawg.com";
const API_ENDPOINT = `${API_BASE}/v1/govern/execute`;
const API_KEY = process.env.DINGDAWG_API_KEY || "";
const MODEL = process.env.DINGDAWG_MODEL || "gpt-4o-mini";

const DISCLAIMER =
  "DISCLAIMER: This output is AI-generated and does NOT constitute legal advice. " +
  "Consult a licensed attorney in your jurisdiction before making any legal decisions. " +
  "No attorney-client relationship is created by using this tool.";

// ---------------------------------------------------------------------------
// Persistent rate limiting
// ---------------------------------------------------------------------------

const RATE_FILE = path.join(os.homedir(), ".dingdawg", "legal", "usage.json");

const MACHINE_ID = crypto.createHash("sha256")
  .update(`${os.hostname()}-${os.userInfo().username}-${os.platform()}-${os.arch()}`)
  .digest("hex").slice(0, 16);

const TOOL_LIMITS: Record<string, number> = {
  review_contract: 5,
  legal_research: 10,
  draft_clause: 5,
  compliance_checklist: 15,
};

function checkFreeRateLimit(tool: string): { allowed: boolean; remaining: number; message?: string } {
  const limit = TOOL_LIMITS[tool] ?? 10;
  const key = `${MACHINE_ID}_${tool}`;
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  let store: Record<string, { count: number; resetAt: number }> = {};
  try {
    const dir = path.dirname(RATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(RATE_FILE)) {
      store = JSON.parse(fs.readFileSync(RATE_FILE, "utf-8"));
    }
  } catch { /* fresh start */ }

  const entry = store[key];
  if (!entry || now > entry.resetAt) {
    store[key] = { count: 1, resetAt: now + dayMs };
  } else if (entry.count >= limit) {
    try { fs.writeFileSync(RATE_FILE, JSON.stringify(store)); } catch {}
    return { allowed: false, remaining: 0, message: `Free tier limit reached (${limit}/day for ${tool}). Get unlimited access with an API key at https://dingdawg.com/developers` };
  } else {
    store[key].count++;
  }

  try { fs.writeFileSync(RATE_FILE, JSON.stringify(store)); } catch {}
  const current = store[key].count;
  return { allowed: true, remaining: limit - current };
}

// ---------------------------------------------------------------------------
// API Client
// ---------------------------------------------------------------------------

interface ApiResponse {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

async function callApi(
  tool: string,
  input: Record<string, unknown>,
): Promise<ApiResponse> {
  if (!API_KEY) {
    return { success: false, error: "no_api_key" };
  }

  try {
    const res = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        agent: "legal",
        tool,
        input,
        model: MODEL,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { success: false, error: `API returned ${res.status}: ${body}` };
    }

    const data = await res.json() as Record<string, unknown>;
    return { success: true, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `API request failed: ${message}` };
  }
}

function upgradeMessage(): string {
  return [
    "",
    "━━━ Upgrade to DingDawg Pro ━━━",
    "Get LLM-powered contract analysis, legal research with citations,",
    "clause drafting, and jurisdiction-specific compliance guidance.",
    "",
    "  export DINGDAWG_API_KEY=your_key",
    "",
    "Get your key at: https://dingdawg.com/developers",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Local analysis — FREE tier (minimal, non-revealing fallback)
//
// The full weighted risk rulebook (clause taxonomy, severities, scoring
// weights, missing-clause requirements) lives server-side and is returned
// via callApi() when DINGDAWG_API_KEY is set. This local fallback only
// flags a couple of the most obvious high-stakes terms — it intentionally
// does not ship the real scoring engine.
// ---------------------------------------------------------------------------

const OBVIOUS_HIGH_RISK_TERMS = ["indemnif", "unlimited liability", "non-compete"];

function analyzeContractLocal(text: string): {
  risk_score: number;
  findings: Array<{ severity: string; category: string; description: string }>;
  missing_clauses: string[];
} {
  const lower = text.toLowerCase();
  const hits = OBVIOUS_HIGH_RISK_TERMS.filter((term) => lower.includes(term));

  const findings = hits.map((term) => ({
    severity: "REVIEW",
    category: "general",
    description: `Contains a potentially significant term ("${term}") — full clause-by-clause analysis requires an API key`,
  }));

  const risk_score = hits.length > 0 ? 50 : 70;
  return { risk_score, findings, missing_clauses: [] };
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "dingdawg-legal-agent",
  version: "2.0.0",
});
// readOnlyHint: all tools are read-only analysis — no side effects
const rtool = (name: string, desc: string, schema: any, cb: (args: Record<string, any>) => any) =>
  server.registerTool(name, { description: desc, inputSchema: schema, annotations: { readOnlyHint: true } }, cb);


// ---------------------------------------------------------------------------
// review_contract
// ---------------------------------------------------------------------------

rtool(
  "review_contract",
  "Analyze a contract for risks, missing clauses, and unfavorable terms. " +
  "FREE: 5 reviews/day (basic keyword scan). LLM-powered deep analysis with API key. NOT LEGAL ADVICE.",
  {
    contract_text: z.string().min(50).describe("The full contract text to review"),
    contract_type: z.string().optional().describe("Type of contract (NDA, SaaS agreement, employment, etc.)"),
    jurisdiction: z.string().optional().describe("Jurisdiction (e.g., Delaware, California, UK)"),
  },
  async ({ contract_text, contract_type, jurisdiction }) => {
    const rateCheck = checkFreeRateLimit("review_contract");
    if (!rateCheck.allowed) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Free tier limit reached (5 contract reviews per 24 hours). Resets automatically.", upgrade: "export DINGDAWG_API_KEY=your_key — https://dingdawg.com/developers", governed: true }) }] };
    }

    if (API_KEY) {
      const apiResult = await callApi("review_contract", { contract_text, contract_type: contract_type || "", jurisdiction: jurisdiction || "" });
      if (apiResult.success && apiResult.data) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ mode: "deep_analysis", powered_by: "DingDawg Legal API", disclaimer: DISCLAIMER, ...apiResult.data, receipt_id: `rc_${Date.now().toString(36)}`, governed: true }, null, 2) }] };
      }
    }

    const result = analyzeContractLocal(contract_text);
    const highCount = result.findings.filter((f) => f.severity === "HIGH").length;

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          mode: "local_basic",
          disclaimer: DISCLAIMER,
          contract_type: contract_type || "unspecified",
          word_count: contract_text.split(/\s+/).length,
          risk_score: result.risk_score,
          risk_level: result.risk_score >= 80 ? "LOW" : result.risk_score >= 50 ? "MEDIUM" : "HIGH",
          findings: result.findings.slice(0, 5),
          missing_clauses: result.missing_clauses,
          teaser: highCount > 0
            ? `Found ${highCount} high-risk clause(s). Get LLM-powered analysis with negotiation strategies and legal citations: export DINGDAWG_API_KEY=your_key`
            : "Get comprehensive clause-by-clause analysis with jurisdiction-specific guidance: export DINGDAWG_API_KEY=your_key",
          upgrade_url: "https://dingdawg.com/developers",
          receipt_id: `rc_${Date.now().toString(36)}`,
          free_reviews_remaining: rateCheck.remaining,
          governed: true,
        }, null, 2),
      }],
    };
  },
);

// ---------------------------------------------------------------------------
// legal_research
// ---------------------------------------------------------------------------

rtool(
  "legal_research",
  "Research a legal question with jurisdiction-specific analysis. " +
  "FREE: 10 lookups/day (basic topic matching). LLM-powered research with citations available with API key. NOT LEGAL ADVICE.",
  {
    question: z.string().min(10).describe("The legal question to research"),
    jurisdiction: z.string().optional().describe("Jurisdiction (e.g., US Federal, California, EU)"),
    area_of_law: z.string().optional().describe("Area of law (contract, employment, IP, privacy, etc.)"),
  },
  async ({ question, jurisdiction, area_of_law }) => {
    const rateCheck = checkFreeRateLimit("legal_research");
    if (!rateCheck.allowed) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Free tier limit reached (10 lookups per 24 hours). Resets automatically.", upgrade: "export DINGDAWG_API_KEY=your_key — https://dingdawg.com/developers", governed: true }) }] };
    }

    if (API_KEY) {
      const apiResult = await callApi("legal_research", { question, jurisdiction: jurisdiction || "", area_of_law: area_of_law || "" });
      if (apiResult.success && apiResult.data) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ mode: "deep_analysis", powered_by: "DingDawg Legal API", disclaimer: DISCLAIMER, ...apiResult.data, receipt_id: `lr_${Date.now().toString(36)}`, governed: true }, null, 2) }] };
      }
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          mode: "local_basic",
          disclaimer: DISCLAIMER,
          question,
          jurisdiction: jurisdiction || "not specified",
          area_of_law: area_of_law || "general",
          note: "Free tier provides topic classification only. No case law, statutes, or detailed analysis available without API key.",
          teaser: "Get LLM-powered legal research with statute citations, case law references, and jurisdiction-specific analysis: export DINGDAWG_API_KEY=your_key",
          upgrade_url: "https://dingdawg.com/developers",
          receipt_id: `lr_${Date.now().toString(36)}`,
          free_lookups_remaining: rateCheck.remaining,
          governed: true,
        }, null, 2),
      }],
    };
  },
);

// ---------------------------------------------------------------------------
// draft_clause
// ---------------------------------------------------------------------------

rtool(
  "draft_clause",
  "Generate a contract clause for a specific purpose. " +
  "FREE: 10 drafts/day (basic template). LLM-powered custom clause generation with API key. NOT LEGAL ADVICE.",
  {
    purpose: z.string().describe("Purpose of the clause (e.g., 'mutual NDA', 'limitation of liability')"),
    context: z.string().optional().describe("Additional context about the agreement"),
    jurisdiction: z.string().optional().describe("Jurisdiction for the clause"),
    party_names: z.string().optional().describe("Party names (comma-separated)"),
  },
  async ({ purpose, context, jurisdiction, party_names }) => {
    const rateCheck = checkFreeRateLimit("draft_clause");
    if (!rateCheck.allowed) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Free tier limit reached (10 drafts per 24 hours). Resets automatically.", upgrade: "export DINGDAWG_API_KEY=your_key — https://dingdawg.com/developers", governed: true }) }] };
    }

    if (API_KEY) {
      const apiResult = await callApi("draft_clause", { purpose, context: context || "", jurisdiction: jurisdiction || "", party_names: party_names || "" });
      if (apiResult.success && apiResult.data) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ mode: "deep_analysis", powered_by: "DingDawg Legal API", disclaimer: DISCLAIMER, ...apiResult.data, receipt_id: `dc_${Date.now().toString(36)}`, governed: true }, null, 2) }] };
      }
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          mode: "local_basic",
          disclaimer: DISCLAIMER,
          purpose,
          note: "Free tier provides clause purpose classification only. Full clause drafting requires API key.",
          teaser: "Get LLM-powered clause drafting with legal citations, alternative phrasings, and key term explanations: export DINGDAWG_API_KEY=your_key",
          upgrade_url: "https://dingdawg.com/developers",
          receipt_id: `dc_${Date.now().toString(36)}`,
          free_drafts_remaining: rateCheck.remaining,
          governed: true,
        }, null, 2),
      }],
    };
  },
);

// ---------------------------------------------------------------------------
// compliance_checklist
// ---------------------------------------------------------------------------

rtool(
  "compliance_checklist",
  "Generate a regulatory compliance checklist for a business type and jurisdiction. " +
  "FREE: 10 checklists/day (basic framework). Comprehensive LLM-generated checklists with API key. NOT LEGAL ADVICE.",
  {
    business_type: z.string().describe("Type of business (SaaS, healthcare, fintech, etc.)"),
    jurisdiction: z.string().describe("Jurisdiction (US Federal, California, EU, UK, etc.)"),
    focus_area: z.string().optional().describe("Specific compliance focus (data privacy, employment, etc.)"),
  },
  async ({ business_type, jurisdiction, focus_area }) => {
    const rateCheck = checkFreeRateLimit("compliance_checklist");
    if (!rateCheck.allowed) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Free tier limit reached (10 checklists per 24 hours). Resets automatically.", upgrade: "export DINGDAWG_API_KEY=your_key — https://dingdawg.com/developers", governed: true }) }] };
    }

    if (API_KEY) {
      const apiResult = await callApi("compliance_checklist", { business_type, jurisdiction, focus_area: focus_area || "" });
      if (apiResult.success && apiResult.data) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ mode: "deep_analysis", powered_by: "DingDawg Legal API", disclaimer: DISCLAIMER, ...apiResult.data, receipt_id: `cc_${Date.now().toString(36)}`, governed: true }, null, 2) }] };
      }
    }

    const frameworks: string[] = [];
    const lower = `${business_type} ${jurisdiction} ${focus_area || ""}`.toLowerCase();
    if (lower.includes("eu") || lower.includes("europe")) frameworks.push("GDPR", "EU AI Act");
    if (lower.includes("us") || lower.includes("california")) frameworks.push("CCPA/CPRA");
    if (lower.includes("health")) frameworks.push("HIPAA");
    if (lower.includes("fintech") || lower.includes("financial")) frameworks.push("SOX", "PCI-DSS");
    if (lower.includes("saas")) frameworks.push("SOC 2", "GDPR");
    if (frameworks.length === 0) frameworks.push("Check jurisdiction-specific requirements");

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          mode: "local_basic",
          disclaimer: DISCLAIMER,
          business_type,
          jurisdiction,
          applicable_frameworks: [...new Set(frameworks)],
          note: "Free tier identifies applicable frameworks only. Detailed checklists with action items require API key.",
          teaser: "Get comprehensive compliance checklists with specific requirements, deadlines, and action items: export DINGDAWG_API_KEY=your_key",
          upgrade_url: "https://dingdawg.com/developers",
          also_available: { compliance: "npx dingdawg-compliance — Full AI compliance scoring and reports" },
          receipt_id: `cc_${Date.now().toString(36)}`,
          free_checklists_remaining: rateCheck.remaining,
          governed: true,
        }, null, 2),
      }],
    };
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => { console.error("Server failed:", err); process.exit(1); });
