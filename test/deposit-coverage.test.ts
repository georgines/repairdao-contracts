import { expect } from "chai";
import { ethers } from "hardhat";
import { RepairDeposit, RepairToken, RepairBadge, RepairReputation, MockPriceFeed } from "../typechain-types";

describe("RepairDeposit coverage extras", () => {
  let deposit: RepairDeposit;
  let token: RepairToken;
  let badge: RepairBadge;
  let reputation: RepairReputation;
  let priceFeed: MockPriceFeed;
  let owner: any;
  let user: any;

  const MIN_DEPOSIT = ethers.parseUnits("100", 18);

  beforeEach(async () => {
    [owner, user] = await ethers.getSigners();

    token = await (await ethers.getContractFactory("RepairToken")).deploy();
    await token.waitForDeployment();

    badge = await (await ethers.getContractFactory("RepairBadge")).deploy();
    await badge.waitForDeployment();

    priceFeed = await (await ethers.getContractFactory("MockPriceFeed")).deploy(200000000000n);
    await priceFeed.waitForDeployment();

    deposit = await (await ethers.getContractFactory("RepairDeposit")).deploy(
      await token.getAddress(),
      await badge.getAddress(),
      ethers.ZeroAddress,
      await priceFeed.getAddress()
    );
    await deposit.waitForDeployment();

    reputation = await (await ethers.getContractFactory("RepairReputation")).deploy(
      await badge.getAddress(),
      await deposit.getAddress()
    );
    await reputation.waitForDeployment();
    await deposit.setRepairReputation(await reputation.getAddress());

    // Autorizações
    await badge.authorizeContract(await reputation.getAddress());
    await badge.authorizeContract(await deposit.getAddress());
    await deposit.authorizeContract(await reputation.getAddress());
    await reputation.authorizeContract(await deposit.getAddress());

    // Mint tokens para user
    await token.mint(user.address, ethers.parseUnits("1000", 18));
    await token.connect(user).approve(await deposit.getAddress(), ethers.parseUnits("1000", 18));
  });

  it("setSlashPercent: owner success and non-owner fails", async () => {
    await deposit.setSlashPercent(20);
    expect(await deposit.slashPercent()).to.equal(20);

    await expect(deposit.connect(user).setSlashPercent(10))
      .to.be.revertedWithCustomError(deposit, "OwnableUnauthorizedAccount");
  });

  it("withdrawRewards should revert when no rewards available", async () => {
    // Deposit principal only; contract has no extra rewards balance
    await deposit.connect(user).deposit(MIN_DEPOSIT, false);

    // Immediately try to withdraw rewards: should revert with "No rewards to claim"
    await expect(deposit.connect(user).withdrawRewards())
      .to.be.revertedWith("No rewards to claim");
  });
});
