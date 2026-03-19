// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PolkaStream
 * @notice Real-time token streaming protocol for Polkadot Hub
 * @dev Supports linear streams, cliff+vesting, and batch payroll
 *      Works with any ERC-20 token including Polkadot native assets
 *      exposed via the ERC-20 precompile
 */
contract PolkaStream is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Enums ============

    enum StreamStatus {
        Active,
        Paused,
        Cancelled,
        Completed
    }

    enum StreamType {
        Linear,        // tokens flow evenly from start to end
        CliffLinear,   // nothing until cliff, then linear
        Milestone      // unlock at specific timestamps
    }

    // ============ Structs ============

    struct Stream {
        address sender;         // who funded the stream
        address recipient;      // who receives tokens
        address token;          // ERC-20 token address
        uint256 depositAmount;  // total tokens deposited
        uint256 withdrawnAmount;// tokens already withdrawn by recipient
        uint256 startTime;      // when streaming begins
        uint256 endTime;        // when streaming ends
        uint256 cliffTime;      // cliff timestamp (0 if no cliff)
        uint256 lastWithdrawTime;
        StreamStatus status;
        StreamType streamType;
    }

    struct Milestone {
        uint256 timestamp;      // when this milestone unlocks
        uint256 percentage;     // basis points (100 = 1%, 10000 = 100%)
    }

    // ============ State ============

    uint256 public nextStreamId;
    mapping(uint256 => Stream) public streams;
    mapping(uint256 => Milestone[]) public milestones;

    // Track streams per user for frontend queries
    mapping(address => uint256[]) public senderStreams;
    mapping(address => uint256[]) public recipientStreams;

    // Protocol fee (can be 0 for hackathon)
    uint256 public protocolFeeBps; // basis points
    address public protocolFeeRecipient;
    address public owner;

    // ============ Events ============

    event StreamCreated(
        uint256 indexed streamId,
        address indexed sender,
        address indexed recipient,
        address token,
        uint256 depositAmount,
        uint256 startTime,
        uint256 endTime,
        StreamType streamType
    );

    event Withdrawn(
        uint256 indexed streamId,
        address indexed recipient,
        uint256 amount
    );

    event StreamCancelled(
        uint256 indexed streamId,
        address indexed sender,
        uint256 refundedAmount,
        uint256 recipientAmount
    );

    event StreamPaused(uint256 indexed streamId);
    event StreamResumed(uint256 indexed streamId);

    event BatchStreamsCreated(
        address indexed sender,
        uint256[] streamIds,
        uint256 totalDeposited
    );

    // ============ Modifiers ============

    modifier onlyStreamSender(uint256 streamId) {
        require(streams[streamId].sender == msg.sender, "Not stream sender");
        _;
    }

    modifier onlyStreamRecipient(uint256 streamId) {
        require(streams[streamId].recipient == msg.sender, "Not stream recipient");
        _;
    }

    modifier streamExists(uint256 streamId) {
        require(streams[streamId].sender != address(0), "Stream does not exist");
        _;
    }

    modifier streamIsActive(uint256 streamId) {
        require(streams[streamId].status == StreamStatus.Active, "Stream not active");
        _;
    }

    // ============ Constructor ============

    constructor() {
        owner = msg.sender;
        protocolFeeBps = 0; // no fee for hackathon
        protocolFeeRecipient = msg.sender;
        nextStreamId = 1;
    }

    // ============ Core: Create Stream ============

    /**
     * @notice Create a linear token stream
     * @param recipient Who receives the tokens
     * @param token ERC-20 token address (use native asset precompile address for DOT/USDC)
     * @param depositAmount Total tokens to stream
     * @param startTime When streaming begins (0 = now)
     * @param endTime When streaming ends
     */
    function createLinearStream(
        address recipient,
        address token,
        uint256 depositAmount,
        uint256 startTime,
        uint256 endTime
    ) external nonReentrant returns (uint256 streamId) {
        if (startTime == 0) startTime = block.timestamp;

        require(recipient != address(0), "Invalid recipient");
        require(recipient != msg.sender, "Cannot stream to self");
        require(depositAmount > 0, "Deposit must be > 0");
        require(endTime > startTime, "End must be after start");

        streamId = _createStream(
            recipient,
            token,
            depositAmount,
            startTime,
            endTime,
            0, // no cliff
            StreamType.Linear
        );
    }

    /**
     * @notice Create a stream with cliff + linear vesting
     * @param cliffTime Timestamp when cliff ends (tokens start flowing)
     */
    function createCliffStream(
        address recipient,
        address token,
        uint256 depositAmount,
        uint256 startTime,
        uint256 endTime,
        uint256 cliffTime
    ) external nonReentrant returns (uint256 streamId) {
        if (startTime == 0) startTime = block.timestamp;

        require(recipient != address(0), "Invalid recipient");
        require(recipient != msg.sender, "Cannot stream to self");
        require(depositAmount > 0, "Deposit must be > 0");
        require(endTime > startTime, "End must be after start");
        require(cliffTime >= startTime, "Cliff before start");
        require(cliffTime < endTime, "Cliff after end");

        streamId = _createStream(
            recipient,
            token,
            depositAmount,
            startTime,
            endTime,
            cliffTime,
            StreamType.CliffLinear
        );
    }

    /**
     * @notice Create streams for multiple recipients in one transaction (payroll)
     * @param recipients Array of recipient addresses
     * @param amounts Array of deposit amounts per recipient
     * @param token ERC-20 token address
     * @param startTime When all streams begin
     * @param endTime When all streams end
     */
    function createBatchStreams(
        address[] calldata recipients,
        uint256[] calldata amounts,
        address token,
        uint256 startTime,
        uint256 endTime
    ) external nonReentrant returns (uint256[] memory streamIds) {
        require(recipients.length == amounts.length, "Length mismatch");
        require(recipients.length > 0, "Empty batch");
        require(recipients.length <= 50, "Max 50 streams per batch");

        if (startTime == 0) startTime = block.timestamp;
        require(endTime > startTime, "End must be after start");

        streamIds = new uint256[](recipients.length);
        uint256 totalDeposit = 0;

        // Calculate total and validate
        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "Invalid recipient");
            require(amounts[i] > 0, "Amount must be > 0");
            totalDeposit += amounts[i];
        }

        // Single transfer for all streams (gas efficient)
        IERC20(token).safeTransferFrom(msg.sender, address(this), totalDeposit);

        // Create individual streams
        for (uint256 i = 0; i < recipients.length; i++) {
            uint256 streamId = nextStreamId++;

            streams[streamId] = Stream({
                sender: msg.sender,
                recipient: recipients[i],
                token: token,
                depositAmount: amounts[i],
                withdrawnAmount: 0,
                startTime: startTime,
                endTime: endTime,
                cliffTime: 0,
                lastWithdrawTime: startTime,
                status: StreamStatus.Active,
                streamType: StreamType.Linear
            });

            senderStreams[msg.sender].push(streamId);
            recipientStreams[recipients[i]].push(streamId);
            streamIds[i] = streamId;

            emit StreamCreated(
                streamId,
                msg.sender,
                recipients[i],
                token,
                amounts[i],
                startTime,
                endTime,
                StreamType.Linear
            );
        }

        emit BatchStreamsCreated(msg.sender, streamIds, totalDeposit);
    }

    // ============ Core: Withdraw ============

    /**
     * @notice Withdraw all available (streamed) tokens
     * @param streamId The stream to withdraw from
     */
    function withdraw(uint256 streamId)
        external
        nonReentrant
        streamExists(streamId)
        onlyStreamRecipient(streamId)
        streamIsActive(streamId)
        returns (uint256 amount)
    {
        amount = _withdrawableAmount(streamId);
        require(amount > 0, "Nothing to withdraw");

        Stream storage stream = streams[streamId];
        stream.withdrawnAmount += amount;
        stream.lastWithdrawTime = block.timestamp;

        // Check if stream is fully withdrawn
        if (stream.withdrawnAmount >= stream.depositAmount) {
            stream.status = StreamStatus.Completed;
        }

        IERC20(stream.token).safeTransfer(stream.recipient, amount);

        emit Withdrawn(streamId, stream.recipient, amount);
    }

    // ============ Core: Cancel ============

    /**
     * @notice Cancel a stream — recipient gets earned amount, sender gets refund
     * @param streamId The stream to cancel
     */
    function cancel(uint256 streamId)
        external
        nonReentrant
        streamExists(streamId)
        onlyStreamSender(streamId)
        streamIsActive(streamId)
    {
        Stream storage stream = streams[streamId];
        stream.status = StreamStatus.Cancelled;

        uint256 recipientAmount = _streamedAmount(streamId) - stream.withdrawnAmount;
        uint256 senderRefund = stream.depositAmount - stream.withdrawnAmount - recipientAmount;

        if (recipientAmount > 0) {
            IERC20(stream.token).safeTransfer(stream.recipient, recipientAmount);
        }

        if (senderRefund > 0) {
            IERC20(stream.token).safeTransfer(stream.sender, senderRefund);
        }

        emit StreamCancelled(streamId, stream.sender, senderRefund, recipientAmount);
    }

    // ============ View Functions ============

    /**
     * @notice Get the amount currently available for withdrawal
     */
    function withdrawable(uint256 streamId)
        external
        view
        streamExists(streamId)
        returns (uint256)
    {
        if (streams[streamId].status != StreamStatus.Active) return 0;
        return _withdrawableAmount(streamId);
    }

    /**
     * @notice Get total amount streamed so far
     */
    function streamedAmount(uint256 streamId)
        external
        view
        streamExists(streamId)
        returns (uint256)
    {
        return _streamedAmount(streamId);
    }

    /**
     * @notice Get full stream details
     */
    function getStream(uint256 streamId)
        external
        view
        returns (Stream memory)
    {
        return streams[streamId];
    }

    /**
     * @notice Get all stream IDs where address is sender
     */
    function getSenderStreams(address sender)
        external
        view
        returns (uint256[] memory)
    {
        return senderStreams[sender];
    }

    /**
     * @notice Get all stream IDs where address is recipient
     */
    function getRecipientStreams(address recipient)
        external
        view
        returns (uint256[] memory)
    {
        return recipientStreams[recipient];
    }

    /**
     * @notice Get current streaming rate (tokens per second)
     */
    function streamRate(uint256 streamId)
        external
        view
        streamExists(streamId)
        returns (uint256)
    {
        Stream memory stream = streams[streamId];
        if (stream.endTime <= stream.startTime) return 0;
        return stream.depositAmount / (stream.endTime - stream.startTime);
    }

    // ============ Internal Functions ============

    function _createStream(
        address recipient,
        address token,
        uint256 depositAmount,
        uint256 startTime,
        uint256 endTime,
        uint256 cliffTime,
        StreamType streamType
    ) internal returns (uint256 streamId) {
        // Transfer tokens from sender to contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), depositAmount);

        streamId = nextStreamId++;

        streams[streamId] = Stream({
            sender: msg.sender,
            recipient: recipient,
            token: token,
            depositAmount: depositAmount,
            withdrawnAmount: 0,
            startTime: startTime,
            endTime: endTime,
            cliffTime: cliffTime,
            lastWithdrawTime: startTime,
            status: StreamStatus.Active,
            streamType: streamType
        });

        senderStreams[msg.sender].push(streamId);
        recipientStreams[recipient].push(streamId);

        emit StreamCreated(
            streamId,
            msg.sender,
            recipient,
            token,
            depositAmount,
            startTime,
            endTime,
            streamType
        );
    }

    function _streamedAmount(uint256 streamId) internal view returns (uint256) {
        Stream memory stream = streams[streamId];

        if (block.timestamp <= stream.startTime) {
            return 0;
        }

        // Cliff check: nothing streams before cliff
        if (stream.streamType == StreamType.CliffLinear && block.timestamp < stream.cliffTime) {
            return 0;
        }

        if (block.timestamp >= stream.endTime) {
            return stream.depositAmount;
        }

        // Linear calculation
        uint256 elapsed = block.timestamp - stream.startTime;
        uint256 duration = stream.endTime - stream.startTime;

        return (stream.depositAmount * elapsed) / duration;
    }

    function _withdrawableAmount(uint256 streamId) internal view returns (uint256) {
        return _streamedAmount(streamId) - streams[streamId].withdrawnAmount;
    }
}