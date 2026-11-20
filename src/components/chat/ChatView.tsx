import React, { useEffect, useRef } from "react";
import { useValet } from "../../store/ValetContext";
import { DEFAULT_PROJECT_ID } from "../../types/valet";
import { isQuoteAttachment } from "../../utils/chatQuotes";
import { SidebarToggleButton } from "../Sidebar";
import {
  ArrowLeftIcon,
  BookOpenIcon,
  BowtieSvg,
  ClockIcon,
  FileTextIcon,
  InboxIcon,
  PlusIcon,
} from "../ui/Icons";
import { SelectMenu } from "../ui/SelectMenu";
import { ChatComposer } from "./ChatComposer";
import {
  FormattedText,
  PermissionAskCard,
  PluginDraftCard,
  ProcessTableCard,
  ToolStepsList,
} from "./MessageCards";

export const ChatView: React.FC = () => {
  const {
    state,
    chatStreams,
    runningChatIds,
    sidebarCollapsed,
    createNewChat,
    selectChatThread,
    selectProject,
    returnToProjectNotebook,
    syncSessionSummaryToNotebook,
    sendChatMessage,
    resolveChatPermission,
    abortChatMessage,
    performProcessAction,
    installPluginDraft,
    setActiveView,
    selectTimelineEvent,
    selectInboxItem,
    pushToast,
  } = useValet();

  const bottomRef = useRef<HTMLDivElement>(null);

  const activeThreads = state.chatThreads.filter((t) => !t.archived);
  const thread =
    activeThreads.find((t) => t.id === state.activeChatId) ??
    state.chatThreads.find((t) => t.id === state.activeChatId) ??
    activeThreads[0] ??
    state.chatThreads[0];
  const sending = thread ? (runningChatIds[thread.id] ?? 0) > 0 : false;
  const activeStream = thread ? (chatStreams[thread.id] ?? null) : null;

  const parentProject = thread
    ? state.projects.find((p) => p.id === (thread.projectId || DEFAULT_PROJECT_ID)) ??
      state.projects.find((p) => p.id === DEFAULT_PROJECT_ID) ??
      state.projects[0]
    : undefined;

  const projectThreads = parentProject
    ? activeThreads.filter(
        (t) => (t.projectId || DEFAULT_PROJECT_ID) === parentProject.id
      )
    : activeThreads;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [
    thread?.messages.length,
    sending,
    activeStream?.steps?.length,
    activeStream?.pendingPermission?.requestId,
  ]);

  if (!thread) return null;

  const switcherThreads = projectThreads.some((t) => t.id === thread.id)
    ? projectThreads
    : [thread, ...projectThreads];

  const hasNotebookBacklink =
    Boolean(parentProject) &&
    (Boolean(thread.originBlockId) ||
      Boolean(thread.notebookContextInjected) ||
      Boolean(
        parentProject?.blocks.some(
          (b) => b.sessionId === thread.id || b.content.includes(`[[session:${thread.id}]]`)
        )
      ));

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-canvas)]">
      {/* Top Bar */}
      <header
        className={`app-drag flex shrink-0 items-center gap-2 border-b border-[var(--border-light)] ${
          sidebarCollapsed ? "h-[44px] px-[22px]" : "h-[52px] px-6"
        }`}
      >
        <SidebarToggleButton />

        {parentProject && (
          <div className="app-no-drag flex shrink-0 items-center gap-1.5 text-[12px] text-[var(--ink-muted)]">
            <button
              type="button"
              onClick={() => selectProject(parentProject.id, "sessions")}
              className="cursor-pointer rounded-[5px] px-1 py-0.5 hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
            >
              项目
            </button>
            <span className="text-[var(--ink-subtle)]">/</span>
            <button
              type="button"
              onClick={() => returnToProjectNotebook(undefined, parentProject.id)}
              className="max-w-[140px] cursor-pointer truncate rounded-[5px] px-1 py-0.5 font-medium hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
              title={`返回 ${parentProject.title} Notebook`}
            >
              {parentProject.title}
            </button>
            <span className="text-[var(--ink-subtle)]">/</span>
          </div>
        )}

        {/* Scoped Thread Switcher Dropdown */}
        <div className="app-no-drag min-w-0">
          <SelectMenu
            value={thread.id}
            options={switcherThreads.map((t) => ({
              value: t.id,
              label: t.archived ? `${t.title}（已归档）` : t.title,
              hint: t.updatedAt,
            }))}
            onChange={(id) => selectChatThread(id)}
            align="left"
            triggerClassName="border-0 bg-transparent px-1 font-semibold text-[13px] lg:text-[14px] text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
          />
        </div>

        <div className="flex-1" />

        {parentProject && (
          <button
            type="button"
            onClick={() =>
              returnToProjectNotebook(thread.originBlockId || undefined, parentProject.id)
            }
            className="app-no-drag inline-flex h-[28px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-surface)] px-2.5 text-[11.5px] font-medium text-[var(--ink-strong)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-subtle)]"
          >
            <ArrowLeftIcon size={12} />
            <span>返回 Notebook</span>
          </button>
        )}

        {thread.timelineActionCount > 0 && (
          <button
            type="button"
            onClick={() => {
              setActiveView("timeline");
              const firstEvt = thread.linkedEventIds[0];
              if (firstEvt) selectTimelineEvent(firstEvt);
            }}
            className="app-no-drag cursor-pointer text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink-strong)] hover:underline lg:text-[12px]"
          >
            {sidebarCollapsed
              ? `${thread.timelineActionCount} 个时间线动作`
              : `本对话产生 ${thread.timelineActionCount} 个时间线动作`}
          </button>
        )}

        <button
          type="button"
          onClick={() => createNewChat(parentProject?.id)}
          title="新建对话 (⌘N)"
          className={`app-no-drag flex shrink-0 cursor-pointer items-center justify-center rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-surface)] text-[var(--ink-primary)] hover:bg-[var(--bg-subtle)] lg:rounded-[8px] ${
            sidebarCollapsed ? "h-[26px] w-[26px]" : "h-[30px] w-[30px]"
          }`}
        >
          <PlusIcon size={sidebarCollapsed ? 12 : 14} />
        </button>
      </header>

      {/* Notebook Backlink Context Bar */}
      {hasNotebookBacklink && parentProject && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--border-light)] bg-[var(--bg-subtle)]/70 px-6 py-1.5 text-[11.5px]">
          <div className="flex min-w-0 items-center gap-2 text-[var(--ink-secondary)]">
            <FileTextIcon size={12.5} className="shrink-0 text-[var(--ink-muted)]" />
            <span className="truncate">
              引用自「{parentProject.title}」Notebook
              {thread.originSection ? ` · ${thread.originSection}` : ""}
            </span>
            {thread.notebookContextInjected && (
              <span className="shrink-0 rounded-[5px] border border-[var(--border-light)] bg-[var(--bg-surface)] px-1.5 py-[1px] font-mono text-[10px] text-[var(--ink-muted)]">
                已注入页面上下文
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() =>
                returnToProjectNotebook(thread.originBlockId || undefined, parentProject.id)
              }
              className="cursor-pointer font-medium text-[var(--ink-strong)] hover:underline"
            >
              定位到引用处 ↗
            </button>
            <span className="text-[var(--ink-subtle)]">·</span>
            <button
              type="button"
              onClick={() => syncSessionSummaryToNotebook(thread.id)}
              className="cursor-pointer text-[var(--ink-muted)] hover:text-[var(--ink-strong)] hover:underline"
            >
              同步摘要到 Notebook
            </button>
          </div>
        </div>
      )}

      {/* Message stream */}
      <div
        className={`min-h-0 flex-1 overflow-y-auto pb-4 ${
          sidebarCollapsed ? "px-[22px] pt-3.5" : "px-6 pt-6"
        }`}
      >
        <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3.5 lg:gap-[18px]">
          {thread.messages.map((msg) =>
            msg.role === "user" ? (
              <div key={msg.id} className="flex justify-end">
                <div className="flex max-w-[460px] flex-col items-end gap-1.5">
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {msg.attachments.map((att) =>
                        isQuoteAttachment(att) ? (
                          <button
                            key={att.id}
                            type="button"
                            onClick={() => {
                              if (att.kind === "inbox_item") {
                                const targetId =
                                  att.refId ?? att.id.replace(/^quote-inbox-/, "");
                                const exists = state.inboxItems.some(
                                  (it) => it.id === targetId
                                );
                                if (!exists) {
                                  pushToast("该事项已被清理或归档");
                                  return;
                                }
                                setActiveView("inbox");
                                selectInboxItem(targetId);
                              } else {
                                const targetId =
                                  att.refId ?? att.id.replace(/^quote-timeline-/, "");
                                const exists = state.timelineEvents.some(
                                  (ev) => ev.id === targetId
                                );
                                if (!exists) {
                                  pushToast("该事项已被清理或归档");
                                  return;
                                }
                                setActiveView("timeline");
                                selectTimelineEvent(targetId);
                              }
                            }}
                            title="点击回看原事项详情"
                            className="flex max-w-[320px] cursor-pointer items-center gap-2 overflow-hidden rounded-[8px] border border-[var(--border-card)] bg-[var(--bg-subtle)] px-2.5 py-1.5 text-left shadow-[inset_3px_0_0_var(--ink-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]/65"
                          >
                            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border border-[var(--border-control)] bg-[var(--bg-surface)] text-[var(--ink-primary)]">
                              {att.kind === "inbox_item" ? (
                                <InboxIcon size={11.5} />
                              ) : (
                                <ClockIcon size={11.5} />
                              )}
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col">
                              <div className="flex items-center gap-1.5">
                                <span className="shrink-0 font-mono text-[9.5px] font-medium text-[var(--ink-muted)]">
                                  {att.badge ??
                                    (att.kind === "inbox_item" ? "收件箱" : "时间线")}
                                </span>
                                <span className="truncate text-[11.5px] font-medium text-[var(--ink-strong)]">
                                  {att.name}
                                </span>
                              </div>
                              {att.meta && (
                                <span className="truncate font-mono text-[9.5px] text-[var(--ink-subtle)]">
                                  {att.meta}
                                </span>
                              )}
                            </div>
                          </button>
                        ) : att.kind === "notebook_context" ? (
                          <button
                            key={att.id}
                            type="button"
                            onClick={() =>
                              returnToProjectNotebook(
                                thread.originBlockId || undefined,
                                att.refId || parentProject?.id
                              )
                            }
                            title={
                              att.meta
                                ? `点击跳转回项目 Notebook（${att.meta}）`
                                : "点击跳转回项目 Notebook"
                            }
                            className="flex max-w-[380px] cursor-pointer items-center gap-2 overflow-hidden rounded-[8px] border border-[var(--border-card)] bg-[var(--bg-subtle)] px-2.5 py-1.5 text-left shadow-[inset_3px_0_0_var(--ink-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]/65"
                          >
                            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border border-[var(--border-control)] bg-[var(--bg-surface)] text-[var(--ink-primary)]">
                              <BookOpenIcon size={11.5} />
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col">
                              <div className="flex items-center gap-1.5">
                                <span className="shrink-0 font-mono text-[9.5px] font-medium text-[var(--ink-muted)]">
                                  {att.badge ?? "Notebook"}
                                </span>
                                <span className="truncate text-[11.5px] font-medium text-[var(--ink-strong)]">
                                  {att.name}
                                </span>
                              </div>
                              {att.meta && (
                                <span className="truncate font-mono text-[9.5px] text-[var(--ink-subtle)]">
                                  {att.meta}
                                </span>
                              )}
                            </div>
                          </button>
                        ) : att.dataUrl ? (
                          <div
                            key={att.id}
                            className="flex items-center gap-2 overflow-hidden rounded-[8px] border border-[var(--border-card)] bg-[var(--bg-subtle)] p-1 pr-2.5"
                          >
                            <img
                              src={att.dataUrl}
                              alt={att.name}
                              className="h-9 w-14 shrink-0 rounded-[5px] object-cover"
                            />
                            <div className="flex flex-col">
                              <span className="max-w-[140px] truncate text-[11px] font-medium text-[var(--ink-strong)]">
                                {att.name}
                              </span>
                              {att.meta && (
                                <span className="font-mono text-[9.5px] text-[var(--ink-subtle)]">
                                  {att.meta}
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span
                            key={att.id}
                            className="rounded-[6px] border border-[var(--border-card)] bg-[var(--bg-subtle)] px-2 py-0.5 font-mono text-[10px] text-[var(--ink-muted)]"
                          >
                            {att.name}
                          </span>
                        )
                      )}
                    </div>
                  )}
                  <div className="rounded-t-[16px] rounded-bl-[16px] rounded-br-[4px] border border-[var(--border-light)] bg-[var(--bg-elevated)] px-3.5 py-2 text-[13px] leading-[20px] text-[var(--ink-body)] lg:px-[15px] lg:py-[11px] lg:text-[14px] lg:leading-[22px]">
                    {msg.content}
                  </div>
                </div>
              </div>
            ) : (
              <div key={msg.id} className="flex gap-2.5 lg:gap-3.5">
                <div
                  className={`flex shrink-0 items-center justify-center border border-[var(--brand-icon-border)] bg-[var(--brand-icon-bg)] text-[var(--brand-icon-fg)] ${
                    sidebarCollapsed
                      ? "h-6 w-6 rounded-[7px]"
                      : "h-7 w-7 rounded-[8px]"
                  }`}
                >
                  <BowtieSvg size={sidebarCollapsed ? 15 : 17} />
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-2 lg:gap-2.5">
                  <div className="flex items-baseline gap-2">
                    <span className="font-[family-name:var(--font-serif-en)] text-[17px] italic leading-[20px] text-[var(--ink-strong)] lg:text-[19px] lg:leading-[24px]">
                      Valet
                    </span>
                    {msg.metaLabel && (
                      <span className="font-mono text-[10px] leading-[12px] text-[var(--ink-subtle)]">
                        {msg.metaLabel}
                      </span>
                    )}
                  </div>

                  {msg.steps && msg.steps.length > 0 && (
                    <ToolStepsList steps={msg.steps} />
                  )}

                  <div className="text-[13px] leading-[20px] text-[var(--ink-body)] lg:text-[14px] lg:leading-[23px]">
                    <FormattedText text={msg.content} />
                  </div>

                  {msg.processTable && (
                    <ProcessTableCard
                      data={msg.processTable}
                      onAction={(act) => performProcessAction(thread.id, msg.id, act)}
                    />
                  )}

                  {msg.pluginDraft && (
                    <PluginDraftCard
                      draft={msg.pluginDraft}
                      onInstall={(draft) =>
                        installPluginDraft(thread.id, msg.id, draft)
                      }
                    />
                  )}
                </div>
              </div>
            )
          )}

          {/* Live Agent Turn State */}
          {sending && (
            <div className="flex gap-2.5 lg:gap-3.5">
              <div
                className={`flex shrink-0 items-center justify-center border border-[var(--brand-icon-border)] bg-[var(--brand-icon-bg)] text-[var(--brand-icon-fg)] ${
                  sidebarCollapsed
                    ? "h-6 w-6 rounded-[7px]"
                    : "h-7 w-7 rounded-[8px]"
                }`}
              >
                <BowtieSvg size={sidebarCollapsed ? 15 : 17} />
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-2 lg:gap-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="font-[family-name:var(--font-serif-en)] text-[17px] italic leading-[20px] text-[var(--ink-strong)] lg:text-[19px] lg:leading-[24px]">
                    Valet
                  </span>
                </div>

                {activeStream?.steps && activeStream.steps.length > 0 && (
                  <ToolStepsList steps={activeStream.steps} />
                )}

                {activeStream?.pendingPermission && (
                  <PermissionAskCard
                    key={activeStream.pendingPermission.requestId}
                    request={activeStream.pendingPermission}
                    onResolve={(decision, note) =>
                      void resolveChatPermission(
                        thread.id,
                        activeStream.pendingPermission!.requestId,
                        decision,
                        note
                      )
                    }
                  />
                )}

                {activeStream?.partialText ? (
                  <div className="text-[13px] leading-[20px] text-[var(--ink-body)] lg:text-[14px] lg:leading-[23px]">
                    <FormattedText text={activeStream.partialText} />
                  </div>
                ) : (
                  !activeStream?.steps?.some(
                    (s) => s.status === "running" || s.status === "pending"
                  ) && (
                    <div className="flex items-center gap-2 py-0.5 text-[13px] text-[var(--ink-muted)]">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--ink-muted)]" />
                      <span>
                        {activeStream?.steps?.length ? "正在整理结果…" : "思考中…"}
                      </span>
                    </div>
                  )
                )}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer */}
      <ChatComposer
        chatId={thread.id}
        sending={sending}
        onAbort={() => void abortChatMessage(thread.id)}
        onSend={(params) => sendChatMessage(params)}
      />
    </div>
  );
};
