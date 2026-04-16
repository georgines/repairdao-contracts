import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();

  const repairToken = await (await ethers.getContractFactory("RepairToken")).deploy();
  await repairToken.waitForDeployment();

  const repairBadge = await (await ethers.getContractFactory("RepairBadge")).deploy();
  await repairBadge.waitForDeployment();

  let priceFeedAddress: string;
  if (network.name === "sepolia") {
    priceFeedAddress = process.env.SEPOLIA_PRICE_FEED_ADDRESS || "";
    if (!priceFeedAddress) throw new Error("SEPOLIA_PRICE_FEED_ADDRESS não definido");
  } else {
    const initialPrice = process.env.HARDHAT_PRICE_FEED_INITIAL_PRICE || "200000000000";
    const mockPriceFeed = await (await ethers.getContractFactory("MockPriceFeed")).deploy(BigInt(initialPrice));
    await mockPriceFeed.waitForDeployment();
    priceFeedAddress = await mockPriceFeed.getAddress();
  }

  const repairDeposit = await (await ethers.getContractFactory("RepairDeposit")).deploy(
    await repairToken.getAddress(),
    await repairBadge.getAddress(),
    ethers.ZeroAddress,
    priceFeedAddress
  );
  await repairDeposit.waitForDeployment();

  const repairReputation = await (await ethers.getContractFactory("RepairReputation")).deploy(
    await repairBadge.getAddress(),
    await repairDeposit.getAddress()
  );
  await repairReputation.waitForDeployment();
  await repairDeposit.setRepairReputation(await repairReputation.getAddress());

  const repairEscrow = await (await ethers.getContractFactory("RepairEscrow")).deploy(
    await repairToken.getAddress(),
    await repairDeposit.getAddress(),
    await repairReputation.getAddress()
  );
  await repairEscrow.waitForDeployment();

  const repairGovernance = await (await ethers.getContractFactory("RepairGovernance")).deploy(
    await repairToken.getAddress(),
    await repairDeposit.getAddress()
  );
  await repairGovernance.waitForDeployment();

  // Autorizações
  await repairBadge.authorizeContract(await repairReputation.getAddress());
  await repairBadge.authorizeContract(await repairDeposit.getAddress());
  await repairReputation.authorizeContract(await repairDeposit.getAddress());
  await repairReputation.authorizeContract(await repairEscrow.getAddress());
  await repairDeposit.authorizeContract(await repairEscrow.getAddress());
  await repairDeposit.authorizeContract(await repairReputation.getAddress());

  // Salvar endereços
  const deployData = {
    network: network.name,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      RepairToken:      await repairToken.getAddress(),
      RepairBadge:      await repairBadge.getAddress(),
      RepairDeposit:    await repairDeposit.getAddress(),
      RepairReputation: await repairReputation.getAddress(),
      RepairEscrow:     await repairEscrow.getAddress(),
      RepairGovernance: await repairGovernance.getAddress(),
      PriceFeed:        priceFeedAddress,
    }
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });

  const fileName = network.name === "sepolia" ? "sepolia.json" : "local.json";
  fs.writeFileSync(path.join(deploymentsDir, fileName), JSON.stringify(deployData, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
