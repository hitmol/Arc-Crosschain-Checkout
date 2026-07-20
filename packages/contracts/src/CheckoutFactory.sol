// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IMerchantRegistry, IFeeManager, IPaymentVault} from "./interfaces/ICheckout.sol";

/// @title CheckoutFactory
/// @notice Deterministically deploys one EIP-1167 vault for every merchant order.
contract CheckoutFactory is Ownable2Step, Pausable {
    uint64 public constant MIN_EXPIRY = 5 minutes;
    uint64 public constant MAX_EXPIRY = 30 days;

    error ZeroAddress();
    error InvalidAmount();
    error InvalidExpiry();
    error MerchantInactive();
    error DuplicateOrderId();

    IMerchantRegistry public immutable merchantRegistry;
    IFeeManager public immutable feeManager;
    address public immutable vaultImplementation;
    address public immutable usdc;

    mapping(address merchant => mapping(bytes32 orderId => address vault)) public vaultByOrderId;
    mapping(address merchant => address[] vaults) private _merchantVaults;

    event PaymentIntentCreated(
        bytes32 indexed orderId,
        address indexed merchant,
        address indexed vault,
        address payoutAddress,
        address refundAddress,
        uint256 expectedAmount,
        uint16 protocolFeeBps,
        uint64 expiresAt,
        bytes32 metadataHash
    );

    constructor(
        address initialOwner,
        address registry_,
        address feeManager_,
        address vaultImplementation_,
        address usdc_
    ) Ownable(initialOwner) {
        if (
            initialOwner == address(0) || registry_ == address(0) || feeManager_ == address(0)
                || vaultImplementation_ == address(0) || usdc_ == address(0)
        ) revert ZeroAddress();
        merchantRegistry = IMerchantRegistry(registry_);
        feeManager = IFeeManager(feeManager_);
        vaultImplementation = vaultImplementation_;
        usdc = usdc_;
    }

    function createPaymentIntent(
        bytes32 orderId,
        uint256 expectedAmount,
        uint64 expiresAt,
        address refundAddress,
        bytes32 metadataHash
    ) external whenNotPaused returns (address vault) {
        if (refundAddress == address(0)) revert ZeroAddress();
        if (expectedAmount == 0) revert InvalidAmount();
        if (expiresAt < block.timestamp + MIN_EXPIRY || expiresAt > block.timestamp + MAX_EXPIRY) {
            revert InvalidExpiry();
        }
        if (vaultByOrderId[msg.sender][orderId] != address(0)) revert DuplicateOrderId();

        IMerchantRegistry.Merchant memory merchant = merchantRegistry.merchantOf(msg.sender);
        if (merchant.owner != msg.sender || !merchant.active) {
            revert MerchantInactive();
        }

        bytes32 salt = _salt(msg.sender, orderId);
        vault = Clones.cloneDeterministic(vaultImplementation, salt);
        uint16 lockedFeeBps = feeManager.protocolFeeBps();
        IPaymentVault(vault)
            .initialize(
                address(this),
                msg.sender,
                merchant.payoutAddress,
                refundAddress,
                usdc,
                feeManager.treasury(),
                orderId,
                expectedAmount,
                lockedFeeBps,
                uint64(block.timestamp),
                expiresAt,
                metadataHash
            );

        vaultByOrderId[msg.sender][orderId] = vault;
        _merchantVaults[msg.sender].push(vault);
        emit PaymentIntentCreated(
            orderId,
            msg.sender,
            vault,
            merchant.payoutAddress,
            refundAddress,
            expectedAmount,
            lockedFeeBps,
            expiresAt,
            metadataHash
        );
    }

    function predictPaymentVault(address merchant, bytes32 orderId) external view returns (address) {
        return Clones.predictDeterministicAddress(vaultImplementation, _salt(merchant, orderId), address(this));
    }

    function merchantVaults(address merchant) external view returns (address[] memory) {
        return _merchantVaults[merchant];
    }

    function pauseCreation() external onlyOwner {
        _pause();
    }

    function unpauseCreation() external onlyOwner {
        _unpause();
    }

    function _salt(address merchant, bytes32 orderId) private pure returns (bytes32) {
        return keccak256(abi.encode(merchant, orderId));
    }
}
