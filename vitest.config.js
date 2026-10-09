// The plugin runs in a browser frame: its tests need a DOM, and the Ionic the app lends it. CSS is
// text: the fonts are declared from it, and the rest goes in the frame's document.
export default {
  test: { environment: "happy-dom", setupFiles: ["./ionic.setup.js"] },
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
