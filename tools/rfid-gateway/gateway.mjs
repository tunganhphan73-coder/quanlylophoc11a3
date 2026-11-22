import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const config = await readFile(new URL("./config.json", import.meta.url), "utf8")
  .then(JSON.parse)
  .catch(() => ({}));
const appUrl = process.env.RFID_APP_URL ?? config.appUrl;
const readerToken = process.env.RFID_READER_TOKEN ?? config.readerToken;
const host = process.env.RFID_GATEWAY_HOST ?? config.listenHost ?? "127.0.0.1";
const port = Number(process.env.RFID_GATEWAY_PORT ?? config.listenPort ?? 8787);

if (!appUrl || !readerToken || readerToken.length < 32) {
  throw new Error("Configure RFID_APP_URL and RFID_READER_TOKEN, or create config.json from config.example.json.");
}

const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST" || request.url !== "/scan") {
    response.writeHead(404).end("Not found");
    return;
  }

  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 2048) {
      response.writeHead(413).end("Payload too large");
      request.destroy();
      return;
    }
  }

  let scan;
  try {
    scan = JSON.parse(body);
  } catch {
    response.writeHead(400).end("Invalid JSON");
    return;
  }
  if (typeof scan.tid !== "string" && typeof scan.epc !== "string") {
    response.writeHead(400).end("A tid or epc string is required");
    return;
  }

  try {
    const upstream = await fetch(appUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${readerToken}`,
      },
      body: JSON.stringify({ tid: scan.tid, epc: scan.epc, scanned_at: scan.scanned_at }),
      signal: AbortSignal.timeout(7000),
    });
    const text = await upstream.text();
    response.writeHead(upstream.status, { "Content-Type": "application/json; charset=utf-8" }).end(text);
  } catch {
    response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" })
      .end(JSON.stringify({ error: "Không kết nối được máy chủ điểm danh." }));
  }
});

server.listen(port, host, () => {
  console.log(`RFID gateway listening on http://${host}:${port}/scan`);
});
