// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// Native token of the RepairDAO platform
contract RepairToken is ERC20, Ownable {

    // Fix: too-many-digits — named constant avoids literal with many digits
    uint256 private constant INITIAL_SUPPLY = 1_000_000;

    // How many tokens per 1 ETH
    uint256 public tokensPerEth = 1000;

    // Events
    event TokensPurchased(address indexed buyer, uint256 ethAmount, uint256 tokenAmount);
    event TokensBurned(address indexed burner, uint256 amount);
    event RateUpdated(uint256 newRate);
    // Fix: reentrancy-events — receiver instead of owner() after external call
    event EthWithdrawn(address indexed receiver, uint256 amount);

    constructor() ERC20("RepairToken", "RPT") Ownable(msg.sender) {
        _mint(msg.sender, INITIAL_SUPPLY * 10 ** decimals());
    }

    // User sends ETH and receives RPT tokens
    function buy() external payable {
        require(msg.value > 0, "Send ETH to buy tokens");
        uint256 amount = msg.value * tokensPerEth;
        _mint(msg.sender, amount);
        emit TokensPurchased(msg.sender, msg.value, amount);
    }

    // Owner mints tokens to a specific address
    function mint(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid address");
        require(amount > 0, "Amount must be greater than zero");
        _mint(to, amount);
    }

    // User burns their own tokens
    function burn(uint256 amount) external {
        require(amount > 0, "Amount must be greater than zero");
        _burn(msg.sender, amount);
        emit TokensBurned(msg.sender, amount);
    }

    // Owner updates the conversion rate
    function setTokensPerEth(uint256 newRate) external onlyOwner {
        require(newRate > 0, "Rate must be greater than zero");
        tokensPerEth = newRate;
        emit RateUpdated(newRate);
    }

    // Fix: reentrancy-unlimited-gas — use call instead of transfer
    // Fix: reentrancy-events — emit before external call
    function withdraw() external onlyOwner {
        uint256 balance  = address(this).balance;
        require(balance > 0, "No ETH to withdraw");
        address receiver = owner();
        emit EthWithdrawn(receiver, balance);
        (bool success, ) = payable(receiver).call{value: balance}("");
        require(success, "ETH transfer failed");
    }
}
