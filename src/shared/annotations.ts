// Title and annotations for every registered tool. Shared tools take theirs from
// src/shared/tool-definitions.json (synced from AlterLab shared/mcp_tools); tools
// that exist only in this server are defined in LOCAL_TOOL_META below.
import defs from "./tool-definitions.json";

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolMeta {
  title: string;
  annotations: ToolAnnotations;
}

interface SharedTool {
  name: string;
  title?: string;
  annotations?: Partial<ToolAnnotations>;
}

const read = (title: string): ToolMeta => ({
  title,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
});
const write = (title: string, o: { destructive?: boolean; idempotent?: boolean } = {}): ToolMeta => ({
  title,
  annotations: {
    readOnlyHint: false,
    destructiveHint: o.destructive ?? false,
    idempotentHint: o.idempotent ?? false,
    openWorldHint: true,
  },
});

export const LOCAL_TOOL_META: Record<string, ToolMeta> = {
  alterlab_get_job: read("Get Job"),
  alterlab_check_balance: read("Check Balance"),
  alterlab_get_usage: read("Get Usage"),
  alterlab_crawl_status: read("Get Crawl Status"),
  alterlab_crawl_cancel: write("Cancel Crawl", { destructive: true, idempotent: true }),
  alterlab_batch_status: read("Get Batch Status"),
  alterlab_list_sessions: read("List Sessions"),
  alterlab_get_session: read("Get Session"),
  alterlab_validate_session: read("Validate Session"),
  alterlab_create_session: write("Create Session"),
  alterlab_update_session: write("Update Session", { idempotent: true }),
  alterlab_refresh_session: write("Refresh Session", { idempotent: true }),
  alterlab_delete_session: write("Delete Session", { destructive: true, idempotent: true }),
  alterlab_list_beta_features: read("List Beta Features"),
  alterlab_list_my_beta_features: read("List My Beta Features"),
  alterlab_enable_beta_feature: write("Enable Beta Feature", { idempotent: true }),
  alterlab_disable_beta_feature: write("Disable Beta Feature", { idempotent: true }),
};

const shared = new Map<string, ToolMeta>();
for (const t of (defs as { tools: SharedTool[] }).tools) {
  if (t.title && t.annotations) {
    shared.set(t.name, {
      title: t.title,
      annotations: {
        readOnlyHint: t.annotations.readOnlyHint ?? false,
        destructiveHint: t.annotations.destructiveHint ?? false,
        idempotentHint: t.annotations.idempotentHint ?? false,
        openWorldHint: t.annotations.openWorldHint ?? true,
      },
    });
  }
}

export function toolMeta(name: string): ToolMeta {
  const meta = shared.get(name) ?? LOCAL_TOOL_META[name];
  if (!meta) throw new Error(`No title/annotations defined for tool ${name}`);
  return meta;
}
