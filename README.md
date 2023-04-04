# Tribal Lending

## Deployed Contracts

The following contracts were deployed to the Sepolia network:

| Contract Name | Address |
| --- | --- |
| PriceOracle | [0x7B015515AcCDdE8f6f28577c41b4C8Ee8f5aa1C5](https://sepolia.etherscan.io/address/0x7B015515AcCDdE8f6f28577c41b4C8Ee8f5aa1C5) |
| Unitroller | [0x33A46AE681455720AFA1B29fE068452Fcf8f5baA](https://sepolia.etherscan.io/address/0x33A46AE681455720AFA1B29fE068452Fcf8f5baA) |
| Comptroller | [0xacc32A9b22A7E51A47eE92037feb5d4E60894801](https://sepolia.etherscan.io/address/0xacc32A9b22A7E51A47eE92037feb5d4E60894801) |
| JumpRateModelV2 | [0x73178150e3C313aBBD02cd4d82DF7687644c0d3C](https://sepolia.etherscan.io/address/0x73178150e3C313aBBD02cd4d82DF7687644c0d3C) |
| Delegate (cUSDC) | [0x990BEB556B7812F8077429f9c516AAa369529C80](https://sepolia.etherscan.io/address/0x990BEB556B7812F8077429f9c516AAa369529C80) |
| Delegator (cUSDC) | [0xa18AeB8C4D4A76D55f2cDD718e2f8fe9f96fE763](https://sepolia.etherscan.io/address/0xa18AeB8C4D4A76D55f2cDD718e2f8fe9f96fE763#readProxyContract) |
| Delegate (cUSDT) | [0x19901Fa6Eb8eF9f21FD48155D68e9253f463c029](https://sepolia.etherscan.io/address/0x19901Fa6Eb8eF9f21FD48155D68e9253f463c029) |
| Delegator (cUSDT) | [0x3D7fB38241e4ca4835191937991Be6E04c68D8c5](https://sepolia.etherscan.io/address/0x3D7fB38241e4ca4835191937991Be6E04c68D8c5#readProxyContract) |
| USDC | [0x65d4019A04488Ea65ed025DdC10E66AF1E2cdf2a](https://sepolia.etherscan.io/address/0x65d4019A04488Ea65ed025DdC10E66AF1E2cdf2a) |
| USDT | [0x56FD9A6D509d5BC3114016d06f52619E5aeF1ff8](https://sepolia.etherscan.io/address/0x56FD9A6D509d5BC3114016d06)

### PriceOracle

The PriceOracle contract is responsible for providing asset prices to the Lender platform. It's an essential component for calculating the value of collateral, determining borrowing capacity, and enforcing liquidation thresholds. The PriceOracle contract reads prices from various trusted sources, such as price feeds, and then makes those prices available to other contracts in the platform.

### Unitroller

The Unitroller contract is a central administration contract that manages the interactions between the Comptroller and various market contracts. It serves as a proxy and delegates calls to the Comptroller, allowing for easy upgrades and changes to the Comptroller contract without affecting the market contracts. This design pattern ensures that the system remains flexible and upgradable.

### Comptroller

The Comptroller contract governs the overall behavior of the Lender platform. It manages risk parameters, such as collateral factors, liquidation incentives, and interest rate models. The Comptroller also handles user interactions with the platform, such as minting and redeeming cTokens, borrowing and repaying, and liquidating underwater accounts.

### JumpRateModelV2

The JumpRateModelV2 contract is an implementation of an interest rate model that calculates the borrowing and supply rates for assets in the platform. This model features a base rate, a multiplier for utilization, and a jump rate when utilization is above a certain threshold. This contract helps ensure that interest rates are dynamic and adjust in real-time based on market demand.

### Delegate (cUSDC) and Delegate (cUSDT)

The Delegate contracts are responsible for the implementation of the cToken market contracts. These contracts contain the logic for minting and redeeming cTokens, borrowing and repaying underlying assets, and managing the accrual of interest. The Delegate contracts are designed to be upgradable, allowing for bug fixes or improvements without affecting the users' assets.

### Delegator (cUSDC) and Delegator (cUSDT)

The Delegator contracts act as proxies for the Delegate contracts. They hold the storage for each cToken market, including user balances and interest accrual information. When users interact with the Lender platform, they interact with the Delegator contracts, which then delegate calls to the appropriate Delegate contract. This design pattern ensures that the storage and logic of the markets are separated, enabling a smooth upgrade process.

### USDC and USDT

These contracts represent the USDC and USDT stablecoins on the Sepolia network. Users can use these stablecoins to interact with the Lender platform, such as supplying collateral, borrowing assets, or repaying loans. The Lender platform supports multiple stablecoins to offer users flexibility and choice when using the platform.

# Lender Deployment

This project contains a deployment script that can be used to deploy the Lender contracts to the Sepolia network.

## Deployment Steps

To deploy the Lender contracts, follow these steps:

1. Run the deployment script using the following command:

npx hardhat run ./scripts/deployment/deployLender.js --network sepolia

2. Wait for the deployment to complete.

## Deployment Log

```
[PriceOracle] Deployed Price Oracle: 0x7B015515AcCDdE8f6f28577c41b4C8Ee8f5aa1C5
[Oracle] Setting Oracle to Point to the UAV at: 0x7B015515AcCDdE8f6f28577c41b4C8Ee8f5aa1C5
        * Note pulling price should follow:
                comptroller -> uav proxy -> uav -> validator proxy -> aggregator -> chainlink
[Unitroller] Deployed Unitroller: 0x33A46AE681455720AFA1B29fE068452Fcf8f5baA
[Unitroller] Deployed Comptroller: 0xacc32A9b22A7E51A47eE92037feb5d4E60894801
[Unitroller] Set liquidation Incentive to 8%
[Unitroller] Set close Factor to 50%
[Unitroller] Setting Price Oracle
USDC Deployed: 0x65d4019A04488Ea65ed025DdC10E66AF1E2cdf2a
Deployed JumpRateModelV2: 0x73178150e3C313aBBD02cd4d82DF7687644c0d3C
[cUSDC] Deployed Delegate: 0x990BEB556B7812F8077429f9c516AAa369529C80
cUSDC Deployed Delegator: 0xa18AeB8C4D4A76D55f2cDD718e2f8fe9f96fE763
cUSDC Setting Reserve Factor to 7.5%
USDT Deployed: 0x56FD9A6D509d5BC3114016d06f52619E5aeF1ff8
Deployed JumpRateModelV2: 0xDa5AFB0F0e7C151FCeE20b57879b0A0Cf6724a85
[cUSDC] Deployed Delegate: 0x19901Fa6Eb8eF9f21FD48155D68e9253f463c029
cUSDC Deployed Delegator: 0x3D7fB38241e4ca4835191937991Be6E04c68D8c5
cUSDC Setting Reserve Factor to 7.5%
[USDT] Deployer sent 1M USDT to Borrower
[Unitroller] Supporting cUSDC market
[Unitroller] Supporting cUSDT market
[Unitroller] Setting Collateral Factor for [qUSD] to 90%
[Unitroller] Setting Collateral Factor for [cUSDT] to 90%
-------------Deposit-USDC--------------
0x7621940f6068C024Fb3a3eeE2810D5Ad76CEa374 just deposited 50000.0 USDC
-------------Deposit-USDT--------------
0x7AdF0a56ca4ed1C59777Eb41d0bB5aad4ac2B43E just deposited 500000.0 USDT
[Borrower] Account Liquidity before borrow: 0.0
-------------Borrowing-USDC--------------
0x7AdF0a56ca4ed1C59777Eb41d0bB5aad4ac2B43E just activated cUSDT to be a collateral
0x7AdF0a56ca4ed1C59777Eb41d0bB5aad4ac2B43E just approved cUSDT to borrow USDT
borrowStaticTx:  BigNumber { _hex: '0x00', _isBigNumber: true }
0x7AdF0a56ca4ed1C59777Eb41d0bB5aad4ac2B43E just borrowed 3.1415 USDC
Actual borrower USDC Balance: 3.1415
[Borrower] Account Liquidity after borrow: 449999.9999999999968585
-------------Balances--------------
deployer USDC Balance: 999950000000000000000.0
deployer cUSDC Balance: 2500000000000000000.0
borrower USDC Balance: 3.1415
borrower cUSDC Balance: 0.0
borrower USDT Balance: 500000000000000000.0
borrower cUSDT Balance: 25000000000000000000.0
```


