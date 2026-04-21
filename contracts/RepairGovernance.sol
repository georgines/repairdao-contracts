// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IRepairTokenGov {
    function setTokensPerEth(uint256 newRate) external;
}

// Interface to interact with RepairDeposit contract
interface IRepairDepositGov {
    function isActive(address user) external view returns (bool);
    function setMinDeposit(uint256 newMin) external;
}

// Simplified DAO governance contract for the RepairDAO platform
contract RepairGovernance is Ownable {

    // Token used for voting
    IERC20 public immutable repairToken;

    // Deposit contract to verify active users
    IRepairDepositGov public immutable repairDeposit;

    // Total number of proposals
    uint256 public totalProposals;

    // Minimum tokens required for quorum
    uint256 public quorum = 1000 * 10 ** 18;

    // Fixed voting duration for all proposals
    uint256 public constant PROPOSAL_DURATION = 5 minutes;

    // Proposal action supported by governance execution
    enum ProposalAction {
        SetTokensPerEth,
        SetMinDeposit
    }

    // Proposal data structure
    struct Proposal {
        uint256 id;
        address proposer;
        string  description;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 deadline;
        bool    executed;
        bool    approved;
        ProposalAction action;
        uint256 actionValue;
    }

    // Proposals by ID
    mapping(uint256 => Proposal) public proposals;

    // Controls if address already voted on a proposal
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    // Events
    event ProposalCreated(uint256 indexed id, address indexed proposer, string description, uint256 deadline);
    event VoteCast(uint256 indexed id, address indexed voter, bool support, uint256 votingPower);
    event ProposalExecuted(uint256 indexed id, bool approved);
    event QuorumUpdated(uint256 newQuorum);
    event ProposalActionConfigured(uint256 indexed id, ProposalAction action, uint256 actionValue);

    // Constructor
    constructor(address _token, address _deposit) Ownable(msg.sender) {
        repairToken   = IERC20(_token);
        repairDeposit = IRepairDepositGov(_deposit);
    }

    function _canPropose(address proposer) internal view returns (bool) {
        return proposer == owner() || repairDeposit.isActive(proposer);
    }

    function _createProposal(
        string memory description,
        ProposalAction action,
        uint256 actionValue
    ) internal {
        require(_canPropose(msg.sender), "Must have active deposit or be owner");
        require(bytes(description).length > 0, "Description cannot be empty");

        totalProposals++;

        uint256 deadline = block.timestamp + PROPOSAL_DURATION;

        proposals[totalProposals] = Proposal({
            id:           totalProposals,
            proposer:     msg.sender,
            description:  description,
            votesFor:     0,
            votesAgainst: 0,
            deadline:     deadline,
            executed:     false,
            approved:     false,
            action:       action,
            actionValue:  actionValue
        });

        emit ProposalCreated(totalProposals, msg.sender, description, deadline);
        emit ProposalActionConfigured(totalProposals, action, actionValue);
    }

    // Owner or active user proposes a token emission rate change
    function createTokensPerEthProposal(
        string memory description,
        uint256 newRate
    ) external {
        require(newRate > 0, "Rate must be greater than zero");
        _createProposal(description, ProposalAction.SetTokensPerEth, newRate);
    }

    // Owner or active user proposes a minimum deposit change
    function createMinDepositProposal(
        string memory description,
        uint256 newMin
    ) external {
        require(newMin > 0, "Minimum deposit must be greater than zero");
        _createProposal(description, ProposalAction.SetMinDeposit, newMin);
    }

    // Token holder votes on a proposal
    function vote(uint256 proposalId, bool support) external {
        Proposal storage proposal = proposals[proposalId];

        require(block.timestamp < proposal.deadline, "Voting period ended");
        require(!hasVoted[proposalId][msg.sender], "Already voted");

        uint256 votingPower = repairToken.balanceOf(msg.sender);
        require(votingPower > 0, "No tokens to vote");

        hasVoted[proposalId][msg.sender] = true;

        if (support) {
            proposal.votesFor     += votingPower;
        } else {
            proposal.votesAgainst += votingPower;
        }

        emit VoteCast(proposalId, msg.sender, support, votingPower);
    }

    // Anyone executes a proposal after voting period ends
    function executeProposal(uint256 proposalId) external {
        Proposal storage proposal = proposals[proposalId];

        require(block.timestamp >= proposal.deadline, "Voting period not ended");
        require(!proposal.executed, "Already executed");

        proposal.executed = true;

        uint256 totalVotes = proposal.votesFor + proposal.votesAgainst;

        // Approved if quorum reached and majority voted for
        proposal.approved = totalVotes >= quorum &&
                            proposal.votesFor > proposal.votesAgainst;

        if (proposal.approved) {
            if (proposal.action == ProposalAction.SetTokensPerEth) {
                IRepairTokenGov(address(repairToken)).setTokensPerEth(proposal.actionValue);
            } else if (proposal.action == ProposalAction.SetMinDeposit) {
                repairDeposit.setMinDeposit(proposal.actionValue);
            }
        }

        emit ProposalExecuted(proposalId, proposal.approved);
    }

    // Returns proposal details
    function getProposal(uint256 proposalId) public view returns (Proposal memory) {
        return proposals[proposalId];
    }

    // Owner updates quorum
    function setQuorum(uint256 newQuorum) external onlyOwner {
        quorum = newQuorum;
        emit QuorumUpdated(newQuorum);
    }
}
