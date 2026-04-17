import { expect } from "chai";
import { ethers } from "hardhat";
import { MockPriceFeed, RepairBadge } from "../typechain-types";

describe("Coverage helpers", () => {
  it("MockPriceFeed decimals and setPrice", async () => {
    const priceFeed = await (await ethers.getContractFactory("MockPriceFeed")).deploy(123456789n);
    await priceFeed.waitForDeployment();

    expect(await priceFeed.decimals()).to.equal(8);

    // change price and ensure latestRoundData reflects it
    await priceFeed.setPrice(987654321n);
    const data = await priceFeed.latestRoundData();
    expect(data[1]).to.equal(987654321n);
  });

  it("RepairBadge getBadgeLevel and edge cases", async () => {
    const [owner, authorized, user] = await ethers.getSigners();
    const badge = await (await ethers.getContractFactory("RepairBadge")).deploy();
    await badge.waitForDeployment();

    // authorize and mint
    await badge.authorizeContract(authorized.address);
    await badge.connect(authorized).mintBadge(user.address);

    expect(await badge.getBadgeLevel(user.address)).to.equal(1);
    expect(await badge.getLevelName(user.address)).to.equal("Bronze");

    // burn and ensure level resets
    await badge.connect(authorized).burnBadge(user.address);
    expect(await badge.getBadgeLevel(user.address)).to.equal(0);
    expect(await badge.getLevelName(user.address)).to.equal("None");
  });
});
