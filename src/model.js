import * as Y from "yjs";

export const PREFIX = "board/";
export const FILE_MIME = "application/x-ftboard";
export const FILE_FORMAT = "ftboard";
export const FILE_VERSION = 1;

export const LOCAL = "local";
export const REMOTE = "remote";

const CAPTURE = 300;

// Time first, so ids sort in creation order.
export function newId(now = Date.now()) {
  const random = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, "0");
  return `${now.toString(36).padStart(9, "0")}${random}`;
}

export const metaKey = (id) => `${PREFIX}${id}/meta`;
export const bodyKey = (id) => `${PREFIX}${id}/body`;

export function toBase64(bytes) {
  let text = "";
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

export function fromBase64(text) {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let at = 0; at < raw.length; at += 1) bytes[at] = raw.charCodeAt(at);
  return bytes;
}

export const KINDS = ["ink", "text", "formula", "image"];

export class Board {
  constructor({ id = newId(), name = "", createdAt = Date.now() } = {}) {
    this.id = id;
    this.name = name;
    this.createdAt = createdAt;
    this.updatedAt = createdAt;
    this.doc = new Y.Doc();
    this.items = this.doc.getMap("items");
    this.log = [];
    this.listeners = new Set();
    this.undoManager = new Y.UndoManager(this.items, { trackedOrigins: new Set([LOCAL]), captureTimeout: CAPTURE });
    this.doc.on("update", (update, origin) => {
      const entry = { t: Date.now(), u: toBase64(update) };
      this.log.push(entry);
      this.updatedAt = entry.t;
      for (const listener of this.listeners) listener(update, origin, entry);
    });
  }

  onUpdate(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onChange(listener) {
    this.items.observe(listener);
    return () => this.items.unobserve(listener);
  }

  list() {
    const all = [];
    for (const [id, item] of this.items.entries()) all.push({ ...item, id });
    return all.sort((a, b) => (a.z ?? 0) - (b.z ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  get(id) {
    const item = this.items.get(id);
    return item ? { ...item, id } : null;
  }

  add(item, origin = LOCAL) {
    if (!KINDS.includes(item.kind)) throw new Error(`not a kind of item: ${item.kind}`);
    const id = item.id ?? newId();
    const top = this.list().reduce((max, one) => Math.max(max, one.z ?? 0), 0);
    const { id: _, ...rest } = item;
    this.doc.transact(() => this.items.set(id, { z: top + 1, ...rest }), origin);
    this.undoManager.stopCapturing();
    return id;
  }

  change(id, fields, origin = LOCAL) {
    const item = this.items.get(id);
    if (!item) return false;
    this.doc.transact(() => this.items.set(id, { ...item, ...fields }), origin);
    this.undoManager.stopCapturing();
    return true;
  }

  move(id, dx, dy, origin = LOCAL) {
    const item = this.items.get(id);
    if (!item) return false;
    return this.change(id, { x: item.x + dx, y: item.y + dy }, origin);
  }

  remove(id, origin = LOCAL) {
    if (!this.items.has(id)) return false;
    this.doc.transact(() => this.items.delete(id), origin);
    this.undoManager.stopCapturing();
    return true;
  }

  // Infinity makes Yjs fold every erase until endStep() into one undo, however long the gesture.
  beginStep() {
    this.undoManager.stopCapturing();
    this.undoManager.captureTimeout = Infinity;
  }

  endStep() {
    this.undoManager.captureTimeout = CAPTURE;
    this.undoManager.stopCapturing();
  }

  erase(id, origin = LOCAL) {
    if (!this.items.has(id)) return false;
    this.doc.transact(() => this.items.delete(id), origin);
    return true;
  }

  raise(id, origin = LOCAL) {
    const top = this.list().reduce((max, one) => Math.max(max, one.z ?? 0), 0);
    return this.change(id, { z: top + 1 }, origin);
  }

  undo() {
    this.undoManager.undo();
  }

  redo() {
    this.undoManager.redo();
  }

  get canUndo() {
    return this.undoManager.canUndo();
  }

  get canRedo() {
    return this.undoManager.canRedo();
  }

  snapshot() {
    return Y.encodeStateAsUpdate(this.doc);
  }

  stateVector() {
    return Y.encodeStateVector(this.doc);
  }

  diffFor(stateVector) {
    return Y.encodeStateAsUpdate(this.doc, stateVector);
  }

  apply(update, origin = REMOTE) {
    Y.applyUpdate(this.doc, update, origin);
  }

  serialize() {
    return JSON.stringify({
      format: FILE_FORMAT,
      version: FILE_VERSION,
      id: this.id,
      name: this.name,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      snapshot: toBase64(this.snapshot()),
      updates: this.log,
    });
  }

  meta() {
    return JSON.stringify({ id: this.id, name: this.name, createdAt: this.createdAt, updatedAt: this.updatedAt, items: this.items.size });
  }

  static parse(json, { id } = {}) {
    let read;
    try {
      read = typeof json === "string" ? JSON.parse(json) : json;
    } catch {
      return null;
    }
    if (!read || read.format !== FILE_FORMAT || typeof read.version !== "number" || read.version > FILE_VERSION) return null;
    const board = new Board({
      id: id ?? (typeof read.id === "string" && read.id ? read.id : newId()),
      name: typeof read.name === "string" ? read.name : "",
      createdAt: typeof read.createdAt === "number" ? read.createdAt : Date.now(),
    });
    const updates = Array.isArray(read.updates) ? read.updates.filter((one) => one && typeof one.t === "number" && typeof one.u === "string") : [];
    const quiet = board.listeners;
    board.listeners = new Set();
    try {
      // The snapshot fills in whatever a broken log is missing.
      for (const entry of updates) Y.applyUpdate(board.doc, fromBase64(entry.u), REMOTE);
      if (typeof read.snapshot === "string" && read.snapshot) Y.applyUpdate(board.doc, fromBase64(read.snapshot), REMOTE);
    } catch {
      return null;
    }
    board.listeners = quiet;
    board.log = updates.length ? updates : board.log;
    board.updatedAt = typeof read.updatedAt === "number" ? read.updatedAt : board.createdAt;
    board.undoManager.clear();
    return board;
  }

  fileName() {
    const clean = (this.name || "board").replace(/[\\/:*?"<>|\n]+/g, " ").trim().slice(0, 60) || "board";
    return `${clean}.ftboard`;
  }
}

export class Replay {
  constructor(log) {
    this.log = log.filter((one) => one && typeof one.u === "string");
  }

  get length() {
    return this.log.length;
  }

  timeAt(index) {
    if (!this.log.length) return null;
    return this.log[Math.max(0, Math.min(this.log.length - 1, index))].t;
  }

  at(count) {
    const board = new Board();
    const quiet = board.listeners;
    board.listeners = new Set();
    for (const entry of this.log.slice(0, Math.max(0, count))) {
      try {
        Y.applyUpdate(board.doc, fromBase64(entry.u), REMOTE);
      } catch {
        // skip a broken entry
      }
    }
    board.listeners = quiet;
    return board;
  }
}
