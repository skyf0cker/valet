import { parse } from "yaml";
import {
  WORKFLOW_CONDITION_OPS,
  WORKFLOW_NODE_TYPES,
  type WorkflowConditionExpr,
  type WorkflowConditionOp,
  type WorkflowDefinition,
  type WorkflowEdgeDef,
  type WorkflowNodeDef,
  type WorkflowNodeType,
} from "./eval.ts";

export interface WorkflowValidationResult {
  valid: boolean;
  errors: string[];
  workflow?: WorkflowDefinition;
  topologicalOrder?: string[];
  entryNodeIds?: string[];
}

const VALID_NODE_TYPE_SET = new Set<string>(WORKFLOW_NODE_TYPES);
const VALID_OP_SET = new Set<string>(WORKFLOW_CONDITION_OPS);
const VALID_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeConditionExpr(
  config: Record<string, unknown>,
  nodeId: string,
  errors: string[],
): WorkflowConditionExpr | undefined {
  const rawExpr = isPlainRecord(config.expr)
    ? config.expr
    : typeof config.path === "string"
      ? { path: config.path, op: config.op ?? "truthy", value: config.value }
      : undefined;

  if (!rawExpr) {
    errors.push(`节点 "${nodeId}" (condition) 缺少 config.expr (或 config.path)`);
    return undefined;
  }

  const path = typeof rawExpr.path === "string" ? rawExpr.path.trim() : "";
  if (!path) {
    errors.push(`节点 "${nodeId}" (condition) 的 expr.path 不能为空`);
  }

  const op =
    typeof rawExpr.op === "string" && rawExpr.op.trim()
      ? rawExpr.op.trim()
      : "truthy";
  if (!VALID_OP_SET.has(op)) {
    errors.push(
      `节点 "${nodeId}" (condition) 的 expr.op "${op}" 不合法，允许值: ${WORKFLOW_CONDITION_OPS.join(", ")}`,
    );
  }

  return {
    path,
    op: op as WorkflowConditionOp,
    ...(rawExpr.value !== undefined ? { value: rawExpr.value } : {}),
  };
}

function validateNodeConfig(
  node: WorkflowNodeDef,
  errors: string[],
): Record<string, unknown> {
  const cfg = node.config ?? {};
  switch (node.type) {
    case "script": {
      if (typeof cfg.command !== "string" || !cfg.command.trim()) {
        errors.push(`节点 "${node.id}" (script) 缺少非空 config.command`);
      }
      if (cfg.args !== undefined && !Array.isArray(cfg.args)) {
        errors.push(`节点 "${node.id}" (script) 的 config.args 必须是数组`);
      }
      break;
    }
    case "http": {
      if (typeof cfg.url !== "string" || !cfg.url.trim()) {
        errors.push(`节点 "${node.id}" (http) 缺少非空 config.url`);
      }
      break;
    }
    case "tool": {
      const toolName =
        typeof cfg.tool === "string" && cfg.tool.trim()
          ? cfg.tool.trim()
          : typeof cfg.name === "string" && cfg.name.trim()
            ? cfg.name.trim()
            : "";
      if (!toolName) {
        errors.push(`节点 "${node.id}" (tool) 缺少非空 config.tool`);
      }
      break;
    }
    case "agent": {
      if (typeof cfg.prompt !== "string" || !cfg.prompt.trim()) {
        errors.push(`节点 "${node.id}" (agent) 缺少非空 config.prompt`);
      }
      break;
    }
    case "condition": {
      const expr = normalizeConditionExpr(cfg, node.id, errors);
      if (expr) {
        return { ...cfg, expr };
      }
      break;
    }
    case "transform": {
      if (cfg.output === undefined && cfg.mapping === undefined) {
        errors.push(`节点 "${node.id}" (transform) 缺少 config.output (或 config.mapping)`);
      }
      break;
    }
    case "sleep": {
      const dur = cfg.duration;
      const validStr = typeof dur === "string" && dur.trim().length > 0;
      const validNum = typeof dur === "number" && Number.isFinite(dur) && dur >= 0;
      if (!validStr && !validNum) {
        errors.push(
          `节点 "${node.id}" (sleep) 缺少合法的 config.duration (如 "5s", "10m", 或非负毫秒数)`,
        );
      }
      break;
    }
    case "approval": {
      const title =
        typeof cfg.title === "string" && cfg.title.trim()
          ? cfg.title.trim()
          : typeof cfg.summary === "string" && cfg.summary.trim()
            ? cfg.summary.trim()
            : "";
      if (!title) {
        errors.push(`节点 "${node.id}" (approval) 缺少非空 config.title`);
      }
      break;
    }
    case "notify": {
      if (typeof cfg.message !== "string" || !cfg.message.trim()) {
        errors.push(`节点 "${node.id}" (notify) 缺少非空 config.message`);
      }
      break;
    }
    case "trigger":
      break;
  }
  return cfg;
}

/**
 * Parses and validates a `workflow.yaml` document into a verified DAG definition.
 */
export function parseAndValidateWorkflowYaml(raw: string): WorkflowValidationResult {
  const errors: string[] = [];
  if (!raw || !raw.trim()) {
    return { valid: false, errors: ["workflow.yaml 内容不能为空"] };
  }

  let doc: unknown;
  try {
    doc = parse(raw);
  } catch (err) {
    return {
      valid: false,
      errors: [
        `workflow.yaml YAML 语法错误: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }

  if (!isPlainRecord(doc)) {
    return { valid: false, errors: ["workflow.yaml 根节点必须是 YAML 对象"] };
  }

  let version = 1;
  if (doc.version !== undefined) {
    if (typeof doc.version !== "number" || !Number.isInteger(doc.version) || doc.version <= 0) {
      errors.push("version 必须是正整数 (推荐 1)");
    } else {
      version = doc.version;
    }
  }

  const name = typeof doc.name === "string" && doc.name.trim() ? doc.name.trim() : undefined;
  const description =
    typeof doc.description === "string" && doc.description.trim()
      ? doc.description.trim()
      : undefined;

  if (!Array.isArray(doc.nodes) || doc.nodes.length === 0) {
    errors.push("workflow.yaml 至少需要定义 1 个节点 (nodes)");
    return { valid: false, errors };
  }

  const nodes: WorkflowNodeDef[] = [];
  const nodeIds = new Set<string>();

  doc.nodes.forEach((rawNode, index) => {
    if (!isPlainRecord(rawNode)) {
      errors.push(`nodes[${index}] 必须是对象`);
      return;
    }
    const id = typeof rawNode.id === "string" ? rawNode.id.trim() : "";
    if (!id) {
      errors.push(`nodes[${index}] 缺少 id`);
      return;
    }
    if (!VALID_ID_REGEX.test(id)) {
      errors.push(`节点 id "${id}" 只允许字母、数字、下划线和连字符`);
    }
    if (nodeIds.has(id)) {
      errors.push(`存在重复的节点 id: "${id}"`);
      return;
    }
    nodeIds.add(id);

    const typeRaw = typeof rawNode.type === "string" ? rawNode.type.trim() : "";
    if (!VALID_NODE_TYPE_SET.has(typeRaw)) {
      errors.push(
        `节点 "${id}" 的 type "${typeRaw}" 不支持，允许类型: ${WORKFLOW_NODE_TYPES.join(", ")}`,
      );
      return;
    }

    if (rawNode.config !== undefined && !isPlainRecord(rawNode.config)) {
      errors.push(`节点 "${id}" 的 config 必须是对象`);
      return;
    }

    const node: WorkflowNodeDef = {
      id,
      type: typeRaw as WorkflowNodeType,
      ...(typeof rawNode.name === "string" && rawNode.name.trim()
        ? { name: rawNode.name.trim() }
        : {}),
      ...(typeof rawNode.description === "string" && rawNode.description.trim()
        ? { description: rawNode.description.trim() }
        : {}),
      config: isPlainRecord(rawNode.config) ? { ...rawNode.config } : {},
    };
    node.config = validateNodeConfig(node, errors);
    nodes.push(node);
  });

  const edges: WorkflowEdgeDef[] = [];
  const edgeIds = new Set<string>();
  const rawEdges = doc.edges === undefined ? [] : doc.edges;
  if (!Array.isArray(rawEdges)) {
    errors.push("edges 必须是数组");
  } else {
    rawEdges.forEach((rawEdge, index) => {
      if (!isPlainRecord(rawEdge)) {
        errors.push(`edges[${index}] 必须是对象`);
        return;
      }
      const from = typeof rawEdge.from === "string" ? rawEdge.from.trim() : "";
      const to = typeof rawEdge.to === "string" ? rawEdge.to.trim() : "";
      if (!from || !to) {
        errors.push(`edges[${index}] 必须包含 from 和 to`);
        return;
      }
      if (!nodeIds.has(from)) {
        errors.push(`edges[${index}] 的 from "${from}" 不存在`);
      }
      if (!nodeIds.has(to)) {
        errors.push(`edges[${index}] 的 to "${to}" 不存在`);
      }
      if (from === to) {
        errors.push(`edges[${index}] 不允许自环 "${from}" -> "${to}"`);
      }

      const when =
        typeof rawEdge.when === "string" && rawEdge.when.trim()
          ? rawEdge.when.trim()
          : typeof rawEdge.when === "boolean"
            ? String(rawEdge.when)
            : undefined;

      const label =
        typeof rawEdge.label === "string" && rawEdge.label.trim()
          ? rawEdge.label.trim()
          : undefined;

      let id =
        typeof rawEdge.id === "string" && rawEdge.id.trim()
          ? rawEdge.id.trim()
          : `e-${from}-${to}${when ? `-${when}` : ""}`;
      if (edgeIds.has(id)) {
        let suffix = 2;
        while (edgeIds.has(`${id}-${suffix}`)) {
          suffix++;
        }
        id = `${id}-${suffix}`;
      }
      edgeIds.add(id);

      edges.push({
        id,
        from,
        to,
        ...(when !== undefined ? { when } : {}),
        ...(label !== undefined ? { label } : {}),
      });
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Topological sort (Kahn's algorithm) for DAG validation
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    outgoing.set(node.id, []);
  }
  for (const edge of edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }

  const entryNodeIds = nodes
    .filter((n) => (inDegree.get(n.id) ?? 0) === 0)
    .map((n) => n.id);

  const queue: string[] = [...entryNodeIds];
  const topologicalOrder: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    topologicalOrder.push(current);
    for (const nextId of outgoing.get(current) ?? []) {
      const nextDegree = (inDegree.get(nextId) ?? 0) - 1;
      inDegree.set(nextId, nextDegree);
      if (nextDegree === 0) {
        queue.push(nextId);
      }
    }
  }

  if (topologicalOrder.length !== nodes.length) {
    const cyclic = nodes
      .filter((n) => !topologicalOrder.includes(n.id))
      .map((n) => n.id);
    return {
      valid: false,
      errors: [`Workflow 存在环路 (DAG 不允许闭环)，涉及节点: ${cyclic.join(", ")}`],
    };
  }

  return {
    valid: true,
    errors: [],
    workflow: {
      version,
      ...(name ? { name } : {}),
      ...(description ? { description } : {}),
      nodes,
      edges,
    },
    topologicalOrder,
    entryNodeIds,
  };
}

export function parseWorkflowYamlOrThrow(raw: string): WorkflowDefinition {
  const result = parseAndValidateWorkflowYaml(raw);
  if (!result.valid || !result.workflow) {
    throw new Error(result.errors.join("; "));
  }
  return result.workflow;
}

export function buildStarterWorkflowYaml(opts?: {
  name?: string;
  description?: string;
  eventCode?: string;
}): string {
  const name = opts?.name?.trim() || "plugin-workflow";
  const desc = opts?.description?.trim() || "声明式自动化工作流";
  const eventCode = opts?.eventCode?.trim() || "manual";
  return `version: 1
name: ${name}
description: ${desc}
nodes:
  - id: trigger
    type: trigger
    name: 事件触发
    config:
      event: ${eventCode}
  - id: prepare
    type: transform
    name: 整理上下文
    config:
      output:
        event: "{{trigger.event}}"
        summary: "{{trigger.summary}}"
        payload: "{{trigger.payload}}"
  - id: report
    type: notify
    name: 记录结果
    config:
      title: ${name}
      message: "已处理事件 {{steps.prepare.output.event}}: {{steps.prepare.output.summary}}"
      level: info
      kind: timeline
edges:
  - from: trigger
    to: prepare
  - from: prepare
    to: report
`;
}

export const DEFAULT_STARTER_WORKFLOW_YAML = buildStarterWorkflowYaml();
