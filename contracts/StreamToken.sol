// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title StreamToken
 * @notice Test stablecoin for PolkaStream demo
 * @dev Mintable by anyone on testnet for easy testing
 */
contract StreamToken is ERC20 {
    uint8 private _decimals;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_
    ) ERC20(name, symbol) {
        _decimals = decimals_;
        // Mint 1 million tokens to deployer for testing
        _mint(msg.sender, 1_000_000 * 10 ** decimals_);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /**
     * @notice Anyone can mint tokens on testnet
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}