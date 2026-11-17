/**
 * Surge Event Script -> Valet Local Webhook Ingress
 *
 * 将本脚本配置到 Surge [Script] 段，可在 Surge 发生网络变更或异常事件时
 * 自动把上下文推送到 Valet（默认回环端口 41920），触发「Surge 诊断」Skill 处理。
 *
 * Surge 配置示例：
 * [Script]
 * valet-network-watch = type=event,event-name=network-changed,script-path=surge-valet-event.js
 */
const endpoint = "http://127.0.0.1:41920/events/surge-doctor/surge.webhook_alert";

const payload = {
  source: "surge-event-script",
  eventName: typeof $event !== "undefined" && $event.name ? $event.name : "surge.event",
  data: typeof $event !== "undefined" && $event.data ? $event.data : {},
  network: typeof $network !== "undefined" ? $network : {},
  timestamp: new Date().toISOString(),
};

$httpClient.post(
  {
    url: endpoint,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeout: 3,
  },
  (error, response) => {
    if (error) {
      console.log("[Valet Webhook] post failed: " + String(error));
    } else if (response && response.status >= 400) {
      console.log("[Valet Webhook] HTTP " + response.status);
    }
    $done();
  }
);
