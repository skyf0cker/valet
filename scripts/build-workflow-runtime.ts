import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BaseBuilder } from "@workflow/builders";

const repoRoot = resolve(import.meta.dir, "..");

class ValetWorkflowBuilder extends BaseBuilder {
  constructor() {
    super({
      dirs: ["sidecar/src/workflow"],
      workingDir: repoRoot,
      stepsBundlePath: "sidecar/src/workflow/generated/.steps-intermediate.mjs",
      workflowsBundlePath: "sidecar/src/workflow/generated/flow.mjs",
      webhookBundlePath: "sidecar/src/workflow/generated/webhook.mjs",
      sourcemap: false,
    });
  }

  async build(): Promise<void> {
    const generatedDir = resolve(repoRoot, "sidecar/src/workflow/generated");
    await rm(generatedDir, { recursive: true, force: true });
    await mkdir(generatedDir, { recursive: true });

    const stepsOutfile = resolve(generatedDir, ".steps-intermediate.mjs");
    const flowOutfile = resolve(generatedDir, "flow.mjs");
    const entryFile = resolve(repoRoot, "sidecar/src/workflow/engine-workflow.ts");
    const tsconfigPath = resolve(repoRoot, "sidecar/tsconfig.json");

    const { manifest } = await this.createCombinedBundle({
      inputFiles: [entryFile],
      stepsOutfile,
      flowOutfile,
      tsconfigPath,
      bundleFinalOutput: true,
    });

    let workflowId = "";
    for (const fileWorkflows of Object.values(manifest.workflows ?? {})) {
      if (!fileWorkflows || typeof fileWorkflows !== "object") continue;
      const entry = (fileWorkflows as Record<string, { workflowId?: string }>)
        .executePluginWorkflow;
      if (entry?.workflowId) {
        workflowId = entry.workflowId;
        break;
      }
    }

    if (!workflowId) {
      throw new Error(
        `executePluginWorkflow workflowId missing in manifest: ${JSON.stringify(manifest.workflows)}`,
      );
    }

    await rm(stepsOutfile, { force: true });

    await writeFile(
      resolve(generatedDir, "manifest.json"),
      `${JSON.stringify(
        {
          version: 1,
          workflowId,
          workflows: manifest.workflows ?? {},
          steps: manifest.steps ?? {},
        },
        null,
        2,
      )}\n`,
    );

    await writeFile(
      resolve(generatedDir, "package.json"),
      `${JSON.stringify({ type: "module" }, null, 2)}\n`,
    );

    console.log(
      `[build-workflow-runtime] Built sidecar/src/workflow/generated/flow.mjs (workflowId=${workflowId})`,
    );
  }
}

const builder = new ValetWorkflowBuilder();
await builder.build();
