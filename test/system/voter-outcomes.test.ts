import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployRepairSystem, ORDER_AMOUNT } from "./fixture";

describe("Resultado dos votantes na disputa", () => {
  async function createDisputeAndVote(openerWins: boolean) {
    const { client, technician, voter1, voter2, token, deposit, reputation, escrow } = await loadFixture(
      deployRepairSystem
    );

    await escrow.connect(client).createOrder("Notebook com falha intermitente");
    await escrow.connect(technician).submitBudget(1, ORDER_AMOUNT);
    await token.connect(client).approve(await escrow.getAddress(), ORDER_AMOUNT);
    await escrow.connect(client).acceptBudget(1);
    await escrow.connect(technician).completeOrder(1);

    if (openerWins) {
      await escrow.connect(client).openDispute(1, "Problema nao resolvido");
      await escrow.connect(voter1).voteOnDispute(1, true);
      await escrow.connect(voter2).voteOnDispute(1, false);
    } else {
      await escrow.connect(technician).openDispute(1, "Cliente nao confirmou entrega");
      await escrow.connect(voter1).voteOnDispute(1, true);
      await escrow.connect(voter2).voteOnDispute(1, false);
    }

    const dispute = await escrow.getDispute(1);
    await time.increaseTo(dispute.deadline + 1n);

    return { client, technician, voter1, voter2, token, deposit, reputation, escrow };
  }

  it("deve recompensar votantes que apoiaram o lado vencedor", async () => {
    const { client, technician, voter1, voter2, reputation, escrow } = await createDisputeAndVote(true);

    await escrow.connect(voter1).resolveDispute(1);

    const voter1Reputation = await reputation.getReputation(voter1.address);
    const voter2Reputation = await reputation.getReputation(voter2.address);

    expect(voter1Reputation.positiveRatings).to.equal(1);
    expect(voter1Reputation.totalPoints).to.equal(2);
    expect(voter1Reputation.level).to.equal(1);

    expect(voter2Reputation.negativeRatings).to.equal(1);
    expect(voter2Reputation.totalPoints).to.equal(0);
    expect(voter2Reputation.level).to.equal(1);

    const resolvedOrder = await escrow.getOrder(1);
    expect(resolvedOrder.state).to.equal(5);
    expect(resolvedOrder.client).to.equal(client.address);
    expect(resolvedOrder.technician).to.equal(technician.address);
  });

  it("deve punir votantes que apoiaram o lado perdedor", async () => {
    const { client, technician, voter1, voter2, deposit, reputation, escrow } = await createDisputeAndVote(false);

    const voter1DepositBefore = await deposit.getDeposit(voter1.address);
    const voter2DepositBefore = await deposit.getDeposit(voter2.address);

    await escrow.connect(voter1).resolveDispute(1);

    const voter1DepositAfter = await deposit.getDeposit(voter1.address);
    const voter2DepositAfter = await deposit.getDeposit(voter2.address);

    expect(voter1DepositAfter.amount).to.equal(voter1DepositBefore.amount);
    expect(voter2DepositAfter.amount).to.equal(ethers.parseUnits("95", 18));

    const voter1Reputation = await reputation.getReputation(voter1.address);
    const voter2Reputation = await reputation.getReputation(voter2.address);

    expect(voter1Reputation.positiveRatings).to.equal(1);
    expect(voter1Reputation.totalPoints).to.equal(2);
    expect(voter2Reputation.negativeRatings).to.equal(1);
    expect(voter2Reputation.totalPoints).to.equal(0);

    const resolvedOrder = await escrow.getOrder(1);
    expect(resolvedOrder.state).to.equal(5);
    expect(resolvedOrder.client).to.equal(client.address);
    expect(resolvedOrder.technician).to.equal(technician.address);
  });
});