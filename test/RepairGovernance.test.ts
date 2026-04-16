import { expect } from "chai";
import { ethers } from "hardhat";
import { RepairGovernance, RepairToken, RepairDeposit, RepairBadge, RepairReputation, MockPriceFeed } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("RepairGovernance", () => {
  let governance: RepairGovernance;
  let token: RepairToken;
  let deposit: RepairDeposit;
  let badge: RepairBadge;
  let reputation: RepairReputation;
  let priceFeed: MockPriceFeed;
  let owner: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let user3: HardhatEthersSigner;

  const MIN_DEPOSIT = ethers.parseUnits("100", 18);

  async function setupUser(signer: HardhatEthersSigner) {
    await token.mint(signer.address, ethers.parseUnits("1000", 18));
    await token.connect(signer).approve(await deposit.getAddress(), ethers.parseUnits("1000", 18));
    await deposit.connect(signer).deposit(MIN_DEPOSIT, false);
  }

  beforeEach(async () => {
    [owner, user, user2, user3] = await ethers.getSigners();

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

    governance = await (await ethers.getContractFactory("RepairGovernance")).deploy(
      await token.getAddress(),
      await deposit.getAddress()
    );
    await governance.waitForDeployment();

    // Autorizações
    await badge.authorizeContract(await reputation.getAddress());
    await badge.authorizeContract(await deposit.getAddress());
    await deposit.authorizeContract(await reputation.getAddress());
    await reputation.authorizeContract(await deposit.getAddress());

    // Setup usuarios
    await setupUser(user);
    await setupUser(user2);
    await token.mint(user3.address, ethers.parseUnits("500", 18));
  });

  describe("deploy", () => {
    it("deve definir token e deposit corretamente", async () => {
      expect(await governance.repairToken()).to.equal(await token.getAddress());
      expect(await governance.repairDeposit()).to.equal(await deposit.getAddress());
    });

    it("deve definir quorum inicial corretamente", async () => {
      expect(await governance.quorum()).to.equal(ethers.parseUnits("1000", 18));
    });
  });

  describe("createProposal", () => {
    it("usuario com deposito deve conseguir criar proposta", async () => {
      await governance.connect(user).createProposal("Aumentar taxa de recompensa", 1);
      const proposal = await governance.getProposal(1);
      expect(proposal.description).to.equal("Aumentar taxa de recompensa");
      expect(proposal.proposer).to.equal(user.address);
    });

    it("deve emitir evento ProposalCreated", async () => {
      await expect(governance.connect(user).createProposal("Proposta teste", 1))
        .to.emit(governance, "ProposalCreated");
    });

    it("deve falhar sem deposito ativo", async () => {
      await expect(governance.connect(user3).createProposal("Proposta teste", 1))
        .to.be.revertedWith("Must have active deposit");
    });

    it("deve falhar com descricao vazia", async () => {
      await expect(governance.connect(user).createProposal("", 1))
        .to.be.revertedWith("Description cannot be empty");
    });

    it("deve falhar com duracao invalida", async () => {
      await expect(governance.connect(user).createProposal("Proposta", 0))
        .to.be.revertedWith("Duration must be between 1 and 30 days");
      await expect(governance.connect(user).createProposal("Proposta", 31))
        .to.be.revertedWith("Duration must be between 1 and 30 days");
    });

    it("deve incrementar totalProposals", async () => {
      await governance.connect(user).createProposal("Proposta 1", 1);
      await governance.connect(user).createProposal("Proposta 2", 1);
      expect(await governance.totalProposals()).to.equal(2);
    });
  });

  describe("vote", () => {
    beforeEach(async () => {
      await governance.connect(user).createProposal("Proposta teste", 1);
    });

    it("detentor de tokens deve conseguir votar a favor", async () => {
      await governance.connect(user2).vote(1, true);
      const proposal = await governance.getProposal(1);
      expect(proposal.votesFor).to.be.gt(0);
    });

    it("detentor de tokens deve conseguir votar contra", async () => {
      await governance.connect(user2).vote(1, false);
      const proposal = await governance.getProposal(1);
      expect(proposal.votesAgainst).to.be.gt(0);
    });

    it("deve emitir evento VoteCast", async () => {
      await expect(governance.connect(user2).vote(1, true))
        .to.emit(governance, "VoteCast");
    });

    it("deve falhar se ja votou", async () => {
      await governance.connect(user2).vote(1, true);
      await expect(governance.connect(user2).vote(1, true))
        .to.be.revertedWith("Already voted");
    });

    it("deve falhar sem tokens", async () => {
      const [,,,,noTokenSigner] = await ethers.getSigners();
      await expect(governance.connect(noTokenSigner).vote(1, true))
        .to.be.revertedWith("No tokens to vote");
    });

    it("deve falhar apos prazo", async () => {
      await time.increase(2 * 24 * 60 * 60); // 2 dias
      await expect(governance.connect(user2).vote(1, true))
        .to.be.revertedWith("Voting period ended");
    });
  });

  describe("executeProposal", () => {
    beforeEach(async () => {
      await governance.connect(user).createProposal("Proposta teste", 1);
    });

    it("deve executar proposta apos prazo", async () => {
      await governance.connect(user2).vote(1, true);
      await governance.connect(user3).vote(1, true);
      await time.increase(2 * 24 * 60 * 60);
      await governance.executeProposal(1);
      const proposal = await governance.getProposal(1);
      expect(proposal.executed).to.be.true;
    });

    it("deve emitir evento ProposalExecuted", async () => {
      await time.increase(2 * 24 * 60 * 60);
      await expect(governance.executeProposal(1))
        .to.emit(governance, "ProposalExecuted");
    });

    it("deve falhar antes do prazo", async () => {
      await expect(governance.executeProposal(1))
        .to.be.revertedWith("Voting period not ended");
    });

    it("deve falhar se ja executada", async () => {
      await time.increase(2 * 24 * 60 * 60);
      await governance.executeProposal(1);
      await expect(governance.executeProposal(1))
        .to.be.revertedWith("Already executed");
    });

    it("proposta sem quorum nao deve ser aprovada", async () => {
      await time.increase(2 * 24 * 60 * 60);
      await governance.executeProposal(1);
      const proposal = await governance.getProposal(1);
      expect(proposal.approved).to.be.false;
    });
  });

  describe("setQuorum", () => {
    it("owner deve conseguir atualizar quorum", async () => {
      await governance.setQuorum(ethers.parseUnits("500", 18));
      expect(await governance.quorum()).to.equal(ethers.parseUnits("500", 18));
    });

    it("nao owner nao pode atualizar quorum", async () => {
      await expect(governance.connect(user).setQuorum(100))
        .to.be.revertedWithCustomError(governance, "OwnableUnauthorizedAccount");
    });
  });
});
