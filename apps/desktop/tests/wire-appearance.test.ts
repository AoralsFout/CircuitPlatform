import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WIRE_COLOR,
  DEFAULT_WIRE_COLOR_STORAGE_KEY,
  WIRE_COLOR_PRESETS,
  readDefaultWireColor,
  writeDefaultWireColor,
} from "../src/editor/index.ts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

test("wire appearance exposes a small preset palette and persists the new-wire default", () => {
  const storage = new MemoryStorage();
  assert.equal(WIRE_COLOR_PRESETS.length, 5);
  assert.equal(readDefaultWireColor(storage), DEFAULT_WIRE_COLOR);
  assert.equal(writeDefaultWireColor(storage, "green"), "green");
  assert.equal(storage.getItem(DEFAULT_WIRE_COLOR_STORAGE_KEY), "green");
  assert.equal(readDefaultWireColor(storage), "green");
});

test("invalid persisted wire colors fall back without leaking arbitrary CSS values", () => {
  const storage = new MemoryStorage();
  storage.setItem(DEFAULT_WIRE_COLOR_STORAGE_KEY, "url(javascript:bad)");
  assert.equal(readDefaultWireColor(storage), DEFAULT_WIRE_COLOR);
});
