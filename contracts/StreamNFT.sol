// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title StreamNFT
 * @notice Transferable token streaming positions as ERC-721 NFTs
 * @dev Each stream mints an NFT to the recipient. Transferring the NFT
 *      transfers the right to withdraw from the stream. This turns
 *      salary streams, vesting schedules, and subscriptions into
 *      tradeable financial instruments on Polkadot Hub.
 *
 *      KEY INNOVATION: Stream positions are composable. You can:
 *      - Sell your future salary stream on a secondary market
 *      - Use a vesting NFT as collateral in DeFi lending
 *      - Gift a payment stream by transferring the NFT
 *      - Build derivatives on top of stream positions
 */
contract StreamNFT is ERC721Enumerable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Strings for uint256;

    // ============ Structs ============

    enum StreamStatus { Active, Cancelled, Completed }
    enum StreamType { Linear, CliffLinear }

    struct Stream {
        address sender;
        address token;
        uint256 depositAmount;
        uint256 withdrawnAmount;
        uint256 startTime;
        uint256 endTime;
        uint256 cliffTime;
        StreamStatus status;
        StreamType streamType;
        string label;
    }

    // ============ State ============

    uint256 public nextStreamId;
    mapping(uint256 => Stream) public streams;
    address public owner;

    // ============ Events ============

    event StreamCreated(
        uint256 indexed streamId,
        address indexed sender,
        address indexed recipient,
        address token,
        uint256 amount,
        uint256 startTime,
        uint256 endTime,
        string label
    );

    event Withdrawn(uint256 indexed streamId, address indexed to, uint256 amount);
    event StreamCancelled(uint256 indexed streamId, uint256 refunded, uint256 recipientAmount);
    event StreamTransferred(uint256 indexed streamId, address indexed from, address indexed to);

    // ============ Constructor ============

    constructor() ERC721("PolkaStream Position", "PSTREAM") {
        owner = msg.sender;
        nextStreamId = 1;
    }

    // ============ Create Streams ============

    /**
     * @notice Create a linear stream and mint NFT to recipient
     * @param recipient Who receives the NFT (and the right to withdraw)
     * @param token ERC-20 token to stream
     * @param amount Total tokens to stream
     * @param durationSeconds How long the stream lasts
     * @param label Human-readable label (e.g., "March Salary", "Seed Vesting")
     */
    function createStream(
        address recipient,
        address token,
        uint256 amount,
        uint256 durationSeconds,
        string calldata label
    ) external nonReentrant returns (uint256 streamId) {
        require(recipient != address(0), "Invalid recipient");
        require(recipient != msg.sender, "Cannot stream to self");
        require(amount > 0, "Amount must be > 0");
        require(durationSeconds > 0, "Duration must be > 0");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        streamId = nextStreamId++;
        uint256 startTime = block.timestamp;

        streams[streamId] = Stream({
            sender: msg.sender,
            token: token,
            depositAmount: amount,
            withdrawnAmount: 0,
            startTime: startTime,
            endTime: startTime + durationSeconds,
            cliffTime: 0,
            status: StreamStatus.Active,
            streamType: StreamType.Linear,
            label: label
        });

        _mint(recipient, streamId);

        emit StreamCreated(
            streamId, msg.sender, recipient, token,
            amount, startTime, startTime + durationSeconds, label
        );
    }

    /**
     * @notice Create a cliff + linear stream with NFT
     */
    function createCliffStream(
        address recipient,
        address token,
        uint256 amount,
        uint256 durationSeconds,
        uint256 cliffSeconds,
        string calldata label
    ) external nonReentrant returns (uint256 streamId) {
        require(recipient != address(0), "Invalid recipient");
        require(recipient != msg.sender, "Cannot stream to self");
        require(amount > 0, "Amount must be > 0");
        require(durationSeconds > 0, "Duration must be > 0");
        require(cliffSeconds < durationSeconds, "Cliff >= duration");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        streamId = nextStreamId++;
        uint256 startTime = block.timestamp;

        streams[streamId] = Stream({
            sender: msg.sender,
            token: token,
            depositAmount: amount,
            withdrawnAmount: 0,
            startTime: startTime,
            endTime: startTime + durationSeconds,
            cliffTime: startTime + cliffSeconds,
            status: StreamStatus.Active,
            streamType: StreamType.CliffLinear,
            label: label
        });

        _mint(recipient, streamId);

        emit StreamCreated(
            streamId, msg.sender, recipient, token,
            amount, startTime, startTime + durationSeconds, label
        );
    }

    /**
     * @notice Batch create streams (DAO payroll) — one NFT per recipient
     */
    function createBatchStreams(
        address[] calldata recipients,
        uint256[] calldata amounts,
        address token,
        uint256 durationSeconds,
        string calldata label
    ) external nonReentrant returns (uint256[] memory streamIds) {
        require(recipients.length == amounts.length, "Length mismatch");
        require(recipients.length > 0 && recipients.length <= 50, "Invalid batch");
        require(durationSeconds > 0, "Duration must be > 0");

        uint256 total = 0;
        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "Invalid recipient");
            require(amounts[i] > 0, "Amount must be > 0");
            total += amounts[i];
        }

        IERC20(token).safeTransferFrom(msg.sender, address(this), total);

        streamIds = new uint256[](recipients.length);
        uint256 startTime = block.timestamp;

        for (uint256 i = 0; i < recipients.length; i++) {
            uint256 streamId = nextStreamId++;
            streamIds[i] = streamId;

            streams[streamId] = Stream({
                sender: msg.sender,
                token: token,
                depositAmount: amounts[i],
                withdrawnAmount: 0,
                startTime: startTime,
                endTime: startTime + durationSeconds,
                cliffTime: 0,
                status: StreamStatus.Active,
                streamType: StreamType.Linear,
                label: label
            });

            _mint(recipients[i], streamId);

            emit StreamCreated(
                streamId, msg.sender, recipients[i], token,
                amounts[i], startTime, startTime + durationSeconds, label
            );
        }
    }

    // ============ Withdraw ============

    /**
     * @notice Withdraw earned tokens — only NFT holder can call
     */
    function withdraw(uint256 streamId) external nonReentrant returns (uint256 amount) {
        require(ownerOf(streamId) == msg.sender, "Not NFT owner");
        require(streams[streamId].status == StreamStatus.Active, "Not active");

        amount = _withdrawable(streamId);
        require(amount > 0, "Nothing to withdraw");

        Stream storage s = streams[streamId];
        s.withdrawnAmount += amount;

        if (s.withdrawnAmount >= s.depositAmount) {
            s.status = StreamStatus.Completed;
        }

        IERC20(s.token).safeTransfer(msg.sender, amount);
        emit Withdrawn(streamId, msg.sender, amount);
    }

    // ============ Cancel ============

    /**
     * @notice Cancel stream — only original sender can cancel
     */
    function cancel(uint256 streamId) external nonReentrant {
        Stream storage s = streams[streamId];
        require(s.sender == msg.sender, "Not stream sender");
        require(s.status == StreamStatus.Active, "Not active");

        s.status = StreamStatus.Cancelled;

        uint256 recipientAmount = _streamed(streamId) - s.withdrawnAmount;
        uint256 senderRefund = s.depositAmount - s.withdrawnAmount - recipientAmount;

        address nftHolder = ownerOf(streamId);

        if (recipientAmount > 0) {
            IERC20(s.token).safeTransfer(nftHolder, recipientAmount);
        }
        if (senderRefund > 0) {
            IERC20(s.token).safeTransfer(s.sender, senderRefund);
        }

        emit StreamCancelled(streamId, senderRefund, recipientAmount);
    }

    // ============ NFT Transfer Hook ============

    /**
     * @dev Override transfer to emit StreamTransferred event
     *      When NFT transfers, the right to withdraw transfers too
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721Enumerable)
        returns (address)
    {
        address from = _ownerOf(tokenId);
        address result = super._update(to, tokenId, auth);

        if (from != address(0) && to != address(0)) {
            emit StreamTransferred(tokenId, from, to);
        }

        return result;
    }

    // ============ On-Chain SVG Metadata ============

    /**
     * @notice Fully on-chain SVG NFT — no IPFS dependency
     * @dev Generates a dynamic SVG showing stream status, amount, and progress
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(tokenId > 0 && tokenId < nextStreamId, "Invalid token");
        Stream memory s = streams[tokenId];

        uint256 streamed = _streamed(tokenId);
        uint256 pct = s.depositAmount > 0 ? (streamed * 100) / s.depositAmount : 0;
        string memory statusText = s.status == StreamStatus.Active ? "STREAMING" :
                                   s.status == StreamStatus.Completed ? "COMPLETED" : "CANCELLED";
        string memory statusColor = s.status == StreamStatus.Active ? "#00d47b" :
                                    s.status == StreamStatus.Completed ? "#3b82f6" : "#ef4444";

        string memory svg = string(abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500" viewBox="0 0 400 500">',
            '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
            '<stop offset="0%" stop-color="#0a0a0f"/><stop offset="100%" stop-color="#12121a"/></linearGradient>',
            '<linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">',
            '<stop offset="0%" stop-color="#e6007a"/><stop offset="100%" stop-color="#00d47b"/></linearGradient></defs>',
            '<rect width="400" height="500" rx="20" fill="url(#bg)"/>',
            '<rect x="20" y="20" width="360" height="460" rx="16" fill="none" stroke="#1a1a24" stroke-width="1"/>',
            _svgBody(tokenId, s, pct, statusText, statusColor),
            '</svg>'
        ));

        string memory json = string(abi.encodePacked(
            '{"name":"PolkaStream #', tokenId.toString(),
            '","description":"Transferable token stream position on Polkadot Hub. Transfer this NFT to transfer the right to withdraw streamed tokens.",',
            '"attributes":[{"trait_type":"Status","value":"', statusText,
            '"},{"trait_type":"Amount","value":"', (s.depositAmount / 1e6).toString(),
            '"},{"trait_type":"Progress","value":"', pct.toString(),
            '"},{"trait_type":"Type","value":"', s.streamType == StreamType.Linear ? "Linear" : "Cliff",
            '"},{"trait_type":"Label","value":"', s.label,
            '"}],"image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg)), '"}'
        ));

        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(bytes(json))));
    }

    function _svgBody(uint256 id, Stream memory s, uint256 pct, string memory statusText, string memory statusColor)
        internal pure returns (string memory)
    {
        uint256 barWidth = (pct * 320) / 100;

        return string(abi.encodePacked(
            '<text x="40" y="60" font-family="monospace" font-size="12" fill="#71717a">POLKASTREAM POSITION</text>',
            '<text x="40" y="95" font-family="monospace" font-size="28" fill="#e6007a" font-weight="bold">#', id.toString(), '</text>',
            bytes(s.label).length > 0 ? string(abi.encodePacked(
                '<text x="40" y="125" font-family="monospace" font-size="14" fill="#e8e8ee">', s.label, '</text>'
            )) : '',
            '<rect x="40" y="150" width="80" height="24" rx="12" fill="', statusColor, '" fill-opacity="0.15"/>',
            '<text x="80" y="166" font-family="monospace" font-size="11" fill="', statusColor, '" text-anchor="middle">', statusText, '</text>',
            '<text x="40" y="220" font-family="monospace" font-size="11" fill="#71717a">TOTAL AMOUNT</text>',
            '<text x="40" y="248" font-family="monospace" font-size="24" fill="#e8e8ee">', (s.depositAmount / 1e6).toString(), ' psUSD</text>',
            '<text x="40" y="290" font-family="monospace" font-size="11" fill="#71717a">STREAMED</text>',
            '<text x="40" y="318" font-family="monospace" font-size="24" fill="#00d47b">', pct.toString(), '%</text>',
            '<rect x="40" y="350" width="320" height="8" rx="4" fill="#1a1a24"/>',
            '<rect x="40" y="350" width="', barWidth > 0 ? barWidth.toString() : "1", '" height="8" rx="4" fill="url(#bar)"/>',
            '<text x="40" y="410" font-family="monospace" font-size="10" fill="#44444d">Polkadot Hub Testnet</text>',
            '<text x="40" y="430" font-family="monospace" font-size="10" fill="#44444d">Chain 420420417</text>',
            '<circle cx="40" cy="460" r="4" fill="#e6007a"/><circle cx="52" cy="460" r="4" fill="#e6007a" opacity="0.7"/>',
            '<circle cx="64" cy="460" r="4" fill="#e6007a" opacity="0.4"/>'
        ));
    }

    // ============ View Functions ============

    function withdrawable(uint256 streamId) external view returns (uint256) {
        if (streams[streamId].status != StreamStatus.Active) return 0;
        return _withdrawable(streamId);
    }

    function streamedAmount(uint256 streamId) external view returns (uint256) {
        return _streamed(streamId);
    }

    function getStream(uint256 streamId) external view returns (Stream memory) {
        return streams[streamId];
    }

    function streamRate(uint256 streamId) external view returns (uint256) {
        Stream memory s = streams[streamId];
        if (s.endTime <= s.startTime) return 0;
        return s.depositAmount / (s.endTime - s.startTime);
    }

    // ============ Internal ============

    function _streamed(uint256 streamId) internal view returns (uint256) {
        Stream memory s = streams[streamId];
        if (block.timestamp <= s.startTime) return 0;
        if (s.streamType == StreamType.CliffLinear && block.timestamp < s.cliffTime) return 0;
        if (block.timestamp >= s.endTime) return s.depositAmount;
        return (s.depositAmount * (block.timestamp - s.startTime)) / (s.endTime - s.startTime);
    }

    function _withdrawable(uint256 streamId) internal view returns (uint256) {
        return _streamed(streamId) - streams[streamId].withdrawnAmount;
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}