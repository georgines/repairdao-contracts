import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
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

    await token.connect(client).approve(await escrow.getAddress(), ethers.parseUnits("2000", 18));

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

  it("nao deve passar do nivel maximo 5 mesmo recebendo mais avaliacoes", async () => {
    const { client, technician, token, reputation, escrow } = await loadFixture(deployRepairSystem);

    await token.mint(client.address, ethers.parseUnits("500", 18));
    await token.connect(client).approve(await escrow.getAddress(), ethers.parseUnits("2000", 18));

    for (let serviceIndex = 0; serviceIndex < 20; serviceIndex++) {
      await escrow.connect(client).createOrder(`Servico maximo ${serviceIndex + 1}`);
      await escrow.connect(technician).submitBudget(serviceIndex + 1, ORDER_AMOUNT);
      await escrow.connect(client).acceptBudget(serviceIndex + 1);
      await escrow.connect(technician).completeOrder(serviceIndex + 1);
      await escrow.connect(client).confirmCompletion(serviceIndex + 1);
      await escrow.connect(client).rateUser(serviceIndex + 1, 5);
    }

    const technicianReputation = await reputation.getReputation(technician.address);

    expect(technicianReputation.totalPoints).to.equal(40);
    expect(technicianReputation.level).to.equal(5);

    await escrow.connect(client).createOrder("Servico extra para limite");
    await escrow.connect(technician).submitBudget(21, ORDER_AMOUNT);
    await escrow.connect(client).acceptBudget(21);
    await escrow.connect(technician).completeOrder(21);
    await escrow.connect(client).confirmCompletion(21);
    await escrow.connect(client).rateUser(21, 5);

    const afterExtraRating = await reputation.getReputation(technician.address);
    expect(afterExtraRating.level).to.equal(5);
    expect(afterExtraRating.totalPoints).to.be.gte(40);
  });

  it("nao deve cair abaixo do nivel minimo 1 mesmo recebendo penalizacoes", async () => {
    const { client, technician, token, reputation, escrow } = await loadFixture(deployRepairSystem);

    await token.connect(client).approve(await escrow.getAddress(), ethers.parseUnits("1000", 18));

    await escrow.connect(client).createOrder("Servico ruim");
    await escrow.connect(technician).submitBudget(1, ORDER_AMOUNT);
    await escrow.connect(client).acceptBudget(1);
    await escrow.connect(technician).completeOrder(1);
    await escrow.connect(client).openDispute(1, "Falha grave");

    const dispute = await escrow.getDispute(1);
    await time.increaseTo(dispute.deadline + 1n);

    await escrow.connect(technician).resolveDispute(1);

    const technicianReputation = await reputation.getReputation(technician.address);

    expect(technicianReputation.level).to.equal(1);
    expect(technicianReputation.totalPoints).to.equal(0);

    await escrow.connect(client).createOrder("Servico ruim 2");
    await escrow.connect(technician).submitBudget(2, ORDER_AMOUNT);
    await escrow.connect(client).acceptBudget(2);
    await escrow.connect(technician).completeOrder(2);
    await escrow.connect(client).openDispute(2, "Falha grave de novo");

    const dispute2 = await escrow.getDispute(2);
    await time.increaseTo(dispute2.deadline + 1n);

    await escrow.connect(client).resolveDispute(2);

    const afterSecondPenalty = await reputation.getReputation(technician.address);
    expect(afterSecondPenalty.level).to.equal(1);
    expect(afterSecondPenalty.totalPoints).to.equal(0);
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

  it("deve reduzir a reputacao do cliente quando o tecnico avalia negativamente", async () => {
    const { client, technician, token, reputation, escrow, badge } = await loadFixture(deployRepairSystem);

    await token.connect(client).approve(await escrow.getAddress(), ethers.parseUnits("1500", 18));

    for (let serviceIndex = 0; serviceIndex < 5; serviceIndex++) {
      await escrow.connect(client).createOrder(`Servico cliente ${serviceIndex + 1}`);
      await escrow.connect(technician).submitBudget(serviceIndex + 1, ORDER_AMOUNT);
      await escrow.connect(client).acceptBudget(serviceIndex + 1);
      await escrow.connect(technician).completeOrder(serviceIndex + 1);
      await escrow.connect(client).confirmCompletion(serviceIndex + 1);
      await escrow.connect(technician).rateUser(serviceIndex + 1, 5);
    }

    const beforePenalty = await reputation.getReputation(client.address);
    expect(beforePenalty.level).to.equal(2);
    expect(beforePenalty.totalPoints).to.equal(10);

    await escrow.connect(client).createOrder("Servico com nota baixa");
    await escrow.connect(technician).submitBudget(6, ORDER_AMOUNT);
    await escrow.connect(client).acceptBudget(6);
    await escrow.connect(technician).completeOrder(6);
    await escrow.connect(client).confirmCompletion(6);
    await escrow.connect(technician).rateUser(6, 1);

    const afterPenalty = await reputation.getReputation(client.address);
    expect(afterPenalty.negativeRatings).to.equal(1);
    expect(afterPenalty.totalPoints).to.equal(7);
    expect(afterPenalty.level).to.equal(1);
    expect(await badge.levelOf(client.address)).to.equal(1);
  });

  it("deve impedir que o tecnico avalie o mesmo cliente duas vezes no mesmo servico", async () => {
    const { client, technician, token, escrow } = await loadFixture(deployRepairSystem);

    await token.connect(client).approve(await escrow.getAddress(), ethers.parseUnits("1000", 18));

    await escrow.connect(client).createOrder("Servico repetido");
    await escrow.connect(technician).submitBudget(1, ORDER_AMOUNT);
    await escrow.connect(client).acceptBudget(1);
    await escrow.connect(technician).completeOrder(1);
    await escrow.connect(client).confirmCompletion(1);

    await escrow.connect(technician).rateUser(1, 4);

    await expect(escrow.connect(technician).rateUser(1, 2))
      .to.be.revertedWith("Technician already rated");
  });
});