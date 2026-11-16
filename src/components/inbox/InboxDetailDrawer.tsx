import React, { useMemo, useState } from "react";
import { useValet } from "../../store/ValetContext";
import { PluginTag } from "../ui/Badge";
import { Checkbox } from "../ui/Checkbox";
import { CloseIcon, UndoIcon } from "../ui/Icons";
import { SlideOverDrawer } from "../ui/Modal";
import { SegmentedControl } from "../ui/SegmentedControl";

type DrawerTab = "overview" | "chain" | "logs";

export const InboxDetailDrawer: React.FC = () => {
  const {
    state,
    selectInboxItem,
    toggleInboxActionItem,
    approveInboxItem,
    dismissInboxItem,
    restoreApprovedInboxItem,
    pushToast,
  } = useValet();

  const [tab, setTab] = useState<DrawerTab>("overview");
  const [expandedItems, setExpandedItems] = useState(false);

  const item = useMemo(
    () =>
      state.selectedInboxItemId
        ? state.inboxItems.find((i) => i.id === state.selectedInboxItemId) ?? null
        : null,
    [state.inboxItems, state.selectedInboxItemId]
  );

  const visibleItems = useMemo(() => {
    if (!item) return [];
    if (expandedItems) return item.actionItems;
    const defaultVisible = item.actionItems.filter((a) => !a.defaultHidden);
    return defaultVisible.length > 0 ? defaultVisible : item.actionItems;
  }, [expandedItems, item]);

  const hiddenCount = useMemo(() => {
    if (!item) return 0;
    return item.actionItems.filter((a) => a.defaultHidden).length;
  }, [item]);

  const selectedCount = item ? item.actionItems.filter((i) => i.checked).length : 0;
  const totalCount = item ? item.actionItems.length : 0;
  const selectedSizeMB = item
    ? item.actionItems.filter((i) => i.checked).reduce((acc, i) => acc + i.sizeMB, 0)
    : 0;
  const selectedSizeGB = (selectedSizeMB / 1024).toFixed(1);

  return (
    <SlideOverDrawer open={Boolean(item)} onClose={() => selectInboxItem(null)}>
      {item && (
        <>
          {/* Header */}
          <div className="flex h-[56px] shrink-0 items-center gap-2.5 border-b border-[var(--border-light)] px-5">
            <button
              type="button"
              onClick={() => selectInboxItem(null)}
              className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[7px] bg-[var(--bg-subtle)] text-[var(--ink-primary)] hover:bg-[var(--bg-hover)]"
              aria-label="关闭详情"
            >
              <CloseIcon size={14} />
            </button>

            <span className="truncate font-mono text-[11px] tracking-[0.08em] text-[var(--ink-muted)]">
              {item.triggerLatencyLabel ?? `${item.timeLabel} · ${item.eventCode}`}
            </span>

            <div className="flex-1" />

            <SegmentedControl<DrawerTab>
              value={tab}
              onChange={setTab}
              options={[
                { value: "overview", label: "概览" },
                { value: "chain", label: "事件链" },
                { value: "logs", label: "日志" },
              ]}
            />
          </div>

          {/* Body */}
          <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-7 pt-[22px] pb-6">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {item.status === "pending" ? (
                  <span className="inline-flex h-[24px] shrink-0 items-center rounded-full border border-[var(--amber-pill)] px-[9px] text-[11px] font-semibold text-[var(--amber-text)]">
                    待你批准
                  </span>
                ) : item.status === "approved" ? (
                  <span className="inline-flex h-[24px] shrink-0 items-center rounded-full border border-[var(--border-control)] px-[9px] text-[11px] font-medium text-[var(--ink-muted)]">
                    {item.restored ? "已还原" : "已批准"}
                  </span>
                ) : (
                  <span className="inline-flex h-[24px] shrink-0 items-center rounded-full border border-[var(--border-control)] px-[9px] text-[11px] font-medium text-[var(--ink-subtle)]">
                    已忽略
                  </span>
                )}
                <PluginTag label={item.pluginName} />
                <span className="font-mono text-[10px] text-[var(--ink-subtle)]">
                  {item.eventCode}
                </span>
                {item.warningTag && (
                  <span className="inline-flex h-[20px] items-center rounded-full border border-[var(--amber-pill)] px-2 text-[10px] font-semibold text-[var(--amber-text)]">
                    {item.warningTag}
                  </span>
                )}
              </div>

              <h3 className="font-[family-name:var(--font-serif-zh)] text-[24px] font-medium leading-[34px] tracking-[-0.01em] text-[var(--ink-strong)]">
                {item.title}
              </h3>
            </div>

            {tab === "overview" && (
              <>
                <section className="flex flex-col gap-2">
                  <div className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
                    01 · 事件载荷
                  </div>
                  <pre className="overflow-x-auto rounded-[8px] bg-[var(--bg-code)] px-3.5 py-3 font-mono text-[11px] leading-[18px] text-[var(--ink-secondary)]">
                    {JSON.stringify(item.payload, null, 2)}
                  </pre>
                </section>

                <section className="flex flex-col gap-2">
                  <div className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
                    02 · 安全判断
                  </div>
                  <p className="text-[13px] leading-[21px] text-[var(--ink-body)]">
                    {item.reasoning}
                  </p>
                </section>

                {item.actionItems.length > 0 && (
                  <section className="flex flex-col gap-1">
                    <div className="flex items-center justify-between pb-1">
                      <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
                        03 · 执行清单
                      </span>
                      <span className="text-[11px] text-[var(--ink-muted)]">
                        已选 {selectedCount} / {totalCount}
                        {selectedSizeMB > 0 ? ` · ${selectedSizeGB} GB` : ""}
                      </span>
                    </div>

                    {visibleItems.map((act) => {
                      const locked = item.status !== "pending";
                      return (
                        <div
                          key={act.id}
                          onClick={() => {
                            if (!locked) toggleInboxActionItem(item.id, act.id);
                          }}
                          className={`flex h-[32px] items-center gap-2.5 rounded-[6px] px-1 transition-colors ${
                            locked
                              ? "cursor-default"
                              : "cursor-pointer hover:bg-[var(--bg-subtle)]"
                          }`}
                        >
                          <Checkbox
                            checked={act.checked}
                            disabled={locked}
                            onChange={() => toggleInboxActionItem(item.id, act.id)}
                          />
                          <div
                            className={`min-w-0 flex-1 truncate font-mono text-[11px] ${
                              act.checked
                                ? "text-[var(--ink-strong)]"
                                : "text-[var(--ink-subtle)]"
                            }`}
                          >
                            {act.label}
                            {act.keepNote && (
                              <span className="font-sans text-[11px] text-[var(--ink-subtle)]">
                                {" "}
                                {act.keepNote}
                              </span>
                            )}
                          </div>
                          <span className="w-[72px] shrink-0 text-right font-mono text-[11px] text-[var(--ink-muted)]">
                            {act.sizeLabel}
                          </span>
                        </div>
                      );
                    })}

                    {hiddenCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setExpandedItems((e) => !e)}
                        className="mt-1 w-fit cursor-pointer text-[12px] font-medium text-[var(--ink-strong)] hover:underline"
                      >
                        {expandedItems
                          ? "收起默认折叠项目"
                          : `+ 展开其余 ${hiddenCount} 项`}
                      </button>
                    )}
                  </section>
                )}
              </>
            )}

            {tab === "chain" && (
              <section className="flex flex-col gap-3">
                <div className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
                  事件响应链
                </div>
                <div className="flex flex-col rounded-[10px] border border-[var(--border-base)] p-4">
                  {item.traceSteps.map((step, i) => {
                    const last = i === item.traceSteps.length - 1;
                    const dotColor =
                      step.status === "error"
                        ? "bg-[var(--danger)]"
                        : step.status === "active"
                          ? "bg-[var(--amber-icon)]"
                          : "bg-[var(--ink-primary)]";
                    return (
                      <div key={step.id} className="flex gap-3">
                        <span className="w-[62px] shrink-0 pt-0.5 font-mono text-[11px] text-[var(--ink-muted)]">
                          {step.time}
                        </span>
                        <div className="flex w-4 shrink-0 flex-col items-center">
                          <span className={`mt-1.5 h-2 w-2 rounded-full ${dotColor}`} />
                          {!last && (
                            <span className="my-1 w-[1px] flex-1 bg-[var(--border-base)]" />
                          )}
                        </div>
                        <div className="flex flex-1 flex-col gap-0.5 pb-4">
                          <span className="text-[13px] font-semibold text-[var(--ink-strong)]">
                            {step.stage}
                          </span>
                          <span className="text-[12px] text-[var(--ink-muted)]">
                            {step.detail}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {tab === "logs" && (
              <section className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
                    检查日志 ({item.logs.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const text = item.logs
                        .map((l) => `[${l.ts}] ${l.level}: ${l.message}`)
                        .join("\n");
                      navigator.clipboard?.writeText(text);
                      pushToast("已复制日志到剪贴板", "success");
                    }}
                    className="cursor-pointer rounded-[6px] border border-[var(--border-control)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
                  >
                    复制日志
                  </button>
                </div>

                <div className="flex flex-col gap-1.5 rounded-[10px] bg-[var(--bg-code)] p-3.5 font-mono text-[11px] leading-[18px]">
                  {item.logs.map((line) => (
                    <div key={line.id} className="flex gap-2">
                      <span className="shrink-0 text-[var(--ink-subtle)]">{line.ts}</span>
                      <span
                        className={`w-[38px] shrink-0 font-semibold ${
                          line.level === "ERR"
                            ? "text-[var(--danger)]"
                            : line.level === "WARN"
                              ? "text-[var(--amber-text)]"
                              : "text-[var(--ink-primary)]"
                        }`}
                      >
                        {line.level}
                      </span>
                      <span className="break-all text-[var(--ink-secondary)]">
                        {line.message}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border-light)] px-7 py-4">
            <UndoIcon size={14} className="shrink-0 text-[var(--ink-muted)]" />
            <span className="flex-1 text-[12px] text-[var(--ink-muted)]">
              {item.reversible7d
                ? "移入废纸篓 · 7 天内可一键还原"
                : item.warningTag === "外发消息"
                  ? "外发草稿默认拦截 · 经批准后才发送"
                  : "敏感系统操作 · 执行后不可撤销"}
            </span>

            {item.status === "pending" && (
              <>
                <button
                  type="button"
                  onClick={() => dismissInboxItem(item.id)}
                  className="inline-flex h-[34px] cursor-pointer items-center rounded-[8px] border border-[var(--border-control)] px-3.5 text-[13px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
                >
                  {item.dismissLabel}
                </button>
                <button
                  type="button"
                  disabled={item.actionItems.length > 0 && selectedCount === 0}
                  onClick={() => approveInboxItem(item.id)}
                  className={`inline-flex h-[34px] items-center rounded-[8px] bg-[var(--ink-primary)] px-3.5 text-[13px] font-semibold text-[var(--ink-on-primary)] ${
                    item.actionItems.length > 0 && selectedCount === 0
                      ? "cursor-not-allowed opacity-40"
                      : "cursor-pointer"
                  }`}
                >
                  {item.approveLabel}
                </button>
              </>
            )}

            {item.status === "approved" && item.reversible7d && !item.restored && (
              <button
                type="button"
                onClick={() => restoreApprovedInboxItem(item.id)}
                className="inline-flex h-[34px] cursor-pointer items-center rounded-[8px] border border-[var(--border-control)] px-3.5 text-[13px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
              >
                一键还原
              </button>
            )}
          </div>
        </>
      )}
    </SlideOverDrawer>
  );
};
