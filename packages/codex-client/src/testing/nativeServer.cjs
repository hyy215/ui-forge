// Test-only JSONL peer: replay explicit native messages without a task implementation.
const fs = require("node:fs");
const readline = require("node:readline");
const scenario = JSON.parse(fs.readFileSync("scenario.json", "utf8"));
fs.writeFileSync("argv.json", JSON.stringify(process.argv.slice(2)));
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
let initialized = false;
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  fs.appendFileSync("wire.jsonl", line + "\n");
  if (request.method === "initialize") {
    send({
      id: request.id,
      result: {
        userAgent: "fixture",
        codexHome: "/fixture",
        platformFamily: "unix",
        platformOs: "macos",
      },
    });
    return;
  }
  if (request.method === "initialized") {
    initialized = true;
    return;
  }
  if (!request.method) return;
  if (!initialized) throw new Error("Request received before initialized");
  const step = scenario.steps.shift();
  if (!step || step.method !== request.method)
    throw new Error("Unexpected fixture request: " + request.method);
  for (const message of step.before ?? []) send(message);
  if (step.raw) process.stdout.write(step.raw);
  if (step.exit) {
    process.exit(2);
    return;
  }
  if (step.hang) return;
  setTimeout(() => {
    const message = step.error
      ? { id: request.id, error: step.error }
      : { id: request.id, result: step.result };
    if (step.fragment) {
      const bytes = Buffer.from(JSON.stringify(message) + "\n");
      for (let index = 0; index < bytes.length; index++)
        process.stdout.write(bytes.subarray(index, index + 1));
    } else send(message);
    for (const message of step.after ?? []) send(message);
  }, step.delay ?? 0);
});
