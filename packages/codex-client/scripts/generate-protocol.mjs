/** 从本机 Codex 生成类型和 JSON Schema；此脚本只选择协议入口，不手写协议字段。 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const methods = {
  initialize: "Initialize",
  "thread/start": "ThreadStart",
  "thread/resume": "ThreadResume",
  "thread/read": "ThreadRead",
  "thread/list": "ThreadList",
  "thread/turns/list": "ThreadTurnsList",
  "thread/items/list": "ThreadItemsList",
  "turn/start": "TurnStart",
  "turn/steer": "TurnSteer",
  "turn/interrupt": "TurnInterrupt",
  "review/start": "ReviewStart",
  "config/read": "ConfigRead",
  "account/read": "GetAccount",
  "mcpServerStatus/list": "ListMcpServerStatus",
  "skills/list": "SkillsList",
  "skills/extraRoots/set": "SkillsExtraRootsSet",
};
const executable = process.env.UI_FORGE_CODEX_PATH || "codex";
const version = execFileSync(executable, ["--version"], { encoding: "utf8" })
  .trim()
  .replace(/^codex-cli /, "");
const temporary = mkdtempSync(join(tmpdir(), "ui-forge-native-protocol-"));
const output = fileURLToPath(new URL("../src/generated/", import.meta.url));
try {
  const types = join(temporary, "types");
  const schemas = join(temporary, "schemas");
  execFileSync(executable, ["app-server", "generate-ts", "--experimental", "--out", types]);
  execFileSync(executable, [
    "app-server",
    "generate-json-schema",
    "--experimental",
    "--out",
    schemas,
  ]);
  const clientMethods = Object.fromEntries(
    Object.entries(methods).map(([method, name]) => [
      method,
      {
        params: `${method === "initialize" ? "" : "v2/"}${name}Params`,
        result: `${method === "initialize" ? "" : "v2/"}${name}Response`,
      },
    ]),
  );
  const source = readFileSync(join(types, "ServerRequest.ts"), "utf8");
  const notificationMethods = [
    ...readFileSync(join(types, "ServerNotification.ts"), "utf8").matchAll(/"method": "([^"]+)"/g),
  ].map((match) => match[1]);
  const serverReplies = Object.fromEntries(
    [...source.matchAll(/\{ "method": "([^"]+)", id: RequestId, params: (\w+)/g)].map(
      ([, method, name]) => {
        const imported = source.match(new RegExp(`import type \\{ ${name} \\} from "([^"]+)"`));
        if (!imported) throw new Error(`Missing native request import: ${name}`);
        return [method, imported[1].replace(/^\.\//, "").replace(/Params$/, "Response")];
      },
    ),
  );
  const roots = [
    ...Object.values(clientMethods).flatMap(({ params, result }) => [params, result]),
    ...Object.values(serverReplies),
    "ServerRequest",
    "ServerNotification",
  ];
  const symbol = (path) => path.replaceAll(/[^a-zA-Z0-9_]/g, "_");
  const declarations = new Map();
  function collect(path) {
    if (declarations.has(path)) return;
    declarations.set(path, "");
    const filename = join(types, `${path}.ts`);
    let source = readFileSync(filename, "utf8");
    const names = new Map();
    for (const [, name, imported] of source.matchAll(/import type \{ (\w+) \} from "([^"]+)";/g)) {
      const target = relative(types, resolve(dirname(filename), imported));
      collect(target);
      names.set(name, symbol(target));
    }
    const exports = [...source.matchAll(/export type (\w+)/g)];
    if (exports.length !== 1) throw new Error(`Unexpected native type module: ${path}`);
    names.set(exports[0][1], symbol(path));
    source = source
      .replace(/^import type .*;$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\/\/.*$/gm, "");
    // Generated modules contain type aliases only. Preserve string literals while qualifying type identifiers.
    source = source.replace(
      /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b[A-Za-z_$][\w$]*\b/g,
      (token) => names.get(token) ?? token,
    );
    declarations.set(path, source.trim().replace(/\n\s*\n/g, "\n"));
  }
  roots.forEach(collect);
  const aggregate = JSON.parse(
    readFileSync(join(schemas, "codex_app_server_protocol.schemas.json"), "utf8"),
  );
  const available = { ...aggregate.definitions };
  delete available.v2;
  for (const [key, value] of Object.entries(aggregate.definitions.v2))
    available[`v2/${key}`] = value;
  const definitions = {};
  function schema(path) {
    const key = symbol(path);
    if (Object.hasOwn(definitions, key)) return;
    const original = available[path] ?? available[path.replace(/^v2\//, "")];
    if (!original) throw new Error(`Missing native schema: ${path}`);
    definitions[key] = {};
    function normalize(value) {
      if (Array.isArray(value)) return value.map(normalize);
      if (value === null || typeof value !== "object") return value;
      return Object.fromEntries(
        Object.entries(value).map(([name, item]) => {
          if (name !== "$ref" || typeof item !== "string") return [name, normalize(item)];
          const dependency = item.replace(/^#\/definitions\//, "");
          schema(dependency);
          return [name, `#/definitions/${symbol(dependency)}`];
        }),
      );
    }
    definitions[key] = normalize(original);
  }
  roots.forEach(schema);
  mkdirSync(output, { recursive: true });
  const clientTypes = Object.entries(clientMethods)
    .map(
      ([method, value]) =>
        `  ${JSON.stringify(method)}: { params: ${symbol(value.params)}; result: ${symbol(value.result)} };`,
    )
    .join("\n");
  const replyTypes = Object.entries(serverReplies)
    .map(([method, path]) => `  ${JSON.stringify(method)}: ${symbol(path)};`)
    .join("\n");
  writeFileSync(
    join(output, "native.ts"),
    `// Generated from Codex CLI ${version}. Run npm run generate:protocol -w @ui-forge/codex-client.\n${[...declarations.values()].join("\n")}\nexport type NativeMethods = {\n${clientTypes}\n};\nexport type NativeReplies = {\n${replyTypes}\n};\n`,
  );
  writeFileSync(
    join(output, "schemas.json"),
    JSON.stringify({
      version,
      notificationMethods,
      clientMethods: Object.fromEntries(
        Object.entries(clientMethods).map(([method, value]) => [
          method,
          { params: symbol(value.params), result: symbol(value.result) },
        ]),
      ),
      serverReplies: Object.fromEntries(
        Object.entries(serverReplies).map(([method, path]) => [method, symbol(path)]),
      ),
      definitions,
    }) + "\n",
  );
  process.stdout.write(`Generated native protocol for Codex ${version}.\n`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
