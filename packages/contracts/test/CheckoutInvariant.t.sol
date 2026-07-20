// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {MerchantRegistry} from "../src/MerchantRegistry.sol";
import {FeeManager} from "../src/FeeManager.sol";
import {PaymentVault} from "../src/PaymentVault.sol";
import {CheckoutFactory} from "../src/CheckoutFactory.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract CheckoutHandler is Test {
    MockUSDC public immutable usdc;
    PaymentVault public immutable vault;
    uint256 public totalFunded;

    constructor(MockUSDC usdc_, PaymentVault vault_) {
        usdc = usdc_;
        vault = vault_;
    }

    function fund(uint96 rawAmount) external {
        uint256 amount = bound(uint256(rawAmount), 1, 100_000_000);
        totalFunded += amount;
        usdc.mint(address(this), amount);
        assertTrue(usdc.transfer(address(vault), amount));
    }

    function settle() external {
        try vault.settle() {} catch {}
    }

    function sweepExcess() external {
        try vault.sweepExcess() {} catch {}
    }
}

contract CheckoutInvariantTest is StdInvariant, Test {
    MockUSDC usdc;
    PaymentVault vault;
    CheckoutHandler handler;

    address merchant = makeAddr("invariantMerchant");
    address payout = makeAddr("invariantPayout");
    address refundAddress = makeAddr("invariantRefund");
    address treasury = makeAddr("invariantTreasury");

    function setUp() public {
        usdc = new MockUSDC();
        MerchantRegistry registry = new MerchantRegistry(address(this));
        FeeManager fees = new FeeManager(address(this), treasury, 100);
        PaymentVault implementation = new PaymentVault();
        CheckoutFactory factory = new CheckoutFactory(
            address(this), address(registry), address(fees), address(implementation), address(usdc)
        );
        vm.prank(merchant);
        registry.registerMerchant(payout, keccak256("invariant-merchant"));
        vm.prank(merchant);
        vault = PaymentVault(
            factory.createPaymentIntent(
                keccak256("INVARIANT-ORDER"), 100_000_000, uint64(block.timestamp + 30 days), refundAddress, bytes32(0)
            )
        );
        handler = new CheckoutHandler(usdc, vault);
        targetContract(address(handler));
    }

    function invariantUsdcIsNeverLost() public view {
        uint256 accounted = usdc.balanceOf(address(vault)) + usdc.balanceOf(payout) + usdc.balanceOf(treasury)
            + usdc.balanceOf(refundAddress);
        assertEq(accounted, handler.totalFunded());
    }

    function invariantInvoiceConfigurationDoesNotChange() public view {
        assertEq(vault.merchant(), merchant);
        assertEq(vault.payoutAddress(), payout);
        assertEq(vault.refundAddress(), refundAddress);
        assertEq(vault.treasury(), treasury);
        assertEq(vault.expectedAmount(), 100_000_000);
        assertEq(vault.protocolFeeBps(), 100);
    }
}
