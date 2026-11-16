import React, { useEffect, useState } from "react";
import { valetService } from "../../services/valetService";
import { useValet } from "../../store/ValetContext";
import type { PermissionId, PermissionItem } from "../../types/valet";
import { ArrowUpRightIcon, BowtieSvg, CheckIcon, PermissionGlyph } from "../ui/Icons";
import { Modal } from "../ui/Modal";

const TIER_LABEL: Record<PermissionItem["tier"], string> = {
  required: "必需",
  recommended: "推荐",
  optional: "可选",
};

export const PermissionsStep: React.FC = () => {
  const {
    state,
    setOnboardingStep,
    setPermissionGranted,
    toggleMockAppPermission,
    pushToast,
  } = useValet();

  const [guidePermId, setGuidePermId] = useState<PermissionId | null>(null);
  const [polling, setPolling] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const grantedCount = state.permissions.filter((p) => p.granted).length;
  const totalCount = state.permissions.length;
  const missingRequired = state.permissions.filter(
    (p) => p.tier === "required" && !p.granted
  );
  const canProceed = missingRequired.length === 0;

  const activeGuidePerm = guidePermId
    ? state.permissions.find((p) => p.id === guidePermId) ?? null
    : null;

  // Poll permission simulation after opening System Settings
  useEffect(() => {
    if (!polling || !guidePermId) return;
    const timer = window.setTimeout(async () => {
      const res = await valetService.pollPermissionStatus(guidePermId);
      if (res.granted) {
        setPermissionGranted(guidePermId, true);
        setPolling(false);
        pushToast("已检测到系统权限授权", "success");
      }
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [polling, guidePermId, pushToast, setPermissionGranted]);

  if (activeGuidePerm) {
    return (
      <div className="flex h-full flex-col px-16 pt-14 pb-9 lg:px-20">
        <div className="font-mono text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
          Step 02 / 05 — 系统权限 · {activeGuidePerm.name}
        </div>

        <h2 className="mt-4 font-[family-name:var(--font-serif-zh)] text-[38px] font-medium leading-[50px] tracking-[-0.01em] text-[var(--ink-strong)]">
          只需三步，打开那个开关
        </h2>

        <div className="mt-9 flex flex-1 items-start gap-12">
          {/* Left 3-step instructions */}
          <div className="flex w-[300px] shrink-0 flex-col gap-7">
            {activeGuidePerm.steps.map((step) => (
              <div key={step.index} className="flex gap-3.5">
                <div className="w-[26px] shrink-0 pt-[2px] font-mono text-[12px] tracking-[0.04em] text-[var(--ink-primary)]">
                  {step.index}
                </div>
                <div className="flex flex-col gap-1">
                  <div className="text-[15px] font-semibold leading-[18px] text-[var(--ink-strong)]">
                    {step.title}
                  </div>
                  <div className="text-[13px] leading-[20px] text-[var(--ink-muted)]">
                    {step.detail}
                  </div>
                </div>
              </div>
            ))}

            <div className="flex flex-col gap-3 pt-2">
              <button
                type="button"
                onClick={async () => {
                  await valetService.openSystemSettings(activeGuidePerm.id);
                  setPolling(true);
                }}
                className="inline-flex h-[40px] w-fit cursor-pointer items-center gap-2 rounded-[9px] bg-[var(--ink-nav)] px-[18px] text-[14px] font-semibold text-[var(--ink-on-primary)] transition-transform active:scale-[0.98]"
              >
                <span>打开系统设置</span>
                <ArrowUpRightIcon size={14} />
              </button>

              <div className="flex items-center gap-2">
                {activeGuidePerm.granted ? (
                  <>
                    <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                    <span className="text-[13px] font-medium text-[var(--ink-strong)]">
                      已检测到授权，可以继续
                    </span>
                  </>
                ) : (
                  <>
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        polling ? "animate-pulse bg-[var(--amber-icon)]" : "bg-[#E2A23B]"
                      }`}
                    />
                    <span className="text-[13px] text-[var(--amber-warn)]">
                      {polling
                        ? "正在检测授权结果（2 秒内自动完成）…"
                        : "正在等待授权… 每 2 秒自动检测"}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Right interactive macOS System Settings simulator */}
          <div className="min-w-0 flex-1">
            <div className="flex h-[410px] w-full overflow-hidden rounded-[12px] border border-[var(--border-base)] bg-[var(--bg-sidebar)] shadow-[0_24px_48px_-16px_rgba(14,21,18,0.18)]">
              {/* Mock macOS sidebar */}
              <div className="flex w-[150px] shrink-0 flex-col gap-1 border-r border-[var(--border-base)] px-2.5 py-3.5">
                <div className="flex gap-1.5 pb-3.5">
                  <span className="h-[9px] w-[9px] rounded-full bg-[var(--border-strong)]" />
                  <span className="h-[9px] w-[9px] rounded-full bg-[var(--border-strong)]" />
                  <span className="h-[9px] w-[9px] rounded-full bg-[var(--border-strong)]" />
                </div>
                {["通用", "外观", "控制中心", "隐私与安全性", "桌面与程序坞", "显示器"].map(
                  (tab) => {
                    const active = tab === "隐私与安全性";
                    return (
                      <div
                        key={tab}
                        className={`rounded-[5px] px-2 py-[5px] text-[11px] leading-[14px] ${
                          active
                            ? "bg-[#3B82F6] font-semibold text-white"
                            : "text-[var(--ink-muted)]"
                        }`}
                      >
                        {tab}
                      </div>
                    );
                  }
                )}
              </div>

              {/* Mock macOS right pane */}
              <div className="flex flex-1 flex-col gap-3.5 bg-[var(--bg-canvas)] px-[22px] py-[18px]">
                <div className="text-[13px] font-semibold text-[var(--ink-strong)]">
                  ‹{"  "}
                  {activeGuidePerm.settingsSectionName}
                </div>
                <div className="text-[11px] leading-[16px] text-[var(--ink-muted)]">
                  {activeGuidePerm.settingsSubtext}
                </div>

                <div className="flex flex-col rounded-[8px] border border-[var(--border-base)]">
                  {activeGuidePerm.mockApps.map((app, index) => {
                    const isLast = index === activeGuidePerm.mockApps.length - 1;
                    return (
                      <div
                        key={app.id}
                        className={`flex items-center gap-2.5 px-3 py-2.5 ${
                          app.isValet ? "bg-[var(--bg-subtle)]" : ""
                        } ${!isLast ? "border-b border-[var(--border-light)]" : ""}`}
                      >
                        {app.isValet ? (
                          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-[var(--ink-primary)] text-[var(--ink-on-primary)]">
                            <BowtieSvg size={11} />
                          </div>
                        ) : (
                          <div className="h-5 w-5 shrink-0 rounded-[5px] bg-[var(--border-base)]" />
                        )}
                        <div
                          className={`flex-1 text-[12px] text-[var(--ink-strong)] ${
                            app.isValet ? "font-semibold" : "font-normal"
                          }`}
                        >
                          {app.name}
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleMockAppPermission(activeGuidePerm.id, app.id)}
                          aria-label={`模拟切换 ${app.name} 权限开关`}
                          className={`flex h-[18px] w-[30px] shrink-0 cursor-pointer items-center rounded-full p-[2px] transition-all ${
                            app.enabled
                              ? "justify-end bg-[#3B82F6]"
                              : "justify-start bg-[#C9D0CC]"
                          } ${
                            app.isValet && !app.enabled
                              ? "outline-2 outline-offset-[3px] outline-[var(--ink-primary)]"
                              : ""
                          }`}
                        >
                          <span className="h-3.5 w-3.5 rounded-full bg-white shadow-xs" />
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="flex justify-end pr-1">
                  <div className="rounded-[6px] bg-[var(--ink-nav)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--ink-on-primary)]">
                    {activeGuidePerm.granted
                      ? "已授权 ✓ 可点击下方「我已完成」"
                      : "点这里打开 ↑（可直接点击模拟）"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom footer */}
        <div className="flex items-center justify-between border-t border-[var(--border-base)] pt-5">
          <button
            type="button"
            onClick={() => {
              setPolling(false);
              setGuidePermId(null);
            }}
            className="inline-flex h-[38px] cursor-pointer items-center rounded-[9px] px-4 text-[14px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
          >
            上一步
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="inline-flex h-[38px] cursor-pointer items-center rounded-[9px] px-4 text-[14px] font-medium text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
            >
              遇到问题？
            </button>
            <button
              type="button"
              onClick={() => {
                setPermissionGranted(activeGuidePerm.id, true);
                setPolling(false);
                setGuidePermId(null);
              }}
              className="inline-flex h-[38px] cursor-pointer items-center rounded-[9px] bg-[var(--ink-primary)] px-5 text-[14px] font-semibold text-[var(--ink-on-primary)]"
            >
              我已完成
            </button>
          </div>
        </div>

        <Modal
          open={helpOpen}
          onClose={() => setHelpOpen(false)}
          title="如果在系统设置里找不到 Valet"
          subtitle="macOS 有时需要手动将应用加入权限列表"
        >
          <div className="flex flex-col gap-3 text-[13px] leading-[21px] text-[var(--ink-secondary)]">
            <p>1. 点击列表左下角的「+」按钮，在「应用程序」中找到 Valet.app 并添加。</p>
            <p>2. 若开关呈灰色不可点，请先点击右下角锁图标或输入开机密码解锁。</p>
            <p>3. 授权后可直接点击页面中的「我已完成」继续下一步。</p>
          </div>
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={() => setHelpOpen(false)}
              className="h-[34px] cursor-pointer rounded-[8px] bg-[var(--ink-primary)] px-4 text-[13px] font-semibold text-[var(--ink-on-primary)]"
            >
              知道了
            </button>
          </div>
        </Modal>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col px-16 pt-14 pb-9 lg:px-20">
      <div className="font-mono text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
        Step 02 / 05 — 系统权限
      </div>

      <div className="mt-4 flex items-end justify-between gap-6">
        <div className="flex flex-col gap-2.5">
          <h2 className="font-[family-name:var(--font-serif-zh)] text-[38px] font-medium leading-[50px] tracking-[-0.01em] text-[var(--ink-strong)]">
            把家门钥匙交给{" "}
            <span className="font-[family-name:var(--font-serif-en)] text-[46px] font-normal italic">
              Valet
            </span>
          </h2>
          <p className="max-w-[560px] text-[15px] leading-[24px] text-[var(--ink-muted)]">
            macOS 需要你在「系统设置 › 隐私与安全性」中逐项授权。必需权限完成后即可继续，其余可以之后在设置里开启。
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="text-[13px] text-[var(--ink-muted)]">
            <span className="font-semibold text-[var(--ink-strong)]">{grantedCount}</span> /{" "}
            {totalCount} 已授权
          </div>
          <div className="h-1 w-[140px] overflow-hidden rounded-[2px] bg-[var(--border-base)]">
            <div
              className="h-full rounded-[2px] bg-[var(--ink-primary)] transition-all duration-300"
              style={{ width: `${Math.round((grantedCount / totalCount) * 100)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="mt-7 flex flex-1 flex-col overflow-y-auto">
        {state.permissions.map((perm, idx) => {
          const isLast = idx === state.permissions.length - 1;
          const isRequired = perm.tier === "required";

          return (
            <div
              key={perm.id}
              className={`flex h-[68px] shrink-0 items-center gap-4 ${
                !isLast ? "border-b border-[var(--border-base)]" : ""
              }`}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[var(--bg-sidebar)] text-[var(--ink-nav)]">
                <PermissionGlyph id={perm.id} size={18} />
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-semibold leading-[18px] text-[var(--ink-strong)]">
                    {perm.name}
                  </span>
                  <span
                    className={`rounded-[4px] px-1.5 py-[2px] text-[11px] font-semibold leading-[14px] ${
                      isRequired
                        ? "bg-[var(--border-light)] text-[var(--ink-primary)]"
                        : "bg-[var(--bg-muted)] text-[var(--ink-muted)]"
                    }`}
                  >
                    {TIER_LABEL[perm.tier]}
                  </span>
                </div>
                <div className="truncate text-[13px] leading-[16px] text-[var(--ink-muted)]">
                  {perm.description}
                </div>
              </div>

              <div className="flex w-[132px] shrink-0 justify-end">
                {perm.granted ? (
                  <button
                    type="button"
                    onClick={() => setGuidePermId(perm.id)}
                    className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-[var(--ink-primary)] hover:opacity-75"
                    title="点击查看详情"
                  >
                    <CheckIcon size={15} strokeWidth={2.4} />
                    <span>已授权</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setGuidePermId(perm.id)}
                    className={`inline-flex h-[32px] cursor-pointer items-center rounded-[8px] px-3.5 text-[13px] font-semibold transition-colors ${
                      isRequired
                        ? "bg-[var(--ink-primary)] text-[var(--ink-on-primary)]"
                        : "border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-[var(--ink-primary)] hover:bg-[var(--bg-subtle)]"
                    }`}
                  >
                    去授权
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between border-t border-[var(--border-base)] pt-5">
        <button
          type="button"
          onClick={() => setOnboardingStep(1)}
          className="inline-flex h-[38px] cursor-pointer items-center rounded-[9px] px-4 text-[14px] font-medium text-[var(--ink-nav)] hover:bg-[var(--bg-subtle)]"
        >
          上一步
        </button>

        <div className="flex items-center gap-4">
          {!canProceed && (
            <span className="text-[13px] text-[var(--amber-warn)]">
              还差 {missingRequired.length} 项必需权限
            </span>
          )}
          <button
            type="button"
            disabled={!canProceed}
            onClick={() => setOnboardingStep(3)}
            className={`inline-flex h-[38px] items-center rounded-[9px] bg-[var(--ink-primary)] px-5 text-[14px] font-semibold text-[var(--ink-on-primary)] transition-opacity ${
              canProceed ? "cursor-pointer opacity-100" : "cursor-not-allowed opacity-40"
            }`}
          >
            继续
          </button>
        </div>
      </div>
    </div>
  );
};
