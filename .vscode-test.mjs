import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "build/test/suite/**/*.test.js",
  mocha: {
    ui: "tdd",
    timeout: 20000,
  },
});
