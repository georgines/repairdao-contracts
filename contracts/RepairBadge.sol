// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// Soulbound NFT representing the current reputation level of a user
contract RepairBadge is ERC721, Ownable {

    uint256 private _tokenIdCounter;

    uint8 public constant BRONZE   = 1;
    uint8 public constant SILVER   = 2;
    uint8 public constant GOLD     = 3;
    uint8 public constant PLATINUM = 4;
    uint8 public constant ELITE    = 5;

    mapping(address => uint256) public tokenIdOf;
    mapping(address => uint8)   public levelOf;
    mapping(address => bool)    public hasBadge;

    // Authorized contracts that can call badge functions
    mapping(address => bool) public authorizedContracts;

    // Events
    event BadgeMinted(address indexed user, uint256 tokenId, uint8 level);
    event BadgeBurned(address indexed user, uint256 tokenId);
    event BadgeUpdated(address indexed user, uint256 oldTokenId, uint256 newTokenId, uint8 newLevel);

    constructor() ERC721("RepairBadge", "RPBDG") Ownable(msg.sender) {}

    // Authorize a contract to call badge functions
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

    // Mint a badge for a user at level 1
    function mintBadge(address user) external onlyAuthorized {
        require(user != address(0), "Invalid address");
        require(!hasBadge[user], "User already has a badge");

        _tokenIdCounter++;
        uint256 newTokenId = _tokenIdCounter;

        hasBadge[user]    = true;
        tokenIdOf[user]   = newTokenId;
        levelOf[user]     = BRONZE;

        _mint(user, newTokenId);

        emit BadgeMinted(user, newTokenId, BRONZE);
    }

    // Burn the badge of a user
    function burnBadge(address user) external onlyAuthorized {
        require(hasBadge[user], "User does not have a badge");

        uint256 tokenId = tokenIdOf[user];

        hasBadge[user]  = false;
        tokenIdOf[user] = 0;
        levelOf[user]   = 0;

        _burn(tokenId);

        emit BadgeBurned(user, tokenId);
    }

    // Update badge level — burns old and mints new
    function updateBadge(address user, uint8 newLevel) external onlyAuthorized {
        require(hasBadge[user], "User does not have a badge");
        require(newLevel >= BRONZE && newLevel <= ELITE, "Invalid level");

        uint256 oldTokenId = tokenIdOf[user];
        _burn(oldTokenId);

        _tokenIdCounter++;
        uint256 newTokenId = _tokenIdCounter;

        tokenIdOf[user] = newTokenId;
        levelOf[user]   = newLevel;

        _mint(user, newTokenId);

        emit BadgeUpdated(user, oldTokenId, newTokenId, newLevel);
    }

    // Returns the level name of a user
    function getLevelName(address user) public view returns (string memory) {
        uint8 level = levelOf[user];
        if (level == BRONZE)   return "Bronze";
        if (level == SILVER)   return "Silver";
        if (level == GOLD)     return "Gold";
        if (level == PLATINUM) return "Platinum";
        if (level == ELITE)    return "Elite";
        return "None";
    }

    // Returns the current level of a user
    function getBadgeLevel(address user) public view returns (uint8) {
        return levelOf[user];
    }

    // Block transfers — soulbound token
    function _update(address to, uint256 tokenId, address auth)
        internal
        virtual
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            revert("Badge cannot be transferred");
        }
        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override {
        revert("Approvals disabled for soulbound tokens");
    }

    function setApprovalForAll(address, bool) public pure override {
        revert("Approvals disabled for soulbound tokens");
    }
}
