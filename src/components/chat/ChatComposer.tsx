import React, { useEffect, useMemo, useRef, useState } from "react";
import { isMyGo } from "mygo-runtime";
import { Valet } from "../../mygo";
import { useValet } from "../../store/ValetContext";
import type { AutonomyLevel, ChatAttachment, PluginState } from "../../types/valet";
import {
  ArrowUpIcon,
  CloseIcon,
  MicIcon,
  PaperclipIcon,
  ScreenCaptureIcon,
} from "../ui/Icons";
import { SelectMenu } from "../ui/SelectMenu";

interface ChatComposerProps {
  sending: boolean;
  onSend: (params: {
    prompt: string;
    mentionPlugin: PluginState | null;
    attachments: ChatAttachment[];
  }) => Promise<void>;
}

const SLASH_COMMANDS = [
  { cmd: "/clean", desc: "排查可清理缓存或下载安装包并生成清理清单" },
  { cmd: "/ps", desc: "立即采样 CPU 与内存异常进程" },
  { cmd: "/plugin", desc: "用自然语言生成一份新的本地自动化插件" },
  { cmd: "/scan", desc: "执行一次快速系统健康状态采样" },
];

const AUTONOMY_CYCLE: AutonomyLevel[] = ["always_ask", "sensitive_only", "autonomous"];
const AUTONOMY_LABEL: Record<AutonomyLevel, string> = {
  always_ask: "每步询问",
  sensitive_only: "敏感操作询问",
  autonomous: "完全自主",
};

const VOICE_WAVE_HEIGHTS = [8, 16, 24, 12, 20, 28, 14, 22, 10, 6];
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_FILE_BYTES = 512 * 1024;

function readBlobAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("无法读取图片数据"));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

export const ChatComposer: React.FC<ChatComposerProps> = ({ sending, onSend }) => {
  const { state, sidebarCollapsed, setAutonomyLevel, updateModels, pushToast } = useValet();

  const [text, setText] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const [mentionPluginId, setMentionPluginId] = useState<string>("");
  const [manualPluginMenu, setManualPluginMenu] = useState(false);
  const [dismissedInlineAt, setDismissedInlineAt] = useState(false);
  const [dismissedSlash, setDismissedSlash] = useState(false);
  const [slashMenuIdx, setSlashMenuIdx] = useState(0);
  const [pluginMenuIdx, setPluginMenuIdx] = useState(0);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [capturingScreen, setCapturingScreen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!recording) {
      setRecordingSec(0);
      return;
    }
    const timer = window.setInterval(() => {
      setRecordingSec((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  // Dismiss menus cleanly on outside clicks
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (
        composerContainerRef.current &&
        !composerContainerRef.current.contains(e.target as Node)
      ) {
        setManualPluginMenu(false);
        setDismissedInlineAt(true);
        setDismissedSlash(true);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const installedPlugins = useMemo(
    () => state.plugins.filter((p) => p.installed && p.enabled),
    [state.plugins]
  );
  const mentionPlugin = installedPlugins.find((p) => p.id === mentionPluginId) ?? null;

  const activeProvider =
    state.providers.find((p) => p.id === state.preferences.activeProviderId) ??
    state.providers[0];

  const modelOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ value: string; label: string }> = [];
    for (const m of activeProvider?.models ?? []) {
      const trimmed = m.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        list.push({ value: trimmed, label: trimmed });
      }
    }
    const primary = state.preferences.models.primary.trim();
    if (primary && !seen.has(primary)) {
      seen.add(primary);
      list.unshift({ value: primary, label: primary });
    }
    if (list.length === 0) {
      list.push({ value: "claude-opus-4", label: "claude-opus-4" });
    }
    return list;
  }, [activeProvider?.models, state.preferences.models.primary]);

  const inlineAtMatch = useMemo(() => {
    if (dismissedInlineAt) return null;
    const beforeCursor = text.slice(0, cursorPos);
    const m = /(?:^|[\s，。！？、,;(\[（])@([^\s@]*)$/.exec(beforeCursor);
    if (!m) return null;
    const query = m[1] ?? "";
    const startIdx = beforeCursor.length - query.length - 1;
    return { query, startIdx, endIdx: cursorPos };
  }, [text, cursorPos, dismissedInlineAt]);

  const filteredPlugins = useMemo(() => {
    const q = (inlineAtMatch?.query ?? "").trim().toLowerCase();
    if (!q) return installedPlugins;
    return installedPlugins.filter(
      (pl) =>
        pl.name.toLowerCase().includes(q) ||
        pl.id.toLowerCase().includes(q) ||
        pl.slug.toLowerCase().includes(q) ||
        pl.bundleId.toLowerCase().includes(q)
    );
  }, [installedPlugins, inlineAtMatch]);

  const pluginMenuOpen = manualPluginMenu || inlineAtMatch !== null;
  const pluginMenuItems = useMemo(() => {
    const items: Array<{ type: "clear" } | { type: "plugin"; plugin: PluginState }> = [];
    if (manualPluginMenu && inlineAtMatch === null) {
      items.push({ type: "clear" });
    }
    for (const pl of filteredPlugins) {
      items.push({ type: "plugin", plugin: pl });
    }
    return items;
  }, [filteredPlugins, manualPluginMenu, inlineAtMatch]);

  const showSlashMenu =
    !dismissedSlash && !pluginMenuOpen && text.startsWith("/") && !text.includes(" ");
  const filteredCommands = useMemo(
    () => SLASH_COMMANDS.filter((c) => c.cmd.startsWith(text.trim().toLowerCase())),
    [text]
  );

  useEffect(() => {
    setSlashMenuIdx(0);
  }, [text]);

  useEffect(() => {
    setPluginMenuIdx(0);
  }, [inlineAtMatch?.query, manualPluginMenu]);

  const syncCursor = (el: HTMLTextAreaElement) => {
    setCursorPos(el.selectionStart ?? el.value.length);
  };

  const applySlashCommand = (cmd: string) => {
    const nextText = `${cmd} `;
    setText(nextText);
    setCursorPos(nextText.length);
    setDismissedSlash(false);
    window.requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(nextText.length, nextText.length);
      }
    });
  };

  const selectPluginMenuItem = (
    item: { type: "clear" } | { type: "plugin"; plugin: PluginState }
  ) => {
    if (item.type === "clear") {
      setMentionPluginId("");
      setManualPluginMenu(false);
      textareaRef.current?.focus();
      return;
    }
    setMentionPluginId(item.plugin.id);
    setManualPluginMenu(false);
    setDismissedInlineAt(false);
    if (inlineAtMatch) {
      const before = text.slice(0, inlineAtMatch.startIdx);
      const after = text.slice(inlineAtMatch.endIdx);
      const nextText =
        before.endsWith(" ") && after.startsWith(" ")
          ? before + after.slice(1)
          : before + after;
      const nextCursor = before.length;
      setText(nextText);
      setCursorPos(nextCursor);
      window.requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(nextCursor, nextCursor);
        }
      });
    } else {
      textareaRef.current?.focus();
    }
  };

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || sending) return;
    const finalPrompt = trimmed || "请帮我分析附加的屏幕截图或文件内容";
    const sentAttachments = [...attachments];

    setText("");
    setCursorPos(0);
    setAttachments([]);
    setManualPluginMenu(false);
    await onSend({
      prompt: finalPrompt,
      mentionPlugin,
      attachments: sentAttachments,
    });
  };

  const handleCaptureScreen = async () => {
    if (capturingScreen || sending) return;
    if (!isMyGo()) {
      pushToast(
        "当前处于浏览器预览环境，无法截取 macOS 系统屏幕；请在 Valet 客户端中使用或直接拖入截图",
        "danger"
      );
      return;
    }

    setCapturingScreen(true);
    try {
      const res = await Valet.captureCurrentScreen();
      if (!res.ok || !res.attachment) {
        pushToast(
          res.error || "截取当前屏幕失败，请确认已在「系统设置 › 隐私与安全性 › 屏幕录制」中允许 Valet",
          "danger"
        );
        return;
      }
      const captured: ChatAttachment = {
        id: res.attachment.id,
        kind: "screen",
        name: res.attachment.name,
        meta: res.attachment.meta,
        badge: res.attachment.badge,
        path: res.attachment.path,
        dataUrl: res.attachment.dataUrl,
        mimeType: res.attachment.mimeType,
      };
      setAttachments((prev) => [...prev, captured]);
      pushToast("已截取当前屏幕", "success");
    } catch (err) {
      pushToast(
        err instanceof Error ? `截屏失败：${err.message}` : "截屏失败，请检查屏幕录制权限",
        "danger"
      );
    } finally {
      setCapturingScreen(false);
    }
  };

  const handleFilesAdded = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const added: ChatAttachment[] = [];

    for (const [idx, file] of Array.from(fileList).entries()) {
      const isImage = file.type.startsWith("image/");
      const sizeMeta = `${Math.max(1, Math.round(file.size / 1024))} KB`;
      const badge = file.name.split(".").pop()?.slice(0, 3).toUpperCase() || "FILE";

      if (isImage) {
        if (file.size > MAX_IMAGE_BYTES) {
          pushToast(`图片「${file.name}」超过 4 MB，请压缩后再试`, "danger");
          continue;
        }
        try {
          const dataUrl = await readBlobAsDataURL(file);
          added.push({
            id: `up-${Date.now()}-${idx}`,
            kind: "image",
            name: file.name,
            meta: sizeMeta,
            badge,
            dataUrl,
            mimeType: file.type || "image/png",
          });
        } catch (err) {
          pushToast(
            err instanceof Error ? err.message : `读取图片「${file.name}」失败`,
            "danger"
          );
        }
        continue;
      }

      let textExcerpt: string | undefined;
      if (file.size > 0 && file.size <= MAX_TEXT_FILE_BYTES) {
        try {
          const rawText = await file.text();
          if (!rawText.includes("\0")) {
            textExcerpt = rawText.slice(0, 12_000).trim() || undefined;
          }
        } catch {
          // Binary or unreadable file: keep metadata attachment without excerpt
        }
      }

      added.push({
        id: `up-${Date.now()}-${idx}`,
        kind: "file",
        name: file.name,
        meta: sizeMeta,
        badge,
        textExcerpt,
      });
    }

    if (added.length > 0) {
      setAttachments((prev) => [...prev, ...added]);
    }
  };

  const cycleAutonomy = () => {
    const idx = AUTONOMY_CYCLE.indexOf(state.preferences.autonomyLevel);
    const next = AUTONOMY_CYCLE[(idx + 1) % AUTONOMY_CYCLE.length] ?? "sensitive_only";
    setAutonomyLevel(next);
    pushToast(`已切换当前自主程度为「${AUTONOMY_LABEL[next]}」`);
  };

  const finishVoiceRecording = async () => {
    setRecording(false);
    const spokenText = "帮我检查一下最近是不是有失控的后台进程";
    const nextPrompt = text.trim() ? `${text.trim()} ${spokenText}` : spokenText;
    const sentAttachments = [...attachments];
    setText("");
    setCursorPos(0);
    setAttachments([]);
    await onSend({
      prompt: nextPrompt,
      mentionPlugin,
      attachments: sentAttachments,
    });
    pushToast("已结束语音并发送转写内容", "success");
  };

  const cancelVoiceRecording = () => {
    setRecording(false);
    pushToast("已取消语音录制");
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const clampedSlashIdx =
    filteredCommands.length > 0 ? Math.min(slashMenuIdx, filteredCommands.length - 1) : 0;
  const clampedPluginIdx =
    pluginMenuItems.length > 0 ? Math.min(pluginMenuIdx, pluginMenuItems.length - 1) : 0;
  const canSend = Boolean((text.trim() || attachments.length > 0) && !sending);

  return (
    <div
      ref={composerContainerRef}
      className={`relative flex shrink-0 flex-col items-center gap-2 ${
        sidebarCollapsed ? "px-[22px] pt-2 pb-2.5" : "px-6 pb-[18px]"
      }`}
    >
      {/* Expandable Dark Voice Capsule when recording */}
      {recording && (
        <div className="animate-valet-modal-in mb-1 flex h-[52px] items-center gap-3.5 rounded-[26px] border border-[var(--border-card)] bg-[var(--ink-primary)] pr-2 pl-[18px] text-[var(--ink-on-primary)] shadow-[var(--shadow-popover)]">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#FF5F57]" />

          <div className="flex h-7 items-center gap-[3px]" aria-hidden="true">
            {VOICE_WAVE_HEIGHTS.map((h, i) => (
              <span
                key={i}
                className="animate-valet-wave w-[3px] shrink-0 rounded-[2px] bg-[var(--ink-on-primary)]"
                style={{
                  height: `${h}px`,
                  animationDelay: `${i * 75}ms`,
                  opacity: i >= 8 ? 0.45 : 1,
                }}
              />
            ))}
          </div>

          <span className="font-mono text-[12px] leading-[16px]">
            {formatDuration(recordingSec)}
          </span>

          <button
            type="button"
            onClick={cancelVoiceRecording}
            title="取消语音输入"
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full opacity-70 hover:bg-[var(--ink-on-primary)]/15 hover:opacity-100"
            aria-label="取消语音输入"
          >
            <CloseIcon size={12} />
          </button>

          <button
            type="button"
            onClick={() => void finishVoiceRecording()}
            className="flex h-9 cursor-pointer items-center rounded-[18px] bg-[var(--ink-on-primary)] px-3.5 text-[12px] font-semibold text-[var(--ink-primary)] transition-opacity hover:opacity-90"
          >
            松开发送
          </button>
        </div>
      )}

      {/* Slash Command Popover */}
      {showSlashMenu && filteredCommands.length > 0 && (
        <div className="animate-valet-modal-in absolute bottom-full z-20 mb-2 w-full max-w-[720px] rounded-[12px] border border-[var(--border-base)] bg-[var(--bg-elevated)] p-1.5 shadow-[var(--shadow-popover)]">
          <div className="px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-subtle)]">
            斜杠命令
          </div>
          {filteredCommands.map((item, idx) => (
            <button
              key={item.cmd}
              type="button"
              onClick={() => applySlashCommand(item.cmd)}
              onMouseEnter={() => setSlashMenuIdx(idx)}
              className={`flex w-full cursor-pointer items-center gap-3 rounded-[8px] px-2.5 py-2 text-left transition-colors ${
                idx === clampedSlashIdx
                  ? "bg-[var(--bg-subtle)] text-[var(--ink-strong)]"
                  : "hover:bg-[var(--bg-subtle)]"
              }`}
            >
              <span className="w-16 shrink-0 font-mono text-[12px] font-semibold text-[var(--ink-strong)]">
                {item.cmd}
              </span>
              <span className="text-[12px] text-[var(--ink-muted)]">{item.desc}</span>
            </button>
          ))}
        </div>
      )}

      {/* @ Plugin Popover */}
      {pluginMenuOpen && (
        <div className="animate-valet-modal-in absolute bottom-full z-20 mb-2 w-full max-w-[440px] rounded-[12px] border border-[var(--border-base)] bg-[var(--bg-elevated)] p-1.5 shadow-[var(--shadow-popover)]">
          <div className="flex items-center justify-between px-2.5 py-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-subtle)]">
              指定插件上下文
            </span>
            {inlineAtMatch?.query && (
              <span className="font-mono text-[10px] text-[var(--ink-muted)]">
                匹配 @{inlineAtMatch.query}
              </span>
            )}
          </div>
          {pluginMenuItems.length === 0 ? (
            <div className="px-2.5 py-2 text-[12px] text-[var(--ink-subtle)]">
              未找到匹配的已启用插件
            </div>
          ) : (
            <div className="max-h-[220px] overflow-y-auto">
              {pluginMenuItems.map((item, idx) => {
                const active = idx === clampedPluginIdx;
                if (item.type === "clear") {
                  return (
                    <button
                      key="__clear__"
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectPluginMenuItem(item)}
                      onMouseEnter={() => setPluginMenuIdx(idx)}
                      className={`flex w-full cursor-pointer items-center justify-between rounded-[8px] px-2.5 py-1.5 text-left text-[12px] text-[var(--ink-muted)] ${
                        active ? "bg-[var(--bg-subtle)]" : "hover:bg-[var(--bg-subtle)]"
                      }`}
                    >
                      <span>不指定特定插件（通用模式）</span>
                    </button>
                  );
                }
                const pl = item.plugin;
                return (
                  <button
                    key={pl.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectPluginMenuItem(item)}
                    onMouseEnter={() => setPluginMenuIdx(idx)}
                    className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-[8px] px-2.5 py-1.5 text-left ${
                      active ? "bg-[var(--bg-subtle)]" : "hover:bg-[var(--bg-subtle)]"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 text-[12px] font-medium text-[var(--ink-strong)]">
                        @{pl.name}
                      </span>
                      <span className="truncate text-[11px] text-[var(--ink-muted)]">
                        {pl.tagline}
                      </span>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-[var(--ink-subtle)]">
                      {pl.bundleId}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Composer Box */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFilesAdded(e.dataTransfer.files);
        }}
        className={`flex w-full max-w-[720px] flex-col rounded-[16px] border bg-[var(--bg-surface)] shadow-[var(--shadow-composer)] transition-colors ${
          sidebarCollapsed ? "gap-1.5 rounded-[13px] p-2" : "gap-2 p-2.5"
        } ${
          dragOver
            ? "border-[var(--ink-primary)] bg-[var(--bg-subtle)]"
            : "border-[var(--border-card)]"
        }`}
      >
        {/* Attachments row (only shown when real attachments exist) */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-1 pt-0.5">
            {attachments.map((att) =>
              att.kind === "image" || att.kind === "screen" ? (
                <div
                  key={att.id}
                  title={att.name}
                  className={`relative flex items-center gap-2 rounded-[8px] border border-[var(--border-card)] bg-[var(--bg-subtle)] pr-2.5 pl-1 ${
                    sidebarCollapsed ? "h-[40px]" : "h-[48px]"
                  }`}
                >
                  {att.dataUrl ? (
                    <img
                      src={att.dataUrl}
                      alt={att.name}
                      className={`shrink-0 rounded-[6px] object-cover ${
                        sidebarCollapsed ? "h-[30px] w-[44px]" : "h-[38px] w-[54px]"
                      }`}
                    />
                  ) : (
                    <div
                      className={`shrink-0 rounded-[6px] ${
                        sidebarCollapsed ? "h-[30px] w-[30px]" : "h-[38px] w-[38px]"
                      }`}
                      style={{
                        backgroundImage: "linear-gradient(135deg, #2A2A2A 0%, #5A5A5A 100%)",
                      }}
                    />
                  )}
                  <div className="flex min-w-0 flex-col">
                    <span className="max-w-[136px] truncate text-[11.5px] font-medium leading-[15px] text-[var(--ink-strong)]">
                      {att.name}
                    </span>
                    {att.meta && (
                      <span className="font-mono text-[9.5px] leading-[12px] text-[var(--ink-subtle)]">
                        {att.meta}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((prev) => prev.filter((a) => a.id !== att.id))
                    }
                    aria-label={`移除附件 ${att.name}`}
                    className="ml-0.5 cursor-pointer text-[10px] text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <div
                  key={att.id}
                  className={`group relative flex items-center gap-2 rounded-[8px] border border-[var(--border-card)] bg-[var(--bg-subtle)] pr-3 pl-2 ${
                    sidebarCollapsed ? "h-[36px]" : "h-[44px]"
                  }`}
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] bg-[var(--ink-primary)] font-mono text-[8px] font-semibold text-[var(--ink-on-primary)] lg:h-7 lg:w-7 lg:rounded-[6px]">
                    {att.badge ?? "FILE"}
                  </div>
                  <div className="flex flex-col">
                    <span className="max-w-[140px] truncate text-[11.5px] font-medium leading-[15px] text-[var(--ink-strong)] lg:text-[12px] lg:leading-[16px]">
                      {att.name}
                    </span>
                    {att.meta && (
                      <span className="font-mono text-[10px] leading-[12px] text-[var(--ink-subtle)]">
                        {att.meta}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((prev) => prev.filter((a) => a.id !== att.id))
                    }
                    aria-label={`移除附件 ${att.name}`}
                    className="ml-1 cursor-pointer text-[10px] text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
                  >
                    ✕
                  </button>
                </div>
              )
            )}
          </div>
        )}

        {/* Textarea */}
        <div className="px-1.5 py-0.5 lg:py-1">
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              syncCursor(e.target);
              setDismissedInlineAt(false);
              setDismissedSlash(false);
            }}
            onClick={(e) => syncCursor(e.currentTarget)}
            onKeyUp={(e) => syncCursor(e.currentTarget)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;

              if (pluginMenuOpen) {
                if (e.key === "ArrowDown" && pluginMenuItems.length > 0) {
                  e.preventDefault();
                  setPluginMenuIdx((i) => (i + 1) % pluginMenuItems.length);
                  return;
                }
                if (e.key === "ArrowUp" && pluginMenuItems.length > 0) {
                  e.preventDefault();
                  setPluginMenuIdx(
                    (i) => (i - 1 + pluginMenuItems.length) % pluginMenuItems.length
                  );
                  return;
                }
                if ((e.key === "Enter" || e.key === "Tab") && pluginMenuItems.length > 0) {
                  e.preventDefault();
                  const chosen = pluginMenuItems[clampedPluginIdx];
                  if (chosen) selectPluginMenuItem(chosen);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setManualPluginMenu(false);
                  if (inlineAtMatch) setDismissedInlineAt(true);
                  return;
                }
              }

              if (showSlashMenu && filteredCommands.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSlashMenuIdx((i) => (i + 1) % filteredCommands.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSlashMenuIdx(
                    (i) => (i - 1 + filteredCommands.length) % filteredCommands.length
                  );
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  const chosen = filteredCommands[clampedSlashIdx];
                  if (chosen) applySlashCommand(chosen.cmd);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setDismissedSlash(true);
                  return;
                }
              }

              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder="给 Valet 发消息，输入 / 命令或 @ 指定插件，拖入文件即可附加…"
            className={`max-h-28 w-full resize-none bg-transparent text-[var(--ink-body)] outline-none placeholder:text-[var(--ink-subtle)] ${
              sidebarCollapsed ? "text-[12.5px] leading-[19px]" : "text-[14px] leading-[22px]"
            }`}
          />
        </div>

        {/* Bottom toolbar */}
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleFilesAdded(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="附加文件或日志"
            className={`flex shrink-0 cursor-pointer items-center justify-center rounded-[8px] text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)] ${
              sidebarCollapsed ? "h-6 w-6" : "h-8 w-8"
            }`}
          >
            <PaperclipIcon size={sidebarCollapsed ? 14 : 17} />
          </button>

          <button
            type="button"
            disabled={capturingScreen}
            onClick={() => void handleCaptureScreen()}
            title="截取当前屏幕并附加到消息"
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--bg-muted)] px-2.5 text-[var(--ink-body)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--ink-strong)] ${
              sidebarCollapsed ? "h-[24px] text-[11px]" : "h-[28px] text-[12px]"
            } ${capturingScreen ? "cursor-wait opacity-60" : "cursor-pointer"}`}
          >
            <ScreenCaptureIcon size={sidebarCollapsed ? 12 : 14} />
            <span>{capturingScreen ? "截图中…" : "当前屏幕"}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setManualPluginMenu((s) => !s);
              setDismissedInlineAt(false);
            }}
            className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-[var(--bg-muted)] px-2.5 text-[var(--ink-body)] hover:bg-[var(--bg-hover)] hover:text-[var(--ink-strong)] ${
              sidebarCollapsed ? "h-[24px] text-[11px]" : "h-[28px] text-[12px]"
            }`}
          >
            <span className="font-mono">@</span>
            <span>{mentionPlugin ? mentionPlugin.name : "选择插件"}</span>
            {mentionPlugin && (
              <span
                role="button"
                aria-label="清除指定插件"
                onClick={(e) => {
                  e.stopPropagation();
                  setMentionPluginId("");
                }}
                className="ml-0.5 rounded-full px-1 text-[10px] text-[var(--ink-subtle)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
              >
                ✕
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={cycleAutonomy}
            title="点击切换当前自主级别"
            className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-[var(--bg-muted)] px-2.5 text-[var(--ink-body)] hover:bg-[var(--bg-hover)] hover:text-[var(--ink-strong)] ${
              sidebarCollapsed ? "h-[24px] text-[11px]" : "h-[28px] text-[12px]"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                state.preferences.autonomyLevel === "autonomous"
                  ? "bg-emerald-500"
                  : state.preferences.autonomyLevel === "sensitive_only"
                    ? "bg-[var(--amber-icon)]"
                    : "bg-[var(--ink-primary)]"
              }`}
            />
            <span>{AUTONOMY_LABEL[state.preferences.autonomyLevel]}</span>
          </button>

          <div className="flex-1" />

          <SelectMenu
            value={state.preferences.models.primary || modelOptions[0]?.value || ""}
            options={modelOptions}
            onChange={(val) => updateModels({ primary: val })}
            mono
            compact
            searchable={modelOptions.length > 8}
            align="right"
            triggerClassName={`max-w-[165px] rounded-full border-[var(--border-control)] bg-[var(--bg-subtle)] ${
              sidebarCollapsed
                ? "h-[24px] px-2 text-[10.5px]"
                : "h-[28px] px-2.5 text-[11px]"
            }`}
          />

          <button
            type="button"
            onClick={() => setRecording((r) => !r)}
            title="语音输入 (M6)"
            className={`flex shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors ${
              sidebarCollapsed ? "h-6 w-6 rounded-[7px]" : "h-[34px] w-[34px]"
            } ${
              recording
                ? "border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger)]"
                : "border-[var(--border-control)] bg-transparent text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
            }`}
          >
            <MicIcon size={sidebarCollapsed ? 13 : 16} />
          </button>

          <button
            type="button"
            disabled={!canSend}
            onClick={() => void handleSubmit()}
            title="发送 (Enter)"
            className={`flex shrink-0 items-center justify-center rounded-full bg-[var(--ink-primary)] text-[var(--ink-on-primary)] transition-opacity ${
              sidebarCollapsed ? "h-6 w-6 rounded-[7px]" : "h-[34px] w-[34px]"
            } ${!canSend ? "cursor-not-allowed opacity-35" : "cursor-pointer"}`}
          >
            <ArrowUpIcon size={sidebarCollapsed ? 13 : 16} />
          </button>
        </div>
      </div>

      {/* Shortcut hints */}
      <div className="font-mono text-[10px] tracking-[0.06em] text-[var(--ink-subtle)]">
        ⏎ 发送{"  "}·{"  "}/ 命令{"  "}·{"  "}@ 指定插件{"  "}·{"  "}按住 fn 说话{"  "}·{"  "}拖入文件即可附加
      </div>
    </div>
  );
};
