import { expect } from "chai";
import { ethers } from "hardhat";
import { RepairEscrow, RepairToken, RepairBadge, RepairDeposit, RepairReputation, MockPriceFeed } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("RepairEscrow", () => {
  let escrow: RepairEscrow;
  let token: RepairToken;
  let badge: RepairBadge;
  let deposit: RepairDeposit;
  let reputation: RepairReputation;
  let priceFeed: MockPriceFeed;
  let owner: HardhatEthersSigner;
  let client: HardhatEthersSigner;
  let technician: HardhatEthersSigner;
  let voter: HardhatEthersSigner;
  let outsider: HardhatEthersSigner;

  const MIN_DEPOSIT = ethers.parseUnits("100", 18);
  const ORDER_AMOUNT = ethers.parseUnits("50", 18);

  async function setupUser(signer: HardhatEthersSigner, isTechnician: boolean) {
    await token.mint(signer.address, ethers.parseUnits("1000", 18));
    await token.connect(signer).approve(await deposit.getAddress(), ethers.parseUnits("1000", 18));
    await deposit.connect(signer).deposit(MIN_DEPOSIT, isTechnician);
  }

  async function createAndAcceptOrder() {
    await escrow.connect(client).createOrder("Notebook nao liga");
    await escrow.connect(technician).submitBudget(1, ORDER_AMOUNT);
    await token.connect(client).approve(await escrow.getAddress(), ORDER_AMOUNT);
    await escrow.connect(client).acceptBudget(1);
  }

  async function movePastVotingPeriod() {
    await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);
  }

  beforeEach(async () => {
    [owner, client, technician, voter, outsider] = await ethers.getSigners();

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

    escrow = await (await ethers.getContractFactory("RepairEscrow")).deploy(
      await token.getAddress(),
      await deposit.getAddress(),
      await reputation.getAddress()
    );
    await escrow.waitForDeployment();

    // Autorizações
    await badge.authorizeContract(await reputation.getAddress());
    await badge.authorizeContract(await deposit.getAddress());
    await deposit.authorizeContract(await reputation.getAddress());
    await deposit.authorizeContract(await escrow.getAddress());
    await reputation.authorizeContract(await deposit.getAddress());
    await reputation.authorizeContract(await escrow.getAddress());

    // Setup usuarios
    await setupUser(client, false);
    await setupUser(technician, true);

    // Setup voter
    await setupUser(voter, false);
  });

  describe("createOrder", () => {
    it("cliente deve conseguir criar ordem", async () => {
      await escrow.connect(client).createOrder("Notebook nao liga");
      const order = await escrow.getOrder(1);
      expect(order.client).to.equal(client.address);
      expect(order.description).to.equal("Notebook nao liga");
    });

    it("deve emitir evento OrderCreated", async () => {
      await expect(escrow.connect(client).createOrder("Notebook nao liga"))
        .to.emit(escrow, "OrderCreated");
    });

    it("deve falhar sem deposito ativo", async () => {
      await expect(escrow.connect(outsider).createOrder("Notebook nao liga"))
        .to.be.revertedWith("Client must have active deposit");
    });

    it("deve falhar com descricao vazia", async () => {
      await expect(escrow.connect(client).createOrder(""))
        .to.be.revertedWith("Description cannot be empty");
    });
  });

  describe("submitBudget", () => {
    beforeEach(async () => {
      await escrow.connect(client).createOrder("Notebook nao liga");
    });

    it("tecnico deve conseguir enviar orcamento", async () => {
      await escrow.connect(technician).submitBudget(1, ORDER_AMOUNT);
      const order = await escrow.getOrder(1);
      expect(order.technician).to.equal(technician.address);
      expect(order.amount).to.equal(ORDER_AMOUNT);
    });

    it("deve emitir evento BudgetSubmitted", async () => {
      await expect(escrow.connect(technician).submitBudget(1, ORDER_AMOUNT))
        .to.emit(escrow, "BudgetSubmitted")
        .withArgs(1, technician.address, ORDER_AMOUNT);
    });

    it("deve falhar sem deposito ativo", async () => {
      await expect(escrow.connect(outsider).submitBudget(1, ORDER_AMOUNT))
        .to.be.revertedWith("Technician must have active deposit");
    });

    it("cliente nao pode ser tecnico", async () => {
      await expect(escrow.connect(client).submitBudget(1, ORDER_AMOUNT))
        .to.be.revertedWith("Client cannot be technician");
    });

    it("deve falhar com amount zero", async () => {
      await expect(escrow.connect(technician).submitBudget(1, 0))
        .to.be.revertedWith("Amount must be greater than zero");
    });
  });

  describe("acceptBudget", () => {
    beforeEach(async () => {
      await escrow.connect(client).createOrder("Notebook nao liga");
      await escrow.connect(technician).submitBudget(1, ORDER_AMOUNT);
      await token.connect(client).approve(await escrow.getAddress(), ORDER_AMOUNT);
    });

    it("cliente deve conseguir aceitar orcamento", async () => {
      await escrow.connect(client).acceptBudget(1);
      const order = await escrow.getOrder(1);
      expect(order.state).to.equal(2); // InProgress
    });

    it("deve emitir evento BudgetAccepted", async () => {
      await expect(escrow.connect(client).acceptBudget(1))
        .to.emit(escrow, "BudgetAccepted")
        .withArgs(1, client.address, ORDER_AMOUNT);
    });

    it("nao cliente nao pode aceitar", async () => {
      await expect(escrow.connect(technician).acceptBudget(1))
        .to.be.revertedWith("Not the client");
    });
  });

  describe("completeOrder", () => {
    beforeEach(async () => {
      await createAndAcceptOrder();
    });

    it("tecnico deve conseguir marcar como concluido", async () => {
      await escrow.connect(technician).completeOrder(1);
      const order = await escrow.getOrder(1);
      expect(order.state).to.equal(3); // Completed
    });

    it("deve emitir evento OrderCompleted", async () => {
      await expect(escrow.connect(technician).completeOrder(1))
        .to.emit(escrow, "OrderCompleted")
        .withArgs(1, technician.address);
    });

    it("nao tecnico nao pode completar", async () => {
      await expect(escrow.connect(client).completeOrder(1))
        .to.be.revertedWith("Not the technician");
    });
  });

  describe("confirmCompletion", () => {
    beforeEach(async () => {
      await createAndAcceptOrder();
      await escrow.connect(technician).completeOrder(1);
    });

    it("cliente deve conseguir confirmar conclusao", async () => {
      const balanceBefore = await token.balanceOf(technician.address);
      await escrow.connect(client).confirmCompletion(1);
      const balanceAfter = await token.balanceOf(technician.address);
      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("deve emitir evento PaymentReleased", async () => {
      await expect(escrow.connect(client).confirmCompletion(1))
        .to.emit(escrow, "PaymentReleased")
        .withArgs(1, technician.address, ORDER_AMOUNT);
    });

    it("nao cliente nao pode confirmar", async () => {
      await expect(escrow.connect(technician).confirmCompletion(1))
        .to.be.revertedWith("Not the client");
    });
  });

  describe("rateUser", () => {
    beforeEach(async () => {
      await createAndAcceptOrder();
      await escrow.connect(technician).completeOrder(1);
      await escrow.connect(client).confirmCompletion(1);
    });

    it("cliente deve conseguir avaliar tecnico", async () => {
      await expect(escrow.connect(client).rateUser(1, 5))
        .to.emit(escrow, "RatingSubmitted");
    });

    it("tecnico deve conseguir avaliar cliente", async () => {
      await expect(escrow.connect(technician).rateUser(1, 4))
        .to.emit(escrow, "RatingSubmitted");
    });

    it("deve falhar para rating invalido", async () => {
      await expect(escrow.connect(client).rateUser(1, 6))
        .to.be.revertedWith("Rating must be between 1 and 5");
      await expect(escrow.connect(client).rateUser(1, 0))
        .to.be.revertedWith("Rating must be between 1 and 5");
    });

    it("deve falhar se ja avaliou", async () => {
      await escrow.connect(client).rateUser(1, 5);
      await expect(escrow.connect(client).rateUser(1, 5))
        .to.be.revertedWith("Client already rated");
    });

    it("deve falhar para terceiros nao envolvidos", async () => {
      await expect(escrow.connect(voter).rateUser(1, 5))
        .to.be.revertedWith("Not authorized to rate");
    });
  });

  describe("openDispute", () => {
    beforeEach(async () => {
      await createAndAcceptOrder();
    });

    it("cliente deve conseguir abrir disputa", async () => {
      await escrow.connect(client).openDispute(1, "Servico mal feito");
      const order = await escrow.getOrder(1);
      expect(order.state).to.equal(4); // Disputed
    });

    it("deve emitir evento DisputeOpened", async () => {
      await expect(escrow.connect(client).openDispute(1, "Servico mal feito"))
        .to.emit(escrow, "DisputeOpened");
    });

    it("deve falhar com motivo vazio", async () => {
      await expect(escrow.connect(client).openDispute(1, ""))
        .to.be.revertedWith("Reason cannot be empty");
    });

    it("terceiros nao podem abrir disputa", async () => {
      await expect(escrow.connect(voter).openDispute(1, "Motivo"))
        .to.be.revertedWith("Not authorized");
    });
  });

  describe("submitEvidence", () => {
    beforeEach(async () => {
      await createAndAcceptOrder();
      await escrow.connect(client).openDispute(1, "Servico mal feito");
    });

    it("cliente deve conseguir submeter evidencia", async () => {
      await expect(escrow.connect(client).submitEvidence(1, "Foto do problema"))
        .to.emit(escrow, "EvidenceSubmitted");
    });

    it("tecnico deve conseguir submeter evidencia", async () => {
      await expect(escrow.connect(technician).submitEvidence(1, "Foto do servico"))
        .to.emit(escrow, "EvidenceSubmitted");
    });

    it("deve falhar com conteudo vazio", async () => {
      await expect(escrow.connect(client).submitEvidence(1, ""))
        .to.be.revertedWith("Content cannot be empty");
    });

    it("deve retornar as evidencias registradas", async () => {
      await escrow.connect(client).submitEvidence(1, "Foto do problema");
      const evidences = await escrow.getEvidences(1);
      expect(evidences.length).to.equal(1);
      expect(evidences[0].content).to.equal("Foto do problema");
    });
  });

  describe("voteOnDispute", () => {
    beforeEach(async () => {
      await createAndAcceptOrder();
      await escrow.connect(client).openDispute(1, "Servico mal feito");
    });

    it("detentor de tokens deve conseguir votar", async () => {
      await expect(escrow.connect(voter).voteOnDispute(1, true))
        .to.emit(escrow, "VoteCast");
    });

    it("deve falhar se ja votou", async () => {
      await escrow.connect(voter).voteOnDispute(1, true);
      await expect(escrow.connect(voter).voteOnDispute(1, true))
        .to.be.revertedWith("Already voted");
    });

    it("partes envolvidas nao podem votar", async () => {
      await expect(escrow.connect(client).voteOnDispute(1, true))
        .to.be.revertedWith("Involved parties cannot vote");
      await expect(escrow.connect(technician).voteOnDispute(1, true))
        .to.be.revertedWith("Involved parties cannot vote");
    });

    it("sem tokens nao pode votar", async () => {
      const [,,,,noTokenSigner] = await ethers.getSigners();
      await expect(escrow.connect(noTokenSigner).voteOnDispute(1, true))
        .to.be.revertedWith("No tokens to vote");
    });
  });

  describe("resolveDispute - opener loses", () => {
    it("deve resolver com o opposing party vencendo quando o opener perde", async () => {
      await createAndAcceptOrder();
      await escrow.connect(client).openDispute(1, "Servico mal feito");
      await escrow.connect(voter).voteOnDispute(1, false);
      await movePastVotingPeriod();

      await expect(escrow.resolveDispute(1))
        .to.emit(escrow, "DisputeResolved");

      const order = await escrow.getOrder(1);
      expect(order.state).to.equal(5); // Resolved
    });
  });

  describe("getClientOrders e getTechnicianOrders", () => {
    it("deve retornar ordens do cliente", async () => {
      await escrow.connect(client).createOrder("Ordem 1");
      await escrow.connect(client).createOrder("Ordem 2");
      const orders = await escrow.getClientOrders(client.address);
      expect(orders.length).to.equal(2);
    });

    it("deve retornar ordens do tecnico", async () => {
      await escrow.connect(client).createOrder("Ordem 1");
      await escrow.connect(technician).submitBudget(1, ORDER_AMOUNT);
      const orders = await escrow.getTechnicianOrders(technician.address);
      expect(orders.length).to.equal(1);
    });
  });

  describe("setVotingPeriod e setSlashPercent", () => {
    it("owner deve conseguir atualizar periodo e slash percent valido", async () => {
      await expect(escrow.connect(owner).setVotingPeriod(3 * 24 * 60 * 60))
        .to.emit(escrow, "VotingPeriodUpdated")
        .withArgs(3 * 24 * 60 * 60);

      await expect(escrow.connect(owner).setSlashPercent(25))
        .to.emit(escrow, "SlashPercentUpdated")
        .withArgs(25);
    });

    it("deve falhar para slash percent invalido", async () => {
      await expect(escrow.connect(owner).setSlashPercent(0))
        .to.be.revertedWith("Invalid percent");
      await expect(escrow.connect(owner).setSlashPercent(51))
        .to.be.revertedWith("Invalid percent");
    });
  });
});
