import { defineConfig } from "mygo-cli";

export default defineConfig({
  name: "Valet",
  identifier: "dev.vophan.valet",
  version: "0.1.0",
  // `mygo dev` runs devCommand and loads devUrl; `mygo build` runs
  // buildCommand and embeds frontendDist into the app.
  devUrl: "http://localhost:5173",
  devCommand: "bun run dev:web",
  buildCommand: "bun run build:sidecar && bun run build:cli && bun run build:web",
  frontendDist: "dist",
  bindings: "src/mygo.ts",
  out: "build",
  resourcesExclude: ["sidecar.entitlements.plist"],
  macos: {
    signingIdentity: process.env.VALET_SIGNING_IDENTITY || undefined,
    helperEntitlements: {
      "bin/valet-bun": "resources/sidecar.entitlements.plist",
    },
    infoPlist: {
      NSMicrophoneUsageDescription: "Valet 使用麦克风进行按住说话语音指令输入。",
      NSCalendarsFullAccessUsageDescription:
        "Valet 读取日历日程以在会议前自动开启专注与检测日程冲突。",
      NSAppleEventsUsageDescription:
        "Valet 通过自动化协助管理 Finder 与桌面工作流。",
    },
  },
});
