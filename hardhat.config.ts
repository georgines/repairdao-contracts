import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.25",
    settings: {
      evmVersion: "cancun"
    }
  },
  defaultNetwork: process.env.REPAIRDAO_DEFAULT_NETWORK || "hardhat",
  networks: {
    hardhat: {
      chainId: 1337
    },
    localhost: {
      url: process.env.HARDHAT_RPC_URL || "http://127.0.0.1:8545",
      accounts: process.env.HARDHAT_PRIVATE_KEY ? [process.env.HARDHAT_PRIVATE_KEY] : []
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts: process.env.SEPOLIA_PRIVATE_KEY ? [process.env.SEPOLIA_PRIVATE_KEY] : []
    }
  }
};

export default config;
