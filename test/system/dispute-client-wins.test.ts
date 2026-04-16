import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployRepairSystem, ORDER_AMOUNT } from "./fixture";

describe("Disputa - cliente vence", () => {
  it("deve abrir disputa, receber evidencias, votar e resolver para o cliente", async () => {
    const { client, technician, voter1, voter2, token, deposit, reputation, escrow } = await loadFixture(
      deployRepairSystem
    );

    await escrow.connect(client).createOrder("Notebook com tela apagada");
    await escrow.connect(technician).submitBudget(1, ORDER_AMOUNT);
    await token.connect(client).approve(await escrow.getAddress(), ORDER_AMOUNT);
    await escrow.connect(client).acceptBudget(1);
    await escrow.connect(technician).completeOrder(1);

    await expect(escrow.connect(client).openDispute(1, "Servico nao resolveu o problema"))
      .to.emit(escrow, "DisputeOpened")
      .withArgs(1, client.address, technician.address, "Servico nao resolveu o problema");

    await expect(escrow.connect(client).submitEvidence(1, "Fotos do defeito"))
      .to.emit(escrow, "EvidenceSubmitted")
      .withArgs(1, client.address);
    await expect(escrow.connect(technician).submitEvidence(1, "Laudo tecnico"))
      .to.emit(escrow, "EvidenceSubmitted")
      .withArgs(1, technician.address);
    await expect(escrow.connect(client).submitEvidence(1, ""))
      .to.be.revertedWith("Content cannot be empty");

    await escrow.connect(voter1).voteOnDispute(1, true);
    await escrow.connect(voter2).voteOnDispute(1, false);

    const dispute = await escrow.getDispute(1);
    await time.increaseTo(dispute.deadline + 1n);

    const clientBalanceBefore = await token.balanceOf(client.address);
    const technicianBalanceBefore = await token.balanceOf(technician.address);
    await expect(escrow.connect(voter1).resolveDispute(1))
      .to.emit(escrow, "DisputeResolved")
      .withArgs(1, client.address, ethers.parseUnits("900", 18), ethers.parseUnits("900", 18));

    const clientBalanceAfter = await token.balanceOf(client.address);
    expect(clientBalanceAfter).to.be.gt(clientBalanceBefore);
    const technicianBalanceAfter = await token.balanceOf(technician.address);
    expect(technicianBalanceAfter).to.equal(technicianBalanceBefore);

    const resolvedOrder = await escrow.getOrder(1);
    expect(resolvedOrder.state).to.equal(5);

    const technicianDeposit = await deposit.getDeposit(technician.address);
    expect(technicianDeposit.amount).to.equal(ethers.parseUnits("80", 18));

    const technicianReputation = await reputation.getReputation(technician.address);
    expect(technicianReputation.negativeRatings).to.equal(1);

    const voter1Reputation = await reputation.getReputation(voter1.address);
    const voter2Reputation = await reputation.getReputation(voter2.address);
    expect(voter1Reputation.positiveRatings).to.equal(1);
    expect(voter2Reputation.negativeRatings).to.equal(1);
  });
});