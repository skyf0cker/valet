import React from "react";
import { useValet } from "../../store/ValetContext";
import { ArrowRightIcon } from "../ui/Icons";

export const WelcomeStep: React.FC = () => {
  const { setOnboardingStep, importExistingConfig } = useValet();

  const promises = [
    {
      num: "01",
      title: "主动照看",
      desc: "磁盘、进程、日志全天候监测，问题出现前就先打招呼。",
    },
    {
      num: "02",
      title: "只在你同意时动手",
      desc: "清理默认移入废纸篓，7 天内一键还原；敏感操作先问你。",
    },
    {
      num: "03",
      title: "用插件教会它新本领",
      desc: "GitHub、日历、智能家居……任何事件都能交给 Valet 处理。",
    },
  ];

  return (
    <div className="flex h-full flex-col justify-center px-16 pb-12 lg:px-24">
      <div className="font-mono text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
        Step 01 / 05 — 欢迎
      </div>

      <h1 className="mt-5 max-w-[680px] font-[family-name:var(--font-serif-zh)] text-[48px] font-medium leading-[62px] tracking-[-0.01em] text-[var(--ink-strong)] xl:text-[54px] xl:leading-[68px]">
        你好，我是{" "}
        <span className="font-[family-name:var(--font-serif-en)] text-[58px] font-normal italic xl:text-[66px]">
          Valet
        </span>
        。<br />
        你的 Mac，从今天起有人照看。
      </h1>

      <p className="mt-5 max-w-[520px] text-[16px] leading-[26px] text-[var(--ink-muted)]">
        Valet 是常驻在 Mac 上的管家：盯着磁盘空间、清理卸载残留、抓出异常进程与系统日志里的问题——还能通过插件，学会响应你关心的任何事件。
      </p>

      <div className="mt-11 flex max-w-[520px] flex-col gap-[18px]">
        {promises.map((item) => (
          <div key={item.num} className="flex items-start gap-4">
            <div className="w-7 shrink-0 pt-[2px] font-mono text-[12px] tracking-[0.04em] text-[var(--ink-primary)]">
              {item.num}
            </div>
            <div className="flex flex-col gap-[2px]">
              <div className="text-[15px] font-semibold leading-[18px] text-[var(--ink-strong)]">
                {item.title}
              </div>
              <div className="text-[14px] leading-[21px] text-[var(--ink-muted)]">
                {item.desc}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-[52px] flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOnboardingStep(2)}
          className="inline-flex h-[44px] cursor-pointer items-center gap-2 rounded-[10px] bg-[var(--ink-primary)] px-[22px] text-[15px] font-semibold text-[var(--ink-on-primary)] transition-transform active:scale-[0.99]"
        >
          <span>开始设置</span>
          <ArrowRightIcon size={16} />
        </button>

        <button
          type="button"
          onClick={importExistingConfig}
          className="inline-flex h-[44px] cursor-pointer items-center rounded-[10px] px-[18px] text-[15px] font-medium text-[var(--ink-nav)] transition-colors hover:bg-[var(--bg-subtle)]"
        >
          导入已有配置
        </button>

        <span className="pl-2 text-[13px] text-[var(--ink-muted)]">
          约需 2 分钟 · 之后会做一次全面体检
        </span>
      </div>
    </div>
  );
};
