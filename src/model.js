// The board itself (plan-board phase 1): a CRDT document (Yjs) whose items are strokes, texts,
// formulas and images. Every change is an update; the list of updates, each with its time, is at
// once what is kept, what is sent, what a twin on the other phone applies, and the replay.

import * as Y from "yjs";

/** Where the plugin keeps its boards, one meta record and one body record each. */
export const PREFIX = "board/";
export const FILE_MIME = "application/x-ftboard";
export const FILE_FORMAT = "ftboard";
export const FILE_VERSION = 1;

/** The origin of what this phone does, so undo tracks only that and not what a twin says. */
export const LOCAL = "local";
export const REMOTE = "remote";

/** An id for a board or an item: time first, so a list sorts as things were made. */
export function newId(now = Date.now()) {
  const random = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, "0");
  return `${now.toString(36).padStart(9, "0")}${random}`;
}

export const metaKey = (id) => `${PREFIX}${id}/meta`;
export const bodyKey = (id) => `${PREFIX}${id}/body`;

/** Bytes as base64 and back; what a record, a file or the live channel carries. */
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

/** The kinds of item a board holds, and what each one needs to be one. */
export const KINDS = ["ink", "text", "formula", "image"];

/**
 * A board: a Yjs document with a map of items keyed by id, and the log of its updates. `log` is
 * everything that ever happened to it, in order, with the time; `snapshot()` is the state now.
 */
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
    this.undoManager = new Y.UndoManager(this.items, { trackedOrigins: new Set([LOCAL]), captureTimeout: 300 });
    this.doc.on("update", (update, origin) => {
      const entry = { t: Date.now(), u: toBase64(update) };
      this.log.push(entry);
      this.updatedAt = entry.t;
      for (const listener of this.listeners) listener(update, origin, entry);
    });
  }

  /** Hears every update: what this phone did (`LOCAL`), what came from a twin (`REMOTE`). */
  onUpdate(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Hears the items changing, for the view. */
  onChange(listener) {
    this.items.observe(listener);
    return () => this.items.unobserve(listener);
  }

  /** The items as plain objects, in drawing order (`z`, then the order they were made). */
  list() {
    const all = [];
    for (const [id, item] of this.items.entries()) all.push({ ...item, id });
    return all.sort((a, b) => (a.z ?? 0) - (b.z ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  get(id) {
    const item = this.items.get(id);
    return item ? { ...item, id } : null;
  }

  /** Adds an item of one of the kinds; returns its id. Positions and sizes are in world units. */
  add(item, origin = LOCAL) {
    if (!KINDS.includes(item.kind)) throw new Error(`not a kind of item: ${item.kind}`);
    const id = item.id ?? newId();
    const top = this.list().reduce((max, one) => Math.max(max, one.z ?? 0), 0);
    const { id: _, ...rest } = item;
    this.doc.transact(() => this.items.set(id, { z: top + 1, ...rest }), origin);
    this.undoManager.stopCapturing();
    return id;
  }

  /** Changes some fields of an item; the rest stays. Nothing happens if it is gone. */
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

  /** Puts an item on top of the others. */
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

  /** The whole state as one update: what a newcomer needs. */
  snapshot() {
    return Y.encodeStateAsUpdate(this.doc);
  }

  /** What this board has, so the other side can send only what is missing. */
  stateVector() {
    return Y.encodeStateVector(this.doc);
  }

  /** What the other side lacks, given its state vector. */
  diffFor(stateVector) {
    return Y.encodeStateAsUpdate(this.doc, stateVector);
  }

  /** Applies an update from elsewhere: a twin, a file, a record. */
  apply(update, origin = REMOTE) {
    Y.applyUpdate(this.doc, update, origin);
  }

  /** What is kept in the plugin's records: the state and the log, as JSON. */
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

  /** The meta record: enough for the list without reading the body. */
  meta() {
    return JSON.stringify({ id: this.id, name: this.name, createdAt: this.createdAt, updatedAt: this.updatedAt, items: this.items.size });
  }

  /** A board read back from `serialize()` or from a `.ftboard` file; null if it is not one. */
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
      // The log replays as it was, with the times it had; the snapshot covers what a broken log lacks.
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

  /** What a board is called as a file. */
  fileName() {
    const clean = (this.name || "board").replace(/[\\/:*?"<>|\n]+/g, " ").trim().slice(0, 60) || "board";
    return `${clean}.ftboard`;
  }
}

/**
 * The replay of a board (plan-board): the state at any moment of its life, from its log. The
 * moments are the times of the updates; `at(index)` is the board after the first `index` ones.
 */
export class Replay {
  constructor(log) {
    this.log = log.filter((one) => one && typeof one.u === "string");
  }

  get length() {
    return this.log.length;
  }

  /** The time of the update at `index`, or null when the log is empty. */
  timeAt(index) {
    if (!this.log.length) return null;
    return this.log[Math.max(0, Math.min(this.log.length - 1, index))].t;
  }

  /** A board holding the first `count` updates. */
  at(count) {
    const board = new Board();
    const quiet = board.listeners;
    board.listeners = new Set();
    for (const entry of this.log.slice(0, Math.max(0, count))) {
      try {
        Y.applyUpdate(board.doc, fromBase64(entry.u), REMOTE);
      } catch {
        // A broken entry is skipped: the replay shows what it can.
      }
    }
    board.listeners = quiet;
    return board;
  }
}
