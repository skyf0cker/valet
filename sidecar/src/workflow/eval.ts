/**
 * Pure expression, template, and DAG type definitions for Valet workflows.
 * IMPORTANT: This module intentionally has ZERO Node/Bun/external imports so it
 * can safely execute inside Vercel Workflow's sandboxed QuickJS flow VM as
 * well as regular step/manager code.
 */

export const WORKFLOW_NODE_TYPES = [
  "trigger",
  "script",
  "http",
  "tool",
  "agent",
  "condition",
  "transform",
  "sleep",
  "approval",
  "notify",
] as const;

export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

export const WORKFLOW_CONDITION_OPS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "exists",
  "truthy",
] as const;

export type WorkflowConditionOp = (typeof WORKFLOW_CONDITION_OPS)[number];

export interface WorkflowConditionExpr {
  path: string;
  op: WorkflowConditionOp;
  value?: unknown;
}

export interface WorkflowNodeDef {
  id: string;
  type: WorkflowNodeType;
  name?: string;
  description?: string;
  config?: Record<string, unknown>;
}

export interface WorkflowEdgeDef {
  id: string;
  from: string;
  to: string;
  when?: string;
  label?: string;
}

export interface WorkflowDefinition {
  version: number;
  name?: string;
  description?: string;
  nodes: WorkflowNodeDef[];
  edges: WorkflowEdgeDef[];
}

export interface WorkflowTemplateScope {
  trigger: unknown;
  config: Record<string, unknown>;
  steps: Record<string, { output?: unknown; status?: string }>;
  [key: string]: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const tag = Object.prototype.toString.call(value);
  return tag === "[object Object]";
}

/**
 * Resolves a dot/bracket path like `trigger.payload.usage` or `steps.check.output.items[0].name`
 * against the supplied scope object.
 */
export function getValueByPath(scope: unknown, rawPath: string): unknown {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return undefined;
  }
  const segments: string[] = [];
  const tokenRegex = /[^.[\]]+|\[(\d+|"[^"]*"|'[^']*')\]/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(trimmed)) !== null) {
    let part = match[1] ?? match[0];
    if (
      (part.startsWith('"') && part.endsWith('"')) ||
      (part.startsWith("'") && part.endsWith("'"))
    ) {
      part = part.slice(1, -1);
    }
    segments.push(part);
  }

  let current: unknown = scope;
  for (const seg of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) {
        return undefined;
      }
      current = current[idx];
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return current;
}

function stringifyTemplateValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Recursively resolves `{{path}}` templates in strings, arrays, and plain objects.
 * When a string is strictly `{{path}}` (with optional inner spaces), the resolved
 * typed value is returned directly without coercing numbers/booleans/objects to strings.
 */
export function resolveTemplate(value: unknown, scope: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const exactMatch = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
    if (exactMatch) {
      return getValueByPath(scope, exactMatch[1] ?? "");
    }
    return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_full, expr: string) =>
      stringifyTemplateValue(getValueByPath(scope, expr)),
    );
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplate(item, scope));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = resolveTemplate(v, scope);
    }
    return out;
  }
  return value;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (
    a !== null &&
    b !== null &&
    typeof a === "object" &&
    typeof b === "object"
  ) {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Evaluates a structured condition expression against a workflow scope.
 */
export function evaluateCondition(
  expr: WorkflowConditionExpr | Record<string, unknown> | undefined,
  scope: Record<string, unknown>,
): { result: boolean; actual: unknown; expected: unknown } {
  if (!expr || typeof expr !== "object") {
    return { result: false, actual: undefined, expected: undefined };
  }
  const path = typeof expr.path === "string" ? expr.path : "";
  const op = (typeof expr.op === "string" ? expr.op : "truthy") as WorkflowConditionOp;
  const actual = getValueByPath(scope, path);
  const expected =
    "value" in expr ? resolveTemplate(expr.value, scope) : undefined;

  let result = false;
  switch (op) {
    case "exists":
      result = actual !== undefined && actual !== null;
      break;
    case "truthy":
      result = Boolean(actual);
      break;
    case "eq":
      result = valuesEqual(actual, expected);
      break;
    case "neq":
      result = !valuesEqual(actual, expected);
      break;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const numA = toFiniteNumber(actual);
      const numB = toFiniteNumber(expected);
      if (numA !== undefined && numB !== undefined) {
        if (op === "gt") result = numA > numB;
        else if (op === "gte") result = numA >= numB;
        else if (op === "lt") result = numA < numB;
        else result = numA <= numB;
      }
      break;
    }
    case "contains": {
      if (typeof actual === "string") {
        result = actual.includes(stringifyTemplateValue(expected));
      } else if (Array.isArray(actual)) {
        result = actual.some((item) => valuesEqual(item, expected));
      } else if (actual && typeof actual === "object") {
        result = stringifyTemplateValue(expected) in (actual as Record<string, unknown>);
      }
      break;
    }
    default:
      result = false;
  }

  return { result, actual, expected };
}
