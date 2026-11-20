import React, { useMemo } from "react";
import dagre from "@dagrejs/dagre";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import type {
  WorkflowEdgeRunState,
  WorkflowGraphDefinition,
  WorkflowNodeRunState,
} from "../../../types/valet";
import {
  WorkflowCanvasNode,
  type ValetCanvasNodeData,
} from "./WorkflowCanvasNode";

const NODE_TYPES = {
  valetNode: WorkflowCanvasNode,
};

const NODE_WIDTH = 216;
const NODE_HEIGHT = 82;

interface WorkflowCanvasProps {
  definition?: WorkflowGraphDefinition;
  nodeStates?: WorkflowNodeRunState[];
  edgeStates?: WorkflowEdgeRunState[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}

export const WorkflowCanvas: React.FC<WorkflowCanvasProps> = ({
  definition,
  nodeStates,
  edgeStates,
  selectedNodeId,
  onSelectNode,
}) => {
  const hasActiveRun = Boolean(nodeStates && nodeStates.length > 0);

  const { nodes, edges } = useMemo(() => {
    if (!definition || definition.nodes.length === 0) {
      return { nodes: [] as Node[], edges: [] as Edge[] };
    }

    const nodeStateById = new Map<string, WorkflowNodeRunState>(
      (nodeStates ?? []).map((n) => [n.nodeId, n])
    );
    const edgeStateById = new Map<string, WorkflowEdgeRunState>(
      (edgeStates ?? []).map((e) => [e.edgeId, e])
    );

    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({
      rankdir: "LR",
      nodesep: 42,
      ranksep: 64,
      marginx: 24,
      marginy: 24,
    });

    for (const node of definition.nodes) {
      g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    }
    for (const edge of definition.edges) {
      g.setEdge(edge.from, edge.to);
    }
    dagre.layout(g);

    const rfNodes: Node[] = definition.nodes.map((node) => {
      const pos = g.node(node.id) ?? { x: 0, y: 0 };
      const data: ValetCanvasNodeData = {
        nodeId: node.id,
        nodeType: node.type,
        label: node.name?.trim() || node.id,
        description: node.description,
        runState: nodeStateById.get(node.id),
        hasActiveRun,
      };
      return {
        id: node.id,
        type: "valetNode",
        position: {
          x: pos.x - NODE_WIDTH / 2,
          y: pos.y - NODE_HEIGHT / 2,
        },
        selected: selectedNodeId === node.id,
        selectable: true,
        draggable: false,
        data,
      };
    });

    const rfEdges: Edge[] = definition.edges.map((edge) => {
      const st = edgeStateById.get(edge.id)?.status;
      const isTaken = hasActiveRun && st === "taken";
      const isSkipped = hasActiveRun && st === "skipped";
      const edgeLabel = edge.label || (edge.when ? `when: ${edge.when}` : undefined);

      return {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        label: edgeLabel,
        type: "smoothstep",
        animated:
          hasActiveRun &&
          isTaken &&
          (nodeStateById.get(edge.to)?.status === "running" ||
            nodeStateById.get(edge.to)?.status === "waiting_approval"),
        style: {
          stroke: isTaken
            ? "var(--ink-primary)"
            : isSkipped
              ? "var(--border-control)"
              : "var(--border-strong)",
          strokeWidth: isTaken ? 2 : 1.5,
          strokeDasharray: isSkipped ? "5 4" : undefined,
          opacity: isSkipped ? 0.5 : 1,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isTaken
            ? "var(--ink-primary)"
            : isSkipped
              ? "var(--border-control)"
              : "var(--border-strong)",
          width: 15,
          height: 15,
        },
      };
    });

    return { nodes: rfNodes, edges: rfEdges };
  }, [definition, nodeStates, edgeStates, selectedNodeId, hasActiveRun]);

  if (!definition || definition.nodes.length === 0) {
    return (
      <div className="flex h-[420px] items-center justify-center rounded-[10px] border border-dashed border-[var(--border-dash)] bg-[var(--bg-subtle)] text-[12px] text-[var(--ink-muted)]">
        暂无可渲染的 Workflow 节点，请先在「编辑 workflow.yaml」中定义节点与连线。
      </div>
    );
  }

  return (
    <div className="valet-workflow-canvas h-[420px] w-full overflow-hidden rounded-[10px] border border-[var(--border-light)] bg-[var(--bg-subtle)]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        fitView
        fitViewOptions={{ padding: 0.24, maxZoom: 1.05 }}
        minZoom={0.35}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_event, node) => onSelectNode(node.id)}
      >
        <Background gap={18} size={1} color="var(--border-light)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
};
