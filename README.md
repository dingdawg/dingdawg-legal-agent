# dingdawg-legal-agent

> Breakthrough legal review bottlenecks. AI legal analysis that learns YOUR contract patterns.

AI-powered contract review, legal research, clause drafting, and compliance checklists. Identifies key clauses (termination, confidentiality, governing law, force majeure, liability limitations), flags missing provisions, and provides jurisdiction-specific analysis. Not legal advice.

## For AI Assistants

This MCP server returns structured JSON for seamless integration:
- Statute and case law citations with jurisdiction references
- Clause-level risk scoring with specific contract section identification
- Governance receipt on every call (audit-ready)
- Chain-ready: `review_contract` -> `legal_research` on flagged issues -> `draft_clause` for missing provisions -> `compliance_checklist` for final verification

Composable with any MCP client: Claude Code, Cursor, VS Code, ChatGPT Desktop, Windsurf.

## Install

```bash
npx dingdawg-legal-agent
```

### Claude Code
```bash
claude mcp add legal -- npx dingdawg-legal-agent
```

### Cursor
Add to `.cursor/mcp.json`:
```json
{"mcpServers": {"legal": {"command": "npx", "args": ["dingdawg-legal-agent"], "env": {"DINGDAWG_API_KEY": "your-key"}}}}
```

### Full Stack (all 13 agents)
```bash
npx dingdawg-setup
```

## Tools

| Tool | Free Tier | Paid Tier |
|------|-----------|-----------|
| `review_contract` | Clause identification + basic risk flags | LLM-powered deep analysis with precedent references |
| `legal_research` | Topic classification only | Statute citations, case law, jurisdiction-specific analysis |
| `draft_clause` | Template-based clause generation | AI-drafted clauses tailored to contract context |
| `compliance_checklist` | Basic regulatory checklist | Comprehensive checklist with jurisdiction mapping |

## Pricing

- **Free:** 10 reviews/day, basic analysis
- **Pro:** $49/mo, 100 calls/day, AI-powered deep analysis
- **Pay-as-you-go:** $0.25/call, no commitment

Get API key: https://dingdawg.com/developers

## Governed

Every call is receipted and auditable. Legal research citations include statute numbers and case references. All outputs include a disclaimer that content is not legal advice. Governance receipts prove analysis methodology for regulatory inquiries.

## Support

support@dingdawg.com | https://dingdawg.com
