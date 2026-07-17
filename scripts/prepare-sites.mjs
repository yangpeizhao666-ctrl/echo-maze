import { cp, copyFile, mkdir, readdir, writeFile } from "node:fs/promises";

await mkdir("dist/client", { recursive: true });
for (const entry of await readdir("dist", { withFileTypes: true })) {
  if (entry.name === "client" || entry.name === "server" || entry.name === ".openai") continue;
  await cp(`dist/${entry.name}`, `dist/client/${entry.name}`, { recursive: true });
}

await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");

await writeFile(
  "dist/server/index.js",
  `export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;

    const accept = request.headers.get("accept") || "";
    const url = new URL(request.url);
    const looksLikePage = request.mode === "navigate" || accept.includes("text/html") || !url.pathname.includes(".");
    if (!looksLikePage) return response;

    url.pathname = "/index.html";
    return env.ASSETS.fetch(new Request(url, request));
  }
};
`,
  "utf8"
);
