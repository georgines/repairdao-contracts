import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployRepairSystem } from "./fixture";

describe("Fluxo de recompensas do deposito", () => {
  it("deve acumular e sacar recompensas sem encerrar o deposito", async () => {
    const { client, token, deposit, owner } = await loadFixture(deployRepairSystem);

    const balanceBeforeDeposit = await token.balanceOf(client.address);

    await token.connect(owner).mint(await deposit.getAddress(), ethers.parseUnits("50", 18));
    const contractBalanceBeforeRewards = await token.balanceOf(await deposit.getAddress());

    await time.increase(30 * 24 * 60 * 60);

    await expect(deposit.connect(client).withdrawRewards())
      .to.emit(deposit, "RewardsClaimed");

    const balanceAfterRewards = await token.balanceOf(client.address);
    const contractBalanceAfter = await token.balanceOf(await deposit.getAddress());

    expect(balanceAfterRewards).to.be.gt(balanceBeforeDeposit);
    expect(contractBalanceAfter).to.be.lt(contractBalanceBeforeRewards);
    expect(await deposit.isActive(client.address)).to.be.true;

    await time.increase(1);

    await expect(deposit.connect(client).withdrawRewards())
      .to.emit(deposit, "RewardsClaimed");
  });

  it("deve permitir sacar o deposito depois de acumular recompensas", async () => {
    const { client, badge, deposit } = await loadFixture(deployRepairSystem);

    await time.increase(15 * 24 * 60 * 60);

    await expect(deposit.connect(client).withdrawDeposit())
      .to.emit(deposit, "DepositWithdrawn");

    expect(await deposit.isActive(client.address)).to.be.false;
    expect(await badge.hasBadge(client.address)).to.be.false;
  });

  it("deve falhar ao sacar recompensas sem deposito ativo", async () => {
    const { outsider, deposit } = await loadFixture(deployRepairSystem);

    await expect(deposit.connect(outsider).withdrawRewards())
      .to.be.revertedWith("No active deposit");
  });
});