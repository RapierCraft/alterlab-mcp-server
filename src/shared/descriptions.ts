// Tool descriptions come from the platform's shared tool source
// (src/shared/tool-definitions.json, synced from AlterLab shared/mcp_tools by the
// ecosystem-sync workflow), so the npm server, the hosted server and the skill all
// present the same tool-selection text. The local description is the fallback for
// tools the shared source does not define.
import defs from "./tool-definitions.json";

interface SharedTool {
  name: string;
  description?: string;
}

const shared = new Map<string, string>(
  (defs as { tools: SharedTool[] }).tools
    .filter((t) => typeof t.description === "string" && t.description.trim() !== "")
    .map((t) => [t.name, t.description as string]),
);

export function toolDescription(name: string, fallback: string): string {
  return shared.get(name) ?? fallback;
}
