import { expect } from "chai";
import { ethers } from "hardhat";
import { RepairToken } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("RepairToken", () => {
  let token: RepairToken;
  let owner: HardhatEthersSigner;
  let user: HardhatEthersSigner;

  beforeEach(async () => {
    [owner, user] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("RepairToken")).deploy();
    await token.waitForDeployment();
    await token.setGovernance(user.address);
  });

  describe("deploy", () => {
    it("deve ter nome e simbolo corretos", async () => {
      expect(await token.name()).to.equal("RepairToken");
      expect(await token.symbol()).to.equal("RPT");
    });

    it("deve mintar 1 milhão de tokens para o owner", async () => {
      const balance = await token.balanceOf(owner.address);
      expect(balance).to.equal(ethers.parseUnits("1000000", 18));
    });

    it("deve definir tokensPerEth como 10000000", async () => {
      expect(await token.tokensPerEth()).to.equal(10000000);
    });
  });

  describe("buy", () => {
    it("deve receber ETH e mintar tokens", async () => {
      const ethAmount = ethers.parseEther("1");
      await token.connect(user).buy({ value: ethAmount });
      const balance = await token.balanceOf(user.address);
      expect(balance).to.equal(ethers.parseUnits("10000000", 18));
    });

    it("deve falhar se não enviar ETH", async () => {
      await expect(token.connect(user).buy({ value: 0 }))
        .to.be.revertedWith("Send ETH to buy tokens");
    });

    it("deve emitir evento TokensPurchased", async () => {
      const ethAmount = ethers.parseEther("1");
      await expect(token.connect(user).buy({ value: ethAmount }))
        .to.emit(token, "TokensPurchased")
        .withArgs(user.address, ethAmount, ethers.parseUnits("10000000", 18));
    });
  });

  describe("mint", () => {
    it("owner deve conseguir mintar tokens", async () => {
      const amount = ethers.parseUnits("500", 18);
      await token.mint(user.address, amount);
      expect(await token.balanceOf(user.address)).to.equal(amount);
    });

    it("não owner não pode mintar", async () => {
      await expect(token.connect(user).mint(user.address, 100))
        .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });

    it("deve falhar para endereço zero", async () => {
      await expect(token.mint(ethers.ZeroAddress, 100))
        .to.be.revertedWith("Invalid address");
    });
  });

  describe("burn", () => {
    it("deve queimar tokens do próprio usuário", async () => {
      const amount = ethers.parseUnits("100", 18);
      await token.mint(user.address, amount);
      await token.connect(user).burn(amount);
      expect(await token.balanceOf(user.address)).to.equal(0);
    });

    it("deve falhar se amount for zero", async () => {
      await expect(token.connect(user).burn(0))
        .to.be.revertedWith("Amount must be greater than zero");
    });

    it("deve emitir evento TokensBurned", async () => {
      const amount = ethers.parseUnits("100", 18);
      await token.mint(user.address, amount);
      await expect(token.connect(user).burn(amount))
        .to.emit(token, "TokensBurned")
        .withArgs(user.address, amount);
    });
  });

  describe("setTokensPerEth", () => {
    it("governanca deve conseguir atualizar a taxa", async () => {
      await token.connect(user).setTokensPerEth(2000);
      expect(await token.tokensPerEth()).to.equal(2000);
    });

    it("não governanca não pode atualizar a taxa", async () => {
      await expect(token.connect(owner).setTokensPerEth(2000))
        .to.be.revertedWith("Not governance");
    });

    it("deve falhar se taxa for zero", async () => {
      await expect(token.connect(user).setTokensPerEth(0))
        .to.be.revertedWith("Rate must be greater than zero");
    });
  });

  describe("withdraw", () => {
    it("owner deve conseguir sacar ETH acumulado", async () => {
      await token.connect(user).buy({ value: ethers.parseEther("1") });
      const balanceBefore = await ethers.provider.getBalance(owner.address);
      await token.withdraw();
      const balanceAfter = await ethers.provider.getBalance(owner.address);
      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("deve falhar se não houver ETH", async () => {
      await expect(token.withdraw())
        .to.be.revertedWith("No ETH to withdraw");
    });

    it("não owner não pode sacar", async () => {
      await token.connect(user).buy({ value: ethers.parseEther("1") });
      await expect(token.connect(user).withdraw())
        .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });
  });
});
