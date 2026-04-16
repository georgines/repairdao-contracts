import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployRepairSystem, ORDER_AMOUNT } from "./fixture";

describe("Fluxo completo - sucesso", () => {
  it("deve executar o fluxo completo entre cliente e tecnico", async () => {
    const { client, technician, token, deposit, reputation, badge, escrow } = await loadFixture(
      deployRepairSystem
    );

    await escrow.connect(client).createOrder("Notebook nao liga");
    await escrow.connect(technician).submitBudget(1, ORDER_AMOUNT);
    await token.connect(client).approve(await escrow.getAddress(), ORDER_AMOUNT);

    await expect(escrow.connect(client).acceptBudget(1))
      .to.emit(escrow, "BudgetAccepted")
      .withArgs(1, client.address, ORDER_AMOUNT);

    await expect(escrow.connect(technician).completeOrder(1))
      .to.emit(escrow, "OrderCompleted")
      .withArgs(1, technician.address);

    const technicianBalanceBefore = await token.balanceOf(technician.address);
    await expect(escrow.connect(client).confirmCompletion(1))
      .to.emit(escrow, "PaymentReleased")
      .withArgs(1, technician.address, ORDER_AMOUNT);
    const technicianBalanceAfter = await token.balanceOf(technician.address);

    expect(technicianBalanceAfter - technicianBalanceBefore).to.equal(ORDER_AMOUNT);

    await expect(escrow.connect(client).rateUser(1, 5))
      .to.emit(escrow, "RatingSubmitted")
      .withArgs(1, client.address, technician.address, 5);

    await expect(escrow.connect(technician).rateUser(1, 4))
      .to.emit(escrow, "RatingSubmitted")
      .withArgs(1, technician.address, client.address, 4);

    const technicianReputation = await reputation.getReputation(technician.address);
    const clientReputation = await reputation.getReputation(client.address);

    expect(technicianReputation.totalRatings).to.equal(1);
    expect(technicianReputation.positiveRatings).to.equal(1);
    expect(clientReputation.totalRatings).to.equal(1);
    expect(clientReputation.positiveRatings).to.equal(1);

    await deposit.connect(client).withdrawDeposit();
    await deposit.connect(technician).withdrawDeposit();

    expect(await deposit.isActive(client.address)).to.be.false;
    expect(await deposit.isActive(technician.address)).to.be.false;
    expect(await badge.hasBadge(client.address)).to.be.false;
    expect(await badge.hasBadge(technician.address)).to.be.false;
  });
});