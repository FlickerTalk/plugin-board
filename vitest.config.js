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
