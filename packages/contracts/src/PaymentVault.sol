// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title PaymentVault
/// @notice Minimal-proxy invoice vault funded by native USDC through its Arc ERC-20 interface.
contract PaymentVault is EIP712 {
    using SafeERC20 for IERC20;

    uint256 public constant ARC_CHAIN_ID = 5_042_002;
    uint256 public constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 public constant ETHEREUM_SEPOLIA_CHAIN_ID = 11_155_111;
    bytes32 public constant PAYMENT_AUTHORIZATION_TYPEHASH = keccak256(
        "PaymentAuthorization(bytes32 attemptId,uint256 sourceChainId,uint256 destinationChainId,address invoiceVault,bytes32 orderId,address payer,address refundAddress,uint256 destinationAmount,uint256 maximumSourceAmount,uint64 quoteExpiresAt,uint256 nonce,uint64 attemptExpiresAt)"
    );

    struct PaymentAuthorization {
        bytes32 attemptId;
        uint256 sourceChainId;
        uint256 destinationChainId;
        address invoiceVault;
        bytes32 orderId;
        address payer;
        address refundAddress;
        uint256 destinationAmount;
        uint256 maximumSourceAmount;
        uint64 quoteExpiresAt;
        uint256 nonce;
        uint64 attemptExpiresAt;
    }

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
    error InvalidAuthorization();
    error InvalidSigner();
    error UnsupportedSourceChain();
    error AuthorizationExpired();
    error NonceAlreadyUsed();
    error AttemptAlreadyUsed();
    error ActivePaymentAttempt();
    error PayerLocked();
    error NotPayer();
    error NotMerchant();
    error NotExpired();
    error Underfunded(uint256 balance, uint256 expected);
    error Reentrancy();
    error UnsupportedRecovery();

    address public factory;
    address public merchant;
    address public payoutAddress;
    address public treasury;
    bytes32 public orderId;
    uint256 public expectedAmount;
    uint16 public protocolFeeBps;
    uint64 public createdAt;
    uint64 public expiresAt;
    bytes32 public metadataHash;
    IERC20 public usdc;

    address public payer;
    address public payerRefundAddress;
    bytes32 public activeAttemptId;
    uint256 public activeSourceChainId;
    uint256 public activeMaximumSourceAmount;
    uint64 public activeQuoteExpiresAt;
    uint64 public attemptExpiresAt;
    bool public attemptLocked;

    bool public initialized;
    PaymentState private _terminalState;
    uint256 private _reentrancyStatus;
    mapping(address paymentPayer => mapping(uint256 nonce => bool used)) public usedNonces;
    mapping(bytes32 attemptId => bool used) public usedAttemptIds;

    event VaultInitialized(
        bytes32 indexed orderId,
        address indexed merchant,
        address indexed payoutAddress,
        uint256 expectedAmount,
        uint64 expiresAt
    );
    event PaymentAttemptRegistered(
        bytes32 indexed attemptId,
        bytes32 indexed orderId,
        address indexed payer,
        address refundAddress,
        uint256 sourceChainId,
        uint256 destinationAmount,
        uint256 maximumSourceAmount,
        uint256 nonce,
        uint64 quoteExpiresAt,
        uint64 attemptExpiresAt
    );
    event PaymentAttemptCleared(bytes32 indexed attemptId, address indexed payer);
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

    constructor() EIP712("SettleLink", "1") {
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
            factory_ == address(0) || merchant_ == address(0) || payoutAddress_ == address(0) || usdc_ == address(0)
                || treasury_ == address(0)
        ) revert ZeroAddress();
        if (expectedAmount_ == 0 || protocolFeeBps_ > 500 || expiresAt_ <= createdAt_) revert InvalidConfiguration();

        initialized = true;
        factory = factory_;
        merchant = merchant_;
        payoutAddress = payoutAddress_;
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

    function registerPaymentAttempt(PaymentAuthorization calldata authorization, bytes calldata signature) external {
        if (_terminalState != PaymentState.Open || block.timestamp > expiresAt || currentBalance() != 0) {
            revert InvalidState();
        }
        if (
            authorization.attemptId == bytes32(0) || authorization.invoiceVault != address(this)
                || authorization.orderId != orderId || authorization.destinationChainId != ARC_CHAIN_ID
                || block.chainid != ARC_CHAIN_ID || authorization.payer == address(0)
                || authorization.refundAddress == address(0) || authorization.destinationAmount != expectedAmount
                || authorization.maximumSourceAmount < authorization.destinationAmount
        ) revert InvalidAuthorization();
        if (!_isSupportedSourceChain(authorization.sourceChainId)) revert UnsupportedSourceChain();
        if (
            authorization.quoteExpiresAt < block.timestamp || authorization.attemptExpiresAt <= block.timestamp
                || authorization.quoteExpiresAt > authorization.attemptExpiresAt
                || authorization.attemptExpiresAt > expiresAt
        ) revert AuthorizationExpired();
        if (activeAttemptId != bytes32(0) && block.timestamp <= attemptExpiresAt) revert ActivePaymentAttempt();
        if (attemptLocked && (authorization.payer != payer || authorization.refundAddress != payerRefundAddress)) {
            revert PayerLocked();
        }
        if (usedNonces[authorization.payer][authorization.nonce]) revert NonceAlreadyUsed();
        if (usedAttemptIds[authorization.attemptId]) revert AttemptAlreadyUsed();

        bytes32 digest = paymentAuthorizationDigest(authorization);
        if (ECDSA.recover(digest, signature) != authorization.payer) revert InvalidSigner();

        usedNonces[authorization.payer][authorization.nonce] = true;
        usedAttemptIds[authorization.attemptId] = true;
        if (!attemptLocked) {
            payer = authorization.payer;
            payerRefundAddress = authorization.refundAddress;
            attemptLocked = true;
        }
        activeAttemptId = authorization.attemptId;
        activeSourceChainId = authorization.sourceChainId;
        activeMaximumSourceAmount = authorization.maximumSourceAmount;
        activeQuoteExpiresAt = authorization.quoteExpiresAt;
        attemptExpiresAt = authorization.attemptExpiresAt;

        emit PaymentAttemptRegistered(
            authorization.attemptId,
            orderId,
            authorization.payer,
            authorization.refundAddress,
            authorization.sourceChainId,
            authorization.destinationAmount,
            authorization.maximumSourceAmount,
            authorization.nonce,
            authorization.quoteExpiresAt,
            authorization.attemptExpiresAt
        );
    }

    function clearExpiredPaymentAttempt() external {
        if (msg.sender != payer) revert NotPayer();
        if (activeAttemptId == bytes32(0) || block.timestamp <= attemptExpiresAt) revert NotExpired();
        if (_terminalState != PaymentState.Open || currentBalance() != 0) revert InvalidState();
        bytes32 clearedAttemptId = activeAttemptId;
        activeAttemptId = bytes32(0);
        activeSourceChainId = 0;
        activeMaximumSourceAmount = 0;
        activeQuoteExpiresAt = 0;
        attemptExpiresAt = 0;
        emit PaymentAttemptCleared(clearedAttemptId, payer);
    }

    function paymentAuthorizationDigest(PaymentAuthorization calldata authorization) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    PAYMENT_AUTHORIZATION_TYPEHASH,
                    authorization.attemptId,
                    authorization.sourceChainId,
                    authorization.destinationChainId,
                    authorization.invoiceVault,
                    authorization.orderId,
                    authorization.payer,
                    authorization.refundAddress,
                    authorization.destinationAmount,
                    authorization.maximumSourceAmount,
                    authorization.quoteExpiresAt,
                    authorization.nonce,
                    authorization.attemptExpiresAt
                )
            )
        );
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
        return attemptLocked && _terminalState == PaymentState.Open && block.timestamp <= expiresAt
            && currentBalance() >= expectedAmount;
    }

    function settle() external nonReentrant {
        if (!attemptLocked || _terminalState != PaymentState.Open || block.timestamp > expiresAt) {
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
        if (excess != 0) usdc.safeTransfer(payerRefundAddress, excess);

        emit PaymentSettled(orderId, msg.sender, expectedAmount, merchantAmount, fee, excess);
    }

    function cancel() external onlyMerchant {
        if (_terminalState != PaymentState.Open || currentBalance() != 0) revert InvalidState();
        _terminalState = PaymentState.Cancelled;
        emit PaymentCancelled(orderId, msg.sender);
    }

    /// @notice Refunds Arc USDC to the customer-authorized Arc address after expiry or cancellation.
    function refund() external nonReentrant {
        if (!attemptLocked || _terminalState == PaymentState.Settled || _terminalState == PaymentState.Refunded) {
            revert InvalidState();
        }
        if (_terminalState != PaymentState.Cancelled && block.timestamp <= expiresAt) revert NotExpired();
        uint256 balance = currentBalance();
        if (balance == 0) revert InvalidState();
        _terminalState = PaymentState.Refunded;
        usdc.safeTransfer(payerRefundAddress, balance);
        emit PaymentRefunded(orderId, msg.sender, payerRefundAddress, balance);
    }

    /// @notice Returns any USDC arriving after final settlement to the customer-authorized Arc address.
    function sweepExcess() external nonReentrant {
        if (!attemptLocked || _terminalState != PaymentState.Settled) revert InvalidState();
        uint256 balance = currentBalance();
        if (balance == 0) revert InvalidState();
        usdc.safeTransfer(payerRefundAddress, balance);
        emit ExcessSwept(orderId, payerRefundAddress, balance);
    }

    function recoverUnsupportedToken(IERC20 token, address recipient) external onlyMerchant nonReentrant {
        if (address(token) == address(usdc) || recipient == address(0)) revert UnsupportedRecovery();
        uint256 balance = token.balanceOf(address(this));
        token.safeTransfer(recipient, balance);
        emit UnsupportedTokenRecovered(address(token), recipient, balance);
    }

    function _isSupportedSourceChain(uint256 sourceChainId) private pure returns (bool) {
        return sourceChainId == BASE_SEPOLIA_CHAIN_ID || sourceChainId == ETHEREUM_SEPOLIA_CHAIN_ID;
    }
}
