const esbuild = require("esbuild")

const production = process.argv.includes("--production")
const watch = process.argv.includes("--watch")

const plugin = {
  name: "esbuild-problem-matcher",
  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started")
    })

    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        if (!location) {
          console.error(`✘ [ERROR] ${text}`)
          return
        }

        console.error(`✘ [ERROR] ${text}`)
        console.error(`    ${location.file}:${location.line}:${location.column}:`)
      })

      console.log("[watch] build finished")
    })
  },
}

async function main() {
  const ctx = await Promise.all([
    esbuild.context({
      entryPoints: ["src/extension.ts"],
      bundle: true,
      format: "cjs",
      minify: production,
      sourcemap: !production,
      sourcesContent: false,
      platform: "node",
      outfile: "dist/extension.js",
      external: ["vscode"],
      logLevel: "silent",
      plugins: [plugin],
    }),
    esbuild.context({
      entryPoints: ["src/panel/webview/index.tsx"],
      bundle: true,
      format: "iife",
      minify: production,
      sourcemap: !production,
      sourcesContent: false,
      platform: "browser",
      target: ["es2022"],
      jsx: "automatic",
      entryNames: "panel-webview",
      assetNames: "panel-webview-[name]",
      outdir: "dist",
      loader: {
        ".css": "css",
      },
      logLevel: "silent",
      plugins: [plugin],
    }),
    esbuild.context({
      entryPoints: ["src/sidebar/webview/index.tsx"],
      bundle: true,
      format: "iife",
      minify: production,
      sourcemap: !production,
      sourcesContent: false,
      platform: "browser",
      target: ["es2022"],
      jsx: "automatic",
      entryNames: "sidebar-webview",
      assetNames: "sidebar-webview-[name]",
      outdir: "dist",
      loader: {
        ".css": "css",
      },
      logLevel: "silent",
      plugins: [plugin],
    }),
  ])

  if (watch) {
    await Promise.all(ctx.map((item) => item.watch()))
    return
  }

  await Promise.all(ctx.map((item) => item.rebuild()))
  await Promise.all(ctx.map((item) => item.dispose()))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
