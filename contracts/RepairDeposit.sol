// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// Interface to interact with RepairBadge contract
interface IRepairBadgeDeposit {
    function burnBadge(address user) external;
    function hasBadge(address user) external view returns (bool);
}

// Interface to interact with RepairReputation contract
interface IRepairReputationDeposit {
    function registerUser(address user) external;
    function getLevel(address user) external view returns (uint8);
    function unregisterUser(address user) external;
}

// Interface for the deposit contract itself
interface IRepairDeposit {
    function deposit(uint256 amount, bool isTechnician) external;
    function getRewards(address user) external view returns (uint256);
    function withdrawRewards() external;
    function withdrawDeposit() external;
    function slash(address user, uint256 percent) external;
    function updateRate(address user, uint256 newRate) external;
    function isActive(address user) external view returns (bool);
    function setMinDeposit(uint256 newMin) external;
    function setSlashPercent(uint256 percent) external;
}

// Interface to interact with Chainlink price feed
interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}

// Contract that manages deposits and rewards for technicians and clients
contract RepairDeposit is Ownable, ReentrancyGuard, IRepairDeposit {
    using SafeERC20 for IERC20;

    // Token used for deposits
    IERC20 public immutable repairToken;

    // External contracts
    IRepairBadgeDeposit public immutable repairBadge;
    IRepairReputationDeposit public repairReputation;
    AggregatorV3Interface public immutable priceFeed;

    // Authorized contracts that can call slash and updateRate
    mapping(address => bool) public authorizedContracts;

    // Annual yield rates per level in basis points (1% = 100)
    mapping(uint8 => uint256) public ratePerLevel;

    // User deposit data
    struct DepositData {
        uint256 amount;
        uint256 depositedAt;
        uint256 lastClaimedAt;
        uint256 customRate;
        bool active;
        bool isTechnician;
    }

    // Deposits by address
    mapping(address => DepositData) public deposits;

    // Minimum deposit amount
    uint256 public minDeposit = 100 * 10 ** 18;

    // Slash percentage for fraud (10%)
    uint256 public slashPercent = 10;

    // Events
    event Deposited(address indexed user, uint256 amount, bool isTechnician);
    event RewardsClaimed(address indexed user, uint256 amount);
    event DepositWithdrawn(address indexed user, uint256 amount);
    event UserSlashed(address indexed user, uint256 amount);
    event RateUpdated(address indexed user, uint256 newRate);
    event MinDepositUpdated(uint256 newMin);
    event RepairReputationUpdated(address indexed newReputation);
    event SlashPercentUpdated(uint256 newPercent);

    // Constructor
    constructor(
        address _token,
        address _badge,
        address _reputation,
        address _priceFeed
    ) Ownable(msg.sender) {
        repairToken    = IERC20(_token);
        repairBadge    = IRepairBadgeDeposit(_badge);
        repairReputation = IRepairReputationDeposit(_reputation);
        priceFeed      = AggregatorV3Interface(_priceFeed);

        // Set default rates per level
        ratePerLevel[1] = 1100; // 11%
        ratePerLevel[2] = 1200; // 12%
        ratePerLevel[3] = 1300; // 13%
        ratePerLevel[4] = 1400; // 14%
        ratePerLevel[5] = 1500; // 15%
    }

    // Authorize a contract to call slash and updateRate
    function authorizeContract(address contractAddress) external onlyOwner {
        authorizedContracts[contractAddress] = true;
    }

    // Owner can update the reputation contract address
    function setRepairReputation(address reputationAddress) external onlyOwner {
        require(reputationAddress != address(0), "Invalid reputation");
        repairReputation = IRepairReputationDeposit(reputationAddress);
        emit RepairReputationUpdated(reputationAddress);
    }

    modifier onlyAuthorized() {
        require(
            authorizedContracts[msg.sender] || msg.sender == owner(),
            "Not authorized"
        );
        _;
    }

    // Returns current ETH/USD price from Chainlink
    function getEthUsdPrice() public view returns (int256) {
        (
            uint80 roundId,
            int256 price,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = priceFeed.latestRoundData();

        require(price > 0, "Invalid price feed");
        require(startedAt > 0, "Stale start");
        require(updatedAt > 0, "Stale price feed");
        require(answeredInRound >= roundId, "Stale round");

        return price;
    }

    // User deposits tokens to activate account
    function deposit(uint256 amount, bool isTechnician) external nonReentrant {
        require(amount >= minDeposit, "Below minimum deposit");
        require(!deposits[msg.sender].active, "Already has active deposit");

        repairToken.safeTransferFrom(msg.sender, address(this), amount);

        deposits[msg.sender] = DepositData({
            amount: amount,
            depositedAt: block.timestamp,
            lastClaimedAt: block.timestamp,
            customRate: 0,
            active: true,
            isTechnician: isTechnician
        });

        // Register user in reputation contract
        repairReputation.registerUser(msg.sender);

        emit Deposited(msg.sender, amount, isTechnician);
    }

    // Calculate pending rewards for a user
    function getRewards(address user) public view returns (uint256) {
        DepositData storage data = deposits[user];
        if (!data.active) return 0;

        uint256 timeElapsed = block.timestamp - data.lastClaimedAt;
        uint8 level = repairReputation.getLevel(user);

        // Use custom rate if set, otherwise use level rate
        uint256 annualRate = data.customRate > 0
            ? data.customRate
            : ratePerLevel[level];

        // Multiply before dividing to preserve precision
        int256 ethPrice = getEthUsdPrice();
        uint256 baseReward = (data.amount * annualRate * timeElapsed * 2000 * 10 ** 8)
                           / (365 days * 10000 * uint256(ethPrice));

        return baseReward;
    }

    // User claims pending rewards without touching deposit
    function withdrawRewards() external nonReentrant {
        require(deposits[msg.sender].active, "No active deposit");

        uint256 rewards = getRewards(msg.sender);

        uint256 principal        = deposits[msg.sender].amount;
        uint256 availableBalance = repairToken.balanceOf(address(this));
        uint256 availableRewards = availableBalance > principal
            ? availableBalance - principal
            : 0;

        if (rewards > availableRewards) {
            rewards = availableRewards;
        }

        require(rewards > 0, "No rewards to claim");

        deposits[msg.sender].lastClaimedAt = block.timestamp;

        repairToken.safeTransfer(msg.sender, rewards);

        emit RewardsClaimed(msg.sender, rewards);
    }

    // User withdraws full deposit — loses badge and level
    function withdrawDeposit() external nonReentrant {
        require(deposits[msg.sender].active, "No active deposit");

        uint256 amount = deposits[msg.sender].amount;

        uint256 rewards          = getRewards(msg.sender);
        uint256 availableBalance = repairToken.balanceOf(address(this));
        uint256 availableRewards = availableBalance > amount
            ? availableBalance - amount
            : 0;

        if (rewards > availableRewards) {
            rewards = availableRewards;
        }

        // Deactivate account before external calls
        deposits[msg.sender].active = false;
        deposits[msg.sender].amount = 0;

        // Burn badge
        if (repairBadge.hasBadge(msg.sender)) {
            repairBadge.burnBadge(msg.sender);
        }

        // Unregister user from reputation (reset their reputation record)
        repairReputation.unregisterUser(msg.sender);

        // Transfer deposit + rewards
        repairToken.safeTransfer(msg.sender, amount + rewards);

        emit DepositWithdrawn(msg.sender, amount + rewards);
    }

    // Slash a portion of user deposit for fraud or losing dispute
    function slash(address user, uint256 percent) external onlyAuthorized nonReentrant {
        require(deposits[user].active, "No active deposit");
        require(percent > 0 && percent <= 50, "Invalid slash percent");

        uint256 slashAmount = (deposits[user].amount * percent) / 100;
        deposits[user].amount -= slashAmount;

        repairToken.safeTransfer(owner(), slashAmount);

        emit UserSlashed(user, slashAmount);
    }

    // Update annual rate for a user based on new reputation level
    function updateRate(address user, uint256 newRate) external onlyAuthorized {
        deposits[user].customRate = newRate;
        emit RateUpdated(user, newRate);
    }

    // Returns whether a user has an active deposit
    function isActive(address user) public view returns (bool) {
        return deposits[user].active;
    }

    // Returns deposit data of a user
    function getDeposit(address user) public view returns (DepositData memory) {
        return deposits[user];
    }

    // Owner updates minimum deposit
    function setMinDeposit(uint256 newMin) external onlyOwner {
        minDeposit = newMin;
        emit MinDepositUpdated(newMin);
    }

    // Owner updates slash percent
    function setSlashPercent(uint256 percent) external onlyOwner {
        require(percent > 0 && percent <= 50, "Invalid percent");
        slashPercent = percent;
        emit SlashPercentUpdated(percent);
    }
}
