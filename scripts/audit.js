const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const toolsRoot = path.join(projectRoot, "tools");
const hardhatOutputDir = path.join(toolsRoot, "hardhat", "output");
const slitherOutputDir = path.join(toolsRoot, "slither", "output");
const mythrilOutputDir = path.join(toolsRoot, "mythril", "output");
const requiredSolcVersion = "0.8.24";

function log(message) {
  process.stdout.write(`${message}\n`);
}

function writeTextFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents.replace(/\r\n/g, "\n"), "utf8");
}

function removeDirectoryContents(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
}

function removeFileIfExists(filePath) {
  fs.rmSync(filePath, { force: true });
}

function run(command, args, options = {}) {
  if (process.platform === "win32" && command === "yarn") {
    return spawnSync("cmd.exe", ["/d", "/s", "/c", [command, ...args].join(" ")], {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, ...(options.env || {}) },
    });
  }

  return spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, ...(options.env || {}) },
  });
}

function getCommandOutput(result) {
  const errorMessage = result.error ? `${result.error.message}\n` : "";
  return `${errorMessage}${result.stdout || ""}${result.stderr || ""}`;
}

function commandExists(command) {
  const probe = process.platform === "win32" ? "where" : "which";
  return run(probe, [command]).status === 0;
}

function ensureSolcSelect() {
  log("==> Verificando solc-select");

  if (!commandExists("solc-select")) {
    log("Instalando solc-select...");
    const installResult = run("python", ["-m", "pip", "install", "solc-select"]);

    if (installResult.status !== 0) {
      throw new Error(getCommandOutput(installResult).trim() || "Falha ao instalar solc-select.");
    }
  }

  log(`==> Instalando solc ${requiredSolcVersion} (se necessario)`);
  run("solc-select", ["install", requiredSolcVersion]);

  log(`==> Usando solc ${requiredSolcVersion}`);
  const useResult = run("solc-select", ["use", requiredSolcVersion]);

  if (useResult.status !== 0) {
    throw new Error(
      getCommandOutput(useResult).trim() || `Falha ao selecionar solc ${requiredSolcVersion}.`
    );
  }
}

function normalizePathForDocker(filePath) {
  return filePath.replace(/\\/g, "/");
}

function runAndWrite(command, args, outputFile, options = {}) {
  const result = run(command, args, options);
  writeTextFile(outputFile, getCommandOutput(result));
  return result.error || result.status !== 0 ? 1 : 0;
}

function readArtifactDescriptors() {
  const artifactsRoot = path.join(projectRoot, "artifacts", "contracts");
  const descriptors = [];

  if (!fs.existsSync(artifactsRoot)) {
    return descriptors;
  }

  const visit = (directory) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.endsWith(".dbg.json")) {
        continue;
      }

      const artifact = JSON.parse(fs.readFileSync(entryPath, "utf8"));

      if (
        typeof artifact.contractName !== "string" ||
        typeof artifact.sourceName !== "string" ||
        typeof artifact.deployedBytecode !== "string"
      ) {
        continue;
      }

      if (!artifact.sourceName.startsWith("contracts/") || artifact.deployedBytecode === "0x") {
        continue;
      }

      descriptors.push({
        contractName: artifact.contractName,
        sourceName: artifact.sourceName,
        deployedBytecode: artifact.deployedBytecode,
      });
    }
  };

  visit(artifactsRoot);

  return descriptors.sort((left, right) => {
    const leftKey = `${left.sourceName}::${left.contractName}`;
    const rightKey = `${right.sourceName}::${right.contractName}`;
    return leftKey.localeCompare(rightKey);
  });
}

function sanitizeFileName(value) {
  return value.replace(/[<>:"/\\|?*\s]+/g, "_");
}

function dockerAvailable() {
  const result = run("docker", ["version"]);
  return {
    ok: !result.error && result.status === 0,
    output: getCommandOutput(result),
  };
}

function main() {
  let hardhatStatus = 0;
  let compileStatus = 0;
  let slitherStatus = 0;
  let mythrilStatus = 0;

  log("==> Preparando ambiente");
  removeDirectoryContents(hardhatOutputDir);
  removeDirectoryContents(slitherOutputDir);
  removeDirectoryContents(mythrilOutputDir);
  removeFileIfExists(path.join(toolsRoot, "audit-error.txt"));
  removeFileIfExists(path.join(toolsRoot, "validate-error.txt"));
  removeFileIfExists(path.join(toolsRoot, "validation-summary.txt"));

  try {
    ensureSolcSelect();
  } catch (error) {
    writeTextFile(path.join(toolsRoot, "audit-error.txt"), `${error.message}\n`);
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }

  log("==> Hardhat coverage");
  hardhatStatus = runAndWrite(
    "yarn",
    ["hardhat", "coverage"],
    path.join(hardhatOutputDir, "hardhat-coverage.txt")
  );

  log("==> Hardhat compile");
  compileStatus = runAndWrite(
    "yarn",
    ["hardhat", "compile", "--force"],
    path.join(hardhatOutputDir, "hardhat-compile.txt")
  );

  log("==> Slither");
  slitherStatus = runAndWrite(
    "slither",
    [".", "--exclude-dependencies", "--fail-none"],
    path.join(slitherOutputDir, "slither.txt")
  );

  log("==> Mythril");
  const docker = dockerAvailable();
  const descriptors = readArtifactDescriptors();

  if (!docker.ok) {
    mythrilStatus = 1;
    writeTextFile(path.join(mythrilOutputDir, "docker-error.txt"), docker.output);
  } else if (descriptors.length === 0) {
    mythrilStatus = 1;
    writeTextFile(
      path.join(mythrilOutputDir, "mythril-error.txt"),
      "Nenhum artifact valido encontrado em artifacts/contracts.\n"
    );
  } else {
    const tempRoot = fs.mkdtempSync(path.join(projectRoot, ".tmp-mythril-"));

    try {
      for (const descriptor of descriptors) {
        const safeName = sanitizeFileName(`${descriptor.sourceName}__${descriptor.contractName}.hex`);
        const bytecodePath = path.join(tempRoot, safeName);
        const outputDir = path.join(mythrilOutputDir, descriptor.contractName);
        const outputFile = path.join(outputDir, "audit.txt");

        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(bytecodePath, descriptor.deployedBytecode, "utf8");

        const result = run(
          "docker",
          [
            "run",
            "--rm",
            "-v",
            `${normalizePathForDocker(tempRoot)}:/tmp/mythril`,
            "mythril/myth",
            "analyze",
            "-f",
            `/tmp/mythril/${safeName}`,
            "--bin-runtime",
            "--execution-timeout",
            "300",
            "--max-depth",
            "128",
            "--transaction-count",
            "5",
            "-o",
            "text",
          ],
          { env: { MSYS2_ARG_CONV_EXCL: "/tmp/mythril" } }
        );

        writeTextFile(outputFile, getCommandOutput(result));

        if (result.error || result.status !== 0) {
          mythrilStatus = 1;
        }
      }
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  log("==> Resumo final");
  log(`Hardhat coverage: ${hardhatStatus}`);
  log(`Hardhat compile: ${compileStatus}`);
  log(`Slither: ${slitherStatus}`);
  log(`Mythril: ${mythrilStatus}`);

  if (hardhatStatus !== 0 || compileStatus !== 0 || mythrilStatus !== 0) {
    process.exit(1);
  }
}

main();
