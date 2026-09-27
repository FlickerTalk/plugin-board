// Formulas: written in LaTeX, painted by KaTeX (MIT), with a palette for whoever does not know
// LaTeX. A template has a `□` where the cursor goes next.

import katex from "katex";

/** The palette: what it shows, and what it writes. `□` marks where the cursor lands. */
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

/** A template put into a text at the cursor: the new text, and where the cursor goes. */
export function insert(text, selectionStart, selectionEnd, template) {
  const chosen = text.slice(selectionStart, selectionEnd);
  const hole = template.indexOf("□");
  const filled = hole >= 0 ? template.replace("□", chosen) : template;
  const next = text.slice(0, selectionStart) + filled + text.slice(selectionEnd);
  const cursor = hole >= 0 ? selectionStart + hole + chosen.length : selectionStart + filled.length;
  return { text: next, cursor };
}

/** A formula as HTML, or the error KaTeX found, as text. Never throws. */
export function render(latex, { display = true } = {}) {
  try {
    return { html: katex.renderToString(latex, { displayMode: display, throwOnError: true, output: "html", strict: "ignore" }), error: null };
  } catch (error) {
    return { html: "", error: String(error?.message ?? error).replace(/^KaTeX parse error: /, "") };
  }
}
