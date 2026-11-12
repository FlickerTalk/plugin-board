import katex from "katex";

export const PALETTE = [
  { show: "a/b", latex: "\\frac{□}{}" },
  { show: "√", latex: "\\sqrt{□}" },
  { show: "xⁿ", latex: "^{□}" },
  { show: "xₙ", latex: "_{□}" },
  { show: "∑", latex: "\\sum_{□}^{}" },
  { show: "∫", latex: "\\int_{□}^{}" },
  { show: "lim", latex: "\\lim_{□ \\to }" },
  { show: "( )", latex: "\\left(□\\right)" },
  { show: "×", latex: "\\times " },
  { show: "·", latex: "\\cdot " },
  { show: "±", latex: "\\pm " },
  { show: "≤", latex: "\\le " },
  { show: "≥", latex: "\\ge " },
  { show: "≠", latex: "\\ne " },
  { show: "≈", latex: "\\approx " },
  { show: "→", latex: "\\to " },
  { show: "∞", latex: "\\infty " },
  { show: "π", latex: "\\pi " },
  { show: "α", latex: "\\alpha " },
  { show: "β", latex: "\\beta " },
  { show: "θ", latex: "\\theta " },
  { show: "λ", latex: "\\lambda " },
  { show: "Δ", latex: "\\Delta " },
  { show: "sin", latex: "\\sin(□)" },
  { show: "cos", latex: "\\cos(□)" },
  { show: "log", latex: "\\log(□)" },
  { show: "vec", latex: "\\vec{□}" },
  { show: "[ ]", latex: "\\begin{pmatrix} □ & \\\\ & \\end{pmatrix}" },
];

export function insert(text, selectionStart, selectionEnd, template) {
  const chosen = text.slice(selectionStart, selectionEnd);
  const hole = template.indexOf("□");
  const filled = hole >= 0 ? template.replace("□", chosen) : template;
  const next = text.slice(0, selectionStart) + filled + text.slice(selectionEnd);
  const cursor = hole >= 0 ? selectionStart + hole + chosen.length : selectionStart + filled.length;
  return { text: next, cursor };
}

export function render(latex, { display = true } = {}) {
  try {
    return { html: katex.renderToString(latex, { displayMode: display, throwOnError: true, output: "html", strict: "ignore" }), error: null };
  } catch (error) {
    return { html: "", error: String(error?.message ?? error).replace(/^KaTeX parse error: /, "") };
  }
}
