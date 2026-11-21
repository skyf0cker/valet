import React, { useState } from "react";
import type {
  ChatMessage,
  PendingPermissionRequest,
  PluginDraftSpec,
} from "../../types/valet";
import { CheckIcon } from "../ui/Icons";
import { stripThinkMarkup } from "../../utils/chatClipboard";
import { MarkdownRenderer } from "../ui/MarkdownRenderer";
import { Modal } from "../ui/Modal";
import { AgentWorkTrace } from "./AgentWorkTrace";
import type { StepRowItem } from "./workTraceUtils";

export type { StepRowItem };

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
            {draft.sensor && (
              <span className="rounded-[4px] border border-[var(--border-control)] bg-[var(--bg-subtle)] px-1.5 py-[1px] font-mono text-[9.5px] text-[var(--ink-muted)]">
                {draft.sensor}
              </span>
            )}
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
        title={`闭环插件定义 · ${draft.name}`}
        subtitle="triggers + sensor + SKILL.md"
      >
        <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto">
          {draft.skillMarkdown && (
            <div className="rounded-[10px] border border-[var(--border-light)] bg-[var(--bg-subtle)] p-3.5 text-[12.5px] leading-[19px] text-[var(--ink-body)]">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-subtle)]">
                SKILL.md · 处理逻辑
              </div>
              <MarkdownRenderer text={draft.skillMarkdown} />
            </div>
          )}
          <div>
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-subtle)]">
              manifest.yaml · 事件与传感器声明
            </div>
            <pre className="overflow-x-auto rounded-[10px] bg-[var(--bg-code)] p-3.5 font-mono text-[11px] leading-[18px] text-[var(--ink-secondary)]">
              {draft.manifestYaml}
            </pre>
          </div>
        </div>
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

export const ToolStepsList: React.FC<{ steps: StepRowItem[] }> = ({ steps }) => {
  if (!steps || steps.length === 0) return null;
  return <AgentWorkTrace steps={steps} />;
};

export const FormattedText: React.FC<{ text: string }> = ({ text }) => {
  const cleaned = stripThinkMarkup(text);
  return <MarkdownRenderer text={cleaned} />;
};

export const PermissionAskCard: React.FC<{
  request: PendingPermissionRequest;
  onResolve: (
    decision: "allow_once" | "allow_session" | "deny",
    note?: string
  ) => void;
}> = ({ request, onResolve }) => {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isQuestion = request.toolName === "ask_user";

  const submit = (decision: "allow_once" | "allow_session" | "deny", customNote?: string) => {
    if (submitting) return;
    setSubmitting(true);
    onResolve(decision, customNote ?? (note.trim() || undefined));
  };

  return (
    <div className="flex w-full max-w-[540px] flex-col gap-2.5 rounded-[12px] border border-[var(--amber-pill)] bg-[var(--bg-surface)] p-3.5 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="rounded-[4px] bg-[var(--amber-bg)] px-1.5 py-[2px] font-mono text-[10px] font-semibold tracking-[0.08em] text-[var(--amber-text)]">
          {isQuestion ? "ASK USER" : "PERMISSION"}
        </span>
        <span className="font-mono text-[11px] text-[var(--ink-muted)]">
          {request.toolName}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--ink-strong)]">
          {request.title}
        </span>
      </div>

      {request.summary && (
        <MarkdownRenderer
          text={request.summary}
          className="text-[12.5px] leading-[18px] text-[var(--ink-body)]"
        />
      )}

      {request.command && (
        <pre className="overflow-x-auto rounded-[8px] bg-[var(--bg-code)] px-3 py-2 font-mono text-[11.5px] leading-[17px] text-[var(--ink-strong)]">
          {request.command}
        </pre>
      )}

      {request.targetPath && (
        <div className="rounded-[7px] bg-[var(--bg-subtle)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--ink-secondary)]">
          目标路径：{request.targetPath}
        </div>
      )}

      {request.paths && request.paths.length > 0 && (
        <div className="flex flex-col gap-1 rounded-[8px] bg-[var(--bg-subtle)] px-2.5 py-2">
          {request.paths.slice(0, 6).map((p) => (
            <div key={p} className="truncate font-mono text-[11px] text-[var(--ink-secondary)]">
              • {p}
            </div>
          ))}
          {request.paths.length > 6 && (
            <div className="font-mono text-[10px] text-[var(--ink-muted)]">
              …共 {request.paths.length} 项
            </div>
          )}
        </div>
      )}

      {isQuestion && request.options && request.options.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {request.options.map((opt) => (
            <button
              key={opt}
              type="button"
              disabled={submitting}
              onClick={() => submit("allow_once", opt)}
              className="inline-flex h-[28px] cursor-pointer items-center rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 text-[12px] font-medium text-[var(--ink-strong)] hover:border-[var(--ink-primary)] hover:bg-[var(--bg-subtle)] disabled:opacity-50"
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {isQuestion && (
        <div className="flex items-center gap-2 pt-0.5">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && note.trim()) {
                e.preventDefault();
                submit("allow_once", note.trim());
              }
            }}
            placeholder="或输入补充说明 / 自定义指示…"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="h-[30px] flex-1 rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-2.5 text-[12px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
          />
          <button
            type="button"
            disabled={submitting || !note.trim()}
            onClick={() => submit("allow_once", note.trim())}
            className="inline-flex h-[30px] cursor-pointer items-center rounded-[7px] bg-[var(--ink-primary)] px-3 text-[12px] font-semibold text-[var(--ink-on-primary)] disabled:cursor-default disabled:opacity-40"
          >
            {request.approveLabel || "确认"}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => submit("deny")}
            className="inline-flex h-[30px] cursor-pointer items-center rounded-[7px] border border-[var(--border-control)] px-2.5 text-[12px] font-medium text-[var(--ink-muted)] hover:text-[var(--ink-strong)] disabled:opacity-50"
          >
            {request.dismissLabel || "跳过"}
          </button>
        </div>
      )}

      {!isQuestion && (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <button
            type="button"
            disabled={submitting}
            onClick={() => submit("allow_once")}
            className="inline-flex h-[29px] cursor-pointer items-center rounded-[7px] bg-[var(--ink-primary)] px-3 text-[12px] font-semibold text-[var(--ink-on-primary)] hover:opacity-90 disabled:opacity-50"
          >
            {request.approveLabel || "允许一次"}
          </button>
          {request.allowSessionLabel && (
            <button
              type="button"
              disabled={submitting}
              onClick={() => submit("allow_session")}
              className="inline-flex h-[29px] cursor-pointer items-center rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 text-[12px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)] disabled:opacity-50"
            >
              {request.allowSessionLabel}
            </button>
          )}
          <button
            type="button"
            disabled={submitting}
            onClick={() => submit("deny")}
            className="inline-flex h-[29px] cursor-pointer items-center rounded-[7px] border border-[var(--border-control)] px-3 text-[12px] font-medium text-[var(--ink-muted)] hover:text-[var(--danger)] disabled:opacity-50"
          >
            {request.dismissLabel || "拒绝"}
          </button>
        </div>
      )}
    </div>
  );
};
