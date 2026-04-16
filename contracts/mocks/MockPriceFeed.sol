// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Mock Chainlink price feed for local testing
contract MockPriceFeed {

    int256 private _price;
    uint8 private _decimals = 8;

    constructor(int256 initialPrice) {
        _price = initialPrice;
    }

    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (1, _price, block.timestamp, block.timestamp, 1);
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    // Update price for testing
    function setPrice(int256 newPrice) external {
        _price = newPrice;
    }
}