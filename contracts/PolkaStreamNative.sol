// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./PolkaStream.sol";
import "./IXcm.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title PolkaStreamNative
 * @notice Polkadot-native extension of PolkaStream
 * @dev Adds native asset registry (ERC-20 precompile), XCM cross-chain
 *      notifications, and Polkadot-specific features that make this
 *      protocol uniquely suited to the Polkadot ecosystem.
 *
 *      KEY POLKADOT INTEGRATIONS:
 *      1. Native Asset Streaming - Stream DOT, USDT, USDC via ERC-20 precompile
 *         addresses without wrapping. On Polkadot Hub, pallet-assets tokens are
 *         automatically exposed as ERC-20 at deterministic precompile addresses.
 *      2. XCM Cross-Chain Notifications - Emit cross-chain messages on stream
 *         events using the XCM precompile, enabling other parachains to react
 *         to stream lifecycle events.
 *      3. Asset Registry - On-chain mapping of human-readable asset IDs to
 *         their ERC-20 precompile addresses for easy discovery.
 */
contract PolkaStreamNative is PolkaStream {
        using SafeERC20 for IERC20;
    // ============ Polkadot Native Asset Registry ============

    struct NativeAsset {
        uint32 assetId;
        address precompile;
        string symbol;
        uint8 decimals;
        bool active;
    }

    mapping(uint32 => NativeAsset) public nativeAssets;
    uint32[] public registeredAssetIds;

    IXcm public immutable xcmPrecompile;
    bool public xcmNotificationsEnabled;

    // ============ Events ============

    event NativeAssetRegistered(
        uint32 indexed assetId,
        address precompile,
        string symbol,
        uint8 decimals
    );

    event NativeAssetStreamCreated(
        uint256 indexed streamId,
        uint32 indexed assetId,
        address indexed recipient,
        uint256 amount,
        uint256 duration
    );

    event XCMNotificationSent(
        uint256 indexed streamId,
        bytes destination,
        bytes message
    );

    event XCMNotificationsToggled(bool enabled);

    // ============ Constructor ============

    constructor() PolkaStream() {
        xcmPrecompile = IXcm(XCM_PRECOMPILE_ADDRESS);
        xcmNotificationsEnabled = false;

        _registerAsset(1984, 0x000007c000000000000000000000000001200000, "USDt", 6);
        _registerAsset(1337, 0x0000053900000000000000000000000001200000, "USDC", 6);
    }

    // ============ Native Asset Management ============

    function registerNativeAsset(
        uint32 assetId,
        address precompile,
        string calldata symbol,
        uint8 decimals
    ) external {
        require(msg.sender == owner, "Only owner");
        _registerAsset(assetId, precompile, symbol, decimals);
    }

    function streamNativeAsset(
        uint32 assetId,
        address recipient,
        uint256 amount,
        uint256 durationSeconds
    ) external nonReentrant returns (uint256 streamId) {
        NativeAsset memory asset = nativeAssets[assetId];
        require(asset.active, "Asset not registered or inactive");
        require(recipient != address(0), "Invalid recipient");
        require(recipient != msg.sender, "Cannot stream to self");
        require(amount > 0, "Amount must be > 0");
        require(durationSeconds > 0, "Duration must be > 0");

        uint256 startTime = block.timestamp;
        uint256 endTime = startTime + durationSeconds;

        streamId = _createStream(
            recipient, asset.precompile, amount,
            startTime, endTime, 0, StreamType.Linear
        );

        emit NativeAssetStreamCreated(streamId, assetId, recipient, amount, durationSeconds);
    }

    function streamNativeAssetWithCliff(
        uint32 assetId,
        address recipient,
        uint256 amount,
        uint256 durationSeconds,
        uint256 cliffSeconds
    ) external nonReentrant returns (uint256 streamId) {
        NativeAsset memory asset = nativeAssets[assetId];
        require(asset.active, "Asset not registered or inactive");
        require(recipient != address(0), "Invalid recipient");
        require(recipient != msg.sender, "Cannot stream to self");
        require(amount > 0, "Amount must be > 0");
        require(durationSeconds > 0, "Duration must be > 0");
        require(cliffSeconds < durationSeconds, "Cliff >= duration");

        uint256 startTime = block.timestamp;
        uint256 endTime = startTime + durationSeconds;
        uint256 cliffTime = startTime + cliffSeconds;

        streamId = _createStream(
            recipient, asset.precompile, amount,
            startTime, endTime, cliffTime, StreamType.CliffLinear
        );

        emit NativeAssetStreamCreated(streamId, assetId, recipient, amount, durationSeconds);
    }

    function batchStreamNativeAsset(
        uint32 assetId,
        address[] calldata recipients,
        uint256[] calldata amounts,
        uint256 durationSeconds
    ) external nonReentrant returns (uint256[] memory streamIds) {
        NativeAsset memory asset = nativeAssets[assetId];
        require(asset.active, "Asset not registered or inactive");
        require(recipients.length == amounts.length, "Length mismatch");
        require(recipients.length > 0 && recipients.length <= 50, "Invalid batch size");
        require(durationSeconds > 0, "Duration must be > 0");

        uint256 startTime = block.timestamp;
        uint256 endTime = startTime + durationSeconds;

        streamIds = new uint256[](recipients.length);
        uint256 totalDeposit = 0;

        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "Invalid recipient");
            require(amounts[i] > 0, "Amount must be > 0");
            totalDeposit += amounts[i];
        }

        IERC20(asset.precompile).safeTransferFrom(msg.sender, address(this), totalDeposit);

        for (uint256 i = 0; i < recipients.length; i++) {
            uint256 streamId = nextStreamId++;

            streams[streamId] = Stream({
                sender: msg.sender,
                recipient: recipients[i],
                token: asset.precompile,
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
                streamId, msg.sender, recipients[i],
                asset.precompile, amounts[i],
                startTime, endTime, StreamType.Linear
            );

            emit NativeAssetStreamCreated(streamId, assetId, recipients[i], amounts[i], durationSeconds);
        }

        emit BatchStreamsCreated(msg.sender, streamIds, totalDeposit);
    }

    // ============ XCM Cross-Chain Notifications ============

    function setXCMNotifications(bool enabled) external {
        require(msg.sender == owner, "Only owner");
        xcmNotificationsEnabled = enabled;
        emit XCMNotificationsToggled(enabled);
    }

    function sendStreamNotification(
        bytes calldata destination,
        bytes calldata message
    ) external {
        require(msg.sender == owner, "Only owner");
        require(xcmNotificationsEnabled, "XCM notifications disabled");
        xcmPrecompile.send(destination, message);
        emit XCMNotificationSent(0, destination, message);
    }

    function estimateXCMWeight(bytes calldata message)
        external
        view
        returns (IXcm.Weight memory weight)
    {
        return xcmPrecompile.weighMessage(message);
    }

    // ============ View Functions ============

    function getRegisteredAssets() external view returns (NativeAsset[] memory assets) {
        assets = new NativeAsset[](registeredAssetIds.length);
        for (uint256 i = 0; i < registeredAssetIds.length; i++) {
            assets[i] = nativeAssets[registeredAssetIds[i]];
        }
    }

    function getNativeAssetAddress(uint32 assetId) external view returns (address) {
        return nativeAssets[assetId].precompile;
    }

    function isNativeAsset(address token) external view returns (bool) {
        for (uint256 i = 0; i < registeredAssetIds.length; i++) {
            if (nativeAssets[registeredAssetIds[i]].precompile == token) return true;
        }
        return false;
    }

    // ============ Internal ============

    function _registerAsset(
        uint32 assetId,
        address precompile,
        string memory symbol,
        uint8 decimals
    ) internal {
        require(precompile != address(0), "Invalid precompile");
        if (!nativeAssets[assetId].active) {
            registeredAssetIds.push(assetId);
        }
        nativeAssets[assetId] = NativeAsset({
            assetId: assetId,
            precompile: precompile,
            symbol: symbol,
            decimals: decimals,
            active: true
        });
        emit NativeAssetRegistered(assetId, precompile, symbol, decimals);
    }
}