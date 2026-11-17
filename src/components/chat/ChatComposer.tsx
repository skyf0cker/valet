import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isMyGo } from "mygo-runtime";
import { Valet } from "../../mygo";
import { useValet } from "../../store/ValetContext";
import type { AutonomyLevel, ChatAttachment, PluginState } from "../../types/valet";
import {
  ArrowRightIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  MicIcon,
  PaperclipIcon,
  PencilIcon,
  PlusIcon,
  ScreenCaptureIcon,
  ShieldIcon,
  StopIcon,
  TerminalSlashIcon,
  TrashIcon,
} from "../ui/Icons";
import { SelectMenu } from "../ui/SelectMenu";

interface ChatComposerProps {
  chatId: string;
  sending: boolean;
  onAbort?: () => void;
  onSend: (params: {
    prompt: string;
    mentionPlugin: PluginState | null;
    attachments: ChatAttachment[];
  }) => Promise<void>;
}

const SLASH_COMMANDS = [
  { cmd: "/scan", desc: "执行一次系统与事件传感器状态快照" },
  { cmd: "/ps", desc: "立即采样 CPU 与内存异常进程" },
  { cmd: "/plugin", desc: "用自然语言编排一个新的事件监听插件与 Skill" },
  { cmd: "/clean", desc: "排查长期闲置文件或开发缓存并生成确认清单" },
];

const AUTONOMY_SHORT_LABEL: Record<AutonomyLevel, string> = {
  always_ask: "每个询问",
  auto_review: "Auto Review",
  full_access: "Full Access",
};

const AUTONOMY_OPTIONS: Array<{
  value: AutonomyLevel;
  label: string;
  desc: string;
}> = [
  { value: "always_ask", label: "每个都询问", desc: "所有非只读操作均先请求确认" },
  { value: "auto_review", label: "Auto Review", desc: "Jev / 小模型审查低风险自动放行" },
  { value: "full_access", label: "Full Access", desc: "安全边界内自动执行并记录时间线" },
];

const VOICE_WAVE_HEIGHTS = [8, 16, 24, 12, 20, 28, 14, 22, 10, 6];
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_FILE_BYTES = 512 * 1024;

interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

type BrowserSpeechRecognitionCtor = new () => BrowserSpeechRecognition;

function getBrowserSpeechRecognitionCtor(): BrowserSpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: BrowserSpeechRecognitionCtor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function measureTextareaCaretViewportRect(
  textarea: HTMLTextAreaElement,
  charIndex: number,
): { left: number; top: number; height: number } {
  const taRect = textarea.getBoundingClientRect();
  const cs = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  const copyProps = [
    "boxSizing",
    "width",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "letterSpacing",
    "lineHeight",
    "textTransform",
    "textIndent",
    "tabSize",
  ] as const;

  mirror.style.position = "fixed";
  mirror.style.top = "-9999px";
  mirror.style.left = "-9999px";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.overflow = "hidden";
  for (const prop of copyProps) {
    mirror.style[prop] = cs[prop];
  }
  mirror.style.width = `${taRect.width}px`;

  const clampedIdx = Math.max(0, Math.min(charIndex, textarea.value.length));
  mirror.textContent = textarea.value.slice(0, clampedIdx);

  const marker = document.createElement("span");
  marker.textContent = textarea.value.slice(clampedIdx, clampedIdx + 1) || "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  try {
    const markerHeight =
      marker.offsetHeight || parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) || 20;
    return {
      left: taRect.left + marker.offsetLeft - textarea.scrollLeft,
      top: taRect.top + marker.offsetTop - textarea.scrollTop,
      height: markerHeight,
    };
  } finally {
    document.body.removeChild(mirror);
  }
}

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

export const ChatComposer: React.FC<ChatComposerProps> = ({
  chatId,
  sending,
  onAbort,
  onSend,
}) => {
  const {
    state,
    sidebarCollapsed,
    queuedMessages,
    removeQueuedMessage,
    sendQueuedMessageNow,
    setAutonomyLevel,
    updateModels,
    pushToast,
  } = useValet();

  const busyPolicy = state.preferences.busyMessagePolicy ?? "queue";

  const [queueCollapsed, setQueueCollapsed] = useState(false);

  const [text, setText] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const [mentionPluginId, setMentionPluginId] = useState<string>("");
  const [manualPluginMenu, setManualPluginMenu] = useState(false);
  const [addContextOpen, setAddContextOpen] = useState(false);
  const [autonomyMenuOpen, setAutonomyMenuOpen] = useState(false);
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
  const composerBoxRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const isComposingRef = useRef(false);
  const compositionEndedAtRef = useRef(0);
  const [pluginPopoverStyle, setPluginPopoverStyle] = useState<React.CSSProperties>({});
  const [slashPopoverStyle, setSlashPopoverStyle] = useState<React.CSSProperties>({});

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

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort?.();
      } catch {
        // ignore cleanup failure
      }
      recognitionRef.current = null;
    };
  }, []);

  // Dismiss menus cleanly on outside clicks
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (
        composerContainerRef.current &&
        !composerContainerRef.current.contains(e.target as Node)
      ) {
        setManualPluginMenu(false);
        setAddContextOpen(false);
        setAutonomyMenuOpen(false);
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

  const updatePopoverPositions = useCallback(() => {
    const container = composerContainerRef.current;
    const box = composerBoxRef.current;
    const ta = textareaRef.current;
    if (!container || !box) return;

    const containerRect = container.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    if (containerRect.width <= 0 || boxRect.width <= 0) return;

    const boxLeftRel = boxRect.left - containerRect.left;
    const boxRightRel = boxRect.right - containerRect.left;
    const maxBoxWidth = Math.max(220, boxRect.width);

    if (showSlashMenu) {
      const slashWidth = Math.min(440, maxBoxWidth);
      const bottom = Math.max(8, containerRect.bottom - boxRect.top + 8);
      setSlashPopoverStyle({
        left: `${Math.round(boxLeftRel)}px`,
        bottom: `${Math.round(bottom)}px`,
        width: `${Math.round(slashWidth)}px`,
      });
    }

    if (pluginMenuOpen) {
      const popoverWidth = Math.min(400, maxBoxWidth);
      let desiredLeft = boxLeftRel;
      let anchorTop = boxRect.top;

      if (inlineAtMatch !== null && ta) {
        const caret = measureTextareaCaretViewportRect(ta, inlineAtMatch.startIdx);
        desiredLeft = caret.left - containerRect.left - 8;
        anchorTop = caret.top - boxRect.top <= 24 ? boxRect.top : caret.top;
      }

      const maxLeft = Math.max(boxLeftRel, boxRightRel - popoverWidth);
      const clampedLeft = Math.max(boxLeftRel, Math.min(desiredLeft, maxLeft));
      const bottom = Math.max(8, containerRect.bottom - anchorTop + 8);
      setPluginPopoverStyle({
        left: `${Math.round(clampedLeft)}px`,
        bottom: `${Math.round(bottom)}px`,
        width: `${Math.round(popoverWidth)}px`,
      });
    }
  }, [showSlashMenu, pluginMenuOpen, inlineAtMatch]);

  useLayoutEffect(() => {
    if (!pluginMenuOpen && !showSlashMenu) return;
    updatePopoverPositions();
  }, [
    pluginMenuOpen,
    showSlashMenu,
    inlineAtMatch?.startIdx,
    inlineAtMatch?.query,
    text,
    cursorPos,
    sidebarCollapsed,
    updatePopoverPositions,
  ]);

  useEffect(() => {
    if (!pluginMenuOpen && !showSlashMenu) return;
    const onResize = () => updatePopoverPositions();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [pluginMenuOpen, showSlashMenu, updatePopoverPositions]);

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
    if (!trimmed && attachments.length === 0) return;
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
    if (capturingScreen) return;
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

  const handleFilesAdded = async (filesInput: FileList | File[] | null) => {
    const files = filesInput ? Array.from(filesInput) : [];
    if (files.length === 0) return;
    const added: ChatAttachment[] = [];

    for (const [idx, file] of files.entries()) {
      const isImage = file.type.startsWith("image/");
      const ext =
        (file.name.split(".").pop() || file.type.split("/")[1] || "png")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "") || "png";
      const rawName = file.name?.trim() || "";
      const displayName =
        isImage && (!rawName || /^image\.(png|jpe?g|webp|gif|bmp|tiff)$/i.test(rawName))
          ? `剪贴板图片-${new Date().toTimeString().slice(0, 8).replace(/:/g, "")}.${ext}`
          : rawName || `附件-${idx + 1}.${ext}`;
      const sizeMeta = `${Math.max(1, Math.round(file.size / 1024))} KB`;
      const badge = isImage
        ? ext.slice(0, 3).toUpperCase() || "IMG"
        : displayName.split(".").pop()?.slice(0, 3).toUpperCase() || "FILE";

      if (isImage) {
        if (file.size > MAX_IMAGE_BYTES) {
          pushToast(`图片「${displayName}」超过 4 MB，请压缩后再试`, "danger");
          continue;
        }
        try {
          const dataUrl = await readBlobAsDataURL(file);
          added.push({
            id: `up-${Date.now()}-${idx}`,
            kind: "image",
            name: displayName,
            meta: sizeMeta,
            badge,
            dataUrl,
            mimeType: file.type || "image/png",
          });
        } catch (err) {
          pushToast(
            err instanceof Error ? err.message : `读取图片「${displayName}」失败`,
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
        name: displayName,
        meta: sizeMeta,
        badge,
        textExcerpt,
      });
    }

    if (added.length > 0) {
      setAttachments((prev) => [...prev, ...added]);
    }
  };

  const stopVoiceRecording = () => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore stop failure
    }
    recognitionRef.current = null;
    setRecording(false);
  };

  const cancelVoiceRecording = () => {
    try {
      recognitionRef.current?.abort?.();
    } catch {
      // ignore abort failure
    }
    recognitionRef.current = null;
    setRecording(false);
    pushToast("已取消语音输入");
  };

  const toggleVoiceRecording = () => {
    if (recording) {
      stopVoiceRecording();
      return;
    }
    const RecognitionCtor = getBrowserSpeechRecognitionCtor();
    if (!RecognitionCtor) {
      pushToast("原生语音输入开发中，当前请使用文字输入");
      return;
    }
    try {
      const rec = new RecognitionCtor();
      rec.lang = "zh-CN";
      rec.continuous = true;
      rec.interimResults = false;
      rec.onresult = (ev) => {
        const parts: string[] = [];
        for (let i = 0; i < ev.results.length; i += 1) {
          const item = ev.results[i];
          const first = item?.[0]?.transcript?.trim();
          if (first) parts.push(first);
        }
        const transcript = parts.join(" ").trim();
        if (!transcript) return;
        setText((prev) => {
          const next = prev.trim() ? `${prev.trim()} ${transcript}` : transcript;
          setCursorPos(next.length);
          return next;
        });
      };
      rec.onerror = () => {
        recognitionRef.current = null;
        setRecording(false);
        pushToast("语音识别未能启动，请检查麦克风权限");
      };
      rec.onend = () => {
        recognitionRef.current = null;
        setRecording(false);
      };
      recognitionRef.current = rec;
      setRecording(true);
      rec.start();
    } catch {
      recognitionRef.current = null;
      setRecording(false);
      pushToast("原生语音输入开发中，当前请使用文字输入");
    }
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
  const canSend = Boolean(text.trim() || attachments.length > 0);

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
            onClick={stopVoiceRecording}
            className="flex h-9 cursor-pointer items-center rounded-[18px] bg-[var(--ink-on-primary)] px-3.5 text-[12px] font-semibold text-[var(--ink-primary)] transition-opacity hover:opacity-90"
          >
            完成输入
          </button>
        </div>
      )}

      {/* Slash Command Popover */}
      {showSlashMenu && filteredCommands.length > 0 && (
        <div
          style={slashPopoverStyle}
          className="animate-valet-modal-in absolute z-20 rounded-[12px] border border-[var(--border-base)] bg-[var(--bg-elevated)] p-1.5 shadow-[var(--shadow-popover)]"
        >
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
        <div
          style={pluginPopoverStyle}
          className="animate-valet-modal-in absolute z-20 rounded-[12px] border border-[var(--border-base)] bg-[var(--bg-elevated)] p-1.5 shadow-[var(--shadow-popover)]"
        >
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

      {/* Queued Messages Tray */}
      {(queuedMessages[chatId] ?? []).length > 0 && (
        <div
          className={`w-full max-w-[720px] overflow-hidden border border-[var(--border-base)] bg-[var(--bg-subtle)] pb-1 ${
            sidebarCollapsed ? "rounded-[12px]" : "rounded-[14px]"
          }`}
        >
          <div className="flex items-center gap-2 px-3.5 pt-2.5 pb-1.5">
            <span className="text-[12px] font-semibold leading-[16px] text-[var(--ink-secondary)]">
              待发送消息
            </span>
            <span className="inline-flex h-[18px] min-w-[20px] items-center justify-center rounded-full bg-[var(--bg-hover)] px-1.5 font-mono text-[11px] font-semibold leading-[14px] text-[var(--ink-strong)]">
              {(queuedMessages[chatId] ?? []).length}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] leading-[16px] text-[var(--ink-subtle)]">
              当前回复完成后自动依次发送
            </span>
            <button
              type="button"
              onClick={() => setQueueCollapsed((v) => !v)}
              title={queueCollapsed ? "展开队列" : "收起队列"}
              aria-label={queueCollapsed ? "展开待发送消息队列" : "收起待发送消息队列"}
              className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-[var(--ink-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--ink-strong)]"
            >
              <ChevronDownIcon
                size={13}
                className={`transition-transform ${queueCollapsed ? "-rotate-90" : ""}`}
              />
            </button>
          </div>

          {!queueCollapsed && (
            <div className="flex max-h-[156px] flex-col overflow-y-auto">
              {(queuedMessages[chatId] ?? []).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2.5 py-1.5 pr-2.5 pl-3.5 transition-colors hover:bg-[var(--bg-hover)]/45"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-[var(--ink-strong)]">
                    {item.prompt}
                  </span>
                  {item.mentionPlugin && (
                    <span className="shrink-0 rounded-[6px] bg-[var(--bg-hover)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-muted)]">
                      @{item.mentionPlugin.name}
                    </span>
                  )}
                  {item.attachments.length > 0 && (
                    <span className="shrink-0 rounded-[6px] bg-[var(--bg-hover)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-muted)]">
                      {item.attachments.length} 附件
                    </span>
                  )}
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => void sendQueuedMessageNow(chatId, item.id)}
                      title="立即插队发送"
                      aria-label="立即插队发送此消息"
                      className="flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-[var(--ink-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--ink-strong)]"
                    >
                      <ArrowRightIcon size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const removed = removeQueuedMessage(chatId, item.id);
                        if (!removed) return;
                        setText(removed.prompt);
                        setCursorPos(removed.prompt.length);
                        setAttachments(removed.attachments);
                        setMentionPluginId(removed.mentionPlugin?.id ?? "");
                        requestAnimationFrame(() => textareaRef.current?.focus());
                      }}
                      title="编辑此消息"
                      aria-label="编辑此待发送消息"
                      className="flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-[var(--ink-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--ink-strong)]"
                    >
                      <PencilIcon size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeQueuedMessage(chatId, item.id)}
                      title="移除此消息"
                      aria-label="从队列移除此消息"
                      className="flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-[var(--ink-muted)] transition-colors hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]"
                    >
                      <TrashIcon size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Composer Box */}
      <div
        ref={composerBoxRef}
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
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => {
              setText(e.target.value);
              syncCursor(e.target);
              setDismissedInlineAt(false);
              setDismissedSlash(false);
            }}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={(e) => {
              isComposingRef.current = false;
              compositionEndedAtRef.current = performance.now();
              syncCursor(e.currentTarget);
            }}
            onPaste={(e) => {
              const items = Array.from(e.clipboardData?.items ?? []);
              const pastedFiles: File[] = [];
              for (const item of items) {
                if (item.kind === "file") {
                  const f = item.getAsFile();
                  if (f) pastedFiles.push(f);
                }
              }
              if (pastedFiles.length === 0 && e.clipboardData?.files?.length) {
                pastedFiles.push(...Array.from(e.clipboardData.files));
              }
              if (pastedFiles.length > 0) {
                e.preventDefault();
                void handleFilesAdded(pastedFiles);
              }
            }}
            onClick={(e) => syncCursor(e.currentTarget)}
            onKeyUp={(e) => syncCursor(e.currentTarget)}
            onKeyDown={(e) => {
              const justEndedComposition =
                performance.now() - compositionEndedAtRef.current < 100;
              if (
                isComposingRef.current ||
                e.nativeEvent.isComposing ||
                e.keyCode === 229 ||
                e.nativeEvent.keyCode === 229 ||
                justEndedComposition
              ) {
                return;
              }

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

              if ((addContextOpen || autonomyMenuOpen) && e.key === "Escape") {
                e.preventDefault();
                setAddContextOpen(false);
                setAutonomyMenuOpen(false);
                return;
              }

              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder={
              sending
                ? busyPolicy === "steer"
                  ? "正在执行… 输入发送即可实时引导，或点击右侧停止"
                  : "正在执行… 继续输入将加入待发送队列，或点击右侧停止"
                : "给 Valet 发消息，@ 指定插件，/ 调用动作…"
            }
            className={`max-h-28 w-full resize-none bg-transparent text-[var(--ink-body)] outline-none placeholder:text-[var(--ink-subtle)] ${
              sidebarCollapsed ? "text-[12.5px] leading-[19px]" : "text-[14px] leading-[22px]"
            }`}
          />
        </div>

        {/* Bottom toolbar */}
        <div className="flex items-center justify-between gap-2">
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

          <div className="flex min-w-0 flex-1 items-center gap-1">
            {/* Consolidated + Add Context Menu */}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => {
                  setAddContextOpen((o) => !o);
                  setManualPluginMenu(false);
                  setAutonomyMenuOpen(false);
                }}
                title="添加上下文（文件、截屏、插件或动作）"
                aria-label="添加上下文"
                aria-expanded={addContextOpen}
                className={`flex shrink-0 cursor-pointer items-center justify-center rounded-[7px] transition-colors ${
                  sidebarCollapsed ? "h-6 w-6" : "h-7 w-7"
                } ${
                  addContextOpen
                    ? "bg-[var(--bg-hover)] text-[var(--ink-strong)]"
                    : "text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
                }`}
              >
                <PlusIcon size={sidebarCollapsed ? 14 : 15} />
              </button>

              {addContextOpen && (
                <div className="animate-valet-modal-in absolute bottom-full left-0 z-30 mb-2 w-[200px] rounded-[12px] border border-[var(--border-base)] bg-[var(--bg-elevated)] p-1.5 shadow-[var(--shadow-popover)]">
                  <div className="px-2.5 pt-1 pb-1.5 text-[11.5px] font-medium text-[var(--ink-muted)]">
                    添加上下文
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAddContextOpen(false);
                      fileInputRef.current?.click();
                    }}
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[12.5px] text-[var(--ink-strong)] transition-colors hover:bg-[var(--bg-subtle)]"
                  >
                    <PaperclipIcon size={14} className="shrink-0 text-[var(--ink-muted)]" />
                    <span>添加文件或图片</span>
                  </button>
                  <button
                    type="button"
                    disabled={capturingScreen}
                    onClick={() => {
                      setAddContextOpen(false);
                      void handleCaptureScreen();
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[12.5px] text-[var(--ink-strong)] transition-colors hover:bg-[var(--bg-subtle)] ${
                      capturingScreen ? "cursor-wait opacity-60" : "cursor-pointer"
                    }`}
                  >
                    <ScreenCaptureIcon size={14} className="shrink-0 text-[var(--ink-muted)]" />
                    <span>{capturingScreen ? "正在截屏…" : "截取当前屏幕"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddContextOpen(false);
                      setManualPluginMenu(true);
                      setDismissedInlineAt(false);
                    }}
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[12.5px] text-[var(--ink-strong)] transition-colors hover:bg-[var(--bg-subtle)]"
                  >
                    <span className="flex w-[14px] shrink-0 items-center justify-center font-mono text-[13px] text-[var(--ink-muted)]">
                      @
                    </span>
                    <span>指定插件</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddContextOpen(false);
                      setText("/");
                      setCursorPos(1);
                      setDismissedSlash(false);
                      window.requestAnimationFrame(() => {
                        if (textareaRef.current) {
                          textareaRef.current.focus();
                          textareaRef.current.setSelectionRange(1, 1);
                        }
                      });
                    }}
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[12.5px] text-[var(--ink-strong)] transition-colors hover:bg-[var(--bg-subtle)]"
                  >
                    <TerminalSlashIcon size={14} className="shrink-0 text-[var(--ink-muted)]" />
                    <span>快捷动作</span>
                  </button>
                </div>
              )}
            </div>

            {/* Borderless Ghost Model Selector */}
            <SelectMenu
              value={state.preferences.models.primary || modelOptions[0]?.value || ""}
              options={modelOptions}
              onChange={(val) => updateModels({ primary: val })}
              variant="ghost"
              align="left"
              compact
              searchable={modelOptions.length > 8}
              triggerClassName={`max-w-[190px] rounded-[7px] font-medium ${
                sidebarCollapsed ? "h-6 text-[11.5px]" : "h-7 text-[12.5px]"
              }`}
            />

            {/* Active @Plugin chip (only shown when explicitly selected) */}
            {mentionPlugin && (
              <span
                className={`inline-flex max-w-[140px] shrink-0 items-center gap-1 rounded-full bg-[var(--bg-muted)] px-2 text-[var(--ink-strong)] ${
                  sidebarCollapsed ? "h-[22px] text-[11px]" : "h-[24px] text-[11.5px]"
                }`}
              >
                <span className="truncate font-medium">@{mentionPlugin.name}</span>
                <button
                  type="button"
                  aria-label="清除指定插件"
                  onClick={() => setMentionPluginId("")}
                  className="shrink-0 cursor-pointer rounded-full px-0.5 text-[10px] text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
                >
                  ✕
                </button>
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {/* Compact Autonomy Dropdown */}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => {
                  setAutonomyMenuOpen((o) => !o);
                  setAddContextOpen(false);
                }}
                title="切换当前自主级别"
                aria-expanded={autonomyMenuOpen}
                className={`inline-flex cursor-pointer items-center gap-1 rounded-[7px] px-2 text-[var(--ink-muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)] ${
                  sidebarCollapsed ? "h-6 text-[11px]" : "h-7 text-[12px]"
                } ${autonomyMenuOpen ? "bg-[var(--bg-subtle)] text-[var(--ink-strong)]" : ""}`}
              >
                <ShieldIcon
                  size={13}
                  className={
                    state.preferences.autonomyLevel === "full_access"
                      ? "text-emerald-500"
                      : state.preferences.autonomyLevel === "auto_review"
                        ? "text-[var(--amber-icon)]"
                        : "text-[var(--ink-secondary)]"
                  }
                />
                <span>{AUTONOMY_SHORT_LABEL[state.preferences.autonomyLevel]}</span>
                <ChevronDownIcon size={11} className="opacity-70" />
              </button>

              {autonomyMenuOpen && (
                <div className="animate-valet-modal-in absolute right-0 bottom-full z-30 mb-2 w-[224px] rounded-[12px] border border-[var(--border-base)] bg-[var(--bg-elevated)] p-1.5 shadow-[var(--shadow-popover)]">
                  <div className="px-2.5 pt-1 pb-1 text-[11px] font-medium text-[var(--ink-muted)]">
                    执行自主级别
                  </div>
                  {AUTONOMY_OPTIONS.map((opt) => {
                    const selected = state.preferences.autonomyLevel === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setAutonomyLevel(opt.value);
                          setAutonomyMenuOpen(false);
                          pushToast(`已切换为「${opt.label}」`);
                        }}
                        className={`flex w-full cursor-pointer items-start gap-2 rounded-[8px] px-2.5 py-2 text-left transition-colors ${
                          selected ? "bg-[var(--bg-subtle)]" : "hover:bg-[var(--bg-subtle)]"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] font-medium text-[var(--ink-strong)]">
                            {opt.label}
                          </div>
                          <div className="mt-0.5 text-[10.5px] leading-[14px] text-[var(--ink-muted)]">
                            {opt.desc}
                          </div>
                        </div>
                        {selected && (
                          <CheckIcon
                            size={12}
                            strokeWidth={2.5}
                            className="mt-0.5 shrink-0 text-[var(--ink-primary)]"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={toggleVoiceRecording}
              title="语音输入"
              aria-label="语音输入"
              className={`flex shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors ${
                sidebarCollapsed ? "h-7 w-7" : "h-8 w-8"
              } ${
                recording
                  ? "bg-[var(--danger-bg)] text-[var(--danger)]"
                  : "text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
              }`}
            >
              <MicIcon size={sidebarCollapsed ? 14 : 15} />
            </button>

            {sending && onAbort && (
              <button
                type="button"
                onClick={onAbort}
                title="停止当前生成"
                aria-label="停止当前生成"
                className={`flex shrink-0 cursor-pointer items-center justify-center rounded-full border border-[var(--danger)]/35 bg-[var(--danger-bg)] text-[var(--danger)] transition-opacity hover:opacity-90 ${
                  sidebarCollapsed ? "h-7 w-7" : "h-8 w-8"
                }`}
              >
                <StopIcon size={sidebarCollapsed ? 11 : 12} />
              </button>
            )}

            {(!sending || !onAbort || canSend) && (
              <button
                type="button"
                disabled={!canSend}
                onClick={() => void handleSubmit()}
                title={
                  sending
                    ? busyPolicy === "steer"
                      ? "实时引导当前执行 (Enter)"
                      : "加入待发送队列 (Enter)"
                    : "发送 (Enter)"
                }
                aria-label="发送消息"
                className={`flex shrink-0 items-center justify-center rounded-full bg-[var(--ink-primary)] text-[var(--ink-on-primary)] transition-opacity ${
                  sidebarCollapsed ? "h-7 w-7" : "h-8 w-8"
                } ${!canSend ? "cursor-not-allowed opacity-35" : "cursor-pointer"}`}
              >
                <ArrowUpIcon size={sidebarCollapsed ? 14 : 15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
