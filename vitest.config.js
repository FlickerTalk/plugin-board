// The plugin runs in a browser frame: its tests need a DOM. CSS is text: the fonts are declared
// from it, and the rest goes inside the shadow tree.
export default {
  test: { environment: "happy-dom" },
  plugins: [
    {
      name: "css-as-text",
      enforce: "pre",
      transform(code, id) {
        if (id.endsWith(".css")) return { code: `export default ${JSON.stringify(code)};`, map: null };
      },
    },
  ],
};
