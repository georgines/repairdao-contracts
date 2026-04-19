import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function deployContract(contractName: string, ...args: any[]) {
  console.log(`[deploy] ${contractName}: deploy started`);

  const factory = await ethers.getContractFactory(contractName);
  const contract = await factory.deploy(...args);

  console.log(`[deploy] ${contractName}: waiting for deployment`);
  await contract.waitForDeployment();

  console.log(`[deploy] ${contractName}: deployed at ${await contract.getAddress()}`);
  return contract;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`[deploy] started on network ${network.name}`);

  const repairToken = await deployContract("RepairToken");
  const repairBadge = await deployContract("RepairBadge");

  let priceFeedAddress: string;
  if (network.name === "sepolia") {
    priceFeedAddress = process.env.SEPOLIA_PRICE_FEED_ADDRESS || "";
    if (!priceFeedAddress) throw new Error("SEPOLIA_PRICE_FEED_ADDRESS nao definido");
    console.log(`[deploy] PriceFeed: using configured address ${priceFeedAddress}`);
  } else {
    const initialPrice = process.env.HARDHAT_PRICE_FEED_INITIAL_PRICE || "200000000000";
    const mockPriceFeed = await deployContract("MockPriceFeed", BigInt(initialPrice));
    priceFeedAddress = await mockPriceFeed.getAddress();
  }

  const repairDeposit = await deployContract(
    "RepairDeposit",
    await repairToken.getAddress(),
    await repairBadge.getAddress(),
    ethers.ZeroAddress,
    priceFeedAddress
  );

  const repairReputation = await deployContract(
    "RepairReputation",
    await repairBadge.getAddress(),
    await repairDeposit.getAddress()
  );

  console.log("[deploy] RepairDeposit: configuring RepairReputation");
  await repairDeposit.setRepairReputation(await repairReputation.getAddress());

  const repairEscrow = await deployContract(
    "RepairEscrow",
    await repairToken.getAddress(),
    await repairDeposit.getAddress(),
    await repairReputation.getAddress()
  );

  const repairGovernance = await deployContract(
    "RepairGovernance",
    await repairToken.getAddress(),
    await repairDeposit.getAddress()
  );

  console.log("[deploy] RepairBadge: authorizing RepairReputation");
  await repairBadge.authorizeContract(await repairReputation.getAddress());
  console.log("[deploy] RepairBadge: authorizing RepairDeposit");
  await repairBadge.authorizeContract(await repairDeposit.getAddress());
  console.log("[deploy] RepairReputation: authorizing RepairDeposit");
  await repairReputation.authorizeContract(await repairDeposit.getAddress());
  console.log("[deploy] RepairReputation: authorizing RepairEscrow");
  await repairReputation.authorizeContract(await repairEscrow.getAddress());
  console.log("[deploy] RepairDeposit: authorizing RepairEscrow");
  await repairDeposit.authorizeContract(await repairEscrow.getAddress());
  console.log("[deploy] RepairDeposit: authorizing RepairReputation");
  await repairDeposit.authorizeContract(await repairReputation.getAddress());

  console.log("[deploy] saving deployment addresses");
  const deployData = {
    network: network.name,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      RepairToken: await repairToken.getAddress(),
      RepairBadge: await repairBadge.getAddress(),
      RepairDeposit: await repairDeposit.getAddress(),
      RepairReputation: await repairReputation.getAddress(),
      RepairEscrow: await repairEscrow.getAddress(),
      RepairGovernance: await repairGovernance.getAddress(),
      PriceFeed: priceFeedAddress,
    },
  };

  const deploymentsDir = path.join(__dirname, "../../", "repairdao/src/contracts/deploy");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });

  const fileName = network.name === "sepolia" ? "sepolia.json" : "local.json";
  fs.writeFileSync(path.join(deploymentsDir, fileName), JSON.stringify(deployData, null, 2));

  console.log(`[deploy] completed: ${fileName}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
