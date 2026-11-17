import React, { useState } from "react";
import { valetService } from "../../services/valetService";
import { useValet } from "../../store/ValetContext";
import type { AutonomyLevel } from "../../types/valet";
import { CheckIcon, EyeIcon, EyeOffIcon } from "../ui/Icons";
import { SegmentedControl } from "../ui/SegmentedControl";
import { SelectMenu } from "../ui/SelectMenu";

const AUTONOMY_OPTIONS: Array<{ value: AutonomyLevel; label: string }> = [
  { value: "always_ask", label: "每个都询问" },
  { value: "auto_review", label: "Auto Review" },
  { value: "full_access", label: "Full Access" },
];

const AUTONOMY_HINT: Record<AutonomyLevel, string> = {
  always_ask: "Valet 每执行一个非只读动作前都会弹窗等待你确认。",
  auto_review: "默认开启 Auto Review：只读操作直通，其余由 Jev System One 或审查小模型自动评估放行或询问。",
  full_access: "安全红线内自动执行并记录时间线，高危越界目录与禁用应用仍受保护。",
};

export const AgentConfigStep: React.FC = () => {
  const {
    state,
    selectProvider,
    updateProvider,
    updateModels,
    setAutonomyLevel,
    setOnboardingStep,
    pushToast,
  } = useValet();

  const [showKey, setShowKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [testingMsg, setTestingMsg] = useState(false);
  const [testReply, setTestReply] = useState<string | null>(null);

  const activeProvider =
    state.providers.find((p) => p.id === state.preferences.activeProviderId) ??
    state.providers[0];

  if (!activeProvider) return null;

  const modelOptions = activeProvider.models.map((m) => ({ value: m, label: m }));
  const visionOptions = [
    { value: "同主模型", label: "同主模型" },
    ...modelOptions,
  ];

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const res = await valetService.verifyProvider(activeProvider);
      if (res.ok) {
        const discovered =
          res.models && res.models.length > 0 ? res.models : activeProvider.models;
        updateProvider(activeProvider.id, {
          verified: true,
          connected: true,
          latencyMs: res.latencyMs,
          availableModelCount: res.modelCount || discovered.length,
          models: discovered,
        });
      } else {
        updateProvider(activeProvider.id, {
          verified: false,
          connected: false,
          latencyMs: res.latencyMs,
        });
      }
      pushToast(res.message, res.ok ? "success" : "warning");
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), "danger");
    } finally {
      setVerifying(false);
    }
  };

  const handleTestMessage = async () => {
    setTestingMsg(true);
    setTestReply(null);
    try {
      const res = await valetService.sendTestAgentMessage(
        activeProvider,
        state.preferences.models.primary
      );
      setTestReply(res.reply);
      pushToast(res.reply, res.ok ? "success" : "warning");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestReply(`测试失败：${msg}`);
      pushToast(msg, "danger");
    } finally {
      setTestingMsg(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-x-hidden overflow-y-auto px-16 pt-12 pb-9 lg:px-20">
      <div className="font-mono text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
        Step 04 / 05 — Agent 配置
      </div>

      <h2 className="mt-3.5 font-[family-name:var(--font-serif-zh)] text-[38px] font-medium leading-[50px] tracking-[-0.01em] text-[var(--ink-strong)]">
        为{" "}
        <span className="font-[family-name:var(--font-serif-en)] text-[46px] font-normal italic">
          Valet
        </span>{" "}
        选一颗大脑
      </h2>

      <p className="mt-1.5 text-[14px] leading-[22px] text-[var(--ink-muted)]">
        密钥只保存在 macOS 钥匙串中。随时可在「设置 › 模型」中添加更多服务商。
      </p>

      {/* 01 Provider */}
      <div className="pt-6 pb-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ink-primary)]">
        01 · Provider
      </div>

      <div className="grid max-w-[770px] grid-cols-2 gap-2.5 xl:grid-cols-3">
        {state.providers.map((provider) => {
          const selected = provider.id === activeProvider.id;
          const isCustom = provider.id === "custom";
          return (
            <button
              key={provider.id}
              type="button"
              onClick={() => {
                selectProvider(provider.id);
                setTestReply(null);
              }}
              className={`flex h-[58px] cursor-pointer items-center gap-3 rounded-[10px] px-3.5 text-left transition-all ${
                selected
                  ? "border-[1.5px] border-[var(--ink-primary)] bg-[var(--bg-canvas)] shadow-[0_6px_16px_-8px_rgba(0,0,0,0.22)]"
                  : isCustom
                    ? "border border-dashed border-[var(--border-dash)] bg-[var(--bg-canvas)] hover:border-[var(--ink-muted)]"
                    : "border border-[var(--border-control)] bg-[var(--bg-canvas)] hover:border-[var(--border-strong)]"
              }`}
            >
              <div
                className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px] ${
                  selected
                    ? "bg-[var(--ink-primary)] text-[var(--ink-on-primary)]"
                    : isCustom
                      ? "border border-dashed border-[var(--border-dash)] text-[var(--ink-muted)]"
                      : "bg-[var(--bg-muted)] text-[var(--ink-strong)]"
                }`}
              >
                <span
                  className={
                    isCustom
                      ? "text-[16px]"
                      : "font-[family-name:var(--font-serif-en)] text-[18px] italic"
                  }
                >
                  {provider.letter}
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold leading-[18px] text-[var(--ink-strong)]">
                  {provider.name}
                </div>
                <div className="truncate text-[12px] leading-[16px] text-[var(--ink-muted)]">
                  {provider.subtitle}
                </div>
              </div>

              {!isCustom &&
                (selected ? (
                  <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--ink-primary)] text-[var(--ink-on-primary)]">
                    <CheckIcon size={10} strokeWidth={3.5} />
                  </span>
                ) : (
                  <span className="h-[18px] w-[18px] shrink-0 rounded-full border-[1.5px] border-[var(--border-strong)]" />
                ))}
            </button>
          );
        })}
      </div>

      {/* 02 Key + 03 Models + 04 Autonomy */}
      <div className="mt-6 flex max-w-[770px] flex-col gap-6 lg:flex-row">
        {/* Left column */}
        <div className="flex w-full shrink-0 flex-col gap-2 lg:w-[373px]">
          <div className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ink-primary)]">
            {activeProvider.id === "ollama" ? "02 · Endpoint" : "02 · API Key"}
          </div>

          <div className="flex h-[42px] items-center gap-2.5 rounded-[9px] border-[1.5px] border-[var(--ink-primary)] bg-[var(--bg-canvas)] px-3 shadow-[0_0_0_4px_rgba(10,10,10,0.06)]">
            {activeProvider.id === "ollama" ? (
              <input
                type="text"
                value={activeProvider.endpoint || "http://localhost:11434"}
                onChange={(e) =>
                  updateProvider(activeProvider.id, { endpoint: e.target.value, verified: false })
                }
                placeholder="http://localhost:11434"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-[var(--ink-strong)] outline-none"
              />
            ) : (
              <>
                <input
                  type={showKey ? "text" : "password"}
                  value={activeProvider.apiKey}
                  onChange={(e) =>
                    updateProvider(activeProvider.id, {
                      apiKey: e.target.value,
                      apiKeyMasked: e.target.value
                        ? `${e.target.value.slice(0, 6)}••••${e.target.value.slice(-4)}`
                        : "",
                      verified: false,
                    })
                  }
                  placeholder={`输入 ${activeProvider.name} API Key`}
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className="min-w-0 flex-1 bg-transparent font-mono text-[13px] tracking-[0.02em] text-[var(--ink-strong)] outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((s) => !s)}
                  className="cursor-pointer text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
                  aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
                >
                  {showKey ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                </button>
              </>
            )}
            <button
              type="button"
              disabled={verifying}
              onClick={handleVerify}
              className="shrink-0 cursor-pointer rounded-[6px] bg-[var(--bg-muted)] px-2 py-1 text-[11px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-hover)]"
            >
              {verifying ? "验证中…" : "验证"}
            </button>
          </div>

          <div className="flex items-center gap-1.5 text-[12px]">
            {activeProvider.verified ? (
              <>
                <CheckIcon size={13} strokeWidth={2.6} className="text-[var(--ink-primary)]" />
                <span className="text-[var(--ink-primary)]">
                  已验证 · 延迟 {activeProvider.latencyMs ?? 240}ms · 可用{" "}
                  {activeProvider.availableModelCount || activeProvider.models.length} 个模型
                </span>
              </>
            ) : (
              <span className="text-[var(--ink-muted)]">
                填写凭据后点击「验证」测试连通性
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((s) => !s)}
            className="w-fit cursor-pointer pt-1 text-left text-[12px] text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
          >
            高级：自定义 Base URL · 代理 · 组织 ID {showAdvanced ? "▾" : "›"}
          </button>

          {showAdvanced && (
            <div className="animate-valet-modal-in mt-1 flex flex-col gap-2 rounded-[9px] border border-[var(--border-base)] bg-[var(--bg-sidebar)] p-3">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase text-[var(--ink-muted)]">
                  Base URL
                </span>
                <input
                  type="text"
                  value={activeProvider.baseUrl}
                  onChange={(e) =>
                    updateProvider(activeProvider.id, { baseUrl: e.target.value })
                  }
                  placeholder="https://api.example.com/v1"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className="h-[30px] rounded-[6px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-2 font-mono text-[11px] text-[var(--ink-strong)] outline-none"
                />
              </label>
              <div className="flex gap-2">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase text-[var(--ink-muted)]">
                    Proxy
                  </span>
                  <input
                    type="text"
                    value={activeProvider.proxyUrl}
                    onChange={(e) =>
                      updateProvider(activeProvider.id, { proxyUrl: e.target.value })
                    }
                    placeholder="http://127.0.0.1:7890"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="h-[30px] rounded-[6px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-2 font-mono text-[11px] text-[var(--ink-strong)] outline-none"
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase text-[var(--ink-muted)]">
                    Org ID
                  </span>
                  <input
                    type="text"
                    value={activeProvider.orgId}
                    onChange={(e) =>
                      updateProvider(activeProvider.id, { orgId: e.target.value })
                    }
                    placeholder="可选"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="h-[30px] rounded-[6px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-2 font-mono text-[11px] text-[var(--ink-strong)] outline-none"
                  />
                </label>
              </div>
            </div>
          )}

          {/* 04 Autonomy */}
          <div className="flex flex-col gap-2 pt-4">
            <div className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ink-primary)]">
              04 · 自主程度
            </div>
            <SegmentedControl
              size="md"
              fullWidth
              options={AUTONOMY_OPTIONS}
              value={state.preferences.autonomyLevel}
              onChange={setAutonomyLevel}
            />
            <div className="text-[12px] leading-[18px] text-[var(--ink-muted)]">
              {AUTONOMY_HINT[state.preferences.autonomyLevel]}
            </div>
          </div>
        </div>

        {/* Right column: 03 Models */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ink-primary)]">
            03 · Models
          </div>

          <div className="flex min-w-0 flex-col rounded-[9px] border border-[var(--border-control)] bg-[var(--bg-canvas)]">
            <div className="flex h-[42px] min-w-0 items-center gap-2.5 border-b border-[var(--border-light)] px-3">
              <span className="w-16 shrink-0 text-[12px] text-[var(--ink-muted)]">
                主模型
              </span>
              <div className="flex min-w-0 flex-1 items-center">
                <SelectMenu
                  value={state.preferences.models.primary}
                  options={modelOptions}
                  onChange={(val) => updateModels({ primary: val })}
                  mono
                  align="left"
                  triggerClassName="border-0 bg-transparent px-1 font-semibold"
                />
              </div>
              <span className="shrink-0 font-mono text-[10px] tracking-[0.08em] text-[var(--ink-muted)]">
                推理·规划
              </span>
            </div>

            <div className="flex h-[42px] min-w-0 items-center gap-2.5 border-b border-[var(--border-light)] px-3">
              <span className="w-16 shrink-0 text-[12px] text-[var(--ink-muted)]">
                快速模型
              </span>
              <div className="flex min-w-0 flex-1 items-center">
                <SelectMenu
                  value={state.preferences.models.fast}
                  options={modelOptions}
                  onChange={(val) => updateModels({ fast: val })}
                  mono
                  align="left"
                  triggerClassName="border-0 bg-transparent px-1 font-semibold"
                />
              </div>
              <span className="shrink-0 font-mono text-[10px] tracking-[0.08em] text-[var(--ink-muted)]">
                摘要·分类
              </span>
            </div>

            <div className="flex h-[42px] min-w-0 items-center gap-2.5 px-3">
              <span className="w-16 shrink-0 text-[12px] text-[var(--ink-muted)]">
                视觉模型
              </span>
              <div className="flex min-w-0 flex-1 items-center">
                <SelectMenu
                  value={state.preferences.models.vision}
                  options={visionOptions}
                  onChange={(val) => updateModels({ vision: val })}
                  align="left"
                  triggerClassName="border-0 bg-transparent px-1 font-semibold"
                />
              </div>
              <span className="shrink-0 font-mono text-[10px] tracking-[0.08em] text-[var(--ink-muted)]">
                读屏·定位
              </span>
            </div>
          </div>

          {testReply && (
            <div className="animate-valet-modal-in mt-2 break-words rounded-[9px] border border-[var(--border-base)] bg-[var(--bg-sidebar)] px-3 py-2.5 text-[12px] leading-[18px] text-[var(--ink-secondary)]">
              {testReply}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1" />

      <div className="mt-5 flex shrink-0 items-center justify-between border-t border-[var(--border-base)] pt-5">
        <button
          type="button"
          onClick={() => setOnboardingStep(3)}
          className="inline-flex h-[38px] cursor-pointer items-center rounded-[9px] px-4 text-[14px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
        >
          上一步
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={testingMsg}
            onClick={handleTestMessage}
            className="inline-flex h-[38px] cursor-pointer items-center rounded-[9px] border border-[var(--border-control)] px-4 text-[14px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
          >
            {testingMsg ? "正在发送…" : "发送测试消息"}
          </button>
          <button
            type="button"
            onClick={() => setOnboardingStep(5)}
            className="inline-flex h-[38px] cursor-pointer items-center rounded-[9px] bg-[var(--ink-primary)] px-5 text-[14px] font-semibold text-[var(--ink-on-primary)]"
          >
            保存并继续
          </button>
        </div>
      </div>
    </div>
  );
};
