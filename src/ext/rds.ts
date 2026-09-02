/** /rds — delete subagent session trees for the current project. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { scanSubagentTrees, deleteSubagentTrees } from "../scanner.ts";
import { formatSize } from "../format.ts";
import { sessionDirFor } from "./context.ts";
import { MSG } from "./messages.ts";

export function registerRds(pi: ExtensionAPI): void {
  pi.registerCommand("rds", {
    description: "Delete subagent session trees for the current project (with confirmation)",
    handler: async (_args, ctx) => {
      const sessionDir = sessionDirFor(ctx);
      const trees = await scanSubagentTrees(sessionDir);
      if (trees.length === 0) {
        ctx.ui.notify(MSG.rds.none, "info");
        return;
      }

      const runs = trees.reduce((s, t) => s + t.runs, 0);
      const size = formatSize(trees.reduce((s, t) => s + t.bytes, 0));
      const deleteOption = MSG.rds.deleteOption(trees.length, size);

      const choice = await ctx.ui.select(MSG.rds.confirm(trees.length, runs, size), [deleteOption, MSG.rds.cancel]);
      if (choice !== deleteOption) {
        ctx.ui.notify(MSG.rds.cancelled, "info");
        return;
      }

      const removed = await deleteSubagentTrees(sessionDir, trees);
      ctx.ui.notify(MSG.rds.done(removed, trees.length, size), removed === trees.length ? "info" : "error");
    },
  });
}
