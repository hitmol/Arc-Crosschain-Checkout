// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IMerchantRegistry} from "./interfaces/ICheckout.sol";

/// @title MerchantRegistry
/// @notice Self-service registry for Arc Crosschain Checkout merchants.
contract MerchantRegistry is Ownable2Step, IMerchantRegistry {
    error AlreadyRegistered();
    error MerchantNotFound();
    error ZeroAddress();

    mapping(address merchant => Merchant details) private _merchants;

    event MerchantRegistered(address indexed owner, address indexed payoutAddress, bytes32 metadataHash);
    event MerchantPayoutUpdated(
        address indexed owner, address indexed oldPayoutAddress, address indexed newPayoutAddress
    );
    event MerchantMetadataUpdated(address indexed owner, bytes32 oldMetadataHash, bytes32 newMetadataHash);
    event MerchantStatusUpdated(address indexed owner, bool active);

    constructor(address initialOwner) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
    }

    function registerMerchant(address payoutAddress, bytes32 metadataHash) external {
        if (payoutAddress == address(0)) revert ZeroAddress();
        if (_merchants[msg.sender].owner != address(0)) revert AlreadyRegistered();
        _merchants[msg.sender] = Merchant({
            owner: msg.sender,
            payoutAddress: payoutAddress,
            metadataHash: metadataHash,
            active: true,
            createdAt: uint64(block.timestamp)
        });
        emit MerchantRegistered(msg.sender, payoutAddress, metadataHash);
    }

    function updatePayoutAddress(address newPayoutAddress) external {
        if (newPayoutAddress == address(0)) revert ZeroAddress();
        Merchant storage merchant = _requireMerchant(msg.sender);
        address oldPayoutAddress = merchant.payoutAddress;
        merchant.payoutAddress = newPayoutAddress;
        emit MerchantPayoutUpdated(msg.sender, oldPayoutAddress, newPayoutAddress);
    }

    function updateMetadata(bytes32 newMetadataHash) external {
        Merchant storage merchant = _requireMerchant(msg.sender);
        bytes32 oldMetadataHash = merchant.metadataHash;
        merchant.metadataHash = newMetadataHash;
        emit MerchantMetadataUpdated(msg.sender, oldMetadataHash, newMetadataHash);
    }

    function setActive(bool active) external {
        Merchant storage merchant = _requireMerchant(msg.sender);
        merchant.active = active;
        emit MerchantStatusUpdated(msg.sender, active);
    }

    /// @notice Emergency admin deactivation. The owner cannot reactivate another merchant.
    function deactivateMerchant(address merchantAddress) external onlyOwner {
        Merchant storage merchant = _requireMerchant(merchantAddress);
        merchant.active = false;
        emit MerchantStatusUpdated(merchantAddress, false);
    }

    function merchantOf(address merchant) external view returns (Merchant memory) {
        return _merchants[merchant];
    }

    function _requireMerchant(address merchantAddress) private view returns (Merchant storage merchant) {
        merchant = _merchants[merchantAddress];
        if (merchant.owner == address(0)) revert MerchantNotFound();
    }
}
