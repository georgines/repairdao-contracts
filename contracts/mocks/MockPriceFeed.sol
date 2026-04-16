// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Fix: missing-inheritance — inherit from the same interface used in RepairDeposit
interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
    function decimals() external view returns (uint8);
}

// Mock Chainlink price feed for local testing only
// Fix: missing-inheritance — now inherits AggregatorV3Interface
contract MockPriceFeed is AggregatorV3Interface {

    int256 private _price;

    // Fix: constable-states — use constant instead of state variable
    uint8 private constant _DECIMALS = 8;

    constructor(int256 initialPrice) {
        _price = initialPrice;
    }

    function latestRoundData() external view override returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (1, _price, block.timestamp, block.timestamp, 1);
    }

    // Fix: constable-states — returns constant value
    function decimals() external pure override returns (uint8) {
        return _DECIMALS;
    }

    // Update price for testing purposes only
    function setPrice(int256 newPrice) external {
        _price = newPrice;
    }
}
