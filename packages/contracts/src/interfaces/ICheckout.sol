// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMerchantRegistry {
    struct Merchant {
        address owner;
        address payoutAddress;
        bytes32 metadataHash;
        bool active;
        uint64 createdAt;
    }

    function merchantOf(address merchant) external view returns (Merchant memory);
}

interface IFeeManager {
    function treasury() external view returns (address);
    function protocolFeeBps() external view returns (uint16);
}

interface IPaymentVault {
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
    ) external;

    function settle() external;
    function currentBalance() external view returns (uint256);
}
