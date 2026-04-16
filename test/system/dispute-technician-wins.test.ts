import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployRepairSystem, ORDER_AMOUNT } from "./fixture";

describe("Disputa - tecnico vence", () => {
  it("deve abrir disputa pelo tecnico, votar e resolver para o tecnico", async () => {
    const { client, technician, voter1, voter2, token, deposit, reputation, escrow } = await loadFixture(
      deployRepairSystem
    );

    await escrow.connect(client).createOrder("Teclado com falha intermitente");
    await escrow.connect(technician).submitBudget(1, ORDER_AMOUNT);
    await token.connect(client).approve(await escrow.getAddress(), ORDER_AMOUNT);
    await escrow.connect(client).acceptBudget(1);
    await escrow.connect(technician).completeOrder(1);

    await expect(escrow.connect(technician).openDispute(1, "Cliente nao respondeu para validar a entrega"))
      .to.emit(escrow, "DisputeOpened")
      .withArgs(1, technician.address, client.address, "Cliente nao respondeu para validar a entrega");

    await escrow.connect(voter1).voteOnDispute(1, true);
    await escrow.connect(voter2).voteOnDispute(1, true);
    await expect(escrow.connect(client).voteOnDispute(1, true))
      .to.be.revertedWith("Involved parties cannot vote");

    const dispute = await escrow.getDispute(1);
    await time.increaseTo(dispute.deadline + 1n);

    const technicianBalanceBefore = await token.balanceOf(technician.address);
    await expect(escrow.connect(voter1).resolveDispute(1))
      .to.emit(escrow, "DisputeResolved")
      .withArgs(1, technician.address, ethers.parseUnits("1800", 18), 0);

    const technicianBalanceAfter = await token.balanceOf(technician.address);
    expect(technicianBalanceAfter).to.be.gt(technicianBalanceBefore);

    const resolvedOrder = await escrow.getOrder(1);
    expect(resolvedOrder.state).to.equal(5);

    const clientDeposit = await deposit.getDeposit(client.address);
    expect(clientDeposit.amount).to.equal(ethers.parseUnits("80", 18));

    const clientReputation = await reputation.getReputation(client.address);
    expect(clientReputation.negativeRatings).to.equal(1);

    const voter1Reputation = await reputation.getReputation(voter1.address);
    const voter2Reputation = await reputation.getReputation(voter2.address);
    expect(voter1Reputation.positiveRatings).to.equal(1);
    expect(voter2Reputation.positiveRatings).to.equal(1);
  });
});