import { performance } from "node:perf_hooks";
import type { ComponentKindName } from "@circuit-platform/protocol";
import { createCanvasSceneProjector, createComponentDefinitionRegistry, type SimulationSnapshot } from "../src/canvas/index.ts";
import type { EditorSnapshot, Point } from "../src/editor/index.ts";

const WIDTH = 1920;
const HEIGHT = 1080;
const COMPONENT_COUNT = 500;
const WIRE_COUNT = 1000;
const DEFAULT_DURATION_MS = 5_000;
const FRAME_INTERVAL_MS = 1000 / 60;
const FRAME_BUDGET_MS = 20;

function makeSnapshot(): EditorSnapshot {
  const kinds: ComponentKindName[] = ["input", "and", "or", "not", "output"];
  const components = Array.from({ length: COMPONENT_COUNT }, (_, index) => {
    const column = index % 25;
    const row = Math.floor(index / 25);
    return {
      id: `component-${index}`,
      kind: kinds[index % kinds.length],
      displayName: `Component ${index + 1}`,
      position: { x: 32 + column * 74, y: 32 + row * 58 },
      lifecycle: "active" as const,
    };
  });
  const connections = Array.from({ length: WIRE_COUNT }, (_, index) => {
    const sourceIndex = index % COMPONENT_COUNT;
    const targetIndex = (sourceIndex + 1 + (index % 23)) % COMPONENT_COUNT;
    const source = components[sourceIndex]!;
    const target = components[targetIndex]!;
    const start = { x: source.position.x + 148, y: source.position.y + 42 };
    const end = { x: target.position.x, y: target.position.y + 42 };
    return {
      id: `wire-${index}`,
      source: { componentId: source.id, port: "out", point: start },
      target: { componentId: target.id, port: "in", point: end },
      // Explicit two-point routes keep the benchmark focused on projection and interaction.
      route: [start, end],
      lifecycle: "visible" as const,
      danglingEndpoints: [],
    };
  });
  return {
    document: { components, connections },
    selection: null,
    operation: "idle",
    canUndo: false,
    canRedo: false,
    confirmation: null,
    error: null,
  };
}

function parseOption(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  const parsed = argument ? Number(argument.slice(prefix.length)) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(`--${flag}`);
}

function percentile(values: readonly number[], percentage: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((percentage / 100) * sorted.length) - 1);
  return sorted[index]!;
}

function signalSnapshot(frame: number): SimulationSnapshot {
  const signals: Record<string, 0 | 1 | "X"> = {};
  for (let index = 0; index < COMPONENT_COUNT; index += 1) {
    signals[`component-${index}:out`] = frame % 2 === 0 ? 0 : 1;
  }
  return { signals };
}

function dragPreview(frame: number): Readonly<Record<string, Point>> {
  return {
    "component-0": { x: 32 + (frame % 20), y: 32 },
  };
}

async function main(): Promise<void> {
  const durationMs = parseOption("duration-ms", DEFAULT_DURATION_MS);
  const mode = process.argv.find((value) => value.startsWith("--mode="))?.slice("--mode=".length) ?? "pan";
  if (mode !== "pan" && mode !== "drag") throw new Error("--mode must be pan or drag");
  const snapshot = makeSnapshot();
  const projector = createCanvasSceneProjector(createComponentDefinitionRegistry());
  const samples: number[] = [];
  const started = performance.now();
  let frame = 0;
  while (performance.now() - started < durationMs) {
    const frameStarted = performance.now();
    projector.project(snapshot, signalSnapshot(frame), mode === "drag" ? dragPreview(frame) : undefined);
    samples.push(performance.now() - frameStarted);
    frame += 1;
    // Keep the workload close to a real 60 Hz interaction without including sleep in frame cost.
    const nextFrameAt = started + frame * FRAME_INTERVAL_MS;
    const remaining = nextFrameAt - performance.now();
    if (remaining > 1) await new Promise((resolve) => setTimeout(resolve, remaining));
  }
  const p95 = percentile(samples, 95);
  const result = {
    viewport: `${WIDTH}x${HEIGHT}`,
    components: COMPONENT_COUNT,
    wires: WIRE_COUNT,
    mode,
    durationMs: Math.round(performance.now() - started),
    frames: samples.length,
    p95FrameMs: Number(p95.toFixed(3)),
    maxFrameMs: Number(Math.max(...samples).toFixed(3)),
    budgetMs: FRAME_BUDGET_MS,
    pass: p95 <= FRAME_BUDGET_MS,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.pass && !hasFlag("no-fail")) process.exitCode = 1;
}

void main();
