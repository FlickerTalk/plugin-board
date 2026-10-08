// The live class (plan-board phase 2): what this board says to its twin on the other phone over
// `ft.live`, the direct channel the core opens between the same plugin on both sides. Nothing of
// it goes through the server: the core sends it only over the direct connection, encrypted as
// every message is. The protocol is small: hello (what I have), sync (what you lack), update.

import { fromBase64, toBase64 } from "./model.js";

/** What one message may carry, in bytes once decoded, below what the core allows (48 KiB). */
export const PART_SIZE = 40_000;

/** The kinds of message. Anything else is ignored. */
export const HELLO = "hello";
export const SYNC = "sync";
export const UPDATE = "update";
export const PART = "part";
export const BYE = "bye";
/** A follower that just opened asks the presenter to say hello again (Plugin API 1.6.0). */
export const ASK = "ask";

/** A message as it travels: JSON, then base64, as `ft.live.send` wants it. */
export function encode(message) {
  return toBase64(new TextEncoder().encode(JSON.stringify(message)));
}

/** A message read back; null when it is not one of ours. */
export function decode(data) {
  try {
    const message = JSON.parse(new TextDecoder().decode(fromBase64(data)));
    if (!message || typeof message.k !== "string" || typeof message.board !== "string") return null;
    return message;
  } catch {
    return null;
  }
}

/** A message with a payload too big for one send, cut into parts the other side puts together. */
export function split(message) {
  const whole = encode(message);
  if (whole.length <= PART_SIZE) return [whole];
  const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const count = Math.ceil(whole.length / PART_SIZE);
  const parts = [];
  for (let at = 0; at < count; at += 1) {
    parts.push(encode({ k: PART, board: message.board, id, n: count, i: at, data: whole.slice(at * PART_SIZE, (at + 1) * PART_SIZE) }));
  }
  return parts;
}

/** Puts parts back together; `take` returns the whole message once the last part is in. */
export class Reassembler {
  constructor() {
    this.pending = new Map();
  }

  take(message) {
    if (message.k !== PART) return message;
    if (typeof message.id !== "string" || typeof message.n !== "number" || typeof message.i !== "number" || typeof message.data !== "string") return null;
    let parts = this.pending.get(message.id);
    if (!parts) {
      parts = new Array(message.n).fill(null);
      this.pending.set(message.id, parts);
    }
    if (message.i < 0 || message.i >= parts.length) return null;
    parts[message.i] = message.data;
    if (parts.some((one) => one === null)) return null;
    this.pending.delete(message.id);
    return decode(parts.join(""));
  }
}

/**
 * The live session of one board: what to say when it starts, what to say when the board changes,
 * and what to do with what arrives. `send(data)` is `ft.live.send`; `board` is the Board.
 */
export class Live {
  constructor(board, send) {
    this.board = board;
    this.send = send;
    this.reassembler = new Reassembler();
    this.synced = false;
    this.queue = [];
    this.timer = null;
    this.stop = board.onUpdate((update, origin) => {
      if (origin === "remote-live") return;
      this.queue.push(update);
      this.flushSoon();
    });
  }

  /** Says hello: what this side has, so the other sends only what is missing. */
  async hello() {
    return this.say({ k: HELLO, board: this.board.id, sv: toBase64(this.board.stateVector()) });
  }

  /** Says hello as if for the first time: a follower that came back has nothing yet. */
  async restart() {
    this.synced = false;
    return this.hello();
  }

  async say(message) {
    for (const part of split(message)) {
      if (!(await this.send(part))) return false;
    }
    return true;
  }

  flushSoon() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 80);
  }

  /** Sends the updates gathered since the last time, as one. */
  async flush() {
    this.timer = null;
    if (!this.queue.length) return;
    const updates = this.queue.splice(0);
    const merged = updates.length === 1 ? updates[0] : (await import("yjs")).mergeUpdates(updates);
    await this.say({ k: UPDATE, board: this.board.id, u: toBase64(merged), t: Date.now() });
  }

  /** What arrived from the twin. Returns what kind it was, for the view; null if ignored. */
  async hear(data) {
    const raw = decode(data);
    if (!raw) return null;
    const message = this.reassembler.take(raw);
    if (!message || message.board !== this.board.id) return null;
    if (message.k === HELLO && typeof message.sv === "string") {
      // The other side says what it has: send the rest, and ask for what I lack in turn.
      const diff = this.board.diffFor(fromBase64(message.sv));
      await this.say({ k: SYNC, board: this.board.id, u: toBase64(diff), sv: toBase64(this.board.stateVector()) });
      return HELLO;
    }
    if (message.k === SYNC && typeof message.u === "string") {
      this.board.apply(fromBase64(message.u), "remote-live");
      if (!this.synced && typeof message.sv === "string") {
        this.synced = true;
        const diff = this.board.diffFor(fromBase64(message.sv));
        if (diff.length > 2) await this.say({ k: SYNC, board: this.board.id, u: toBase64(diff) });
      }
      return SYNC;
    }
    if (message.k === UPDATE && typeof message.u === "string") {
      this.board.apply(fromBase64(message.u), "remote-live");
      return UPDATE;
    }
    if (message.k === BYE) return BYE;
    return null;
  }

  async bye() {
    await this.say({ k: BYE, board: this.board.id });
  }

  close() {
    this.stop();
    if (this.timer) clearTimeout(this.timer);
  }
}
