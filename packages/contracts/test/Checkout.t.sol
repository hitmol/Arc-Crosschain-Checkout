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

    address merchant = makeAddr("merchant");
    address payout = makeAddr("payout");
    address refundAddress = makeAddr("refund");
    address treasury = makeAddr("treasury");
    address payer = makeAddr("payer");

    function setUp() public {
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

    function _create(bytes32 orderId, uint256 amount) internal returns (PaymentVault vault) {
        vm.prank(merchant);
        vault = PaymentVault(
            factory.createPaymentIntent(
                orderId, amount, uint64(block.timestamp + 1 hours), refundAddress, keccak256("invoice")
            )
        );
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
        factory.createPaymentIntent(orderId, 1, uint64(block.timestamp + 1 hours), refundAddress, bytes32(0));
    }

    function testOrderIdsAreScopedPerMerchant() public {
        bytes32 orderId = keccak256("SHARED-ORDER");
        address secondMerchant = makeAddr("secondMerchant");
        address secondPayout = makeAddr("secondPayout");
        vm.prank(secondMerchant);
        registry.registerMerchant(secondPayout, keccak256("second-merchant"));

        PaymentVault firstVault = _create(orderId, 100_000_000);
        vm.prank(secondMerchant);
        address secondVault = factory.createPaymentIntent(
            orderId, 100_000_000, uint64(block.timestamp + 1 hours), refundAddress, keccak256("invoice")
        );

        assertNotEq(address(firstVault), secondVault);
        assertEq(factory.vaultByOrderId(merchant, orderId), address(firstVault));
        assertEq(factory.vaultByOrderId(secondMerchant, orderId), secondVault);
    }

    function testImplementationCannotBeInitialized() public {
        vm.expectRevert(PaymentVault.AlreadyInitialized.selector);
        implementation.initialize(
            address(this), merchant, payout, refundAddress, address(usdc), treasury, bytes32(0), 1, 0, 1, 2, bytes32(0)
        );
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
        factory.createPaymentIntent(
            keccak256("ORDER-8"), 10_000_000, uint64(block.timestamp + 1 hours), refundAddress, bytes32(0)
        );
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
}
