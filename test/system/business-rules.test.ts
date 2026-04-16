import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployRepairSystem, MIN_DEPOSIT, ORDER_AMOUNT } from "./fixture";

describe("Regras de negocio principais", () => {
  it("deve emitir badge nivel 1 automaticamente ao depositar o valor minimo", async () => {
    const { outsider, token, deposit, badge, reputation } = await loadFixture(deployRepairSystem);

    await token.connect(outsider).approve(await deposit.getAddress(), MIN_DEPOSIT);
    await deposit.connect(outsider).deposit(MIN_DEPOSIT, false);

    expect(await deposit.isActive(outsider.address)).to.be.true;
    expect(await badge.hasBadge(outsider.address)).to.be.true;
    expect(await badge.levelOf(outsider.address)).to.equal(1);
    expect(await reputation.getLevel(outsider.address)).to.equal(1);
  });

  it("nao deve aumentar o nivel apenas porque o usuario depositou mais tokens", async () => {
    const { outsider, token, deposit, badge, reputation } = await loadFixture(deployRepairSystem);
    const highDeposit = ethers.parseUnits("500", 18);

    await token.connect(outsider).approve(await deposit.getAddress(), highDeposit);
    await deposit.connect(outsider).deposit(highDeposit, false);

    expect(await deposit.isActive(outsider.address)).to.be.true;
    expect(await badge.hasBadge(outsider.address)).to.be.true;
    expect(await badge.levelOf(outsider.address)).to.equal(1);
    expect(await reputation.getLevel(outsider.address)).to.equal(1);
  });

  it("deve subir o nivel do tecnico conforme recebe avaliacoes positivas", async () => {
    const { client, technician, token, reputation, deposit, escrow, badge } = await loadFixture(deployRepairSystem);

    await token.connect(client).approve(await escrow.getAddress(), ethers.parseUnits("1000", 18));

    for (let serviceIndex = 0; serviceIndex < 5; serviceIndex++) {
      await escrow.connect(client).createOrder(`Servico ${serviceIndex + 1}`);
      await escrow.connect(technician).submitBudget(serviceIndex + 1, ORDER_AMOUNT);
      await escrow.connect(client).acceptBudget(serviceIndex + 1);
      await escrow.connect(technician).completeOrder(serviceIndex + 1);
      await escrow.connect(client).confirmCompletion(serviceIndex + 1);
      await escrow.connect(client).rateUser(serviceIndex + 1, 5);
    }

    const technicianReputation = await reputation.getReputation(technician.address);
    const technicianDeposit = await deposit.getDeposit(technician.address);

    expect(technicianReputation.totalPoints).to.equal(10);
    expect(technicianReputation.level).to.equal(2);
    expect(await badge.levelOf(technician.address)).to.equal(2);
    expect(technicianDeposit.customRate).to.equal(1200);
  });

  it("deve impedir que a mesma cliente avalie duas vezes o mesmo servico", async () => {
    const { client, technician, token, escrow } = await loadFixture(deployRepairSystem);

    await token.connect(client).approve(await escrow.getAddress(), ethers.parseUnits("1000", 18));

    await escrow.connect(client).createOrder("Notebook com tela quebrada");
    await escrow.connect(technician).submitBudget(1, ORDER_AMOUNT);
    await escrow.connect(client).acceptBudget(1);
    await escrow.connect(technician).completeOrder(1);
    await escrow.connect(client).confirmCompletion(1);

    await escrow.connect(client).rateUser(1, 5);

    await expect(escrow.connect(client).rateUser(1, 4))
      .to.be.revertedWith("Client already rated");
  });
});