import { expect } from "chai";
import { ethers } from "hardhat";
import { RepairBadge } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("RepairBadge", () => {
  let badge: RepairBadge;
  let owner: HardhatEthersSigner;
  let authorized: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  beforeEach(async () => {
    [owner, authorized, user, user2] = await ethers.getSigners();
    badge = await (await ethers.getContractFactory("RepairBadge")).deploy();
    await badge.waitForDeployment();
    await badge.authorizeContract(authorized.address);
  });

  describe("deploy", () => {
    it("deve ter nome e simbolo corretos", async () => {
      expect(await badge.name()).to.equal("RepairBadge");
      expect(await badge.symbol()).to.equal("RPBDG");
    });

    it("deve definir owner corretamente", async () => {
      expect(await badge.owner()).to.equal(owner.address);
    });
  });

  describe("authorizeContract", () => {
    it("owner deve conseguir autorizar contrato", async () => {
      expect(await badge.authorizedContracts(authorized.address)).to.be.true;
    });

    it("nao owner nao pode autorizar", async () => {
      await expect(badge.connect(user).authorizeContract(user.address))
        .to.be.revertedWithCustomError(badge, "OwnableUnauthorizedAccount");
    });
  });

  describe("mintBadge", () => {
    it("autorizado deve conseguir mintar badge", async () => {
      await badge.connect(authorized).mintBadge(user.address);
      expect(await badge.hasBadge(user.address)).to.be.true;
      expect(await badge.levelOf(user.address)).to.equal(1);
    });

    it("deve emitir evento BadgeMinted", async () => {
      await expect(badge.connect(authorized).mintBadge(user.address))
        .to.emit(badge, "BadgeMinted")
        .withArgs(user.address, 1, 1);
    });

    it("deve falhar para endereco zero", async () => {
      await expect(badge.connect(authorized).mintBadge(ethers.ZeroAddress))
        .to.be.revertedWith("Invalid address");
    });

    it("deve falhar se usuario ja tem badge", async () => {
      await badge.connect(authorized).mintBadge(user.address);
      await expect(badge.connect(authorized).mintBadge(user.address))
        .to.be.revertedWith("User already has a badge");
    });

    it("nao autorizado nao pode mintar", async () => {
      await expect(badge.connect(user).mintBadge(user2.address))
        .to.be.revertedWith("Not authorized");
    });
  });

  describe("burnBadge", () => {
    beforeEach(async () => {
      await badge.connect(authorized).mintBadge(user.address);
    });

    it("autorizado deve conseguir queimar badge", async () => {
      await badge.connect(authorized).burnBadge(user.address);
      expect(await badge.hasBadge(user.address)).to.be.false;
      expect(await badge.levelOf(user.address)).to.equal(0);
    });

    it("deve emitir evento BadgeBurned", async () => {
      const tokenId = await badge.tokenIdOf(user.address);
      await expect(badge.connect(authorized).burnBadge(user.address))
        .to.emit(badge, "BadgeBurned")
        .withArgs(user.address, tokenId);
    });

    it("deve falhar se usuario nao tem badge", async () => {
      await expect(badge.connect(authorized).burnBadge(user2.address))
        .to.be.revertedWith("User does not have a badge");
    });
  });

  describe("updateBadge", () => {
    beforeEach(async () => {
      await badge.connect(authorized).mintBadge(user.address);
    });

    it("deve atualizar nivel do badge", async () => {
      await badge.connect(authorized).updateBadge(user.address, 3);
      expect(await badge.levelOf(user.address)).to.equal(3);
    });

    it("deve emitir evento BadgeUpdated", async () => {
      await expect(badge.connect(authorized).updateBadge(user.address, 2))
        .to.emit(badge, "BadgeUpdated");
    });

    it("deve falhar para nivel invalido", async () => {
      await expect(badge.connect(authorized).updateBadge(user.address, 6))
        .to.be.revertedWith("Invalid level");
    });

    it("deve falhar se usuario nao tem badge", async () => {
      await expect(badge.connect(authorized).updateBadge(user2.address, 2))
        .to.be.revertedWith("User does not have a badge");
    });
  });

  describe("getLevelName", () => {
    it("deve retornar nome correto para cada nivel", async () => {
      await badge.connect(authorized).mintBadge(user.address);
      expect(await badge.getLevelName(user.address)).to.equal("Bronze");
      await badge.connect(authorized).updateBadge(user.address, 2);
      expect(await badge.getLevelName(user.address)).to.equal("Silver");
      await badge.connect(authorized).updateBadge(user.address, 3);
      expect(await badge.getLevelName(user.address)).to.equal("Gold");
      await badge.connect(authorized).updateBadge(user.address, 4);
      expect(await badge.getLevelName(user.address)).to.equal("Platinum");
      await badge.connect(authorized).updateBadge(user.address, 5);
      expect(await badge.getLevelName(user.address)).to.equal("Elite");
    });

    it("deve retornar None para usuario sem badge", async () => {
      expect(await badge.getLevelName(user.address)).to.equal("None");
    });
  });

  describe("soulbound", () => {
    it("deve bloquear transferencia", async () => {
      await badge.connect(authorized).mintBadge(user.address);
      const tokenId = await badge.tokenIdOf(user.address);
      await expect(badge.connect(user).transferFrom(user.address, user2.address, tokenId))
        .to.be.revertedWith("Badge cannot be transferred");
    });

    it("deve bloquear approve", async () => {
      await badge.connect(authorized).mintBadge(user.address);
      const tokenId = await badge.tokenIdOf(user.address);
      await expect(badge.connect(user).approve(user2.address, tokenId))
        .to.be.revertedWith("Approvals disabled for soulbound tokens");
    });

    it("deve bloquear setApprovalForAll", async () => {
      await expect(badge.connect(user).setApprovalForAll(user2.address, true))
        .to.be.revertedWith("Approvals disabled for soulbound tokens");
    });
  });
});
