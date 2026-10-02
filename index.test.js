// The plugin's own tests (Plan §53, plan-board): the board as a document, where things are, the
// stroke, the live channel between two boards, the formulas, the catalogue, and the view against
// a fake core.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Board, FILE_FORMAT, FILE_MIME, LOCAL, REMOTE, Replay, bodyKey, fromBase64, metaKey, newId, toBase64 } from "./src/model.js";
import { boundsOfAll, camera, fit, hits, itemAt, pan, toScreen, toWorld, zoomAt } from "./src/geometry.js";
import { NIBS, outlineOf, pathOf, pathOfItem, strokeItem } from "./src/ink.js";
import { HELLO, Live, PART, Reassembler, SYNC, UPDATE, decode, encode, split } from "./src/live.js";
import { PALETTE, insert, render } from "./src/formula.js";
import { LANGUAGES, catalogueOf, t } from "./src/i18n.js";
import { fontFaces, imagePlacement, isBoardFile, measured, pacing, withoutFontFaces } from "./src/index.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a board", () => {
  it("holds items in drawing order, moves and removes them, and undoes what this phone did", () => {
    const board = new Board({ name: "Algebra" });
    const a = board.add({ kind: "text", x: 10, y: 10, text: "a" });
    const b = board.add({ kind: "formula", x: 50, y: 10, latex: "x^2" });
    expect(board.list().map((one) => one.id)).toEqual([a, b]);
    expect(board.list()[1].z).toBeGreaterThan(board.list()[0].z);
    board.raise(a);
    expect(board.list().map((one) => one.id)).toEqual([b, a]);
    expect(board.move(a, 5, -5)).toBe(true);
    expect(board.get(a)).toMatchObject({ x: 15, y: 5 });
    board.undo();
    expect(board.get(a)).toMatchObject({ x: 10, y: 10 });
    board.redo();
    expect(board.get(a)).toMatchObject({ x: 15, y: 5 });
    expect(board.remove(b)).toBe(true);
    expect(board.remove(b)).toBe(false);
    expect(board.move("nobody", 1, 1)).toBe(false);
    expect(() => board.add({ kind: "video", x: 0, y: 0 })).toThrow();
  });

  it("does not undo what came from the other side", () => {
    const board = new Board();
    board.add({ kind: "text", x: 0, y: 0, text: "theirs" }, REMOTE);
    expect(board.canUndo).toBe(false);
    board.add({ kind: "text", x: 0, y: 0, text: "mine" }, LOCAL);
    expect(board.canUndo).toBe(true);
    board.undo();
    expect(board.list().map((one) => one.text)).toEqual(["theirs"]);
  });

  it("keeps a log of everything that happened, and comes back from it as a file", () => {
    const board = new Board({ id: "b1", name: "Class 1", createdAt: 1000 });
    board.add({ kind: "text", x: 1, y: 2, text: "one" });
    board.add({ kind: "text", x: 3, y: 4, text: "two" });
    expect(board.log).toHaveLength(2);
    expect(board.log[0]).toMatchObject({ t: expect.any(Number), u: expect.any(String) });
    const json = board.serialize();
    const read = JSON.parse(json);
    expect(read).toMatchObject({ format: FILE_FORMAT, version: 1, id: "b1", name: "Class 1", createdAt: 1000 });
    expect(read.updates).toHaveLength(2);

    const back = Board.parse(json);
    expect(back.id).toBe("b1");
    expect(back.name).toBe("Class 1");
    expect(back.list().map((one) => one.text)).toEqual(["one", "two"]);
    expect(back.log).toHaveLength(2);
    expect(back.canUndo).toBe(false, "what was read is not undone");
    expect(Board.parse(json, { id: "copy" }).id).toBe("copy");
    expect(back.fileName()).toBe("Class 1.ftboard");
    expect(new Board({ name: "a/b:c" }).fileName()).toBe("a b c.ftboard");
    expect(JSON.parse(back.meta())).toMatchObject({ id: "b1", items: 2 });
  });

  it("rejects what is not a board and survives a broken log", () => {
    expect(Board.parse("nonsense")).toBeNull();
    expect(Board.parse(JSON.stringify({ format: "other" }))).toBeNull();
    expect(Board.parse(JSON.stringify({ format: FILE_FORMAT, version: 99 }))).toBeNull();
    const board = new Board();
    board.add({ kind: "text", x: 0, y: 0, text: "kept" });
    const json = JSON.parse(board.serialize());
    json.updates = [{ t: 1, u: "!!!not base64" }];
    // The snapshot still says what the board holds.
    expect(Board.parse(JSON.stringify(json))).toBeNull();
    json.updates = [];
    expect(Board.parse(JSON.stringify(json)).list().map((one) => one.text)).toEqual(["kept"]);
  });

  it("gives another board what it lacks, and no more", () => {
    const teacher = new Board({ id: "class" });
    const student = new Board({ id: "class" });
    teacher.add({ kind: "text", x: 0, y: 0, text: "first" });
    student.apply(teacher.diffFor(student.stateVector()));
    expect(student.list().map((one) => one.text)).toEqual(["first"]);
    teacher.add({ kind: "text", x: 0, y: 0, text: "second" });
    const diff = teacher.diffFor(student.stateVector());
    expect(diff.length).toBeLessThan(teacher.snapshot().length);
    student.apply(diff);
    expect(student.list().map((one) => one.text)).toEqual(["first", "second"]);
  });

  it("replays its life step by step", () => {
    const board = new Board();
    board.add({ kind: "text", x: 0, y: 0, text: "a" });
    board.add({ kind: "text", x: 0, y: 0, text: "b" });
    const id = board.add({ kind: "text", x: 0, y: 0, text: "c" });
    board.remove(id);
    const replay = new Replay(board.log);
    expect(replay.length).toBe(4);
    expect(replay.at(0).list()).toHaveLength(0);
    expect(replay.at(2).list().map((one) => one.text)).toEqual(["a", "b"]);
    expect(replay.at(3).list()).toHaveLength(3);
    expect(replay.at(4).list()).toHaveLength(2);
    expect(replay.timeAt(1)).toBe(board.log[1].t);
    expect(new Replay([]).timeAt(0)).toBeNull();
  });

  it("carries bytes as base64 and back, and names things in order", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    const big = new Uint8Array(100_000).map((_, at) => at % 256);
    expect(fromBase64(toBase64(big))).toEqual(big);
    expect(newId(1000) < newId(2000)).toBe(true);
    expect(metaKey("x")).toBe("board/x/meta");
    expect(bodyKey("x")).toBe("board/x/body");
  });
});

describe("the camera", () => {
  it("maps between the screen and the world and back", () => {
    const cam = camera({ x: 100, y: 50, zoom: 2 });
    expect(toWorld(cam, { x: 100, y: 50 })).toEqual({ x: 0, y: 0 });
    expect(toWorld(cam, { x: 300, y: 250 })).toEqual({ x: 100, y: 100 });
    expect(toScreen(cam, toWorld(cam, { x: 33, y: 44 }))).toEqual({ x: 33, y: 44 });
  });

  it("zooms around the finger, which stays over the same point of the world", () => {
    const cam = camera({ x: 20, y: 20, zoom: 1 });
    const finger = { x: 200, y: 300 };
    const before = toWorld(cam, finger);
    const zoomed = zoomAt(cam, 2, finger);
    expect(zoomed.zoom).toBe(2);
    expect(toWorld(zoomed, finger).x).toBeCloseTo(before.x);
    expect(toWorld(zoomed, finger).y).toBeCloseTo(before.y);
    expect(zoomAt(cam, 100, finger).zoom).toBe(8);
    expect(zoomAt(cam, 0.001, finger).zoom).toBe(0.1);
    expect(pan(cam, 5, -5)).toEqual({ x: 25, y: 15, zoom: 1 });
  });

  it("finds the item under a point, the topmost first, and fits everything in view", () => {
    const items = [
      { id: "a", x: 0, y: 0, w: 100, h: 100 },
      { id: "b", x: 50, y: 50, w: 100, h: 100 },
    ];
    expect(itemAt(items, { x: 75, y: 75 }).id).toBe("b");
    expect(itemAt(items, { x: 10, y: 10 }).id).toBe("a");
    expect(itemAt(items, { x: 500, y: 500 })).toBeNull();
    expect(hits(items[0], { x: -3, y: -3 })).toBe(true);
    expect(boundsOfAll(items)).toEqual({ x: 0, y: 0, w: 150, h: 150 });
    expect(boundsOfAll([])).toBeNull();
    const cam = fit(items, { w: 400, h: 400 }, 25);
    expect(cam.zoom).toBe(2, "never blown up beyond twice its size");
    expect(toScreen(cam, { x: 75, y: 75 })).toEqual({ x: 200, y: 200 });
    expect(fit([], { w: 400, h: 400 }).zoom).toBe(1);
  });
});

describe("a stroke", () => {
  it("becomes an item with its own corner and its points relative to it", () => {
    const item = strokeItem(
      [
        { x: 100, y: 100 },
        { x: 120, y: 105 },
        { x: 140, y: 100 },
      ],
      { color: "#111111", size: 6 },
    );
    expect(item.kind).toBe("ink");
    expect(item.x).toBeLessThanOrEqual(100);
    expect(item.y).toBeLessThanOrEqual(100);
    expect(item.w).toBeGreaterThan(30);
    expect(item.points[0][0]).toBeCloseTo(100 - item.x, 1);
    expect(item.points).toHaveLength(3);
    expect(pathOfItem(item)).toMatch(/^M .* Z$/);
    expect(strokeItem([], { color: "#111", size: 6 })).toBeNull();
  });

  it("is a dot when the finger did not move, and its outline closes", () => {
    const dot = strokeItem([{ x: 5, y: 5 }], { color: "#111", size: NIBS[0] });
    expect(dot).not.toBeNull();
    expect(dot.w).toBeGreaterThan(0);
    const outline = outlineOf([[0, 0, 0.5], [10, 0, 0.5]], 4);
    expect(outline.length).toBeGreaterThan(2);
    expect(pathOf(outline).endsWith("Z")).toBe(true);
    expect(pathOf([])).toBe("");
  });
});

describe("the live channel", () => {
  it("carries a message as base64 JSON, in parts when it is big", () => {
    const message = { k: UPDATE, board: "b", u: "x".repeat(100_000), t: 1 };
    const parts = split(message);
    expect(parts.length).toBeGreaterThan(2);
    for (const part of parts) expect(fromBase64(part).length).toBeLessThan(48 * 1024);
    const put = new Reassembler();
    let whole = null;
    for (const part of parts) whole = put.take(decode(part)) ?? whole;
    expect(whole).toEqual(message);
    expect(split({ k: HELLO, board: "b", sv: "" })).toHaveLength(1);
    expect(decode("not base64 at all")).toBeNull();
    expect(decode(encode({ nothing: true }))).toBeNull();
    expect(put.take({ k: PART, board: "b", id: "z", n: 2, i: 5, data: "" })).toBeNull();
  });

  it("brings two boards together: hello, sync, then every update as it happens", async () => {
    vi.useFakeTimers();
    const teacher = new Board({ id: "class" });
    const student = new Board({ id: "class" });
    teacher.add({ kind: "text", x: 0, y: 0, text: "before" });
    student.add({ kind: "text", x: 0, y: 0, text: "student's" });
    let toStudent;
    let toTeacher;
    const teacherLive = new Live(teacher, async (data) => (await toStudent(data), true));
    const studentLive = new Live(student, async (data) => (await toTeacher(data), true));
    toStudent = (data) => studentLive.hear(data);
    toTeacher = (data) => teacherLive.hear(data);

    await teacherLive.hello();
    expect(student.list().map((one) => one.text).sort()).toEqual(["before", "student's"]);
    expect(teacher.list().map((one) => one.text).sort()).toEqual(["before", "student's"]);

    teacher.add({ kind: "text", x: 0, y: 0, text: "during" });
    teacher.add({ kind: "text", x: 0, y: 0, text: "and more" });
    await vi.advanceTimersByTimeAsync(100);
    expect(student.list().map((one) => one.text)).toContain("during");
    expect(student.list().map((one) => one.text)).toContain("and more");
    // What arrived is not sent back: no echo, no loop.
    expect(teacherLive.queue).toHaveLength(0);
    expect(studentLive.queue).toHaveLength(0);

    // Something for another board, or something that is not ours, is ignored.
    expect(await studentLive.hear(encode({ k: UPDATE, board: "other", u: "" }))).toBeNull();
    expect(await studentLive.hear("garbage")).toBeNull();
    teacherLive.close();
    studentLive.close();
    vi.useRealTimers();
  });

  it("gives up when the other side is not reachable", async () => {
    const board = new Board({ id: "class" });
    const live = new Live(board, async () => false);
    expect(await live.hello()).toBe(false);
    live.close();
  });
});

describe("a formula", () => {
  it("is painted by KaTeX, and says when it is not one yet", () => {
    expect(render("\\frac{1}{2}").html).toContain("katex");
    expect(render("\\frac{1}{2}").error).toBeNull();
    const broken = render("\\frac{1}{");
    expect(broken.html).toBe("");
    expect(broken.error).toBeTruthy();
  });

  it("takes a key from the palette at the cursor, around what was chosen", () => {
    expect(insert("a+b", 3, 3, "\\sqrt{□}")).toEqual({ text: "a+b\\sqrt{}", cursor: 9 });
    expect(insert("a+b", 0, 3, "\\frac{□}{}")).toEqual({ text: "\\frac{a+b}{}", cursor: 9 });
    expect(insert("x", 1, 1, "\\pi ")).toEqual({ text: "x\\pi ", cursor: 5 });
    expect(PALETTE.length).toBeGreaterThan(20);
    for (const key of PALETTE) expect(render(key.latex.replace("□", "1")).error, key.latex).toBeNull();
  });
});

describe("the catalogue and the styles", () => {
  it("speaks the 21 languages of the app, with the same keys in each", () => {
    expect(LANGUAGES).toHaveLength(21);
    const keys = Object.keys(catalogueOf("en")).sort();
    for (const lang of LANGUAGES) expect(Object.keys(catalogueOf(lang)).sort(), lang).toEqual(keys);
    expect(t("es", "pen")).toBe("Rotulador");
    expect(t("pt-BR", "pen")).toBe("Caneta");
    expect(t("xx", "pen")).toBe("Pen");
  });

  it("points KaTeX's fonts at the ones the package carries, woff2 only, outside the shadow tree", () => {
    const css = '@font-face{font-family:KaTeX_Main;src:url(fonts/KaTeX_Main-Regular.woff2) format("woff2"),url(fonts/KaTeX_Main-Regular.woff) format("woff"),url(fonts/KaTeX_Main-Regular.ttf) format("truetype")}.katex{font:1em KaTeX_Main}';
    const faces = fontFaces(css);
    expect(faces).toBe('@font-face{font-family:KaTeX_Main;src:url(./dist/fonts/KaTeX_Main-Regular.woff2) format("woff2")}');
    expect(withoutFontFaces(css)).toBe(".katex{font:1em KaTeX_Main}");
  });

  it("measures, paces and places", () => {
    expect(measured({ width: 200, height: 40 }, 2)).toEqual({ w: 100, h: 20 });
    expect(pacing([{ t: 0 }, { t: 5000 }, { t: 5010 }], 1)).toBe(1500);
    expect(pacing([{ t: 0 }, { t: 5000 }, { t: 5010 }], 2)).toBe(60);
    expect(pacing([], 0)).toBe(60);
    expect(imagePlacement({ w: 1200, h: 600 }, { x: 100, y: 100 })).toEqual({ x: -200, y: -50, w: 600, h: 300 });
    expect(imagePlacement({ w: 100, h: 50 }, { x: 0, y: 0 })).toEqual({ x: -50, y: -25, w: 100, h: 50 });
    expect(isBoardFile({ name: "class.ftboard", mime: "application/octet-stream" })).toBe(true);
    expect(isBoardFile({ name: "x.png", mime: FILE_MIME })).toBe(true);
    expect(isBoardFile({ name: "x.png", mime: "image/png" })).toBe(false);
  });
});

describe("the manifest", () => {
  const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "module.json"), "utf8"));
  // The app's languages besides English (plugin-sdk's module.schema.json, `locales`).
  const APP_LANGUAGES = ["es", "pt", "fr", "de", "it", "ro", "ru", "uk", "pl", "tr", "ar", "hi", "bn", "id", "vi", "th", "ja", "ko", "zh-CN", "zh-TW"];
  const length = (text) => [...text].length;

  it("names and sums up the board in each of the app's languages, within the schema's limits", () => {
    expect(Object.keys(manifest.locales ?? {})).toEqual(APP_LANGUAGES);
    for (const lang of APP_LANGUAGES) {
      const { name, summary, ...rest } = manifest.locales[lang];
      expect(rest, lang).toEqual({});
      expect(name.trim(), lang).not.toBe("");
      expect(length(name), lang).toBeLessThanOrEqual(64);
      expect(summary.trim(), lang).not.toBe("");
      expect(length(summary), lang).toBeLessThanOrEqual(200);
    }
  });

  it("keeps English at the top level", () => {
    expect(manifest.name).toBe("Board");
    expect(manifest.summary).toBe("A whiteboard with ink, text and formulas: draw a class, send it, or give it live.");
  });
});

/** A fake core: records and the live channel in memory, as the frame's `ft` would answer. */
function fakeCore() {
  const records = new Map();
  const handlers = [];
  const heard = [];
  return {
    records,
    heard,
    open: (opening) => Promise.all(handlers.map((handler) => handler({ text: "", dark: false, lang: "en", file: null, ref: null, reminder: null, live: false, ...opening }))),
    ft: {
      onOpen: (handler) => handlers.push(handler),
      pickFile: vi.fn(async () => null),
      send: vi.fn(),
      save: vi.fn(async () => true),
      close: vi.fn(),
      records: {
        get: async (key) => records.get(key) ?? null,
        set: vi.fn(async (key, value) => (records.set(key, value), true)),
        forget: async (key) => records.delete(key),
        keys: async (prefix) => [...records.keys()].filter((key) => key.startsWith(prefix)).sort(),
        usage: async () => ({ used: 0, quota: 256_000_000 }),
      },
      live: {
        send: vi.fn(async () => true),
        onMessage: (handler) => heard.push(handler),
      },
    },
  };
}

describe("the view", () => {
  let core;
  let element;
  const inside = () => element.shadowRoot;
  const press = async (act, extra = "") => {
    const button = inside().querySelector(`[data-act="${act}"]${extra}`);
    if (!button) throw new Error(`no button ${act}`);
    button.click();
    await tick();
    await tick();
  };
  const touch = (type, x, y, id = 1) => {
    const event = new Event(type, { bubbles: true });
    Object.assign(event, { pointerId: id, clientX: x, clientY: y, pressure: 0.5 });
    inside().querySelector(".stage").dispatchEvent(event);
  };

  beforeEach(async () => {
    core = fakeCore();
    globalThis.ft = core.ft;
    globalThis.confirm = () => true;
    globalThis.prompt = () => "Renamed";
    document.body.innerHTML = "";
    element = document.createElement("ft-board");
    document.body.append(element);
    await core.open({});
  });

  it("starts with no boards, makes one, draws on it and keeps it", async () => {
    expect(inside().textContent).toContain("No boards yet");
    await press("new");
    expect(inside().querySelector(".stage")).not.toBeNull();
    expect(element.board.id).toBeTruthy();
    touch("pointerdown", 10, 10);
    touch("pointermove", 40, 20);
    touch("pointermove", 80, 10);
    touch("pointerup", 80, 10);
    expect(element.board.list()).toHaveLength(1);
    expect(element.board.list()[0].kind).toBe("ink");
    expect(inside().querySelectorAll("svg.item")).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(core.records.has(bodyKey(element.board.id))).toBe(true);
    expect(JSON.parse(core.records.get(metaKey(element.board.id))).items).toBe(1);
    await press("undo");
    expect(element.board.list()).toHaveLength(0);
    await press("back");
    expect(inside().querySelectorAll("li")).toHaveLength(1);
    await press("rename");
    expect(inside().textContent).toContain("Renamed");
    await press("delete");
    expect(inside().textContent).toContain("No boards yet");
    expect(core.records.size).toBe(0);
  });

  it("writes a text and a formula where the finger tapped, and edits the text again", async () => {
    await press("new");
    await press("tool", '[data-id="text"]');
    touch("pointerdown", 100, 100);
    touch("pointerup", 100, 100);
    await tick();
    const area = inside().querySelector("textarea");
    expect(area).not.toBeNull();
    area.value = "Theorem";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    await press("done");
    expect(element.board.list()[0]).toMatchObject({ kind: "text", text: "Theorem" });
    expect(inside().querySelector(".item.text").textContent).toBe("Theorem");

    await press("tool", '[data-id="formula"]');
    touch("pointerdown", 100, 200);
    touch("pointerup", 100, 200);
    await tick();
    await press("key", '[data-at="1"]');
    const formulaArea = inside().querySelector("textarea");
    expect(formulaArea.value).toBe("\\sqrt{}");
    formulaArea.value = "\\sqrt{2}";
    formulaArea.dispatchEvent(new Event("input", { bubbles: true }));
    expect(inside().querySelector("[data-preview]").innerHTML).toContain("katex");
    await press("done");
    expect(element.board.list()[1]).toMatchObject({ kind: "formula", latex: "\\sqrt{2}" });
    expect(inside().querySelector(".item.formula").innerHTML).toContain("katex");

    // A tap on the selected text opens it again; nothing typed removes it.
    await press("tool", '[data-id="select"]');
    element.sizes.set(element.board.list()[0].id, { w: 100, h: 30 });
    const world = element.cam;
    const screenX = 100 * world.zoom + world.x + 5;
    const screenY = 100 * world.zoom + world.y + 5;
    touch("pointerdown", screenX, screenY);
    touch("pointerup", screenX, screenY);
    expect(element.selected).toBe(element.board.list()[0].id);
    touch("pointerdown", screenX, screenY);
    touch("pointerup", screenX, screenY);
    await tick();
    expect(inside().querySelector("textarea").value).toBe("Theorem");
    await press("removeEdited");
    expect(element.board.list()).toHaveLength(1);
  });

  it("opens the panel only after the click that trails the tap, so the click cannot press a key", async () => {
    await press("new");
    await press("tool", '[data-id="text"]');
    touch("pointerdown", 100, 100);
    touch("pointerup", 100, 100);
    // The browser fires `click` right after `pointerup`: there is no panel yet to land on.
    expect(inside().querySelector("[data-panel]").hidden).toBe(true);
    expect(element.editing).toBeNull();
    await tick();
    expect(element.editing).toMatchObject({ kind: "text", id: null });
    expect(inside().querySelector("[data-panel]").hidden).toBe(false);
  });

  it("saves and sends the board as a file, and opens one received read-only", async () => {
    await press("new");
    element.board.name = "Class";
    element.board.add({ kind: "text", x: 0, y: 0, text: "x" });
    await press("send");
    expect(core.ft.send).toHaveBeenCalledWith("Class.ftboard", FILE_MIME, expect.any(String));
    const [, , data] = core.ft.send.mock.calls[0];
    await press("save");
    expect(core.ft.save).toHaveBeenCalled();

    core = fakeCore();
    globalThis.ft = core.ft;
    element = document.createElement("ft-board");
    document.body.append(element);
    await core.open({ file: { name: "Class.ftboard", mime: FILE_MIME, data } });
    expect(element.readOnly).toBe(true);
    expect(inside().querySelector(".item.text").textContent).toBe("x");
    expect(inside().querySelector('[data-act="tool"]')).toBeNull();
    touch("pointerdown", 10, 10);
    touch("pointermove", 50, 50);
    touch("pointerup", 50, 50);
    expect(element.board.list()).toHaveLength(1);
    await press("keep");
    expect(core.records.size).toBe(2);
    expect(inside().textContent).toContain("Kept in your boards");
    await press("replay");
    expect(inside().querySelector('input[name="step"]')).not.toBeNull();
    const slider = inside().querySelector('input[name="step"]');
    slider.value = "0";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    expect(inside().querySelectorAll(".item")).toHaveLength(0);
    await press("stopReplay");
    expect(inside().querySelectorAll(".item")).toHaveLength(1);
  });

  it("starts a new board from an image the user opened with it", async () => {
    core = fakeCore();
    globalThis.ft = core.ft;
    element = document.createElement("ft-board");
    document.body.append(element);
    await core.open({ file: { name: "photo.png", mime: "image/png", data: "iVBORw0KGgo=" } });
    await tick();
    expect(element.board.list()[0]).toMatchObject({ kind: "image" });
    expect(element.board.name).toBe("photo");
    expect(core.records.size).toBe(2);
  });

  it("goes live from a conversation, and the other side's board appears on its own", async () => {
    core = fakeCore();
    globalThis.ft = core.ft;
    element = document.createElement("ft-board");
    document.body.append(element);
    await core.open({ live: true });
    await press("new");
    element.board.add({ kind: "text", x: 0, y: 0, text: "lesson" });
    await press("live");
    expect(element.live).not.toBeNull();
    expect(core.ft.live.send).toHaveBeenCalled();
    const hello = core.ft.live.send.mock.calls[0][0];
    expect(decode(hello)).toMatchObject({ k: HELLO, board: element.board.id });

    // The student's phone: the same plugin, open in the same conversation, hears the hello.
    const other = fakeCore();
    globalThis.ft = other.ft;
    const student = document.createElement("ft-board");
    document.body.append(student);
    await other.open({ live: true });
    for (const handler of other.heard) await handler(hello);
    await tick();
    expect(student.board?.id).toBe(element.board.id);
    expect(student.live).not.toBeNull();
    const sync = other.ft.live.send.mock.calls[0][0];
    expect(decode(sync).k).toBe(SYNC);
    // Back on the teacher's phone, the student's sync fills in what it lacked (nothing) and
    // sends the lesson over.
    globalThis.ft = core.ft;
    for (const handler of core.heard) await handler(sync);
    const lesson = core.ft.live.send.mock.calls.at(-1)[0];
    expect(decode(lesson).k).toBe(SYNC);
    globalThis.ft = other.ft;
    for (const handler of other.heard) await handler(lesson);
    expect(student.board.list().map((one) => one.text)).toEqual(["lesson"]);
  });

  it("says when the other side is not reachable", async () => {
    core = fakeCore();
    core.ft.live.send = vi.fn(async () => false);
    globalThis.ft = core.ft;
    element = document.createElement("ft-board");
    document.body.append(element);
    await core.open({ live: true });
    await press("new");
    await press("live");
    expect(element.live).toBeNull();
    expect(inside().textContent).toContain("not reachable");
  });
});
