import { expect } from "chai";
import { ethers } from "hardhat";
import { RepairReputation, RepairBadge, RepairDeposit, RepairToken, MockPriceFeed } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("RepairReputation", () => {
  let reputation: RepairReputation;
  let badge: RepairBadge;
  let deposit: RepairDeposit;
  let token: RepairToken;
  let priceFeed: MockPriceFeed;
  let owner: HardhatEthersSigner;
  let authorized: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  beforeEach(async () => {
    [owner, authorized, user, user2] = await ethers.getSigners();

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

    // Autorizações
    await badge.authorizeContract(await reputation.getAddress());
    await badge.authorizeContract(await deposit.getAddress());
    await deposit.authorizeContract(await reputation.getAddress());
    await reputation.authorizeContract(await deposit.getAddress());
    await reputation.authorizeContract(authorized.address);
  });

  describe("deploy", () => {
    it("deve definir badge e deposit corretamente", async () => {
      expect(await reputation.repairBadge()).to.equal(await badge.getAddress());
      expect(await reputation.repairDeposit()).to.equal(await deposit.getAddress());
    });
  });

  describe("registerUser", () => {
    it("autorizado deve registrar usuario no nivel 1", async () => {
      await reputation.connect(authorized).registerUser(user.address);
      expect(await reputation.getLevel(user.address)).to.equal(1);
    });

    it("deve emitir evento UserRegistered", async () => {
      await expect(reputation.connect(authorized).registerUser(user.address))
        .to.emit(reputation, "UserRegistered")
        .withArgs(user.address, 1);
    });

    it("deve falhar para endereco zero", async () => {
      await expect(reputation.connect(authorized).registerUser(ethers.ZeroAddress))
        .to.be.revertedWith("Invalid address");
    });

    it("deve falhar se usuario ja registrado", async () => {
      await reputation.connect(authorized).registerUser(user.address);
      await expect(reputation.connect(authorized).registerUser(user.address))
        .to.be.revertedWith("User already registered");
    });

    it("nao autorizado nao pode registrar", async () => {
      await expect(reputation.connect(user).registerUser(user2.address))
        .to.be.revertedWith("Not authorized");
    });
  });

  describe("penalize", () => {
    beforeEach(async () => {
      await reputation.connect(authorized).registerUser(user.address);
    });

    it("deve penalizar usuario", async () => {
      await reputation.connect(authorized).penalize(user.address);
      expect(await reputation.getLevel(user.address)).to.equal(1);
    });

    it("deve emitir evento UserPenalized", async () => {
      await expect(reputation.connect(authorized).penalize(user.address))
        .to.emit(reputation, "UserPenalized");
    });

    it("deve falhar se usuario nao registrado", async () => {
      await expect(reputation.connect(authorized).penalize(user2.address))
        .to.be.revertedWith("User not registered");
    });
  });

  describe("reward", () => {
    beforeEach(async () => {
      await reputation.connect(authorized).registerUser(user.address);
    });

    it("deve recompensar usuario", async () => {
      await reputation.connect(authorized).reward(user.address);
      expect(await reputation.getLevel(user.address)).to.equal(1);
    });

    it("deve emitir evento UserRewarded", async () => {
      await expect(reputation.connect(authorized).reward(user.address))
        .to.emit(reputation, "UserRewarded");
    });

    it("deve falhar se usuario nao registrado", async () => {
      await expect(reputation.connect(authorized).reward(user2.address))
        .to.be.revertedWith("User not registered");
    });
  });

  describe("getAverageRating", () => {
    it("deve retornar zero para usuario sem avaliacoes", async () => {
      await reputation.connect(authorized).registerUser(user.address);
      expect(await reputation.getAverageRating(user.address)).to.equal(0);
    });
  });

  describe("getReputation", () => {
    it("deve retornar dados de reputacao do usuario", async () => {
      await reputation.connect(authorized).registerUser(user.address);
      const rep = await reputation.getReputation(user.address);
      expect(rep.level).to.equal(1);
      expect(rep.totalPoints).to.equal(0);
      expect(rep.totalRatings).to.equal(0);
    });
  });

  describe("niveis", () => {
    it("deve subir de nivel com pontos suficientes", async () => {
      await reputation.connect(authorized).registerUser(user.address);
      for (let i = 0; i < 5; i++) {
        await reputation.connect(authorized).reward(user.address);
        await reputation.connect(authorized).reward(user.address);
        await reputation.connect(authorized).reward(user.address);
        await reputation.connect(authorized).reward(user.address);
        await reputation.connect(authorized).reward(user.address);
      }
      expect(await reputation.getLevel(user.address)).to.be.gt(1);
    });
  });
});
