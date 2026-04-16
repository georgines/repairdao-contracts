import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployRepairSystem, ORDER_AMOUNT } from "./fixture";

describe("Fluxos de erro", () => {
  it("deve rejeitar operacoes fora da regra de negocio", async () => {
    const { client, technician, voter1, outsider, token, escrow, deposit } = await loadFixture(
      deployRepairSystem
    );
    const signers = await ethers.getSigners();
    const noTokenSigner = signers[7];

    await expect(escrow.connect(outsider).createOrder("Sem deposito"))
      .to.be.revertedWith("Client must have active deposit");

    await escrow.connect(client).createOrder("Notebook sem orcamento");
    const createdOrder = await escrow.getOrder(1);
    expect(createdOrder.client).to.equal(client.address);
    expect(createdOrder.description).to.equal("Notebook sem orcamento");

    await expect(escrow.connect(outsider).submitBudget(1, ORDER_AMOUNT))
      .to.be.revertedWith("Technician must have active deposit");
    await expect(escrow.connect(client).submitBudget(1, ORDER_AMOUNT))
      .to.be.revertedWith("Client cannot be technician");
    await expect(escrow.connect(technician).acceptBudget(1))
      .to.be.revertedWith("Not the client");

    await escrow.connect(technician).submitBudget(1, ORDER_AMOUNT);
    await expect(escrow.connect(client).completeOrder(1))
      .to.be.revertedWith("Not the technician");
    await expect(escrow.connect(client).confirmCompletion(1))
      .to.be.revertedWith("Order is not completed");

    await token.connect(client).approve(await escrow.getAddress(), ORDER_AMOUNT);
    await escrow.connect(client).acceptBudget(1);

    await expect(escrow.connect(client).rateUser(1, 0))
      .to.be.revertedWith("Order not completed or resolved");

    await expect(escrow.connect(voter1).openDispute(1, "Motivo"))
      .to.be.revertedWith("Not authorized");

    await expect(escrow.connect(client).openDispute(1, ""))
      .to.be.revertedWith("Reason cannot be empty");

    await escrow.connect(technician).completeOrder(1);
    await escrow.connect(client).openDispute(1, "Problema persistente");

    await expect(escrow.connect(noTokenSigner).voteOnDispute(1, true))
      .to.be.revertedWith("No tokens to vote");

    await expect(escrow.connect(client).submitEvidence(1, ""))
      .to.be.revertedWith("Content cannot be empty");

    const dispute = await escrow.getDispute(1);
    await time.increaseTo(dispute.deadline + 1n);

    await expect(escrow.connect(client).submitEvidence(1, "Tarde demais"))
      .to.be.revertedWith("Voting period ended");
    await expect(escrow.connect(voter1).voteOnDispute(1, true))
      .to.be.revertedWith("Voting period ended");

    await expect(escrow.connect(outsider).resolveDispute(1))
      .to.not.be.reverted;
    await expect(escrow.connect(outsider).resolveDispute(1))
      .to.be.revertedWith("No active dispute");

    await expect(deposit.connect(outsider).withdrawDeposit())
      .to.be.revertedWith("No active deposit");
  });
});