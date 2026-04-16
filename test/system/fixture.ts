import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  RepairBadge,
  RepairDeposit,
  RepairEscrow,
  RepairReputation,
  RepairToken,
  MockPriceFeed,
} from "../../typechain-types";

export const MIN_DEPOSIT = ethers.parseUnits("100", 18);
export const ORDER_AMOUNT = ethers.parseUnits("50", 18);

export interface RepairSystemFixture {
  owner: HardhatEthersSigner;
  client: HardhatEthersSigner;
  technician: HardhatEthersSigner;
  voter1: HardhatEthersSigner;
  voter2: HardhatEthersSigner;
  outsider: HardhatEthersSigner;
  token: RepairToken;
  badge: RepairBadge;
  deposit: RepairDeposit;
  reputation: RepairReputation;
  escrow: RepairEscrow;
  priceFeed: MockPriceFeed;
}

async function setupDeposit(
  token: RepairToken,
  deposit: RepairDeposit,
  signer: HardhatEthersSigner,
  isTechnician: boolean
) {
  await token.mint(signer.address, ethers.parseUnits("1000", 18));
  await token.connect(signer).approve(await deposit.getAddress(), ethers.parseUnits("1000", 18));
  await deposit.connect(signer).deposit(MIN_DEPOSIT, isTechnician);
}

export async function deployRepairSystem(): Promise<RepairSystemFixture> {
  const [owner, client, technician, voter1, voter2, outsider] = await ethers.getSigners();

  const token = await (await ethers.getContractFactory("RepairToken")).deploy();
  await token.waitForDeployment();

  const badge = await (await ethers.getContractFactory("RepairBadge")).deploy();
  await badge.waitForDeployment();

  const priceFeed = await (await ethers.getContractFactory("MockPriceFeed")).deploy(200000000000n);
  await priceFeed.waitForDeployment();

  const deposit = await (await ethers.getContractFactory("RepairDeposit")).deploy(
    await token.getAddress(),
    await badge.getAddress(),
    ethers.ZeroAddress,
    await priceFeed.getAddress()
  );
  await deposit.waitForDeployment();

  const reputation = await (await ethers.getContractFactory("RepairReputation")).deploy(
    await badge.getAddress(),
    await deposit.getAddress()
  );
  await reputation.waitForDeployment();
  await deposit.setRepairReputation(await reputation.getAddress());

  const escrow = await (await ethers.getContractFactory("RepairEscrow")).deploy(
    await token.getAddress(),
    await deposit.getAddress(),
    await reputation.getAddress()
  );
  await escrow.waitForDeployment();

  await badge.authorizeContract(await reputation.getAddress());
  await badge.authorizeContract(await deposit.getAddress());
  await deposit.authorizeContract(await reputation.getAddress());
  await deposit.authorizeContract(await escrow.getAddress());
  await reputation.authorizeContract(await deposit.getAddress());
  await reputation.authorizeContract(await escrow.getAddress());

  await setupDeposit(token, deposit, client, false);
  await setupDeposit(token, deposit, technician, true);
  await setupDeposit(token, deposit, voter1, false);
  await setupDeposit(token, deposit, voter2, false);

  await token.mint(outsider.address, ethers.parseUnits("500", 18));

  return {
    owner,
    client,
    technician,
    voter1,
    voter2,
    outsider,
    token,
    badge,
    deposit,
    reputation,
    escrow,
    priceFeed,
  };
}