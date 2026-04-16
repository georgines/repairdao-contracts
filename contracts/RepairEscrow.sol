// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Interface to interact with RepairDeposit contract
interface IRepairDepositEscrow {
    function isActive(address user) external view returns (bool);
    function slash(address user, uint256 percent) external;
}

// Interface to interact with RepairReputation contract
interface IRepairReputationEscrow {
    function rate(address rated, uint8 rating, uint256 serviceId) external;
    function rateFrom(address rater, address rated, uint8 rating, uint256 serviceId) external;
    function penalize(address user) external;
    function reward(address user) external;
    function getLevel(address user) external view returns (uint8);
}

// Contract that manages secure payments between clients and technicians
contract RepairEscrow is Ownable, ReentrancyGuard {

    IERC20 public repairToken;
    IRepairDepositEscrow public repairDeposit;
    IRepairReputationEscrow public repairReputation;

    // Voting period for disputes (1 day)
    uint256 public votingPeriod = 1 days;

    // Slash percent for losing party (20%)
    uint256 public slashPercent = 20;

    // Possible states of a service order
    enum ServiceState {
        Open,
        Budgeted,
        InProgress,
        Completed,
        Disputed,
        Resolved
    }

    // Service order data structure
    struct ServiceOrder {
        uint256 id;
        address client;
        address technician;
        uint256 amount;
        string description;
        ServiceState state;
        uint256 createdAt;
        uint256 completedAt;
        bool clientRated;
        bool technicianRated;
    }

    // Evidence data structure
    struct Evidence {
        address submittedBy;
        string content;
        uint256 timestamp;
    }

    // Dispute data structure
    struct Dispute {
        uint256 orderId;
        address openedBy;
        address opposingParty;
        uint256 votesForOpener;
        uint256 votesForOpposing;
        uint256 deadline;
        bool resolved;
        string reason;
    }

    // Total number of orders
    uint256 public totalOrders;

    // Orders by ID
    mapping(uint256 => ServiceOrder) public orders;

    // Disputes by order ID
    mapping(uint256 => Dispute) public disputes;

    // Evidences by order ID
    mapping(uint256 => Evidence[]) public evidences;

    // Controls if address already voted on a dispute
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    // Controls which side each voter voted
    // true = voted for opener, false = voted for opposing
    mapping(uint256 => mapping(address => bool)) public voteSide;

    // List of voters per dispute
    mapping(uint256 => address[]) public voters;

    // Orders by client
    mapping(address => uint256[]) public ordersByClient;

    // Orders by technician
    mapping(address => uint256[]) public ordersByTechnician;

    // Events
    event OrderCreated(uint256 indexed id, address indexed client, string description);
    event BudgetSubmitted(uint256 indexed id, address indexed technician, uint256 amount);
    event BudgetAccepted(uint256 indexed id, address indexed client, uint256 amount);
    event OrderCompleted(uint256 indexed id, address indexed technician);
    event CompletionConfirmed(uint256 indexed id, address indexed client);
    event RatingSubmitted(uint256 indexed id, address indexed rater, address indexed rated, uint8 rating);
    event DisputeOpened(uint256 indexed id, address indexed openedBy, address indexed opposingParty, string reason);
    event EvidenceSubmitted(uint256 indexed id, address indexed submittedBy);
    event VoteCast(uint256 indexed id, address indexed voter, bool supportOpener);
    event DisputeResolved(uint256 indexed id, address winner, uint256 votesForOpener, uint256 votesForOpposing);
    event PaymentReleased(uint256 indexed id, address indexed recipient, uint256 amount);

    // Constructor
    constructor(
        address _token,
        address _deposit,
        address _reputation
    ) Ownable(msg.sender) {
        repairToken = IERC20(_token);
        repairDeposit = IRepairDepositEscrow(_deposit);
        repairReputation = IRepairReputationEscrow(_reputation);
    }

    // Client creates a service order
    function createOrder(string memory description) external nonReentrant {
        require(repairDeposit.isActive(msg.sender), "Client must have active deposit");
        require(bytes(description).length > 0, "Description cannot be empty");

        totalOrders++;

        orders[totalOrders] = ServiceOrder({
            id: totalOrders,
            client: msg.sender,
            technician: address(0),
            amount: 0,
            description: description,
            state: ServiceState.Open,
            createdAt: block.timestamp,
            completedAt: 0,
            clientRated: false,
            technicianRated: false
        });

        ordersByClient[msg.sender].push(totalOrders);

        emit OrderCreated(totalOrders, msg.sender, description);
    }

    // Technician submits a budget for an open order
    function submitBudget(uint256 orderId, uint256 amount) external nonReentrant {
        ServiceOrder storage order = orders[orderId];
        require(repairDeposit.isActive(msg.sender), "Technician must have active deposit");
        require(order.state == ServiceState.Open, "Order is not open");
        require(order.client != msg.sender, "Client cannot be technician");
        require(amount > 0, "Amount must be greater than zero");

        order.technician = msg.sender;
        order.amount = amount;
        order.state = ServiceState.Budgeted;

        ordersByTechnician[msg.sender].push(orderId);

        emit BudgetSubmitted(orderId, msg.sender, amount);
    }

    // Client accepts the budget and locks payment
    function acceptBudget(uint256 orderId) external nonReentrant {
        ServiceOrder storage order = orders[orderId];
        require(order.client == msg.sender, "Not the client");
        require(order.state == ServiceState.Budgeted, "No budget submitted");

        // Lock payment in escrow
        repairToken.transferFrom(msg.sender, address(this), order.amount);

        order.state = ServiceState.InProgress;

        emit BudgetAccepted(orderId, msg.sender, order.amount);
    }

    // Technician marks the service as completed
    function completeOrder(uint256 orderId) external nonReentrant {
        ServiceOrder storage order = orders[orderId];
        require(order.technician == msg.sender, "Not the technician");
        require(order.state == ServiceState.InProgress, "Order is not in progress");

        order.state = ServiceState.Completed;

        emit OrderCompleted(orderId, msg.sender);
    }

    // Client confirms completion and releases payment
    function confirmCompletion(uint256 orderId) external nonReentrant {
        ServiceOrder storage order = orders[orderId];
        require(order.client == msg.sender, "Not the client");
        require(order.state == ServiceState.Completed, "Order is not completed");

        order.completedAt = block.timestamp;

        // Release payment to technician
        repairToken.transfer(order.technician, order.amount);

        emit CompletionConfirmed(orderId, msg.sender);
        emit PaymentReleased(orderId, order.technician, order.amount);
    }

    // Client rates technician or technician rates client
    function rateUser(uint256 orderId, uint8 rating) external nonReentrant {
        ServiceOrder storage order = orders[orderId];
        require(
            order.state == ServiceState.Completed ||
            order.state == ServiceState.Resolved,
            "Order not completed or resolved"
        );
        require(rating >= 1 && rating <= 5, "Rating must be between 1 and 5");

        if (msg.sender == order.client) {
            require(!order.clientRated, "Client already rated");
            order.clientRated = true;
            repairReputation.rateFrom(msg.sender, order.technician, rating, orderId);
            emit RatingSubmitted(orderId, msg.sender, order.technician, rating);
        } else if (msg.sender == order.technician) {
            require(!order.technicianRated, "Technician already rated");
            order.technicianRated = true;
            repairReputation.rateFrom(msg.sender, order.client, rating, orderId);
            emit RatingSubmitted(orderId, msg.sender, order.client, rating);
        } else {
            revert("Not authorized to rate");
        }
    }

    // Client or technician opens a dispute
    function openDispute(uint256 orderId, string memory reason) external nonReentrant {
        ServiceOrder storage order = orders[orderId];
        require(
            msg.sender == order.client || msg.sender == order.technician,
            "Not authorized"
        );
        require(
            order.state == ServiceState.InProgress ||
            order.state == ServiceState.Completed,
            "Cannot dispute at this stage"
        );
        require(bytes(reason).length > 0, "Reason cannot be empty");

        address opposingParty = msg.sender == order.client
            ? order.technician
            : order.client;

        order.state = ServiceState.Disputed;

        disputes[orderId] = Dispute({
            orderId: orderId,
            openedBy: msg.sender,
            opposingParty: opposingParty,
            votesForOpener: 0,
            votesForOpposing: 0,
            deadline: block.timestamp + votingPeriod,
            resolved: false,
            reason: reason
        });

        emit DisputeOpened(orderId, msg.sender, opposingParty, reason);
    }

    // Client or technician submits evidence
    function submitEvidence(uint256 orderId, string memory content) external nonReentrant {
        ServiceOrder storage order = orders[orderId];
        require(
            msg.sender == order.client || msg.sender == order.technician,
            "Not authorized"
        );
        require(order.state == ServiceState.Disputed, "No active dispute");
        require(block.timestamp < disputes[orderId].deadline, "Voting period ended");
        require(bytes(content).length > 0, "Content cannot be empty");

        evidences[orderId].push(Evidence({
            submittedBy: msg.sender,
            content: content,
            timestamp: block.timestamp
        }));

        emit EvidenceSubmitted(orderId, msg.sender);
    }

    // Token holders vote on the dispute
    function voteOnDispute(uint256 orderId, bool supportOpener) external nonReentrant {
        ServiceOrder storage order = orders[orderId];
        Dispute storage dispute = disputes[orderId];

        require(order.state == ServiceState.Disputed, "No active dispute");
        require(block.timestamp < dispute.deadline, "Voting period ended");
        require(!hasVoted[orderId][msg.sender], "Already voted");
        require(
            msg.sender != order.client && msg.sender != order.technician,
            "Involved parties cannot vote"
        );

        uint256 votingPower = repairToken.balanceOf(msg.sender);
        require(votingPower > 0, "No tokens to vote");

        hasVoted[orderId][msg.sender] = true;
        voteSide[orderId][msg.sender] = supportOpener;
        voters[orderId].push(msg.sender);

        if (supportOpener) {
            dispute.votesForOpener += votingPower;
        } else {
            dispute.votesForOpposing += votingPower;
        }

        emit VoteCast(orderId, msg.sender, supportOpener);
    }

    // Anyone resolves the dispute after voting period ends
    function resolveDispute(uint256 orderId) external nonReentrant {
        ServiceOrder storage order = orders[orderId];
        Dispute storage dispute = disputes[orderId];

        require(order.state == ServiceState.Disputed, "No active dispute");
        require(block.timestamp >= dispute.deadline, "Voting period not ended");
        require(!dispute.resolved, "Already resolved");

        dispute.resolved = true;
        order.state = ServiceState.Resolved;
        order.completedAt = block.timestamp;

        // Tie goes to opener
        bool openerWins = dispute.votesForOpener >= dispute.votesForOpposing;
        address winner = openerWins ? dispute.openedBy : dispute.opposingParty;
        address loser = openerWins ? dispute.opposingParty : dispute.openedBy;

        // Release payment to winner
        repairToken.transfer(winner, order.amount);

        // Slash loser deposit and penalize reputation
        repairDeposit.slash(loser, slashPercent);
        repairReputation.penalize(loser);

        // Reward and penalize voters
        for (uint256 i = 0; i < voters[orderId].length; i++) {
            address voter = voters[orderId][i];
            bool votedForOpener = voteSide[orderId][voter];
            bool voterWon = (votedForOpener == openerWins);

            if (voterWon) {
                repairReputation.reward(voter);
            } else {
                repairDeposit.slash(voter, 5);
                repairReputation.penalize(voter);
            }
        }

        emit DisputeResolved(orderId, winner, dispute.votesForOpener, dispute.votesForOpposing);
        emit PaymentReleased(orderId, winner, order.amount);
    }

    // Returns all evidences for a dispute
    function getEvidences(uint256 orderId) public view returns (Evidence[] memory) {
        return evidences[orderId];
    }

    // Returns dispute details
    function getDispute(uint256 orderId) public view returns (Dispute memory) {
        return disputes[orderId];
    }

    // Returns order details
    function getOrder(uint256 orderId) public view returns (ServiceOrder memory) {
        return orders[orderId];
    }

    // Returns all orders for a client
    function getClientOrders(address client) public view returns (uint256[] memory) {
        return ordersByClient[client];
    }

    // Returns all orders for a technician
    function getTechnicianOrders(address technician) public view returns (uint256[] memory) {
        return ordersByTechnician[technician];
    }

    // Owner updates voting period
    function setVotingPeriod(uint256 period) external onlyOwner {
        votingPeriod = period;
    }

    // Owner updates slash percent
    function setSlashPercent(uint256 percent) external onlyOwner {
        require(percent > 0 && percent <= 50, "Invalid percent");
        slashPercent = percent;
    }
}
