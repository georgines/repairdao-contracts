import { expect } from "chai";
import { ethers } from "hardhat";
import { RepairDeposit, RepairToken, RepairBadge, RepairReputation, MockPriceFeed } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("RepairDeposit", () => {
  let deposit: RepairDeposit;
  let token: RepairToken;
  let badge: RepairBadge;
  let reputation: RepairReputation;
  let priceFeed: MockPriceFeed;
  let owner: HardhatEthersSigner;
  let authorized: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  const MIN_DEPOSIT = ethers.parseUnits("100", 18);

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
    await deposit.authorizeContract(authorized.address);

    // Mint tokens para usuarios
    await token.mint(user.address, ethers.parseUnits("1000", 18));
    await token.mint(user2.address, ethers.parseUnits("1000", 18));
    await token.connect(user).approve(await deposit.getAddress(), ethers.parseUnits("1000", 18));
    await token.connect(user2).approve(await deposit.getAddress(), ethers.parseUnits("1000", 18));
  });

  describe("deploy", () => {
    it("deve definir minDeposit corretamente", async () => {
      expect(await deposit.minDeposit()).to.equal(MIN_DEPOSIT);
    });

    it("deve definir taxas por nivel corretamente", async () => {
      expect(await deposit.ratePerLevel(1)).to.equal(1100);
      expect(await deposit.ratePerLevel(2)).to.equal(1200);
      expect(await deposit.ratePerLevel(3)).to.equal(1300);
      expect(await deposit.ratePerLevel(4)).to.equal(1400);
      expect(await deposit.ratePerLevel(5)).to.equal(1500);
    });
  });

  describe("deposit", () => {
    it("deve depositar tokens e ativar conta", async () => {
      await deposit.connect(user).deposit(MIN_DEPOSIT, false);
      expect(await deposit.isActive(user.address)).to.be.true;
    });

    it("deve emitir evento Deposited", async () => {
      await expect(deposit.connect(user).deposit(MIN_DEPOSIT, true))
        .to.emit(deposit, "Deposited")
        .withArgs(user.address, MIN_DEPOSIT, true);
    });

    it("deve falhar se abaixo do minimo", async () => {
      await expect(deposit.connect(user).deposit(ethers.parseUnits("50", 18), false))
        .to.be.revertedWith("Below minimum deposit");
    });

    it("deve falhar se ja tem deposito ativo", async () => {
      await deposit.connect(user).deposit(MIN_DEPOSIT, false);
      await expect(deposit.connect(user).deposit(MIN_DEPOSIT, false))
        .to.be.revertedWith("Already has active deposit");
    });

    it("deve salvar perfil correto (tecnico)", async () => {
      await deposit.connect(user).deposit(MIN_DEPOSIT, true);
      const data = await deposit.getDeposit(user.address);
      expect(data.isTechnician).to.be.true;
    });

    it("deve salvar perfil correto (cliente)", async () => {
      await deposit.connect(user).deposit(MIN_DEPOSIT, false);
      const data = await deposit.getDeposit(user.address);
      expect(data.isTechnician).to.be.false;
    });
  });

  describe("withdrawDeposit", () => {
    beforeEach(async () => {
      await deposit.connect(user).deposit(MIN_DEPOSIT, false);
    });

    it("deve sacar deposito e desativar conta", async () => {
      await deposit.connect(user).withdrawDeposit();
      expect(await deposit.isActive(user.address)).to.be.false;
    });

    it("deve emitir evento DepositWithdrawn", async () => {
      await expect(deposit.connect(user).withdrawDeposit())
        .to.emit(deposit, "DepositWithdrawn");
    });

    it("deve falhar se nao tem deposito ativo", async () => {
      await expect(deposit.connect(user2).withdrawDeposit())
        .to.be.revertedWith("No active deposit");
    });
  });

  describe("slash", () => {
    beforeEach(async () => {
      await deposit.connect(user).deposit(MIN_DEPOSIT, false);
    });

    it("autorizado deve conseguir slash", async () => {
      const before = (await deposit.getDeposit(user.address)).amount;
      await deposit.connect(authorized).slash(user.address, 10);
      const after = (await deposit.getDeposit(user.address)).amount;
      expect(after).to.be.lt(before);
    });

    it("deve emitir evento UserSlashed", async () => {
      await expect(deposit.connect(authorized).slash(user.address, 10))
        .to.emit(deposit, "UserSlashed");
    });

    it("deve falhar para percent invalido", async () => {
      await expect(deposit.connect(authorized).slash(user.address, 0))
        .to.be.revertedWith("Invalid slash percent");
      await expect(deposit.connect(authorized).slash(user.address, 51))
        .to.be.revertedWith("Invalid slash percent");
    });

    it("nao autorizado nao pode slash", async () => {
      await expect(deposit.connect(user2).slash(user.address, 10))
        .to.be.revertedWith("Not authorized");
    });
  });

  describe("updateRate", () => {
    beforeEach(async () => {
      await deposit.connect(user).deposit(MIN_DEPOSIT, false);
    });

    it("autorizado deve atualizar taxa", async () => {
      await deposit.connect(authorized).updateRate(user.address, 1500);
      const data = await deposit.getDeposit(user.address);
      expect(data.customRate).to.equal(1500);
    });

    it("deve emitir evento RateUpdated", async () => {
      await expect(deposit.connect(authorized).updateRate(user.address, 1500))
        .to.emit(deposit, "RateUpdated")
        .withArgs(user.address, 1500);
    });
  });

  describe("getEthUsdPrice", () => {
    it("deve retornar preco do ETH/USD", async () => {
      const price = await deposit.getEthUsdPrice();
      expect(price).to.equal(200000000000n);
    });
  });

  describe("setMinDeposit", () => {
    it("owner deve conseguir atualizar minimo", async () => {
      await deposit.setMinDeposit(ethers.parseUnits("200", 18));
      expect(await deposit.minDeposit()).to.equal(ethers.parseUnits("200", 18));
    });

    it("nao owner nao pode atualizar", async () => {
      await expect(deposit.connect(user).setMinDeposit(200))
        .to.be.revertedWithCustomError(deposit, "OwnableUnauthorizedAccount");
    });
  });
});
