// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

// Interface to interact with RepairBadge contract
interface IRepairBadge {
    function mintBadge(address user) external;
    function burnBadge(address user) external;
    function updateBadge(address user, uint8 newLevel) external;
    function getBadgeLevel(address user) external view returns (uint8);
    function hasBadge(address user) external view returns (bool);
}

// Interface to interact with RepairDeposit contract
interface IRepairDeposit {
    function isActive(address user) external view returns (bool);
    function updateRate(address user, uint256 newRate) external;
}

// Interface for the reputation contract itself
interface IRepairReputation {
    function registerUser(address user) external;
    function rate(address rated, uint8 rating, uint256 serviceId) external;
    function rateFrom(address rater, address rated, uint8 rating, uint256 serviceId) external;
    function penalize(address user) external;
    function reward(address user) external;
    function getLevel(address user) external view returns (uint8);
    function getUserRate(address user) external view returns (uint256);
}

// Contract that manages reputation and trust levels of technicians and clients
contract RepairReputation is Ownable, IRepairReputation {

    // Contract addresses
    IRepairBadge public immutable repairBadge;
    IRepairDeposit public immutable repairDeposit;

    // Authorized contracts that can call reputation functions
    mapping(address => bool) public authorizedContracts;

    // Reputation levels
    uint8 public constant LEVEL_1 = 1;
    uint8 public constant LEVEL_2 = 2;
    uint8 public constant LEVEL_3 = 3;
    uint8 public constant LEVEL_4 = 4;
    uint8 public constant LEVEL_5 = 5;

    // Annual yield rates per level (in basis points — 1% = 100)
    uint256 public constant RATE_LEVEL_1 = 1100; // 11%
    uint256 public constant RATE_LEVEL_2 = 1200; // 12%
    uint256 public constant RATE_LEVEL_3 = 1300; // 13%
    uint256 public constant RATE_LEVEL_4 = 1400; // 14%
    uint256 public constant RATE_LEVEL_5 = 1500; // 15%

    // Points required to level up
    uint256 public constant POINTS_PER_LEVEL = 10;

    // Penalty points for fraud or losing dispute
    uint256 public constant PENALTY_POINTS = 5;

    // Reward points for winning dispute vote
    uint256 public constant REWARD_POINTS = 2;

    // User reputation data
    struct Reputation {
        uint8 level;
        uint256 totalPoints;
        uint256 positiveRatings;
        uint256 negativeRatings;
        uint256 totalRatings;
        uint256 ratingSum;
    }

    // Reputation by address
    mapping(address => Reputation) public reputations;

    // Controls if user A already rated user B for a specific service
    // serviceId => rater => rated => bool
    mapping(uint256 => mapping(address => mapping(address => bool))) public hasRated;

    // Events
    event UserRegistered(address indexed user, uint8 level);
    event RatingSubmitted(address indexed rater, address indexed rated, uint8 rating, uint256 serviceId);
    event LevelUp(address indexed user, uint8 oldLevel, uint8 newLevel);
    event LevelDown(address indexed user, uint8 oldLevel, uint8 newLevel);
    event UserPenalized(address indexed user, uint256 points);
    event UserRewarded(address indexed user, uint256 points);

    // Constructor
    constructor(address _badge, address _deposit) Ownable(msg.sender) {
        repairBadge = IRepairBadge(_badge);
        repairDeposit = IRepairDeposit(_deposit);
    }

    // Authorize a contract to call reputation functions
    function authorizeContract(address contractAddress) external onlyOwner {
        authorizedContracts[contractAddress] = true;
    }

    modifier onlyAuthorized() {
        require(
            authorizedContracts[msg.sender] || msg.sender == owner(),
            "Not authorized"
        );
        _;
    }

    // Register a new user at level 1
    function registerUser(address user) external onlyAuthorized {
        require(user != address(0), "Invalid address");
        require(reputations[user].level == 0, "User already registered");

        reputations[user] = Reputation({
            level: LEVEL_1,
            totalPoints: 0,
            positiveRatings: 0,
            negativeRatings: 0,
            totalRatings: 0,
            ratingSum: 0
        });

        // Mint badge at level 1
        repairBadge.mintBadge(user);

        emit UserRegistered(user, LEVEL_1);
    }

    // User rates another user after a service
    function rate(
        address rated,
        uint8 rating,
        uint256 serviceId
    ) external {
        _rate(msg.sender, rated, rating, serviceId);
    }

    function rateFrom(
        address rater,
        address rated,
        uint8 rating,
        uint256 serviceId
    ) external onlyAuthorized {
        _rate(rater, rated, rating, serviceId);
    }

    function _rate(
        address rater,
        address rated,
        uint8 rating,
        uint256 serviceId
    ) internal {
        require(rater != address(0), "Invalid address");
        require(rated != address(0), "Invalid address");
        require(rated != rater, "Cannot rate yourself");
        require(rating >= 1 && rating <= 5, "Rating must be between 1 and 5");
        require(repairDeposit.isActive(rater), "Rater must have active deposit");
        require(repairDeposit.isActive(rated), "Rated user must have active deposit");
        require(!hasRated[serviceId][rater][rated], "Already rated for this service");

        hasRated[serviceId][rater][rated] = true;

        Reputation storage rep = reputations[rated];
        rep.totalRatings++;
        rep.ratingSum += rating;

        if (rating >= 4) {
            rep.positiveRatings++;
            rep.totalPoints += 2;
            emit UserRewarded(rated, 2);
        } else if (rating <= 2) {
            rep.negativeRatings++;
            if (rep.totalPoints >= 3) {
                rep.totalPoints -= 3;
            } else {
                rep.totalPoints = 0;
            }
            emit UserPenalized(rated, 3);
        }

        _updateLevel(rated);

        emit RatingSubmitted(rater, rated, rating, serviceId);
    }

    // Penalize a user for fraud or losing a dispute
    function penalize(address user) external onlyAuthorized {
        require(reputations[user].level > 0, "User not registered");

        Reputation storage rep = reputations[user];

        if (rep.totalPoints >= PENALTY_POINTS) {
            rep.totalPoints -= PENALTY_POINTS;
        } else {
            rep.totalPoints = 0;
        }

        rep.negativeRatings++;

        _updateLevel(user);

        emit UserPenalized(user, PENALTY_POINTS);
    }

    // Reward a user for voting on the winning side
    function reward(address user) external onlyAuthorized {
        require(reputations[user].level > 0, "User not registered");

        Reputation storage rep = reputations[user];
        rep.totalPoints += REWARD_POINTS;
        rep.positiveRatings++;

        _updateLevel(user);

        emit UserRewarded(user, REWARD_POINTS);
    }

    // Internal function to update level based on points
    function _updateLevel(address user) internal {
        Reputation storage rep = reputations[user];
        uint8 oldLevel = rep.level;
        uint8 newLevel = _calculateLevel(rep.totalPoints);

        if (newLevel != oldLevel) {
            rep.level = newLevel;

            // Update badge
            repairBadge.updateBadge(user, newLevel);

            // Update deposit rate
            uint256 newRate = _getRateForLevel(newLevel);
            repairDeposit.updateRate(user, newRate);

            if (newLevel > oldLevel) {
                emit LevelUp(user, oldLevel, newLevel);
            } else {
                emit LevelDown(user, oldLevel, newLevel);
            }
        }
    }

    // Calculate level based on total points
    function _calculateLevel(uint256 points) internal pure returns (uint8) {
        if (points >= POINTS_PER_LEVEL * 4) return LEVEL_5;
        if (points >= POINTS_PER_LEVEL * 3) return LEVEL_4;
        if (points >= POINTS_PER_LEVEL * 2) return LEVEL_3;
        if (points >= POINTS_PER_LEVEL * 1) return LEVEL_2;
        return LEVEL_1;
    }

    // Returns annual rate for a given level
    function _getRateForLevel(uint8 level) internal pure returns (uint256) {
        if (level == LEVEL_5) return RATE_LEVEL_5;
        if (level == LEVEL_4) return RATE_LEVEL_4;
        if (level == LEVEL_3) return RATE_LEVEL_3;
        if (level == LEVEL_2) return RATE_LEVEL_2;
        return RATE_LEVEL_1;
    }

    // Returns current level of a user
    function getLevel(address user) public view returns (uint8) {
        return reputations[user].level;
    }

    // Returns average rating of a user
    function getAverageRating(address user) public view returns (uint256) {
        Reputation storage rep = reputations[user];
        if (rep.totalRatings == 0) return 0;
        return rep.ratingSum / rep.totalRatings;
    }

    // Returns full reputation data of a user
    function getReputation(address user) public view returns (Reputation memory) {
        return reputations[user];
    }

    // Returns annual rate for a user based on current level
    function getUserRate(address user) public view returns (uint256) {
        return _getRateForLevel(reputations[user].level);
    }
}
