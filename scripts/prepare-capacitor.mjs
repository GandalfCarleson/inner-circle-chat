import { promises as fs } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const webDir = path.join(rootDir, "dist", "client");
const assetsDir = path.join(webDir, "assets");
const indexHtmlPath = path.join(webDir, "index.html");

async function statOrNull(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function findMainClientEntry() {
  const assetFiles = await fs.readdir(assetsDir);
  const candidates = await Promise.all(
    assetFiles
      .filter((fileName) => /^index-.*\.js$/.test(fileName))
      .map(async (fileName) => ({
        fileName,
        stat: await statOrNull(path.join(assetsDir, fileName)),
      })),
  );

  const sorted = candidates
    .filter((candidate) => candidate.stat)
    .sort((left, right) => right.stat.size - left.stat.size);

  if (sorted.length === 0) {
    throw new Error("Could not find a built client entry in dist/client/assets.");
  }

  return sorted[0].fileName;
}

async function findMainStylesheet() {
  const assetFiles = await fs.readdir(assetsDir);
  const stylesheet = assetFiles.find((fileName) => /^styles-.*\.css$/.test(fileName));
  if (!stylesheet) {
    throw new Error("Could not find the built stylesheet in dist/client/assets.");
  }

  return stylesheet;
}

async function main() {
  const entryScript = await findMainClientEntry();
  const stylesheet = await findMainStylesheet();

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#1F313B" />
    <title>Halo</title>
    <link rel="stylesheet" href="/assets/${stylesheet}" />
  </head>
  <body class="min-h-app">
    <script type="module" src="/assets/${entryScript}"></script>
  </body>
</html>
`;

  await fs.writeFile(indexHtmlPath, html, "utf8");
  console.log(`Prepared Capacitor web entry: dist/client/index.html -> ${entryScript}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
