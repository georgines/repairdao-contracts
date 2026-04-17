import { expect } from "chai";
import { ethers } from "hardhat";
import { RepairDeposit, RepairToken, RepairBadge, RepairReputation, MockPriceFeed } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("Role change and badge reset", () => {
  let deposit: RepairDeposit;
  let token: RepairToken;
  let badge: RepairBadge;
  let reputation: RepairReputation;
  let newReputation: RepairReputation;
  let priceFeed: MockPriceFeed;
  let owner: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  const MIN_DEPOSIT = ethers.parseUnits("100", 18);

  beforeEach(async () => {
    [owner, , user] = await ethers.getSigners();

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

    // Autorizações necessárias
    await badge.authorizeContract(await reputation.getAddress());
    await badge.authorizeContract(await deposit.getAddress());
    await deposit.authorizeContract(await reputation.getAddress());
    await reputation.authorizeContract(await deposit.getAddress());

    // Prepare tokens for user
    await token.mint(user.address, ethers.parseUnits("1000", 18));
    await token.connect(user).approve(await deposit.getAddress(), ethers.parseUnits("1000", 18));
  });

  it("falha ao redepositar como tecnico sem reset de reputacao (usuario ja registrado)", async () => {
    // Deposita como cliente
    await deposit.connect(user).deposit(MIN_DEPOSIT, false);
    expect(await deposit.isActive(user.address)).to.be.true;
    expect((await deposit.getDeposit(user.address)).isTechnician).to.be.false;

    // Retira, badge deve ser queimado e conta desativada
    await deposit.connect(user).withdrawDeposit();
    expect(await deposit.isActive(user.address)).to.be.false;

    // A reputação DEVE ser removida, então aqui o comportamento esperado mudou para SUCESSO.
    // O teste antigo esperava erro, mas agora que unregisterUser é chamado, deve funcionar.
    await deposit.connect(user).deposit(MIN_DEPOSIT, true);
    const data = await deposit.getDeposit(user.address);
    expect(data.isTechnician).to.be.true;
    expect(await badge.hasBadge(user.address)).to.be.true;
  });

  it("sucesso ao mudar para tecnico e resetar badge usando novo contrato de reputacao", async () => {
    // Deposita como cliente e retira (badge queimado)
    await deposit.connect(user).deposit(MIN_DEPOSIT, false);
    await deposit.connect(user).withdrawDeposit();

    // Deploy de um novo contrato de reputacao vazio
    newReputation = await (await ethers.getContractFactory("RepairReputation")).deploy(
      await badge.getAddress(),
      await deposit.getAddress()
    );
    await newReputation.waitForDeployment();

    // Autorizar e conectar o novo contrato para que o deposit possa registrar
    await newReputation.authorizeContract(await deposit.getAddress());
    await badge.authorizeContract(await newReputation.getAddress());
    await deposit.authorizeContract(await newReputation.getAddress());

    // Apontar deposit para usar a nova reputacao
    await deposit.setRepairReputation(await newReputation.getAddress());

    // Agora redeposita como tecnico — deve registrar no novo contrato e mintar o badge
    await deposit.connect(user).deposit(MIN_DEPOSIT, true);
    const data = await deposit.getDeposit(user.address);
    expect(data.isTechnician).to.be.true;
    expect(await badge.hasBadge(user.address)).to.be.true;
    expect(await newReputation.getLevel(user.address)).to.equal(1);
  });
});
