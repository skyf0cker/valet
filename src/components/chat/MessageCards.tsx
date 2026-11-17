import React, { useState } from "react";
import type { ChatMessage, PluginDraftSpec } from "../../types/valet";
import { CheckIcon } from "../ui/Icons";
import { Modal } from "../ui/Modal";

export const ProcessTableCard: React.FC<{
  data: NonNullable<ChatMessage["processTable"]>;
  onAction: (action: "kill_primary" | "clean_disk" | "auto_rule") => void;
}> = ({ data, onAction }) => {
  const firstRow = data.rows[0];
  const shortProcessName = firstRow?.name.split("·").pop()?.trim() ?? "进程";

  return (
    <div className="mt-1 flex w-full max-w-[520px] flex-col overflow-hidden rounded-[12px] border border-[var(--border-card)] bg-[var(--bg-surface)]">
      {/* Table Header */}
      <div className="flex h-[32px] items-center border-b border-[var(--border-light)] bg-[var(--bg-subtle)] px-3.5 font-mono text-[10px] tracking-[0.08em] text-[var(--ink-subtle)]">
        <span className="flex-1">PROCESS</span>
        <span className="w-[70px] shrink-0 text-right">CPU</span>
        <span className="w-[70px] shrink-0 text-right">MEM</span>
        <span className="w-[80px] shrink-0 text-right">来源</span>
      </div>

      {/* Rows */}
      {data.rows.map((row, idx) => {
        const isLast = idx === data.rows.length - 1;
        return (
          <div
            key={row.id}
            className={`flex h-[36px] items-center px-3.5 ${
              !isLast ? "border-b border-[var(--border-faint)]" : ""
            } ${row.killed ? "opacity-45" : ""}`}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  row.killed
                    ? "bg-emerald-500"
                    : row.severity === "high"
                      ? "bg-[var(--danger)]"
                      : "bg-[var(--border-strong)]"
                }`}
              />
              <span
                className={`truncate font-mono text-[12px] text-[var(--ink-strong)] ${
                  row.severity === "high" ? "font-semibold" : "font-normal"
                } ${row.killed ? "line-through" : ""}`}
              >
                {row.name}
              </span>
            </div>
            <span
              className={`w-[70px] shrink-0 text-right font-mono text-[12px] text-[var(--ink-strong)] ${
                row.severity === "high" ? "font-semibold" : ""
              }`}
            >
              {row.killed ? "已结束" : `${row.cpuPct}%`}
            </span>
            <span className="w-[70px] shrink-0 text-right font-mono text-[12px] text-[var(--ink-strong)]">
              {row.memLabel}
            </span>
            <span className="w-[80px] shrink-0 text-right text-[12px] text-[var(--ink-muted)]">
              {row.sourceLabel}
            </span>
          </div>
        );
      })}

      {/* Action Footer */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--border-light)] px-3.5 py-2.5">
        <button
          type="button"
          disabled={data.primaryActionDone}
          onClick={() => onAction("kill_primary")}
          className={`inline-flex h-[28px] items-center gap-1.5 rounded-[7px] px-3 text-[12px] font-semibold transition-opacity ${
            data.primaryActionDone
              ? "cursor-default bg-[var(--bg-muted)] text-[var(--ink-muted)]"
              : "cursor-pointer bg-[var(--ink-primary)] text-[var(--ink-on-primary)] hover:opacity-90"
          }`}
        >
          {data.primaryActionDone ? (
            <>
              <CheckIcon size={11} strokeWidth={3} />
              <span>已结束 {shortProcessName}</span>
            </>
          ) : (
            <span>结束 {shortProcessName}</span>
          )}
        </button>

        <button
          type="button"
          disabled={data.secondaryActionDone}
          onClick={() => onAction("clean_disk")}
          className={`inline-flex h-[28px] items-center gap-1.5 rounded-[7px] border px-3 text-[12px] font-medium transition-colors ${
            data.secondaryActionDone
              ? "cursor-default border-[var(--border-light)] bg-[var(--bg-subtle)] text-[var(--ink-muted)]"
              : "cursor-pointer border-[var(--border-control)] bg-[var(--bg-canvas)] text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
          }`}
        >
          {data.secondaryActionDone ? "已发起清理 ✓" : "清理磁盘 18 GB"}
        </button>

        <div className="flex-1" />

        <button
          type="button"
          disabled={data.autoRuleAdded}
          onClick={() => onAction("auto_rule")}
          className={`inline-flex h-[28px] items-center px-1 text-[12px] font-medium ${
            data.autoRuleAdded
              ? "cursor-default text-[var(--ink-muted)]"
              : "cursor-pointer text-[var(--ink-strong)] underline underline-offset-2 hover:opacity-75"
          }`}
        >
          {data.autoRuleAdded ? "已设为自动处理 ✓" : "以后自动处理此类情况"}
        </button>
      </div>
    </div>
  );
};

export const PluginDraftCard: React.FC<{
  draft: PluginDraftSpec;
  onInstall: (draft: PluginDraftSpec) => void;
}> = ({ draft, onInstall }) => {
  const [codeOpen, setCodeOpen] = useState(false);

  return (
    <>
      <div className="flex w-full max-w-[520px] items-center gap-3.5 rounded-[12px] border-[1.5px] border-dashed border-[var(--border-dash)] bg-[var(--bg-code)] px-3.5 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="rounded-[4px] bg-[var(--ink-primary)] px-1.5 py-[2px] font-mono text-[9px] tracking-[0.12em] text-[var(--ink-on-primary)]">
              PLUGIN DRAFT
            </span>
            <span className="truncate text-[14px] font-semibold leading-[18px] text-[var(--ink-strong)]">
              {draft.name}
            </span>
          </div>
          <div className="font-mono text-[11px] leading-[17px] text-[var(--ink-secondary)]">
            <div>{draft.whenExpression}</div>
            <div className="font-semibold text-[var(--ink-strong)]">{draft.actionExpression}</div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-1.5">
          <button
            type="button"
            disabled={draft.installed}
            onClick={() => onInstall(draft)}
            className={`inline-flex h-[28px] items-center justify-center gap-1 rounded-[7px] px-3 text-[12px] font-semibold ${
              draft.installed
                ? "cursor-default bg-[var(--bg-muted)] text-[var(--ink-muted)]"
                : "cursor-pointer bg-[var(--ink-primary)] text-[var(--ink-on-primary)]"
            }`}
          >
            {draft.installed ? (
              <>
                <CheckIcon size={11} strokeWidth={3} />
                <span>已安装</span>
              </>
            ) : (
              <span>安装到本地</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setCodeOpen(true)}
            className="inline-flex h-[28px] cursor-pointer items-center justify-center rounded-[7px] border border-[var(--border-control)] px-3 text-[12px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
          >
            查看代码
          </button>
        </div>
      </div>

      <Modal
        open={codeOpen}
        onClose={() => setCodeOpen(false)}
        title={`插件清单 · ${draft.name}`}
        subtitle="~/.valet/plugins/manifest.yaml"
      >
        <pre className="overflow-x-auto rounded-[10px] bg-[var(--bg-code)] p-3.5 font-mono text-[11px] leading-[18px] text-[var(--ink-secondary)]">
          {draft.manifestYaml}
        </pre>
        <div className="mt-4 flex justify-end gap-2">
          {!draft.installed && (
            <button
              type="button"
              onClick={() => {
                onInstall(draft);
                setCodeOpen(false);
              }}
              className="h-[32px] cursor-pointer rounded-[8px] bg-[var(--ink-primary)] px-3.5 text-[12px] font-semibold text-[var(--ink-on-primary)]"
            >
              安装到本地
            </button>
          )}
          <button
            type="button"
            onClick={() => setCodeOpen(false)}
            className="h-[32px] cursor-pointer rounded-[8px] border border-[var(--border-control)] px-3.5 text-[12px] font-medium text-[var(--ink-strong)]"
          >
            关闭
          </button>
        </div>
      </Modal>
    </>
  );
};

function stripThinkMarkup(raw: string): string {
  if (!raw) return "";
  let clean = raw.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "");
  if (/<think(?:ing)?>/i.test(clean)) {
    clean = clean.replace(/<think(?:ing)?>[\s\S]*$/i, "");
  }
  return clean.replace(/^\s+/, "");
}

const InlineFormatted: React.FC<{ text: string }> = ({ text }) => {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
          return (
            <code
              key={i}
              className="rounded-[4px] bg-[var(--bg-muted)] px-1 py-0.5 font-mono text-[12.5px] font-semibold text-[var(--ink-strong)]"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
          return (
            <strong key={i} className="font-semibold text-[var(--ink-strong)]">
              {part.slice(2, -2)}
            </strong>
          );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </>
  );
};

const MarkdownTextBlock: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1]!.length;
      const content = headingMatch[2]!;
      blocks.push(
        <div
          key={`h-${i}`}
          className={`font-semibold text-[var(--ink-strong)] ${
            level === 1 ? "mt-2 text-[15px]" : "mt-1.5 text-[13.5px]"
          }`}
        >
          <InlineFormatted text={content} />
        </div>
      );
      i++;
      continue;
    }

    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test((lines[i] ?? "").trim())) {
        items.push((lines[i] ?? "").trim().replace(/^[-*•]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={`ul-${i}`} className="my-1 flex flex-col gap-1 pl-4 list-disc">
          {items.map((item, idx) => (
            <li key={idx}>
              <InlineFormatted text={item} />
            </li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test((lines[i] ?? "").trim())) {
        items.push((lines[i] ?? "").trim().replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={`ol-${i}`} className="my-1 flex flex-col gap-1 pl-4 list-decimal">
          {items.map((item, idx) => (
            <li key={idx}>
              <InlineFormatted text={item} />
            </li>
          ))}
        </ol>
      );
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() !== "" &&
      !/^(#{1,3})\s+/.test((lines[i] ?? "").trim()) &&
      !/^[-*•]\s+/.test((lines[i] ?? "").trim()) &&
      !/^\d+\.\s+/.test((lines[i] ?? "").trim())
    ) {
      paraLines.push(lines[i]!);
      i++;
    }
    blocks.push(
      <p key={`p-${i}`} className="whitespace-pre-wrap break-words">
        <InlineFormatted text={paraLines.join("\n")} />
      </p>
    );
  }

  return <div className="flex flex-col gap-1.5">{blocks}</div>;
};

export const FormattedText: React.FC<{ text: string }> = ({ text }) => {
  const cleaned = stripThinkMarkup(text);
  const segments = cleaned.split(/(```[\s\S]*?```)/g);
  return (
    <div className="flex flex-col gap-2">
      {segments.map((seg, idx) => {
        if (seg.startsWith("```") && seg.endsWith("```") && seg.length >= 6) {
          const inner = seg.slice(3, -3).replace(/^[^\n]*\n/, "");
          return (
            <pre
              key={idx}
              className="overflow-x-auto rounded-[8px] bg-[var(--bg-code)] p-3 font-mono text-[11.5px] leading-[18px] text-[var(--ink-secondary)]"
            >
              {inner}
            </pre>
          );
        }
        if (!seg.trim()) return null;
        return <MarkdownTextBlock key={idx} text={seg} />;
      })}
    </div>
  );
};
