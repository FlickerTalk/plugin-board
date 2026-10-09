// A whiteboard for FlickerTalk (plan-board, phases 1 and 2): ink, text, formulas and images on an
// infinite canvas; kept on this phone, saved or sent as a `.ftboard` file, opened read-only on the
// other side, replayed stroke by stroke, and, from a conversation where both have the plugin,
// drawn live over the direct connection. Nothing leaves this frame but what the user sends.

import katexCss from "katex/dist/katex.min.css";
import { Board, FILE_MIME, LOCAL, PREFIX, Replay, bodyKey, fromBase64, metaKey, newId, toBase64 } from "./model.js";
import { MAX_ZOOM, MIN_ZOOM, boundsOf, camera, distance, fit, itemAt, middle, pan, toWorld, zoomAt } from "./geometry.js";
import { INKS, NIBS, outlineOf, pathOf, pathOfItem, strokeItem } from "./ink.js";
import { BYE, HELLO, Live, decode } from "./live.js";
import { PALETTE, insert, render } from "./formula.js";
import { t } from "./i18n.js";

export { Board, Replay, Live, strokeItem, render, insert, PALETTE };

/** The `@font-face` rules of a stylesheet, pointed at the fonts the package carries, woff2 only. */
export function fontFaces(css, base = "./dist/fonts/") {
  const faces = css.match(/@font-face\{[^}]*\}/g) ?? [];
  return faces
    .map((face) =>
      face.replace(/src:([^;}]*)/, (_, sources) => {
        const woff2 = sources.match(/url\(([^)]*\.woff2)\)\s*format\("woff2"\)/);
        if (!woff2) return `src:${sources}`;
        const file = woff2[1].replace(/^.*\//, "");
        return `src:url(${base}${file}) format("woff2")`;
      }),
    )
    .join("\n");
}

/** The stylesheet without its `@font-face` rules: what goes in the frame's document. */
export function withoutFontFaces(css) {
  return css.replace(/@font-face\{[^}]*\}/g, "");
}

/** The world a text or formula takes, measured on screen, back in world units. */
export function measured(rect, zoom) {
  return { w: Math.max(1, rect.width / zoom), h: Math.max(1, rect.height / zoom) };
}

/** The steps of a replay, paced as the class was but never slower than a breath. */
export function pacing(log, index, { min = 60, max = 1500 } = {}) {
  if (index <= 0 || index >= log.length) return min;
  const gap = log[index].t - log[index - 1].t;
  return Math.min(max, Math.max(min, Number.isFinite(gap) ? gap : min));
}

/** Where a picked image goes: scaled to fit a comfortable width, keeping its shape. */
export function imagePlacement(natural, at, limit = 600) {
  const scale = Math.min(1, limit / Math.max(1, natural.w, natural.h));
  const w = Math.max(1, Math.round(natural.w * scale));
  const h = Math.max(1, Math.round(natural.h * scale));
  return { x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2), w, h };
}

/** Whether a file the app hands over is a board, by its kind or its name. */
export function isBoardFile(file) {
  return Boolean(file && (file.mime === FILE_MIME || /\.ftboard$/i.test(file.name ?? "")));
}

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (one) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[one]);

// Ionic draws the window (the app lends it to the frame, app 1.6.0): its header, toolbars, buttons
// and content. This is only what is the board's own, with the app's colours through Ionic's
// variables, in light and dark.
const STYLE = `
ft-board { display: flex; flex-direction: column; font: 14px system-ui, sans-serif; color: var(--ion-text-color, #111); --paper: var(--ion-background-color, #fff); --line: var(--ion-border-color, #d8d8d8); --soft: var(--ion-color-medium, #666); --accent: var(--ion-color-danger, #e0562b); }
ft-board * { box-sizing: border-box; }
ft-board ion-content { flex: 1; }
ft-board .body { display: flex; flex-direction: column; height: 100%; }
ft-board ion-buttons { flex-wrap: wrap; }
ft-board .bar { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; padding: 4px 0; }
ft-board .grow { flex: 1; }
ft-board button {
  appearance: none; border: 1px solid currentColor; background: transparent; color: inherit;
  border-radius: 10px; min-width: 40px; height: 38px; font: inherit; padding: 0 8px; cursor: pointer; opacity: .75;
}
ft-board button.on { opacity: 1; box-shadow: inset 0 0 0 2px currentColor; }
ft-board .i { display: block; width: 20px; height: 20px; margin: auto; background: currentColor; -webkit-mask: var(--i) center/contain no-repeat; mask: var(--i) center/contain no-repeat; }
ft-board .ink { border: 0; min-width: 34px; }
ft-board .ink i { display: block; width: 20px; height: 20px; border-radius: 50%; margin: auto; }
ft-board .ink.on i { box-shadow: 0 0 0 2px var(--paper), 0 0 0 4px currentColor; }
ft-board .stage { position: relative; flex: 1; overflow: hidden; background: #fff; border-radius: 10px; touch-action: none; user-select: none; -webkit-user-select: none; min-height: 240px; color: #111; }
ft-board .world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
ft-board .item { position: absolute; }
ft-board svg.item { overflow: visible; }
ft-board .item.text { white-space: pre-wrap; line-height: 1.3; font-family: system-ui, sans-serif; min-width: 8px; min-height: 1em; }
ft-board .item.formula { white-space: nowrap; }
ft-board .item.formula .katex-display { margin: 0; }
ft-board img.item { pointer-events: none; }
ft-board .item.selected { outline: 2px dashed #1d6fd0; outline-offset: 4px; }
ft-board .preview { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
ft-board .zoom { position: absolute; right: 8px; bottom: 8px; display: flex; flex-direction: column; gap: 4px; }
ft-board .badge { position: absolute; left: 8px; top: 8px; background: rgba(0,0,0,.6); color: #fff; padding: 4px 8px; border-radius: 8px; font-size: 12px; pointer-events: none; }
ft-board .panel { border-top: 1px solid var(--line); padding: 6px 0 0; }
ft-board textarea, ft-board input[type="text"], ft-board input[type="search"] { font: inherit; color: inherit; background: transparent; border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; width: 100%; }
ft-board textarea { min-height: 72px; resize: vertical; }
ft-board .keys { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
ft-board .keys button { min-width: 38px; height: 34px; font-size: 15px; }
ft-board .preview-formula { min-height: 40px; padding: 6px; background: #fff; color: #111; border-radius: 10px; margin: 6px 0; overflow-x: auto; }
ft-board .warn { color: var(--accent); margin: 6px 0; }
ft-board .hint { color: var(--soft); font-size: 13px; margin: 4px 0; }
ft-board ul { list-style: none; margin: 0; padding: 0; }
ft-board li { display: flex; align-items: center; gap: 6px; border-bottom: 1px solid var(--line); }
ft-board li .open { flex: 1; text-align: start; border: 0; border-radius: 0; height: auto; padding: 10px 4px; opacity: 1; }
ft-board .title { font-weight: 600; }
ft-board .meta { color: var(--soft); font-size: 13px; }
ft-board .empty { color: var(--soft); text-align: center; padding: 40px 0; }
ft-board .timeline { display: flex; gap: 8px; align-items: center; padding: 6px 0; }
ft-board .timeline input { flex: 1; }
`;

/** An Ionicon in a button: Ionic's own `ion-icon` when the app lent it by name, else the one the
 *  app serves at `./icon/<name>.svg`, painted in the button's colour. Never a picture of ours. */
const icon = (name) =>
  globalThis.Ionicons?.map?.has(name)
    ? `<ion-icon slot="icon-only" name="${name}" aria-hidden="true"></ion-icon>`
    : `<i slot="icon-only" class="i" style="--i:url(./icon/${name}.svg)" aria-hidden="true"></i>`;

/** An Ionic button with an icon only: filled when it is the one in use. */
const button = (act, label, name, { id, on = false, danger = false, disabled = false, fill = "clear", color = "" } = {}) =>
  `<ion-button data-act="${act}" ${id === undefined ? "" : `data-id="${escape(id)}"`} fill="${on ? "solid" : fill}" ${danger ? 'color="danger"' : color ? `color="${color}"` : ""} aria-label="${escape(label)}" ${disabled ? "disabled" : ""}>${icon(name)}</ion-button>`;

let stylesLoaded = false;
/** KaTeX's styles and fonts and the board's own, once, in the frame's document: it holds only
 *  this plugin, and Ionic's global styles do not cross a shadow boundary. */
function loadStyles() {
  if (stylesLoaded || typeof document === "undefined") return;
  stylesLoaded = true;
  const style = document.createElement("style");
  style.textContent = `${fontFaces(katexCss)}\n${withoutFontFaces(katexCss)}\n${STYLE}`;
  document.head.append(style);
}

/** The plugin's view: the boards this phone keeps, one board, or its replay. */
class BoardElement extends HTMLElement {
  constructor() {
    super();
    this.lang = "en";
    this.screen = "home";
    this.boards = [];
    this.board = null;
    this.readOnly = false;
    this.mayLive = false;
    this.live = null;
    this.tool = "pen";
    this.ink = 0;
    this.nib = 1;
    this.cam = camera({ x: 20, y: 20 });
    this.selected = null;
    this.editing = null;
    this.pointers = new Map();
    this.gesture = null;
    this.nodes = new Map();
    this.sizes = new Map();
    this.replay = null;
    this.warning = "";
    this.saveTimer = null;
    this.stopBoard = [];
  }

  connectedCallback() {
    loadStyles();
    this.style.height = `${Math.max(480, (globalThis.screen?.availHeight ?? 800) - 150)}px`;
    this.view = this;
    this.addEventListener("click", (event) => this.onClick(event));
    this.addEventListener("input", (event) => this.onInput(event));
    this.addEventListener("change", (event) => this.onChange(event));
    globalThis.ft?.onOpen?.((opening) => this.onOpen(opening));
    globalThis.ft?.live?.onMessage?.((data) => this.onLiveMessage(data));
    this.paint();
  }

  // ---- What the app hands over ----

  async onOpen(opening) {
    this.lang = opening.lang || "en";
    this.mayLive = Boolean(opening.live);
    await this.loadList();
    if (opening.file) {
      if (isBoardFile(opening.file)) {
        const board = Board.parse(new TextDecoder().decode(fromBase64(opening.file.data)));
        if (board) return this.show(board, { readOnly: true });
      } else if (/^image\//.test(opening.file.mime)) {
        const board = new Board({ name: opening.file.name.replace(/\.[^.]+$/, "") });
        await this.placeImage(board, opening.file, { x: 300, y: 200 });
        await this.keep(board);
        return this.show(board);
      }
    }
    this.paint();
  }

  async loadList() {
    const keys = await globalThis.ft.records.keys(PREFIX);
    const boards = [];
    for (const key of keys) {
      if (!key.endsWith("/meta")) continue;
      try {
        const meta = JSON.parse(await globalThis.ft.records.get(key));
        if (meta && typeof meta.id === "string") boards.push(meta);
      } catch {
        // A broken meta record is left out of the list.
      }
    }
    this.boards = boards.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }

  async open(id) {
    const body = await globalThis.ft.records.get(bodyKey(id));
    const board = body ? Board.parse(body, { id }) : null;
    if (board) this.show(board);
  }

  /** Puts a board on screen, editable unless it is someone else's file. */
  show(board, { readOnly = false } = {}) {
    this.leaveBoard();
    this.board = board;
    this.readOnly = readOnly;
    this.selected = null;
    this.editing = null;
    this.warning = "";
    this.screen = "board";
    this.nodes.clear();
    this.sizes.clear();
    this.stopBoard.push(board.onChange(() => this.paintItems()));
    if (!readOnly) this.stopBoard.push(board.onUpdate(() => this.keepSoon()));
    this.paint();
    this.fitAll();
  }

  leaveBoard() {
    for (const stop of this.stopBoard) stop();
    this.stopBoard = [];
    if (this.live) {
      this.live.bye().catch(() => {});
      this.live.close();
      this.live = null;
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      if (this.board && !this.readOnly) this.keep(this.board).catch(() => {});
    }
    this.stopReplay();
  }

  // ---- Keeping boards ----

  keepSoon() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      if (this.board && !this.readOnly) await this.keep(this.board);
    }, 600);
  }

  async keep(board) {
    const kept = (await globalThis.ft.records.set(bodyKey(board.id), board.serialize())) && (await globalThis.ft.records.set(metaKey(board.id), board.meta()));
    const warning = kept ? "" : t(this.lang, "full");
    if (warning !== this.warning) {
      this.warning = warning;
      this.paintWarning();
    }
    return kept;
  }

  async forget(id) {
    await globalThis.ft.records.forget(bodyKey(id));
    await globalThis.ft.records.forget(metaKey(id));
    this.boards = this.boards.filter((one) => one.id !== id);
  }

  // ---- Live ----

  async toggleLive() {
    if (this.live) {
      await this.live.bye();
      this.live.close();
      this.live = null;
      this.paintBar();
      return;
    }
    this.live = new Live(this.board, (data) => globalThis.ft.live.send(data));
    const reached = await this.live.hello();
    if (!reached) {
      this.live.close();
      this.live = null;
      this.warning = t(this.lang, "liveGone");
      this.paintWarning();
    }
    this.paintBar();
  }

  /** What the twin says: for the open board, or a hello for one this phone does not have yet. */
  async onLiveMessage(data) {
    if (this.live) {
      const kind = await this.live.hear(data);
      if (kind === BYE) {
        this.live.close();
        this.live = null;
        this.paintBar();
      }
      return;
    }
    const message = decode(data);
    if (!message || message.k !== HELLO || !this.mayLive) return;
    let board = this.board && this.board.id === message.board ? this.board : null;
    if (!board) {
      const body = await globalThis.ft.records.get(bodyKey(message.board));
      board = body ? Board.parse(body, { id: message.board }) : new Board({ id: message.board, name: t(this.lang, "received") });
      this.show(board);
    }
    this.readOnly = false;
    this.live = new Live(board, (data) => globalThis.ft.live.send(data));
    await this.live.hear(data);
    this.paintBar();
  }

  /** Asks in the app's Ionic alert: the frame has no browser dialogs. Resolves {role, data}. */
  async ask(options) {
    const alerts = globalThis.ftIonic?.alertController;
    if (!alerts) return { role: "cancel" };
    const alert = await alerts.create(options);
    await alert.present();
    return alert.onDidDismiss();
  }

  // ---- Clicks ----

  async onClick(event) {
    const button = event.target.closest("button, ion-button");
    if (!button) return;
    const { act, id, at } = button.dataset;
    const T = (key) => t(this.lang, key);
    switch (act) {
      case "new": {
        const board = new Board({ name: "" });
        await this.keep(board);
        return this.show(board);
      }
      case "open":
        return this.open(id);
      case "delete": {
        const { role } = await this.ask({
          message: T("confirmDelete"),
          buttons: [
            { text: T("back"), role: "cancel" },
            { text: T("delete"), role: "destructive" },
          ],
        });
        if (role !== "destructive") return;
        await this.forget(id);
        return this.paint();
      }
      case "rename": {
        const board = this.boards.find((one) => one.id === id);
        const { role, data } = await this.ask({
          header: T("rename"),
          inputs: [{ name: "name", value: board?.name ?? "", placeholder: T("name"), attributes: { "aria-label": T("name") } }],
          buttons: [
            { text: T("back"), role: "cancel" },
            { text: T("done"), role: "confirm" },
          ],
        });
        if (role !== "confirm" || !board) return;
        const name = String(data?.values?.name ?? "");
        const body = await globalThis.ft.records.get(bodyKey(id));
        const whole = body ? Board.parse(body, { id }) : null;
        if (!whole) return;
        whole.name = name.trim();
        await this.keep(whole);
        await this.loadList();
        return this.paint();
      }
      case "back":
        this.leaveBoard();
        this.board = null;
        this.screen = "home";
        await this.loadList();
        return this.paint();
      case "tool":
        this.tool = id;
        this.selected = null;
        return this.paintBar(), this.paintItems();
      case "ink":
        this.ink = Number(at);
        return this.paintBar();
      case "nib":
        this.nib = (this.nib + 1) % NIBS.length;
        return this.paintBar();
      case "undo":
        this.board.undo();
        return this.paintBar();
      case "redo":
        this.board.redo();
        return this.paintBar();
      case "remove":
        if (this.selected) this.board.remove(this.selected);
        this.selected = null;
        return this.paintBar();
      case "image":
        return this.pickImage();
      case "zoomIn":
        return this.setCamera(zoomAt(this.cam, 1.25, this.stageCentre()));
      case "zoomOut":
        return this.setCamera(zoomAt(this.cam, 0.8, this.stageCentre()));
      case "fit":
        return this.fitAll();
      case "save":
        return globalThis.ft.save(this.board.fileName(), FILE_MIME, toBase64(new TextEncoder().encode(this.board.serialize())));
      case "send":
        return globalThis.ft.send(this.board.fileName(), FILE_MIME, toBase64(new TextEncoder().encode(this.board.serialize())));
      case "live":
        return this.toggleLive();
      case "keep": {
        const copy = Board.parse(this.board.serialize(), { id: newId() });
        if (!copy) return;
        copy.name = this.board.name || T("received");
        if (await this.keep(copy)) {
          this.warning = T("kept");
          this.paintWarning();
        }
        return;
      }
      case "replay":
        return this.startReplay();
      case "stopReplay":
        this.stopReplay();
        return this.paint();
      case "play":
        return this.togglePlay();
      case "key": {
        const area = this.view.querySelector("textarea");
        if (!area) return;
        const { text, cursor } = insert(area.value, area.selectionStart ?? area.value.length, area.selectionEnd ?? area.value.length, PALETTE[Number(at)].latex);
        area.value = text;
        area.setSelectionRange?.(cursor, cursor);
        area.focus?.();
        this.editing.value = text;
        return this.paintFormulaPreview();
      }
      case "done":
        return this.finishEditing();
      case "cancelEdit":
        this.editing = null;
        return this.paintPanel();
      case "removeEdited":
        if (this.editing?.id) this.board.remove(this.editing.id);
        this.editing = null;
        this.selected = null;
        return this.paintPanel(), this.paintBar();
      default:
    }
  }

  onInput(event) {
    const field = event.target;
    if (field.name === "edit" && this.editing) {
      this.editing.value = field.value;
      if (this.editing.kind === "formula") this.paintFormulaPreview();
    } else if (field.name === "step" && this.replay) {
      this.replay.index = Number(field.value);
      this.paintReplayFrame();
    }
  }

  onChange(event) {
    if (event.target.name === "step" && this.replay) {
      this.replay.index = Number(event.target.value);
      this.paintReplayFrame();
    }
  }

  // ---- Items ----

  async pickImage() {
    const file = await globalThis.ft.pickFile("image/*");
    if (!file) return;
    const centre = toWorld(this.cam, this.stageCentre());
    if (!(await this.placeImage(this.board, file, centre))) {
      this.warning = t(this.lang, "imageFailed");
      this.paintWarning();
    }
  }

  /** Puts a picked image on a board, at a world point, scaled to a readable size. */
  async placeImage(board, file, at) {
    const src = `data:${file.mime};base64,${file.data}`;
    const natural = await new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve({ w: image.naturalWidth || 400, h: image.naturalHeight || 300 });
      image.onerror = () => resolve(null);
      image.src = src;
      if (typeof image.decode !== "function" && !("onload" in image)) resolve({ w: 400, h: 300 });
    });
    if (!natural) return false;
    board.add({ kind: "image", ...imagePlacement(natural, at), src });
    return true;
  }

  startEditing(kind, id, at) {
    const item = id ? this.board.get(id) : null;
    this.editing = { kind, id, value: item ? (kind === "text" ? item.text : item.latex) : "", at };
    this.paintPanel();
    this.view.querySelector("textarea")?.focus?.();
  }

  finishEditing() {
    const edit = this.editing;
    if (!edit) return;
    const value = edit.value.trim();
    if (edit.id) {
      if (!value) this.board.remove(edit.id);
      else this.board.change(edit.id, edit.kind === "text" ? { text: value } : { latex: value });
    } else if (value) {
      const base = { x: Math.round(edit.at.x), y: Math.round(edit.at.y), color: INKS[this.ink] };
      this.board.add(edit.kind === "text" ? { kind: "text", ...base, text: value, size: 24 } : { kind: "formula", ...base, latex: value, size: 24 });
    }
    this.editing = null;
    this.paintPanel();
  }

  // ---- The camera ----

  stage() {
    return this.view.querySelector(".stage");
  }

  stageCentre() {
    const stage = this.stage();
    const box = stage?.getBoundingClientRect?.() ?? { width: 360, height: 480 };
    return { x: box.width / 2, y: box.height / 2 };
  }

  setCamera(cam) {
    this.cam = cam;
    const world = this.view.querySelector(".world");
    if (world) world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`;
  }

  fitAll() {
    const stage = this.stage();
    const box = stage?.getBoundingClientRect?.() ?? { width: 360, height: 480 };
    const items = this.shownItems();
    this.setCamera(items.length ? fit(items, { w: box.width || 360, h: box.height || 480 }) : camera({ x: 20, y: 20 }));
  }

  /** Where the pointer is, on the stage. */
  local(event) {
    const box = this.stage().getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  /** The items with the sizes measured on screen, for hit testing. */
  shownItems() {
    const source = this.replay ? this.replay.frame : this.board;
    if (!source) return [];
    return source.list().map((item) => (item.w ? item : { ...item, ...(this.sizes.get(item.id) ?? { w: 1, h: 1 }) }));
  }

  // ---- Pointers ----

  onPointerDown(event) {
    const stage = this.stage();
    stage.setPointerCapture?.(event.pointerId);
    const at = this.local(event);
    this.pointers.set(event.pointerId, at);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.gesture = { kind: "pinch", distance: distance(a, b), middle: middle(a, b), cam: this.cam };
      this.discardPreview();
      return;
    }
    const world = toWorld(this.cam, at);
    const editable = !this.readOnly && !this.replay;
    if (editable && this.tool === "pen") {
      this.gesture = { kind: "ink", points: [{ ...world, pressure: event.pressure || 0.5 }] };
      this.paintPreview();
    } else if (editable && (this.tool === "text" || this.tool === "formula")) {
      this.gesture = { kind: "place", at: world };
    } else if (editable && this.tool === "select") {
      const hit = itemAt(this.shownItems(), world);
      if (hit) {
        const again = this.selected === hit.id;
        this.selected = hit.id;
        this.gesture = { kind: "drag", id: hit.id, from: at, moved: false, again };
        this.paintItems();
      } else {
        this.selected = null;
        this.gesture = { kind: "pan", from: at, cam: this.cam };
        this.paintItems();
      }
    } else {
      this.gesture = { kind: "pan", from: at, cam: this.cam };
    }
  }

  onPointerMove(event) {
    if (!this.pointers.has(event.pointerId)) return;
    const at = this.local(event);
    this.pointers.set(event.pointerId, at);
    const gesture = this.gesture;
    if (!gesture) return;
    if (gesture.kind === "pinch" && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const now = distance(a, b);
      const mid = middle(a, b);
      const zoomed = zoomAt(gesture.cam, now / (gesture.distance || 1), gesture.middle);
      this.setCamera(pan(zoomed, mid.x - gesture.middle.x, mid.y - gesture.middle.y));
    } else if (gesture.kind === "ink") {
      gesture.points.push({ ...toWorld(this.cam, at), pressure: event.pressure || 0.5 });
      this.paintPreview();
    } else if (gesture.kind === "pan") {
      this.setCamera(pan(gesture.cam, at.x - gesture.from.x, at.y - gesture.from.y));
    } else if (gesture.kind === "drag") {
      const dx = (at.x - gesture.from.x) / this.cam.zoom;
      const dy = (at.y - gesture.from.y) / this.cam.zoom;
      if (Math.hypot(dx, dy) > 2) gesture.moved = true;
      const node = this.nodes.get(gesture.id);
      if (node && gesture.moved) node.style.translate = `${dx}px ${dy}px`;
    }
  }

  onPointerUp(event) {
    const at = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    const gesture = this.gesture;
    if (!gesture) return;
    if (gesture.kind === "pinch") {
      if (this.pointers.size < 2) this.gesture = null;
      return;
    }
    this.gesture = null;
    if (gesture.kind === "ink") {
      this.discardPreview();
      const item = strokeItem(gesture.points, { color: INKS[this.ink], size: NIBS[this.nib] });
      if (item) this.board.add(item);
      this.paintBar();
    } else if (gesture.kind === "place") {
      // The `click` that trails this tap fires before any timer: the panel is painted after it,
      // so the click lands on the stage and not on a key of the panel that was not there yet.
      setTimeout(() => this.startEditing(this.tool, null, gesture.at), 0);
    } else if (gesture.kind === "drag") {
      const node = this.nodes.get(gesture.id);
      if (node) node.style.translate = "";
      if (gesture.moved && at) {
        this.board.move(gesture.id, (at.x - gesture.from.x) / this.cam.zoom, (at.y - gesture.from.y) / this.cam.zoom);
      } else if (gesture.again) {
        const item = this.board.get(gesture.id);
        if (item && (item.kind === "text" || item.kind === "formula")) setTimeout(() => this.startEditing(item.kind, item.id), 0);
      }
      this.paintBar();
    }
  }

  onWheel(event) {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) this.setCamera(zoomAt(this.cam, event.deltaY < 0 ? 1.1 : 0.9, this.local(event)));
    else this.setCamera(pan(this.cam, -event.deltaX, -event.deltaY));
  }

  // ---- Replay ----

  startReplay() {
    if (!this.board || !this.board.log.length) return;
    this.replay = { steps: new Replay(this.board.log), index: this.board.log.length, playing: false, timer: null, frame: null };
    this.selected = null;
    this.editing = null;
    this.paint();
    this.paintReplayFrame();
  }

  stopReplay() {
    if (!this.replay) return;
    if (this.replay.timer) clearTimeout(this.replay.timer);
    this.replay = null;
    this.nodes.clear();
  }

  togglePlay() {
    const replay = this.replay;
    if (!replay) return;
    if (replay.playing) {
      replay.playing = false;
      if (replay.timer) clearTimeout(replay.timer);
      replay.timer = null;
    } else {
      replay.playing = true;
      if (replay.index >= replay.steps.length) replay.index = 0;
      this.stepReplay();
    }
    this.paintTimeline();
  }

  stepReplay() {
    const replay = this.replay;
    if (!replay || !replay.playing) return;
    if (replay.index >= replay.steps.length) {
      replay.playing = false;
      replay.timer = null;
      this.paintTimeline();
      return;
    }
    replay.index += 1;
    this.paintReplayFrame();
    replay.timer = setTimeout(() => this.stepReplay(), pacing(replay.steps.log, replay.index));
  }

  paintReplayFrame() {
    const replay = this.replay;
    if (!replay) return;
    replay.frame = replay.steps.at(replay.index);
    const slider = this.view.querySelector('input[name="step"]');
    if (slider && Number(slider.value) !== replay.index) slider.value = String(replay.index);
    const label = this.view.querySelector(".step");
    if (label) label.textContent = `${replay.index} / ${replay.steps.length}`;
    this.paintItems();
  }

  // ---- Painting ----

  paint() {
    if (this.screen === "board") this.paintBoard();
    else this.paintHome();
  }

  paintHome() {
    const T = (key) => t(this.lang, key);
    const rows = this.boards
      .map(
        (board) => `<li>
          <button class="open" data-act="open" data-id="${escape(board.id)}">
            <div class="title">${escape(board.name || T("untitled"))}</div>
            <div class="meta">${escape(new Date(board.updatedAt ?? board.createdAt ?? 0).toLocaleString(this.lang))}</div>
          </button>
          ${button("rename", T("rename"), "text-outline", { id: board.id })}
          ${button("delete", T("delete"), "trash-outline", { id: board.id, danger: true })}
        </li>`,
      )
      .join("");
    this.view.innerHTML = `
      <ion-header>
        <ion-toolbar>
          <ion-buttons slot="end">${button("new", T("newBoard"), "add-outline", { on: true })}</ion-buttons>
        </ion-toolbar>
      </ion-header>
      <ion-content>
        ${rows ? `<ul>${rows}</ul>` : `<p class="empty">${escape(T("empty"))}</p>`}
      </ion-content>`;
  }

  paintBoard() {
    const T = (key) => t(this.lang, key);
    // The board sizes itself to the screen: its content does not scroll, the stage pans instead.
    this.view.innerHTML = `
      <ion-header data-bar></ion-header>
      <ion-content scroll-y="false">
        <div class="body">
          <div class="stage">
            <div class="world"></div>
            <svg class="preview"></svg>
            <div class="zoom">
              ${button("zoomIn", T("zoomIn"), "add-outline", { fill: "solid", color: "light" })}
              ${button("zoomOut", T("zoomOut"), "remove-outline", { fill: "solid", color: "light" })}
              ${button("fit", T("fitAll"), "expand-outline", { fill: "solid", color: "light" })}
            </div>
            <span class="badge" data-badge hidden></span>
          </div>
          <p class="warn" data-warn hidden></p>
          <div class="timeline" data-timeline hidden></div>
          <div class="panel" data-panel hidden></div>
        </div>
      </ion-content>`;
    const stage = this.stage();
    stage.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    stage.addEventListener("pointermove", (event) => this.onPointerMove(event));
    stage.addEventListener("pointerup", (event) => this.onPointerUp(event));
    stage.addEventListener("pointercancel", (event) => this.onPointerUp(event));
    stage.addEventListener("wheel", (event) => this.onWheel(event), { passive: false });
    this.setCamera(this.cam);
    this.paintBar();
    this.paintItems();
    this.paintWarning();
    this.paintTimeline();
  }

  paintBar() {
    const bar = this.view.querySelector("[data-bar]");
    if (!bar || !this.board) return;
    const T = (key) => t(this.lang, key);
    const badge = this.view.querySelector("[data-badge]");
    if (this.replay) {
      this.setBar(bar, `<ion-toolbar>
        <ion-buttons slot="start">${button("stopReplay", T("back"), "arrow-back-outline")}</ion-buttons>
        <ion-title>${escape(T("replay"))}</ion-title>
      </ion-toolbar>`);
      if (badge) (badge.textContent = T("replay")), (badge.hidden = false);
      return;
    }
    if (this.readOnly) {
      this.setBar(bar, `<ion-toolbar>
        <ion-buttons slot="start">${button("back", T("back"), "arrow-back-outline")}</ion-buttons>
        <ion-buttons slot="end">
          ${button("replay", T("replay"), "play-outline", { disabled: !this.board.log.length })}
          ${button("keep", T("keepCopy"), "save-outline")}
        </ion-buttons>
      </ion-toolbar>`);
      if (badge) (badge.textContent = T("readOnly")), (badge.hidden = false);
      return;
    }
    if (badge) badge.hidden = !this.live;
    if (badge && this.live) badge.textContent = T("live");
    const tools = [
      ["select", "hand-left-outline"],
      ["pen", "pencil-outline"],
      ["text", "text-outline"],
      ["formula", "calculator-outline"],
    ]
      .map(([tool, name]) => button("tool", T(tool), name, { id: tool, on: this.tool === tool }))
      .join("");
    const inks = this.tool === "pen"
      ? INKS.map((colour, at) => `<button class="ink ${this.ink === at ? "on" : ""}" data-act="ink" data-at="${at}" aria-label="${escape(T("colour"))} ${at + 1}"><i style="background:${colour}"></i></button>`).join("") +
        button("nib", T("width"), "brush-outline", { on: this.nib > 0 })
      : "";
    // Three rows, as the bar wrapped before: the way back and what the board does with itself, the
    // tools, and the pen's colours while the pen is in use.
    this.setBar(bar, `
      <ion-toolbar>
        <ion-buttons slot="start">${button("back", T("back"), "arrow-back-outline")}</ion-buttons>
        <ion-buttons slot="end">
          ${this.mayLive ? button("live", this.live ? T("liveOn") : T("liveOff"), "play-outline", { on: Boolean(this.live) }) : ""}
          ${button("replay", T("replay"), "time-outline", { disabled: !this.board.log.length })}
          ${button("save", T("save"), "save-outline")}
          ${button("send", T("send"), "send-outline")}
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar>
        <ion-buttons slot="start">
          ${tools}
          ${button("image", T("image"), "image-outline")}
          ${button("undo", T("undo"), "arrow-undo-outline", { disabled: !this.board.canUndo })}
          ${button("redo", T("redo"), "arrow-redo-outline", { disabled: !this.board.canRedo })}
          ${this.selected ? button("remove", T("remove"), "trash-outline", { danger: true }) : ""}
        </ion-buttons>
      </ion-toolbar>
      ${inks ? `<ion-toolbar><ion-buttons slot="start">${inks}</ion-buttons></ion-toolbar>` : ""}`);
  }

  /** A new header in place of the old one, rather than new children in it: Ionic keeps its own
   *  bookkeeping of what is inside a header. */
  setBar(bar, html) {
    const header = document.createElement("ion-header");
    header.dataset.bar = "";
    header.innerHTML = html;
    bar.replaceWith(header);
  }

  /** The items on the stage: made, changed or removed by id, so a moving pen does not redraw all. */
  paintItems() {
    const world = this.view.querySelector(".world");
    if (!world) return;
    const source = this.replay ? this.replay.frame : this.board;
    const items = source ? source.list() : [];
    const seen = new Set();
    for (const item of items) {
      seen.add(item.id);
      const signature = JSON.stringify(item);
      let node = this.nodes.get(item.id);
      if (!node || node.dataset.signature !== signature) {
        const made = this.nodeOf(item);
        made.dataset.signature = signature;
        made.dataset.id = item.id;
        if (node) node.replaceWith(made);
        else world.append(made);
        node = made;
        this.nodes.set(item.id, node);
        if (item.kind === "text" || item.kind === "formula") this.measure(item.id, node);
      }
      node.style.zIndex = String(item.z ?? 0);
      node.classList.toggle("selected", this.selected === item.id);
    }
    for (const [id, node] of this.nodes) {
      if (!seen.has(id)) {
        node.remove();
        this.nodes.delete(id);
        this.sizes.delete(id);
      }
    }
  }

  measure(id, node) {
    const box = node.getBoundingClientRect?.();
    if (box && (box.width || box.height)) this.sizes.set(id, measured(box, this.cam.zoom));
    else this.sizes.set(id, { w: 120, h: 30 });
  }

  nodeOf(item) {
    if (item.kind === "ink") {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "item");
      svg.setAttribute("viewBox", `0 0 ${item.w} ${item.h}`);
      svg.setAttribute("width", String(item.w));
      svg.setAttribute("height", String(item.h));
      svg.style.left = `${item.x}px`;
      svg.style.top = `${item.y}px`;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathOfItem(item));
      path.setAttribute("fill", item.color ?? "#111");
      svg.append(path);
      return svg;
    }
    if (item.kind === "image") {
      const image = document.createElement("img");
      image.className = "item";
      image.src = item.src;
      image.style.left = `${item.x}px`;
      image.style.top = `${item.y}px`;
      image.style.width = `${item.w}px`;
      image.style.height = `${item.h}px`;
      image.draggable = false;
      return image;
    }
    const div = document.createElement("div");
    div.className = `item ${item.kind}`;
    div.style.left = `${item.x}px`;
    div.style.top = `${item.y}px`;
    div.style.color = item.color ?? "#111";
    div.style.fontSize = `${item.size ?? 24}px`;
    if (item.kind === "text") div.textContent = item.text ?? "";
    else {
      const { html, error } = render(item.latex ?? "");
      if (error) div.textContent = item.latex ?? "";
      else div.innerHTML = html;
    }
    return div;
  }

  paintPreview() {
    const preview = this.view.querySelector(".preview");
    const gesture = this.gesture;
    if (!preview || !gesture || gesture.kind !== "ink") return;
    const outline = outlineOf(gesture.points, NIBS[this.nib]);
    preview.innerHTML = `<path d="${pathOf(outline)}" fill="${INKS[this.ink]}"/>`;
    preview.style.transform = `translate(${this.cam.x}px, ${this.cam.y}px) scale(${this.cam.zoom})`;
    preview.style.transformOrigin = "0 0";
  }

  discardPreview() {
    const preview = this.view.querySelector(".preview");
    if (preview) preview.innerHTML = "";
    if (this.gesture?.kind === "ink") this.gesture = null;
  }

  paintWarning() {
    const warn = this.view.querySelector("[data-warn]");
    if (!warn) return;
    warn.textContent = this.warning;
    warn.hidden = !this.warning;
  }

  paintPanel() {
    const panel = this.view.querySelector("[data-panel]");
    if (!panel) return;
    const edit = this.editing;
    const T = (key) => t(this.lang, key);
    if (!edit) {
      panel.hidden = true;
      panel.innerHTML = "";
      return;
    }
    panel.hidden = false;
    const keys = edit.kind === "formula"
      ? `<div class="keys">${PALETTE.map((key, at) => `<button data-act="key" data-at="${at}" aria-label="${escape(key.latex)}">${escape(key.show)}</button>`).join("")}</div><div class="preview-formula" data-preview></div>`
      : "";
    panel.innerHTML = `
      <textarea name="edit" placeholder="${escape(T(edit.kind === "formula" ? "latexPlaceholder" : "textPlaceholder"))}" aria-label="${escape(T(edit.kind))}">${escape(edit.value)}</textarea>
      ${keys}
      <div class="bar">
        ${edit.id ? button("removeEdited", T("remove"), "trash-outline", { danger: true }) : ""}
        <span class="grow"></span>
        ${button("cancelEdit", T("back"), "close-outline")}
        ${button("done", T("done"), "checkmark-outline", { on: true })}
      </div>`;
    this.paintFormulaPreview();
  }

  paintFormulaPreview() {
    const preview = this.view.querySelector("[data-preview]");
    if (!preview || !this.editing) return;
    const { html, error } = render(this.editing.value);
    if (error) preview.innerHTML = `<span class="hint">${escape(this.editing.value ? `${t(this.lang, "formulaError")}: ${error}` : t(this.lang, "latexPlaceholder"))}</span>`;
    else preview.innerHTML = html;
  }

  paintTimeline() {
    const timeline = this.view.querySelector("[data-timeline]");
    if (!timeline) return;
    const replay = this.replay;
    if (!replay) {
      timeline.hidden = true;
      timeline.innerHTML = "";
      return;
    }
    const T = (key) => t(this.lang, key);
    timeline.hidden = false;
    timeline.innerHTML = `
      ${button("play", replay.playing ? T("pause") : T("play"), replay.playing ? "pause-outline" : "play-outline")}
      <input type="range" name="step" min="0" max="${replay.steps.length}" value="${replay.index}" aria-label="${escape(T("step"))}">
      <span class="step">${replay.index} / ${replay.steps.length}</span>`;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("ft-board")) customElements.define("ft-board", BoardElement);
