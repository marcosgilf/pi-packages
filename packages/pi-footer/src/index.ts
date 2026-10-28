import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import registerSession from "@marcosgilf/pi-session";
import registerUsage from "@marcosgilf/pi-usage";

const MCP_STATUS_KEY = "pi-footer:mcp";

function updateMcpStatus(ctx: ExtensionContext, pi: ExtensionAPI): void {
  if (ctx.mode !== "tui") return;

  // shortcut: count non-hidden registered namespaces, not offline configs; use a Pi MCP status API if one becomes public.
  const servers = new Set(
    pi
      .getAllTools()
      .flatMap(({ namespace, exposure }) =>
        namespace?.name.startsWith("mcp__") && exposure !== "hidden" ? [namespace.name] : [],
      ),
  );
  ctx.ui.setStatus(
    MCP_STATUS_KEY,
    servers.size ? `🔌 MCP: ${servers.size} server${servers.size === 1 ? "" : "s"} enabled` : undefined,
  );
}

export default function (pi: ExtensionAPI): void {
  registerSession(pi);
  registerUsage(pi);

  const refreshMcpStatus = (_event: unknown, ctx: ExtensionContext) => updateMcpStatus(ctx, pi);
  pi.on("session_start", refreshMcpStatus);
  pi.on("agent_end", refreshMcpStatus);
  pi.on("tool_execution_end", refreshMcpStatus);
  pi.on("mcp_servers_change", refreshMcpStatus);
  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode === "tui") ctx.ui.setStatus(MCP_STATUS_KEY, undefined);
  });
}
