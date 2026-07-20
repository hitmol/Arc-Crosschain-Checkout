// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title FeeManager
/// @notice Stores fee settings used only when new invoice vaults are created.
contract FeeManager is Ownable2Step {
    uint16 public constant MAX_PROTOCOL_FEE_BPS = 500;

    error FeeTooHigh();
    error ZeroAddress();

    address public treasury;
    uint16 public protocolFeeBps;

    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event ProtocolFeeUpdated(uint16 oldFeeBps, uint16 newFeeBps);

    constructor(address initialOwner, address initialTreasury, uint16 initialFeeBps) Ownable(initialOwner) {
        if (initialOwner == address(0) || initialTreasury == address(0)) {
            revert ZeroAddress();
        }
        if (initialFeeBps > MAX_PROTOCOL_FEE_BPS) revert FeeTooHigh();
        treasury = initialTreasury;
        protocolFeeBps = initialFeeBps;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        address oldTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    function setProtocolFeeBps(uint16 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_PROTOCOL_FEE_BPS) revert FeeTooHigh();
        uint16 oldFeeBps = protocolFeeBps;
        protocolFeeBps = newFeeBps;
        emit ProtocolFeeUpdated(oldFeeBps, newFeeBps);
    }
}
