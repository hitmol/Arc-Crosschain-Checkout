// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title PaymentVault
/// @notice Minimal-proxy invoice vault funded by native USDC through its Arc ERC-20 interface.
contract PaymentVault {
    using SafeERC20 for IERC20;

    enum PaymentState {
        Open,
        PartiallyFunded,
        Funded,
        Settled,
        Refunded,
        Cancelled
    }

    error AlreadyInitialized();
    error ZeroAddress();
    error InvalidConfiguration();
    error InvalidState();
    error NotMerchant();
    error NotExpired();
    error Underfunded(uint256 balance, uint256 expected);
    error Reentrancy();
    error UnsupportedRecovery();

    address public factory;
    address public merchant;
    address public payoutAddress;
    address public refundAddress;
    address public treasury;
    bytes32 public orderId;
    uint256 public expectedAmount;
    uint16 public protocolFeeBps;
    uint64 public createdAt;
    uint64 public expiresAt;
    bytes32 public metadataHash;
    IERC20 public usdc;

    bool public initialized;
    PaymentState private _terminalState;
    uint256 private _reentrancyStatus;

    event VaultInitialized(
        bytes32 indexed orderId,
        address indexed merchant,
        address indexed payoutAddress,
        uint256 expectedAmount,
        uint64 expiresAt
    );
    event PaymentSettled(
        bytes32 indexed orderId,
        address indexed caller,
        uint256 invoiceAmount,
        uint256 merchantAmount,
        uint256 protocolFee,
        uint256 refundedExcess
    );
    event PaymentCancelled(bytes32 indexed orderId, address indexed merchant);
    event PaymentRefunded(
        bytes32 indexed orderId, address indexed caller, address indexed refundAddress, uint256 amount
    );
    event ExcessSwept(bytes32 indexed orderId, address indexed refundAddress, uint256 amount);
    event UnsupportedTokenRecovered(address indexed token, address indexed recipient, uint256 amount);

    constructor() {
        initialized = true;
    }

    modifier nonReentrant() {
        if (_reentrancyStatus == 2) revert Reentrancy();
        _reentrancyStatus = 2;
        _;
        _reentrancyStatus = 1;
    }

    modifier onlyMerchant() {
        if (msg.sender != merchant) revert NotMerchant();
        _;
    }

    function initialize(
        address factory_,
        address merchant_,
        address payoutAddress_,
        address refundAddress_,
        address usdc_,
        address treasury_,
        bytes32 orderId_,
        uint256 expectedAmount_,
        uint16 protocolFeeBps_,
        uint64 createdAt_,
        uint64 expiresAt_,
        bytes32 metadataHash_
    ) external {
        if (initialized) revert AlreadyInitialized();
        if (
            factory_ == address(0) || merchant_ == address(0) || payoutAddress_ == address(0)
                || refundAddress_ == address(0) || usdc_ == address(0) || treasury_ == address(0)
        ) revert ZeroAddress();
        if (expectedAmount_ == 0 || protocolFeeBps_ > 500 || expiresAt_ <= createdAt_) revert InvalidConfiguration();

        initialized = true;
        factory = factory_;
        merchant = merchant_;
        payoutAddress = payoutAddress_;
        refundAddress = refundAddress_;
        usdc = IERC20(usdc_);
        treasury = treasury_;
        orderId = orderId_;
        expectedAmount = expectedAmount_;
        protocolFeeBps = protocolFeeBps_;
        createdAt = createdAt_;
        expiresAt = expiresAt_;
        _reentrancyStatus = 1;
        metadataHash = metadataHash_;

        emit VaultInitialized(orderId_, merchant_, payoutAddress_, expectedAmount_, expiresAt_);
    }

    function paymentState() public view returns (PaymentState) {
        if (_terminalState != PaymentState.Open) return _terminalState;
        uint256 balance = currentBalance();
        if (balance == 0) return PaymentState.Open;
        if (balance < expectedAmount) return PaymentState.PartiallyFunded;
        return PaymentState.Funded;
    }

    function currentBalance() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function amountRemaining() external view returns (uint256) {
        uint256 balance = currentBalance();
        return balance >= expectedAmount ? 0 : expectedAmount - balance;
    }

    function canSettle() public view returns (bool) {
        return _terminalState == PaymentState.Open && block.timestamp <= expiresAt && currentBalance() >= expectedAmount;
    }

    function settle() external nonReentrant {
        if (_terminalState != PaymentState.Open || block.timestamp > expiresAt) {
            revert InvalidState();
        }
        uint256 balance = currentBalance();
        if (balance < expectedAmount) revert Underfunded(balance, expectedAmount);

        uint256 fee = (expectedAmount * protocolFeeBps) / 10_000;
        uint256 merchantAmount = expectedAmount - fee;
        uint256 excess = balance - expectedAmount;
        _terminalState = PaymentState.Settled;

        if (fee != 0) usdc.safeTransfer(treasury, fee);
        usdc.safeTransfer(payoutAddress, merchantAmount);
        if (excess != 0) usdc.safeTransfer(refundAddress, excess);

        emit PaymentSettled(orderId, msg.sender, expectedAmount, merchantAmount, fee, excess);
    }

    function cancel() external onlyMerchant {
        if (_terminalState != PaymentState.Open || currentBalance() != 0) {
            revert InvalidState();
        }
        _terminalState = PaymentState.Cancelled;
        emit PaymentCancelled(orderId, msg.sender);
    }

    /// @notice Refunds the current Arc USDC balance after expiry or cancellation. Anyone may execute it.
    function refund() external nonReentrant {
        if (_terminalState == PaymentState.Settled || _terminalState == PaymentState.Refunded) revert InvalidState();
        if (_terminalState != PaymentState.Cancelled && block.timestamp <= expiresAt) revert NotExpired();
        uint256 balance = currentBalance();
        if (balance == 0) revert InvalidState();
        _terminalState = PaymentState.Refunded;
        usdc.safeTransfer(refundAddress, balance);
        emit PaymentRefunded(orderId, msg.sender, refundAddress, balance);
    }

    /// @notice Returns any USDC arriving after final settlement to the invoice refund address.
    function sweepExcess() external nonReentrant {
        if (_terminalState != PaymentState.Settled) revert InvalidState();
        uint256 balance = currentBalance();
        if (balance == 0) revert InvalidState();
        usdc.safeTransfer(refundAddress, balance);
        emit ExcessSwept(orderId, refundAddress, balance);
    }

    function recoverUnsupportedToken(IERC20 token, address recipient) external onlyMerchant nonReentrant {
        if (address(token) == address(usdc) || recipient == address(0)) {
            revert UnsupportedRecovery();
        }
        uint256 balance = token.balanceOf(address(this));
        token.safeTransfer(recipient, balance);
        emit UnsupportedTokenRecovered(address(token), recipient, balance);
    }
}
