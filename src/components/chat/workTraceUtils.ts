export interface StepRowItem {
  id: string;
  name: string;
  label?: string;
  status: string;
  detail?: string;
}

export type StepCategory =
  | "web"
  | "terminal"
  | "file"
  | "skill"
  | "plugin"
  | "system";

export interface LiveMilestoneRow {
  id: string;
  category: StepCategory;
  title: string;
  countLabel?: string;
  subtitle?: string;
  status: "running" | "done" | "error";
}

export function formatElapsedSeconds(sec: number): string {
  const s = Math.max(1, Math.floor(sec));
  if (s < 60) {
    return `${s} 秒`;
  }
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${mins} 分` : `${mins} 分 ${rem} 秒`;
}

export function formatWorkDuration(ms: number): string {
  const sec = Math.max(1, Math.round(ms / 1000));
  return formatElapsedSeconds(sec);
}

export function classifyStepCategory(step: StepRowItem): StepCategory {
  const name = (step.name || "").toLowerCase();
  const label = (step.label || "").toLowerCase();
  const combined = `${name} ${label}`;

  if (
    /web_?fetch|web_?search|web fetch|web search|search_web|搜索网络|读取网页|http_?fetch/i.test(
      combined
    )
  ) {
    return "web";
  }
  if (
    name === "bash" ||
    label.startsWith("执行命令") ||
    label.startsWith("执行终端")
  ) {
    return "terminal";
  }
  if (
    name === "read_file" ||
    name === "write_file" ||
    name === "list_dir" ||
    name === "trash_files" ||
    name === "notebook_read" ||
    name === "notebook_edit" ||
    label.startsWith("读取 ·") ||
    label.startsWith("写入 ·") ||
    label.startsWith("浏览目录") ||
    label.startsWith("移入废纸篓") ||
    label.includes("Notebook")
  ) {
    return "file";
  }
  if (name === "skill_load" || label.startsWith("加载 skill")) {
    return "skill";
  }
  if (name.startsWith("plugin_")) {
    return "plugin";
  }
  return "system";
}

function capitalizeWord(word: string): string {
  if (!word) return "";
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function cleanStepLabel(step: StepRowItem): string {
  const raw = (step.label || step.name || "").trim();
  if (!raw) return "执行步骤";

  if (raw.startsWith("执行命令 · ")) {
    const rest = raw.slice("执行命令 · ".length).trim();
    return rest || "执行终端命令";
  }

  const mcpMatch =
    /^mcp[\s_]+(?:mcp[\s_]+)?[a-z0-9]+[\s_]+(.+)$/i.exec(raw);
  if (mcpMatch) {
    const suffix = (mcpMatch[1] ?? "").replace(/_/g, " ").trim();
    if (/web[\s_]?fetch/i.test(suffix)) {
      const provider = suffix
        .replace(/web[\s_]?fetch/i, "")
        .trim();
      return provider ? `读取网页 · ${capitalizeWord(provider)}` : "读取网页";
    }
    if (/web[\s_]?search/i.test(suffix)) {
      const provider = suffix
        .replace(/web[\s_]?search/i, "")
        .trim();
      return provider ? `搜索网络 · ${capitalizeWord(provider)}` : "搜索网络";
    }
    return suffix || raw;
  }

  return raw;
}

export function cleanStepDetail(detail?: string): string | undefined {
  if (!detail) return undefined;
  const trimmed = detail
    .trim()
    .replace(/^\[exit=\d+,\s*cwd=[^\]]+\]\s*/i, "")
    .trim();
  if (!trimmed) return undefined;

  if (
    /^[\[\]{},]+$/.test(trimmed) ||
    /^"[a-zA-Z0-9_-]+"\s*:\s*[\[{"]*$/.test(trimmed) ||
    /^[-=_]{2,}$/.test(trimmed) ||
    /^==\s*.+$/.test(trimmed) ||
    /^---\s*(?:ui)?$/i.test(trimmed) ||
    /^\d{1,4}$/.test(trimmed)
  ) {
    return undefined;
  }

  return trimmed;
}

const CATEGORY_GROUP_COPY: Record<
  StepCategory,
  { title: string; formatCount: (count: number) => string }
> = {
  web: {
    title: "搜索与读取网页",
    formatCount: (n) => `${n} 个来源`,
  },
  terminal: {
    title: "执行终端排查",
    formatCount: (n) => `${n} 条命令`,
  },
  file: {
    title: "查阅本地文件",
    formatCount: (n) => `${n} 项`,
  },
  skill: {
    title: "加载内置技能",
    formatCount: (n) => `${n} 项`,
  },
  plugin: {
    title: "调用插件能力",
    formatCount: (n) => `${n} 次`,
  },
  system: {
    title: "系统诊断与处理",
    formatCount: (n) => `${n} 项`,
  },
};

export function buildLiveMilestones(steps: StepRowItem[]): LiveMilestoneRow[] {
  if (!steps || steps.length === 0) return [];

  const completedByCategory = new Map<StepCategory, StepRowItem[]>();
  const activeSteps: StepRowItem[] = [];

  for (const step of steps) {
    if (step.status === "running" || step.status === "pending") {
      activeSteps.push(step);
      continue;
    }
    const cat = classifyStepCategory(step);
    const list = completedByCategory.get(cat);
    if (list) {
      list.push(step);
    } else {
      completedByCategory.set(cat, [step]);
    }
  }

  const rows: LiveMilestoneRow[] = [];

  for (const [category, group] of completedByCategory) {
    const hasError = group.some((s) => s.status === "error");
    if (group.length === 1) {
      const only = group[0]!;
      rows.push({
        id: `milestone-${only.id}`,
        category,
        title: cleanStepLabel(only),
        subtitle: cleanStepDetail(only.detail),
        status: only.status === "error" ? "error" : "done",
      });
    } else {
      const copy = CATEGORY_GROUP_COPY[category];
      const latest = group[group.length - 1]!;
      rows.push({
        id: `milestone-group-${category}`,
        category,
        title: copy.title,
        countLabel: copy.formatCount(group.length),
        subtitle:
          category === "terminal" ? cleanStepLabel(latest) : undefined,
        status: hasError ? "error" : "done",
      });
    }
  }

  for (const active of activeSteps) {
    rows.push({
      id: `active-${active.id}`,
      category: classifyStepCategory(active),
      title: cleanStepLabel(active),
      subtitle: cleanStepDetail(active.detail),
      status: "running",
    });
  }

  return rows;
}

export function getDistinctCategories(steps: StepRowItem[]): StepCategory[] {
  const seen: StepCategory[] = [];
  for (const step of steps) {
    const cat = classifyStepCategory(step);
    if (!seen.includes(cat)) {
      seen.push(cat);
      if (seen.length >= 3) break;
    }
  }
  return seen;
}
