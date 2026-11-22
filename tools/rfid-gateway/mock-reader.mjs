const endpoint = process.env.RFID_GATEWAY_URL ?? "http://127.0.0.1:8787/scan";
const tid = process.argv[2] ?? "DEMO-TID-001";

const response = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ tid }),
});

console.log(`HTTP ${response.status}`);
console.log(await response.text());
