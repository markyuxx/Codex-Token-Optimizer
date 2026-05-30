#!/usr/bin/env node

const { build, check, benchmark } = require("../src/build");
const { search, fileContext, symbolContext, staleness, summary } = require("../src/query");

function parseCli(argv) {
  const options = { root: process.env.AGENT_INDEX_ROOT || process.cwd() };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--root") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --root");
      }
      options.root = value;
      index += 1;
      continue;
    }
    positional.push(current);
  }

  return { options, positional };
}

function print(value) {
  if (typeof value === "string") console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

function main() {
  const { options, positional } = parseCli(process.argv.slice(2));
  const [command = "build", ...args] = positional;

  if (command === "build") {
    print(build(options.root));
    return;
  }
  if (command === "check") {
    print(check(options.root));
    return;
  }
  if (command === "benchmark") {
    print(benchmark(options.root));
    return;
  }
  if (command === "search" || command === "query") {
    print(search(options.root, args.join(" ")));
    return;
  }
  if (command === "file") {
    print(fileContext(options.root, args.join(" ")));
    return;
  }
  if (command === "symbol") {
    print(symbolContext(options.root, args.join(" ")));
    return;
  }
  if (command === "stale") {
    print(staleness(options.root, args));
    return;
  }
  if (command === "summary") {
    print(summary(options.root));
    return;
  }
  if (command === "mcp") {
    require("../src/mcp-server");
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
