const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = process.cwd();
const tempDirectory = path.join(os.tmpdir(), "repairdao-mythril-docker");
const containerProjectRoot = "/src";
const containerTempRoot = "/tmp/mythril";
const solcConfigName = "mythril-solc.json";
const executionTimeout = process.env.MYTHRIL_EXECUTION_TIMEOUT || "20";
const solcVersion = process.env.MYTHRIL_SOLC_VERSION || "0.8.25";

function toDockerVolumePath(filePath) {
  return filePath.replace(/\\/g, "/");
}

function ensureTempDirectory() {
  fs.mkdirSync(tempDirectory, { recursive: true });
}

function writeSolcConfig() {
  const solcConfigPath = path.join(tempDirectory, solcConfigName);
  const solcConfig = {
    remappings: ["@openzeppelin/contracts/=node_modules/@openzeppelin/contracts/"],
  };

  fs.writeFileSync(solcConfigPath, `${JSON.stringify(solcConfig, null, 2)}\n`, "utf8");

  return solcConfigPath;
}

function discoverSolidityFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...discoverSolidityFiles(entryPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".sol")) {
      files.push(entryPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function runMythril(contractPath) {
  const relativePath = path.relative(projectRoot, contractPath).replace(/\\/g, "/");
  const containerContractPath = `${containerProjectRoot}/${relativePath}`;
  const containerSolcConfigPath = `${containerTempRoot}/${solcConfigName}`;

  return spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${toDockerVolumePath(projectRoot)}:${containerProjectRoot}`,
      "-v",
      `${toDockerVolumePath(tempDirectory)}:${containerTempRoot}`,
      "-w",
      containerProjectRoot,
      "mythril/myth",
      "analyze",
      containerContractPath,
      "--solc-json",
      containerSolcConfigPath,
      "--solv",
      solcVersion,
      "-o",
      "text",
      "--execution-timeout",
      String(executionTimeout),
      "-t",
      "1",
    ],
    {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    }
  );
}

function main() {
  ensureTempDirectory();
  const solcConfigPath = writeSolcConfig();
  const solidityFiles = discoverSolidityFiles(path.join(projectRoot, "contracts"));

  if (solidityFiles.length === 0) {
    console.error("Nenhum arquivo Solidity encontrado em contracts/.");
    process.exitCode = 1;
    return;
  }

  let hasIssues = false;

  for (const contractPath of solidityFiles) {
    const relativePath = path.relative(projectRoot, contractPath).replace(/\\/g, "/");
    process.stdout.write(`Auditando ${relativePath}...\n`);

    const result = runMythril(contractPath);

    if (result.error) {
      hasIssues = true;
      process.stderr.write(
        `[ERRO] ${relativePath}: nao foi possivel executar o Docker.\n${result.error.message}\n`
      );
      continue;
    }

    if (result.status === 0) {
      process.stdout.write(`[OK] ${relativePath}: sem achados.\n`);
      continue;
    }

    hasIssues = true;
    process.stdout.write(`[ALERTA] ${relativePath}: o Mythril encontrou achados.\n`);

    if (result.stdout) {
      process.stdout.write(`${result.stdout}\n`);
    }

    if (result.stderr) {
      process.stderr.write(`${result.stderr}\n`);
    }
  }

  if (hasIssues) {
    process.exitCode = 1;
    return;
  }

  process.stdout.write("Auditoria Mythril em Docker concluida sem achados.\n");
}

main();
