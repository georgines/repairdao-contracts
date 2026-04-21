import { expect } from "chai";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import hre from "hardhat";

describe("deploy script", function () {
  this.timeout(180000);

  const deployFilePath = path.resolve(__dirname, "..", "..", "repairdao", "src", "contracts", "deploy", "local.json");
  const testFn = (hre as any).__SOLIDITY_COVERAGE_RUNNING ? it.skip : it;

  testFn("shows start and completion logs and writes deployment addresses", function () {
    const hadExistingFile = fs.existsSync(deployFilePath);
    const originalContent = hadExistingFile ? fs.readFileSync(deployFilePath, "utf8") : null;

    try {
      const hardhatCli = require.resolve("hardhat/internal/cli/cli");
      const output = execFileSync(
        process.execPath,
        [hardhatCli, "run", "--no-compile", "scripts/deploy.ts", "--network", "hardhat"],
        {
          cwd: path.resolve(__dirname, ".."),
          env: {
            ...process.env,
            HARDHAT_PRICE_FEED_INITIAL_PRICE: "200000000000",
          },
          encoding: "utf8",
        }
      );

      expect(output).to.include("[deploy] started on network hardhat");
      expect(output).to.include("[deploy] RepairToken: deploy started");
      expect(output).to.match(/\[deploy\] RepairToken: deployed at 0x[a-fA-F0-9]{40}/);
      expect(output).to.match(/\[deploy\] RepairGovernance: deployed at 0x[a-fA-F0-9]{40}/);
      expect(output).to.include("[deploy] RepairToken: configuring governance");
      expect(output).to.include("[deploy] RepairDeposit: configuring governance");
      expect(output).to.include("[deploy] completed: local.json");

      expect(fs.existsSync(deployFilePath)).to.equal(true);
      const deployData = JSON.parse(fs.readFileSync(deployFilePath, "utf8"));
      expect(deployData).to.have.property("contracts");
      expect(deployData.contracts).to.have.property("RepairToken");
      expect(deployData.contracts.RepairToken).to.match(/^0x[a-fA-F0-9]{40}$/);
      expect(deployData.contracts).to.have.property("PriceFeed");
      expect(deployData.contracts.PriceFeed).to.match(/^0x[a-fA-F0-9]{40}$/);
    } finally {
      if (hadExistingFile && originalContent !== null) {
        fs.writeFileSync(deployFilePath, originalContent);
      } else if (fs.existsSync(deployFilePath)) {
        fs.unlinkSync(deployFilePath);
      }
    }
  });
});
