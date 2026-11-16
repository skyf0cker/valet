import React, { useEffect, useRef, useState } from "react";
import { useValet } from "../../store/ValetContext";
import type { AutonomyLevel, ChatAttachment, PluginState } from "../../types/valet";
import {
  ArrowUpIcon,
  CloseIcon,
  ImageIcon,
  MicIcon,
  PaperclipIcon,
  ScreenCaptureIcon,
} from "../ui/Icons";

interface ChatComposerProps {
  sending: boolean;
  onSend: (params: {
    prompt: string;
    mentionPlugin: PluginState | null;
    attachments: ChatAttachment[];
  }) => Promise<void>;
}

const SLASH_COMMANDS = [
  { cmd: "/clean", desc: "排查超过 2 GB 且长期未打开的大文件并生成清理清单" },
  { cmd: "/ps", desc: "立即采样 10 秒 CPU 与内存异常进程" },
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

export const ChatComposer: React.FC<ChatComposerProps> = ({ sending, onSend }) => {
  const { state, sidebarCollapsed, setAutonomyLevel, pushToast } = useValet();

  const [text, setText] = useState("/clean 再看看还有哪些大文件可以清理");
  const [mentionPluginId, setMentionPluginId] = useState<string>("process-sentinel");
  const [showPluginMenu, setShowPluginMenu] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([
    { id: "att-img", kind: "image", name: "screen-clip.png" },
    { id: "att-log", kind: "file", name: "WindowServer.ips", meta: "48 KB", badge: "LOG" },
  ]);
  const [includeCurrentScreen, setIncludeCurrentScreen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const installedPlugins = state.plugins.filter((p) => p.installed && p.enabled);
  const mentionPlugin = installedPlugins.find((p) => p.id === mentionPluginId) ?? null;

  const showSlashMenu = text.startsWith("/") && !text.includes(" ");
  const filteredCommands = SLASH_COMMANDS.filter((c) =>
    c.cmd.startsWith(text.trim().toLowerCase())
  );

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    const finalAttachments: ChatAttachment[] = includeCurrentScreen
      ? [...attachments, { id: "att-scr", kind: "screen", name: "当前屏幕截图" }]
      : attachments;

    setText("");
    setAttachments([]);
    setIncludeCurrentScreen(false);
    await onSend({
      prompt: trimmed,
      mentionPlugin,
      attachments: finalAttachments,
    });
  };

  const handleFilesAdded = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const added: ChatAttachment[] = Array.from(fileList).map((file, idx) => ({
      id: `up-${Date.now()}-${idx}`,
      kind: file.type.startsWith("image/") ? "image" : "file",
      name: file.name,
      meta: `${Math.max(1, Math.round(file.size / 1024))} KB`,
      badge: file.name.split(".").pop()?.slice(0, 3).toUpperCase() || "FILE",
    }));
    setAttachments((prev) => [...prev, ...added]);
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
    setText("");
    setAttachments([]);
    setIncludeCurrentScreen(false);
    await onSend({
      prompt: nextPrompt,
      mentionPlugin,
      attachments: [],
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

  return (
    <div
      className={`relative flex shrink-0 flex-col items-center gap-2 ${
        sidebarCollapsed ? "px-[22px] pt-2 pb-2.5" : "px-6 pb-[18px]"
      }`}
    >
      {/* M6 Expandable Dark Voice Capsule when recording */}
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
          {filteredCommands.map((item) => (
            <button
              key={item.cmd}
              type="button"
              onClick={() => setText(`${item.cmd} `)}
              className="flex w-full cursor-pointer items-center gap-3 rounded-[8px] px-2.5 py-2 text-left hover:bg-[var(--bg-subtle)]"
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
      {showPluginMenu && (
        <div className="animate-valet-modal-in absolute bottom-full z-20 mb-2 w-full max-w-[420px] rounded-[12px] border border-[var(--border-base)] bg-[var(--bg-elevated)] p-1.5 shadow-[var(--shadow-popover)]">
          <div className="px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-subtle)]">
            指定插件上下文
          </div>
          <button
            type="button"
            onClick={() => {
              setMentionPluginId("");
              setShowPluginMenu(false);
            }}
            className="flex w-full cursor-pointer items-center justify-between rounded-[8px] px-2.5 py-1.5 text-left text-[12px] text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)]"
          >
            <span>不指定特定插件（通用模式）</span>
          </button>
          {installedPlugins.map((pl) => (
            <button
              key={pl.id}
              type="button"
              onClick={() => {
                setMentionPluginId(pl.id);
                setShowPluginMenu(false);
              }}
              className="flex w-full cursor-pointer items-center justify-between rounded-[8px] px-2.5 py-1.5 text-left hover:bg-[var(--bg-subtle)]"
            >
              <span className="text-[12px] font-medium text-[var(--ink-strong)]">
                @{pl.name}
              </span>
              <span className="font-mono text-[10px] text-[var(--ink-subtle)]">
                {pl.bundleId}
              </span>
            </button>
          ))}
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
          handleFilesAdded(e.dataTransfer.files);
        }}
        className={`flex w-full max-w-[720px] flex-col rounded-[16px] border bg-[var(--bg-surface)] shadow-[var(--shadow-composer)] transition-colors ${
          sidebarCollapsed ? "gap-1.5 rounded-[13px] p-2" : "gap-2 p-2.5"
        } ${
          dragOver ? "border-[var(--ink-primary)] bg-[var(--bg-subtle)]" : "border-[var(--border-card)]"
        }`}
      >
        {/* Attachments row */}
        <div className="flex flex-wrap items-center gap-2 px-1 pt-0.5">
          {attachments.map((att) =>
            att.kind === "image" ? (
              <div
                key={att.id}
                title={att.name}
                className={`relative shrink-0 rounded-[8px] ${
                  sidebarCollapsed ? "h-[36px] w-[36px]" : "h-[44px] w-[44px]"
                }`}
                style={{
                  backgroundImage: "linear-gradient(135deg, #2A2A2A 0%, #5A5A5A 100%)",
                }}
              >
                <button
                  type="button"
                  onClick={() =>
                    setAttachments((prev) => prev.filter((a) => a.id !== att.id))
                  }
                  aria-label={`移除附件 ${att.name}`}
                  className="absolute -top-[5px] -right-[5px] flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border-[1.5px] border-[var(--bg-surface)] bg-[var(--ink-primary)] text-[9px] text-[var(--ink-on-primary)]"
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

          {/* Current screen toggle chip */}
          <button
            type="button"
            onClick={() => setIncludeCurrentScreen((s) => !s)}
            className={`flex cursor-pointer items-center gap-1.5 rounded-[8px] border px-3 text-[11.5px] transition-colors lg:text-[12px] ${
              sidebarCollapsed ? "h-[36px]" : "h-[44px]"
            } ${
              includeCurrentScreen
                ? "border-[var(--ink-primary)] bg-[var(--bg-muted)] font-medium text-[var(--ink-strong)]"
                : "border-dashed border-[var(--border-strong)] text-[var(--ink-muted)] hover:border-[var(--ink-muted)]"
            }`}
          >
            <ImageIcon size={12} />
            <span>{includeCurrentScreen ? "已附加当前屏幕 ✓" : "当前屏幕"}</span>
          </button>
        </div>

        {/* Textarea */}
        <div className="px-1.5 py-0.5 lg:py-1">
          <textarea
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder="给 Valet 发消息，输入 / 查看命令，或拖入日志文件…"
            className={`max-h-28 w-full resize-none bg-transparent text-[var(--ink-body)] outline-none placeholder:text-[var(--ink-subtle)] ${
              sidebarCollapsed ? "text-[12.5px] leading-[19px]" : "text-[14px] leading-[22px]"
            }`}
          />
        </div>

        {/* Bottom toolbar */}
        <div className="flex items-center gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFilesAdded(e.target.files)}
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
            onClick={() => setIncludeCurrentScreen((s) => !s)}
            title="截取当前屏幕"
            className={`flex shrink-0 cursor-pointer items-center justify-center rounded-[8px] transition-colors ${
              sidebarCollapsed ? "h-6 w-6" : "h-8 w-8"
            } ${
              includeCurrentScreen
                ? "bg-[var(--bg-muted)] text-[var(--ink-strong)]"
                : "text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
            }`}
          >
            <ScreenCaptureIcon size={sidebarCollapsed ? 14 : 17} />
          </button>

          <button
            type="button"
            onClick={() => setShowPluginMenu((s) => !s)}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[var(--bg-muted)] px-2.5 text-[var(--ink-body)] hover:bg-[var(--bg-hover)] hover:text-[var(--ink-strong)] ${
              sidebarCollapsed ? "h-[24px] text-[11px]" : "h-[28px] text-[12px]"
            }`}
          >
            <span className="font-mono">@</span>
            <span>{mentionPlugin ? mentionPlugin.name : "选择插件"}</span>
          </button>

          <button
            type="button"
            onClick={cycleAutonomy}
            title="点击切换当前自主级别"
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[var(--bg-muted)] px-2.5 text-[var(--ink-body)] hover:bg-[var(--bg-hover)] hover:text-[var(--ink-strong)] ${
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
            disabled={!text.trim() || sending}
            onClick={() => void handleSubmit()}
            title="发送 (Enter)"
            className={`flex shrink-0 items-center justify-center rounded-full bg-[var(--ink-primary)] text-[var(--ink-on-primary)] transition-opacity ${
              sidebarCollapsed ? "h-6 w-6 rounded-[7px]" : "h-[34px] w-[34px]"
            } ${!text.trim() || sending ? "cursor-not-allowed opacity-35" : "cursor-pointer"}`}
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
