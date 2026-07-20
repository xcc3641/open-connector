#!/usr/bin/env node
/**
 * Build / recreate the local OpenConnector Docker stack from source.
 *
 * Usage:
 *   npm run docker:local                 # build + up -d + wait healthy
 *   npm run docker:local -- --no-cache   # rebuild without cache
 *   npm run docker:local -- up           # same as default
 *   npm run docker:local -- rebuild      # alias for default
 *   npm run docker:local -- down
 *   npm run docker:local -- restart      # restart without rebuild
 *   npm run docker:local -- logs
 *   npm run docker:local -- status
 *   npm run docker:local -- ps
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const composeFile = join(rootDir, "docker/local/compose.yml");
const dockerfile = join(rootDir, "docker/local/Dockerfile");
const envFile = join(rootDir, ".env.openconnector");
const containerName = "openconnector";
const healthUrl = "http://127.0.0.1:13000/health";
const defaultTimeoutMs = 180_000;

type Command = "up" | "rebuild" | "down" | "restart" | "logs" | "status" | "ps" | "help";

interface ParsedArgs {
  command: Command;
  noCache: boolean;
  followLogs: boolean;
  timeoutMs: number;
  passthrough: string[];
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "help") {
    printHelp();
    return;
  }

  assertPrerequisites();

  switch (args.command) {
    case "up":
    case "rebuild":
      rebuildAndWait(args);
      break;
    case "down":
      runCompose(["down"], { inherit: true });
      break;
    case "restart":
      runCompose(["restart", "connector"], { inherit: true });
      waitHealthy(args.timeoutMs);
      printStatus();
      break;
    case "logs":
      runCompose(["logs", ...(args.followLogs ? ["-f"] : ["--tail", "200"]), "connector"], {
        inherit: true,
      });
      break;
    case "status":
    case "ps":
      printStatus();
      break;
    default: {
      const _exhaustive: never = args.command;
      throw new Error(`Unknown command: ${_exhaustive}`);
    }
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  let command: Command | undefined;
  let noCache = false;
  let followLogs = false;
  let timeoutMs = defaultTimeoutMs;
  const passthrough: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      passthrough.push(...argv.slice(index + 1));
      break;
    }
    if (arg === "--no-cache") {
      noCache = true;
      continue;
    }
    if (arg === "-f" || arg === "--follow") {
      followLogs = true;
      continue;
    }
    if (arg === "--timeout") {
      const raw = argv[index + 1];
      if (!raw) {
        fail("--timeout requires a value in seconds");
      }
      timeoutMs = Number(raw) * 1000;
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        fail(`invalid --timeout value: ${raw}`);
      }
      index += 1;
      continue;
    }
    if (arg === "-h" || arg === "--help" || arg === "help") {
      command = "help";
      continue;
    }
    if (
      arg === "up" ||
      arg === "rebuild" ||
      arg === "down" ||
      arg === "restart" ||
      arg === "logs" ||
      arg === "status" ||
      arg === "ps"
    ) {
      command = arg;
      continue;
    }
    fail(`unknown argument: ${arg}\nRun with --help for usage.`);
  }

  return {
    command: command ?? "rebuild",
    noCache,
    followLogs,
    timeoutMs,
    passthrough,
  };
}

function assertPrerequisites(): void {
  if (!existsSync(composeFile)) {
    fail(`missing compose file: ${composeFile}`);
  }
  if (!existsSync(dockerfile)) {
    fail(`missing dockerfile: ${dockerfile}`);
  }
  if (!existsSync(envFile)) {
    fail(`missing env file: ${envFile}\nCreate it before running the local Docker stack.`);
  }
  const docker = spawnSync("docker", ["version"], { encoding: "utf8" });
  if (docker.status !== 0) {
    fail("docker is not available. Start Docker / OrbStack first.");
  }
  const compose = spawnSync("docker", ["compose", "version"], { encoding: "utf8" });
  if (compose.status !== 0) {
    fail("docker compose is not available.");
  }
}

function rebuildAndWait(args: ParsedArgs): void {
  const buildArgs = ["build", ...(args.noCache ? ["--no-cache"] : []), "connector"];
  console.log(`→ docker compose ${buildArgs.join(" ")}`);
  runCompose(buildArgs, { inherit: true });

  console.log("→ docker compose up -d connector");
  runCompose(["up", "-d", "connector"], { inherit: true });

  waitHealthy(args.timeoutMs);
  printStatus();
  console.log("\nLocal OpenConnector is up:");
  console.log(`  UI / API:  http://127.0.0.1:13000`);
  console.log(`  MCP:       http://127.0.0.1:13000/mcp`);
}

function waitHealthy(timeoutMs: number): void {
  const started = Date.now();
  process.stdout.write("→ waiting for healthy");
  while (Date.now() - started < timeoutMs) {
    const health = getContainerHealth();
    if (health === "healthy") {
      process.stdout.write(" ok\n");
      return;
    }
    // Fall back to HTTP if the health field is missing right after recreate.
    if (health === "missing" || health === "starting" || health === "unhealthy") {
      if (isHttpHealthy()) {
        process.stdout.write(" ok (http)\n");
        return;
      }
    }
    process.stdout.write(".");
    sleep(2000);
  }
  process.stdout.write("\n");
  printStatus();
  fail(`container did not become healthy within ${Math.round(timeoutMs / 1000)}s`);
}

function getContainerHealth(): string {
  const result = spawnSync(
    "docker",
    ["inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}", containerName],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    return "missing";
  }
  return (result.stdout || "").trim() || "unknown";
}

function isHttpHealthy(): boolean {
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `fetch(${JSON.stringify(healthUrl)}).then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`,
    ],
    { encoding: "utf8" },
  );
  return result.status === 0;
}

function printStatus(): void {
  runCompose(["ps"], { inherit: true });
  const health = getContainerHealth();
  console.log(`container health: ${health}`);
}

function runCompose(args: string[], options: { inherit?: boolean } = {}): void {
  const result = spawnSync("docker", ["compose", "-f", composeFile, ...args], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe",
    env: {
      ...process.env,
      HOME: process.env.HOME ?? "",
    },
  });
  if (result.status !== 0) {
    if (!options.inherit) {
      if (result.stdout) {
        process.stdout.write(result.stdout);
      }
      if (result.stderr) {
        process.stderr.write(result.stderr);
      }
    }
    process.exit(result.status ?? 1);
  }
}

function printHelp(): void {
  console.log(`OpenConnector local Docker helper

Usage:
  npm run docker:local [-- <command>] [options]

Commands:
  rebuild | up   Build image from source, recreate container, wait healthy (default)
  restart        Restart container without rebuild
  down           Stop and remove the local stack
  logs           Show connector logs (add -f/--follow)
  status | ps    Show compose ps + health

Options:
  --no-cache     Build without Docker cache
  --timeout N    Health wait timeout in seconds (default 180)
  -f, --follow   Follow logs
  -h, --help     Show help

Files:
  ${composeFile}
  ${dockerfile}
  ${envFile}
`);
}

function sleep(ms: number): void {
  spawnSync("node", ["-e", `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${ms})`]);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

main();
