import { describe, expect, it } from "bun:test";
import {
  type StepRowItem,
  buildLiveMilestones,
  classifyStepCategory,
  cleanStepDetail,
  cleanStepLabel,
  formatElapsedSeconds,
  formatWorkDuration,
  getDistinctCategories,
} from "../workTraceUtils";

describe("workTraceUtils", () => {
  it("formats elapsed seconds and work duration in Chinese concisely", () => {
    expect(formatElapsedSeconds(0)).toBe("1 秒");
    expect(formatElapsedSeconds(1)).toBe("1 秒");
    expect(formatElapsedSeconds(14)).toBe("14 秒");
    expect(formatElapsedSeconds(60)).toBe("1 分");
    expect(formatElapsedSeconds(72)).toBe("1 分 12 秒");

    expect(formatWorkDuration(350)).toBe("1 秒");
    expect(formatWorkDuration(14200)).toBe("14 秒");
    expect(formatWorkDuration(72400)).toBe("1 分 12 秒");
  });

  it("classifies tool steps across web, terminal, file, skill, plugin, and system categories", () => {
    expect(
      classifyStepCategory({
        id: "1",
        name: "mcp_mcp_mwpanbak_web_fetch_exa",
        status: "done",
      })
    ).toBe("web");
    expect(
      classifyStepCategory({
        id: "2",
        name: "mcp_mcp_mwpanbak_web_search_exa",
        status: "done",
      })
    ).toBe("web");
    expect(
      classifyStepCategory({
        id: "3",
        name: "bash",
        label: "执行命令 · valet mcp list",
        status: "done",
      })
    ).toBe("terminal");
    expect(
      classifyStepCategory({
        id: "4",
        name: "read_file",
        status: "done",
      })
    ).toBe("file");
    expect(
      classifyStepCategory({
        id: "5",
        name: "skill_load",
        label: "加载 Skill · valet-self-config",
        status: "done",
      })
    ).toBe("skill");
    expect(
      classifyStepCategory({
        id: "6",
        name: "plugin_inspect",
        status: "done",
      })
    ).toBe("plugin");
    expect(
      classifyStepCategory({
        id: "7",
        name: "system_overview",
        status: "done",
      })
    ).toBe("system");
  });

  it("cleans legacy MCP and bash labels", () => {
    expect(
      cleanStepLabel({
        id: "1",
        name: "mcp_mcp_mwpanbak_web_fetch_exa",
        label: "mcp mwpanbak web fetch exa",
        status: "done",
      })
    ).toBe("读取网页 · Exa");

    expect(
      cleanStepLabel({
        id: "2",
        name: "mcp_mcp_mwpanbak_web_search_exa",
        label: "mcp mwpanbak web search exa",
        status: "done",
      })
    ).toBe("搜索网络 · Exa");

    expect(
      cleanStepLabel({
        id: "3",
        name: "bash",
        label: "执行命令 · valet mcp list 2>&1 | head -50",
        status: "done",
      })
    ).toBe("valet mcp list 2>&1 | head -50");

    expect(
      cleanStepLabel({
        id: "4",
        name: "bash",
        label: "定位 valet CLI 与 App 位置",
        status: "done",
      })
    ).toBe("定位 valet CLI 与 App 位置");
  });

  it("strips noisy structural fragments from step details while keeping real summaries", () => {
    expect(cleanStepDetail('"content": [')).toBe(undefined);
    expect(cleanStepDetail("---")).toBe(undefined);
    expect(cleanStepDetail("82")).toBe(undefined);
    expect(cleanStepDetail("== MacOS/Valet")).toBe(undefined);
    expect(cleanStepDetail("{")).toBe(undefined);
    expect(cleanStepDetail('"mcpServers": [')).toBe(undefined);

    expect(
      cleanStepDetail(
        "[exit=0, cwd=/Users/dd] /Applications/Valet.app/Contents/Resources/bin/valet"
      )
    ).toBe("/Applications/Valet.app/Contents/Resources/bin/valet");
    expect(cleanStepDetail("mcp-mwpanbak enabled=true")).toBe(
      "mcp-mwpanbak enabled=true"
    );
  });

  it("groups multi-step execution into compact Grok-style live milestones", () => {
    const steps: StepRowItem[] = [
      ...Array.from({ length: 14 }, (_, idx) => ({
        id: `b-${idx}`,
        name: "bash",
        label: `执行命令 · cmd-${idx}`,
        status: "done",
      })),
      {
        id: "w-1",
        name: "mcp_mcp_mwpanbak_web_fetch_exa",
        label: "读取网页 · exa.ai/auth.md",
        status: "done",
      },
      {
        id: "w-2",
        name: "mcp_mcp_mwpanbak_web_search_exa",
        label: "搜索网络 · exaApiKey",
        status: "done",
      },
      {
        id: "s-1",
        name: "skill_load",
        label: "加载 Skill · valet-self-config",
        status: "done",
      },
      {
        id: "w-3",
        name: "mcp_mcp_mwpanbak_web_fetch_exa",
        label: "读取网页 · exa.ai/docs/reference/exa-mcp",
        status: "running",
      },
    ];

    const milestones = buildLiveMilestones(steps);
    expect(milestones).toEqual([
      {
        id: "milestone-group-terminal",
        category: "terminal",
        title: "执行终端排查",
        countLabel: "14 条命令",
        subtitle: "cmd-13",
        status: "done",
      },
      {
        id: "milestone-group-web",
        category: "web",
        title: "搜索与读取网页",
        countLabel: "2 个来源",
        subtitle: undefined,
        status: "done",
      },
      {
        id: "milestone-s-1",
        category: "skill",
        title: "加载 Skill · valet-self-config",
        subtitle: undefined,
        status: "done",
      },
      {
        id: "active-w-3",
        category: "web",
        title: "读取网页 · exa.ai/docs/reference/exa-mcp",
        subtitle: undefined,
        status: "running",
      },
    ]);

    expect(getDistinctCategories(steps)).toEqual(["terminal", "web", "skill"]);
  });
});
