import React, { useEffect, useRef } from "react";
import { useValet } from "../../store/ValetContext";
import { SidebarToggleButton } from "../Sidebar";
import { BowtieSvg, PlusIcon } from "../ui/Icons";
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
    chatStream,
    runningChatIds,
    sidebarCollapsed,
    createNewChat,
    selectChatThread,
    sendChatMessage,
    resolveChatPermission,
    abortChatMessage,
    performProcessAction,
    installPluginDraft,
    setActiveView,
    selectTimelineEvent,
  } = useValet();

  const bottomRef = useRef<HTMLDivElement>(null);

  const activeThreads = state.chatThreads.filter((t) => !t.archived);
  const thread =
    activeThreads.find((t) => t.id === state.activeChatId) ??
    state.chatThreads.find((t) => t.id === state.activeChatId) ??
    activeThreads[0] ??
    state.chatThreads[0];
  const sending = thread ? (runningChatIds[thread.id] ?? 0) > 0 : false;
  const activeStream =
    chatStream && thread && chatStream.chatId === thread.id ? chatStream : null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [
    thread?.messages.length,
    sending,
    activeStream?.steps?.length,
    activeStream?.pendingPermission?.requestId,
  ]);

  if (!thread) return null;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-canvas)]">
      {/* Top Bar */}
      <header
        className={`app-drag flex shrink-0 items-center gap-2 border-b border-[var(--border-light)] ${
          sidebarCollapsed ? "h-[44px] px-[22px]" : "h-[52px] px-6"
        }`}
      >
        <SidebarToggleButton />

        {/* Thread Switcher Dropdown (matches 23 小屏 · 对话) */}
        <div className="app-no-drag min-w-0">
          <SelectMenu
            value={thread.id}
            options={(thread.archived && !activeThreads.some((t) => t.id === thread.id)
              ? [thread, ...activeThreads]
              : activeThreads
            ).map((t) => ({
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
          onClick={createNewChat}
          title="新建对话 (⌘N)"
          className={`app-no-drag flex shrink-0 cursor-pointer items-center justify-center rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-surface)] text-[var(--ink-primary)] hover:bg-[var(--bg-subtle)] lg:rounded-[8px] ${
            sidebarCollapsed ? "h-[26px] w-[26px]" : "h-[30px] w-[30px]"
          }`}
        >
          <PlusIcon size={sidebarCollapsed ? 12 : 14} />
        </button>
      </header>

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
                        att.dataUrl ? (
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
