// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MerchantRegistry} from "../src/MerchantRegistry.sol";
import {FeeManager} from "../src/FeeManager.sol";
import {PaymentVault} from "../src/PaymentVault.sol";
import {CheckoutFactory} from "../src/CheckoutFactory.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract CheckoutTest is Test {
    MerchantRegistry registry;
    FeeManager fees;
    PaymentVault implementation;
    CheckoutFactory factory;
    MockUSDC usdc;

    uint256 merchantKey = 0xBEEF;
    address merchant;
    address payout = makeAddr("payout");
    address refundAddress = makeAddr("refund");
    address treasury = makeAddr("treasury");
    uint256 payerKey = 0xA11CE;
    address payer;

    function setUp() public {
        vm.chainId(5_042_002);
        merchant = vm.addr(merchantKey);
        payer = vm.addr(payerKey);
        usdc = new MockUSDC();
        registry = new MerchantRegistry(address(this));
        fees = new FeeManager(address(this), treasury, 100);
        implementation = new PaymentVault();
        factory = new CheckoutFactory(
            address(this), address(registry), address(fees), address(implementation), address(usdc)
        );
        vm.prank(merchant);
        registry.registerMerchant(payout, keccak256("merchant"));
        usdc.mint(payer, 1_000_000_000);
    }

    function _createUnregistered(bytes32 orderId, uint256 amount) internal returns (PaymentVault vault) {
        vm.prank(merchant);
        vault = PaymentVault(
            factory.createPaymentIntent(orderId, amount, uint64(block.timestamp + 1 hours), keccak256("invoice"))
        );
    }

    function _create(bytes32 orderId, uint256 amount) internal returns (PaymentVault vault) {
        vault = _createUnregistered(orderId, amount);
        _register(vault, payerKey, payer, refundAddress, 1, keccak256(abi.encode(orderId, "attempt")));
    }

    function _authorization(
        PaymentVault vault,
        address paymentPayer,
        address paymentRefundAddress,
        uint256 nonce,
        bytes32 attemptId
    ) internal view returns (PaymentVault.PaymentAuthorization memory) {
        return PaymentVault.PaymentAuthorization({
            attemptId: attemptId,
            sourceChainId: vault.BASE_SEPOLIA_CHAIN_ID(),
            destinationChainId: vault.ARC_CHAIN_ID(),
            invoiceVault: address(vault),
            orderId: vault.orderId(),
            payer: paymentPayer,
            refundAddress: paymentRefundAddress,
            destinationAmount: vault.expectedAmount(),
            maximumSourceAmount: vault.expectedAmount() + 5_000_000,
            quoteExpiresAt: uint64(block.timestamp + 5 minutes),
            nonce: nonce,
            attemptExpiresAt: uint64(block.timestamp + 10 minutes)
        });
    }

    function _register(
        PaymentVault vault,
        uint256 signerKey,
        address paymentPayer,
        address paymentRefundAddress,
        uint256 nonce,
        bytes32 attemptId
    ) internal {
        PaymentVault.PaymentAuthorization memory authorization =
            _authorization(vault, paymentPayer, paymentRefundAddress, nonce, attemptId);
        bytes32 digest = vault.paymentAuthorizationDigest(authorization);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        vault.registerPaymentAttempt(authorization, abi.encodePacked(r, s, v));
    }

    function _fund(PaymentVault vault, uint256 amount) internal {
        vm.prank(payer);
        assertTrue(usdc.transfer(address(vault), amount));
    }

    function testMerchantRegistrationAndUpdates() public {
        address newPayout = makeAddr("newPayout");
        vm.prank(merchant);
        registry.updatePayoutAddress(newPayout);
        assertEq(registry.merchantOf(merchant).payoutAddress, newPayout);
        vm.prank(merchant);
        registry.setActive(false);
        assertFalse(registry.merchantOf(merchant).active);
    }

    function testRejectsZeroPayout() public {
        vm.expectRevert(MerchantRegistry.ZeroAddress.selector);
        vm.prank(makeAddr("badMerchant"));
        registry.registerMerchant(address(0), bytes32(0));
    }

    function testDeterministicVaultAndDuplicateOrder() public {
        bytes32 orderId = keccak256("ORDER-1");
        address predicted = factory.predictPaymentVault(merchant, orderId);
        PaymentVault vault = _create(orderId, 100_000_000);
        assertEq(address(vault), predicted);
        vm.expectRevert(CheckoutFactory.DuplicateOrderId.selector);
        vm.prank(merchant);
        factory.createPaymentIntent(orderId, 1, uint64(block.timestamp + 1 hours), bytes32(0));
    }

    function testOrderIdsAreScopedPerMerchant() public {
        bytes32 orderId = keccak256("SHARED-ORDER");
        address secondMerchant = makeAddr("secondMerchant");
        address secondPayout = makeAddr("secondPayout");
        vm.prank(secondMerchant);
        registry.registerMerchant(secondPayout, keccak256("second-merchant"));

        PaymentVault firstVault = _create(orderId, 100_000_000);
        vm.prank(secondMerchant);
        address secondVault =
            factory.createPaymentIntent(orderId, 100_000_000, uint64(block.timestamp + 1 hours), keccak256("invoice"));

        assertNotEq(address(firstVault), secondVault);
        assertEq(factory.vaultByOrderId(merchant, orderId), address(firstVault));
        assertEq(factory.vaultByOrderId(secondMerchant, orderId), secondVault);
    }

    function testImplementationCannotBeInitialized() public {
        vm.expectRevert(PaymentVault.AlreadyInitialized.selector);
        implementation.initialize(
            address(this), merchant, payout, address(usdc), treasury, bytes32(0), 1, 0, 1, 2, bytes32(0)
        );
    }

    function testCustomerAuthorizationLocksPayerAndRefundAddress() public {
        PaymentVault vault = _createUnregistered(keccak256("ATTEMPT-1"), 100_000_000);
        _register(vault, payerKey, payer, refundAddress, 7, keccak256("attempt-1"));

        assertEq(vault.payer(), payer);
        assertEq(vault.payerRefundAddress(), refundAddress);
        assertTrue(vault.attemptLocked());
        assertTrue(vault.usedNonces(payer, 7));
    }

    function testRejectsInvalidSignerAndMerchantSignature() public {
        PaymentVault vault = _createUnregistered(keccak256("ATTEMPT-2"), 100_000_000);
        PaymentVault.PaymentAuthorization memory authorization =
            _authorization(vault, payer, refundAddress, 8, keccak256("attempt-2"));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(merchantKey, vault.paymentAuthorizationDigest(authorization));

        vm.expectRevert(PaymentVault.InvalidSigner.selector);
        vault.registerPaymentAttempt(authorization, abi.encodePacked(r, s, v));
    }

    function testRejectsWrongVaultChainAmountAndSourceChain() public {
        PaymentVault vault = _createUnregistered(keccak256("ATTEMPT-3"), 100_000_000);
        PaymentVault.PaymentAuthorization memory authorization =
            _authorization(vault, payer, refundAddress, 9, keccak256("attempt-3"));

        authorization.invoiceVault = address(implementation);
        _expectInvalidAuthorization(vault, authorization, payerKey);
        authorization.invoiceVault = address(vault);
        authorization.destinationChainId = 1;
        _expectInvalidAuthorization(vault, authorization, payerKey);
        authorization.destinationChainId = vault.ARC_CHAIN_ID();
        authorization.destinationAmount += 1;
        _expectInvalidAuthorization(vault, authorization, payerKey);
        authorization.destinationAmount = vault.expectedAmount();
        authorization.sourceChainId = 1;
        _expectRevertWithSignature(vault, authorization, payerKey, PaymentVault.UnsupportedSourceChain.selector);
    }

    function testRejectsExpiredAuthorization() public {
        PaymentVault vault = _createUnregistered(keccak256("ATTEMPT-4"), 100_000_000);
        PaymentVault.PaymentAuthorization memory authorization =
            _authorization(vault, payer, refundAddress, 10, keccak256("attempt-4"));
        authorization.quoteExpiresAt = uint64(block.timestamp - 1);
        _expectRevertWithSignature(vault, authorization, payerKey, PaymentVault.AuthorizationExpired.selector);
    }

    function testRejectsExecutionOnWrongDestinationChain() public {
        PaymentVault vault = _createUnregistered(keccak256("ATTEMPT-WRONG-CHAIN"), 100_000_000);
        vm.chainId(1);
        PaymentVault.PaymentAuthorization memory authorization =
            _authorization(vault, payer, refundAddress, 20, keccak256("attempt-wrong-chain"));
        _expectRevertWithSignature(vault, authorization, payerKey, PaymentVault.InvalidAuthorization.selector);
    }

    function testNonceAndAttemptCannotReplay() public {
        PaymentVault first = _createUnregistered(keccak256("ATTEMPT-5A"), 100_000_000);
        _register(first, payerKey, payer, refundAddress, 11, keccak256("attempt-5"));
        vm.warp(block.timestamp + 11 minutes);
        PaymentVault.PaymentAuthorization memory replayedNonce =
            _authorization(first, payer, refundAddress, 11, keccak256("attempt-5-new"));
        _expectRevertWithSignature(first, replayedNonce, payerKey, PaymentVault.NonceAlreadyUsed.selector);

        PaymentVault.PaymentAuthorization memory replayedAttempt =
            _authorization(first, payer, refundAddress, 12, keccak256("attempt-5"));
        _expectRevertWithSignature(first, replayedAttempt, payerKey, PaymentVault.AttemptAlreadyUsed.selector);
    }

    function testActiveAttemptCannotBeReplaced() public {
        PaymentVault vault = _createUnregistered(keccak256("ATTEMPT-6"), 100_000_000);
        _register(vault, payerKey, payer, refundAddress, 13, keccak256("attempt-6"));
        PaymentVault.PaymentAuthorization memory replacement =
            _authorization(vault, payer, refundAddress, 14, keccak256("attempt-6-replacement"));
        _expectRevertWithSignature(vault, replacement, payerKey, PaymentVault.ActivePaymentAttempt.selector);
    }

    function testSecondPayerAndRefundAddressCannotTakeOver() public {
        PaymentVault vault = _createUnregistered(keccak256("ATTEMPT-7"), 100_000_000);
        _register(vault, payerKey, payer, refundAddress, 15, keccak256("attempt-7"));
        vm.warp(block.timestamp + 11 minutes);

        uint256 attackerKey = 0xB0B;
        address attacker = vm.addr(attackerKey);
        PaymentVault.PaymentAuthorization memory takeover =
            _authorization(vault, attacker, attacker, 1, keccak256("takeover"));
        _expectRevertWithSignature(vault, takeover, attackerKey, PaymentVault.PayerLocked.selector);

        PaymentVault.PaymentAuthorization memory redirect =
            _authorization(vault, payer, merchant, 16, keccak256("redirect"));
        _expectRevertWithSignature(vault, redirect, payerKey, PaymentVault.PayerLocked.selector);
    }

    function testPayerCanClearAndReplaceExpiredAttemptWithoutChangingRefund() public {
        PaymentVault vault = _createUnregistered(keccak256("ATTEMPT-8"), 100_000_000);
        _register(vault, payerKey, payer, refundAddress, 17, keccak256("attempt-8"));
        vm.warp(block.timestamp + 11 minutes);
        vm.prank(payer);
        vault.clearExpiredPaymentAttempt();
        assertEq(vault.activeAttemptId(), bytes32(0));
        assertEq(vault.payerRefundAddress(), refundAddress);

        _register(vault, payerKey, payer, refundAddress, 18, keccak256("attempt-8-replacement"));
        assertEq(vault.activeAttemptId(), keccak256("attempt-8-replacement"));
    }

    function testCrossInvoiceSignatureReplayFails() public {
        PaymentVault first = _createUnregistered(keccak256("ATTEMPT-9A"), 100_000_000);
        PaymentVault second = _createUnregistered(keccak256("ATTEMPT-9B"), 100_000_000);
        PaymentVault.PaymentAuthorization memory authorization =
            _authorization(first, payer, refundAddress, 19, keccak256("attempt-9"));
        bytes32 digest = first.paymentAuthorizationDigest(authorization);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payerKey, digest);
        authorization.invoiceVault = address(second);
        authorization.orderId = second.orderId();
        vm.expectRevert(PaymentVault.InvalidSigner.selector);
        second.registerPaymentAttempt(authorization, abi.encodePacked(r, s, v));
    }

    function testCannotSettleOrRefundWithoutCustomerAttempt() public {
        PaymentVault vault = _createUnregistered(keccak256("ATTEMPT-10"), 100_000_000);
        _fund(vault, 100_000_000);
        vm.expectRevert(PaymentVault.InvalidState.selector);
        vault.settle();
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(PaymentVault.InvalidState.selector);
        vault.refund();
    }

    function testPartialFundingAndExactSettlement() public {
        PaymentVault vault = _create(keccak256("ORDER-2"), 100_000_000);
        _fund(vault, 40_000_000);
        assertEq(uint8(vault.paymentState()), uint8(PaymentVault.PaymentState.PartiallyFunded));
        assertEq(vault.amountRemaining(), 60_000_000);
        vm.expectRevert();
        vault.settle();
        _fund(vault, 60_000_000);
        address caller = makeAddr("permissionlessCaller");
        vm.prank(caller);
        vault.settle();
        assertEq(usdc.balanceOf(payout), 99_000_000);
        assertEq(usdc.balanceOf(treasury), 1_000_000);
        assertEq(uint8(vault.paymentState()), uint8(PaymentVault.PaymentState.Settled));
        vm.expectRevert(PaymentVault.InvalidState.selector);
        vault.settle();
    }

    function testOverpaymentRefundsExcess() public {
        PaymentVault vault = _create(keccak256("ORDER-3"), 100_000_000);
        _fund(vault, 110_000_000);
        vault.settle();
        assertEq(usdc.balanceOf(refundAddress), 10_000_000);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function testPayoutSnapshotIsImmutable() public {
        PaymentVault vault = _create(keccak256("ORDER-4"), 10_000_000);
        address changedPayout = makeAddr("changedPayout");
        vm.prank(merchant);
        registry.updatePayoutAddress(changedPayout);
        _fund(vault, 10_000_000);
        vault.settle();
        assertEq(usdc.balanceOf(payout), 9_900_000);
        assertEq(usdc.balanceOf(changedPayout), 0);
    }

    function testCancellationAndLateRefund() public {
        PaymentVault vault = _create(keccak256("ORDER-5"), 10_000_000);
        vm.prank(merchant);
        vault.cancel();
        _fund(vault, 5_000_000);
        vm.prank(makeAddr("refunder"));
        vault.refund();
        assertEq(usdc.balanceOf(refundAddress), 5_000_000);
        vm.expectRevert(PaymentVault.InvalidState.selector);
        vault.refund();
    }

    function testExpiryRefund() public {
        PaymentVault vault = _create(keccak256("ORDER-6"), 10_000_000);
        _fund(vault, 8_000_000);
        vm.warp(block.timestamp + 1 hours + 1);
        vault.refund();
        assertEq(usdc.balanceOf(refundAddress), 8_000_000);
    }

    function testPauseOnlyBlocksNewInvoices() public {
        PaymentVault vault = _create(keccak256("ORDER-7"), 10_000_000);
        factory.pauseCreation();
        vm.expectRevert();
        vm.prank(merchant);
        factory.createPaymentIntent(keccak256("ORDER-8"), 10_000_000, uint64(block.timestamp + 1 hours), bytes32(0));
        _fund(vault, 10_000_000);
        vault.settle();
        assertEq(uint8(vault.paymentState()), uint8(PaymentVault.PaymentState.Settled));
    }

    function testUnsupportedTokenRecovery() public {
        MockUSDC other = new MockUSDC();
        PaymentVault vault = _create(keccak256("ORDER-9"), 10_000_000);
        other.mint(address(vault), 123);
        vm.prank(merchant);
        vault.recoverUnsupportedToken(other, merchant);
        assertEq(other.balanceOf(merchant), 123);
        vm.expectRevert(PaymentVault.UnsupportedRecovery.selector);
        vm.prank(merchant);
        vault.recoverUnsupportedToken(usdc, merchant);
    }

    function testFuzzSettlementConservesFunds(uint96 rawAmount, uint16 feeBps, uint96 rawExcess) public {
        uint256 amount = bound(uint256(rawAmount), 1, 1_000_000_000_000);
        uint256 excess = bound(uint256(rawExcess), 0, 1_000_000_000);
        feeBps = uint16(bound(uint256(feeBps), 0, 500));
        fees.setProtocolFeeBps(feeBps);
        usdc.mint(payer, amount + excess);
        PaymentVault vault = _create(keccak256(abi.encode(amount, feeBps, excess)), amount);
        _fund(vault, amount + excess);
        uint256 before = usdc.balanceOf(payout) + usdc.balanceOf(treasury) + usdc.balanceOf(refundAddress);
        vault.settle();
        uint256 afterBalance = usdc.balanceOf(payout) + usdc.balanceOf(treasury) + usdc.balanceOf(refundAddress);
        assertEq(afterBalance - before, amount + excess);
    }

    function _expectInvalidAuthorization(
        PaymentVault vault,
        PaymentVault.PaymentAuthorization memory authorization,
        uint256 signerKey
    ) internal {
        _expectRevertWithSignature(vault, authorization, signerKey, PaymentVault.InvalidAuthorization.selector);
    }

    function _expectRevertWithSignature(
        PaymentVault vault,
        PaymentVault.PaymentAuthorization memory authorization,
        uint256 signerKey,
        bytes4 selector
    ) internal {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, vault.paymentAuthorizationDigest(authorization));
        vm.expectRevert(selector);
        vault.registerPaymentAttempt(authorization, abi.encodePacked(r, s, v));
    }
}
