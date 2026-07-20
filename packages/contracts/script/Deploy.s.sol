// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {MerchantRegistry} from "../src/MerchantRegistry.sol";
import {FeeManager} from "../src/FeeManager.sol";
import {PaymentVault} from "../src/PaymentVault.sol";
import {CheckoutFactory} from "../src/CheckoutFactory.sol";

contract Deploy is Script {
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external {
        address deployer = msg.sender;
        address treasury = vm.envOr("PROTOCOL_TREASURY", deployer);
        uint16 feeBps = uint16(vm.envOr("PROTOCOL_FEE_BPS", uint256(25)));

        vm.startBroadcast();
        MerchantRegistry registry = new MerchantRegistry(deployer);
        FeeManager feeManager = new FeeManager(deployer, treasury, feeBps);
        PaymentVault implementation = new PaymentVault();
        CheckoutFactory factory =
            new CheckoutFactory(deployer, address(registry), address(feeManager), address(implementation), ARC_USDC);
        vm.stopBroadcast();

        console2.log("MerchantRegistry", address(registry));
        console2.log("FeeManager", address(feeManager));
        console2.log("PaymentVaultImplementation", address(implementation));
        console2.log("CheckoutFactory", address(factory));
    }
}
