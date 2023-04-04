const { ethers } = require('hardhat');

const {
  deployUSDC,
  deployPriceOracle,
  deploycETH,
  deploycUSDC,
  deployComptroller,
  deployUSDT,
  deployDAI,
  deploycDAI,
} = require('./utils/utils.js')


async function main() {
  const [deployer, borrower] = await ethers.getSigners();

  // deploy mock uniswap anchor view (UAV)
  // const MockUniswapAnchoredView = await ethers.getContractFactory("MockUniswapAnchoredView");
  // const mockUniswapAnchoredView = await MockUniswapAnchoredView.deploy();
  // await mockUniswapAnchoredView.deployed();

  // const uavAddress = mockUniswapAnchoredView.address;

  const oracle = await deployPriceOracle(deployer)
  console.log("[Oracle] Setting Oracle to Point to the UAV at: %s", oracle.address)
  console.log("\t* Note pulling price should follow:\n\t\tcomptroller -> uav proxy -> uav -> validator proxy -> aggregator -> chainlink")

  const unitroller = await deployComptroller(deployer, oracle)

  // deploy usdc
  const usdc = await deployUSDC(deployer)
  const cUSDC = await deploycUSDC(deployer, unitroller, usdc)

  // deploy usdt
  const usdt = await deployUSDT(deployer)
  const cUSDT = await deploycUSDC(deployer, unitroller, usdt)

  // deployer sends usdt to borrower
  await usdt.connect(deployer).transfer(borrower.address, ethers.utils.parseEther("1000000"))
  console.log("[USDT] Deployer sent 1M USDT to Borrower")



  // Set Market as eligible for the entire platform
  await unitroller._supportMarket(cUSDC.address);
  await unitroller._supportMarket(cUSDT.address);
  console.log("[Unitroller] Supporting cUSDC market")
  console.log("[Unitroller] Supporting cUSDT market")

  // Set Collateral Factor for Markets
  await unitroller._setCollateralFactor(cUSDC.address, ethers.utils.parseUnits("0.9")) // 75% Collateral Factor
  console.log("[Unitroller] Setting Collateral Factor for [qUSD] to 90%")
  await unitroller._setCollateralFactor(cUSDT.address, ethers.utils.parseUnits("0.9")) // 75% Collateral Factor
  console.log("[Unitroller] Setting Collateral Factor for [cUSDT] to 90%")

  console.log("-------------Deposit-USDC--------------");
  const depositUSDCAmount = ethers.utils.parseEther("50000")
  const approveDepositorTx = await usdc.connect(deployer).approve(cUSDC.address, depositUSDCAmount);  // give cToken permission to swap USDC for cUSDC
  await approveDepositorTx.wait()
  const depositUSDCTx = await cUSDC.connect(deployer).mint(depositUSDCAmount)
  await depositUSDCTx.wait()
  console.log(`${deployer.address} just deposited ${ethers.utils.formatEther(depositUSDCAmount)} USDC`)

  console.log("-------------Deposit-USDT--------------");
  // borrower deposit amount of USDT as collateral
  const depositUSDTAmount = ethers.utils.parseEther("500000"); // Change this value to increase the deposited USDT
  const approveDepositorTxUSDT = await usdt.connect(borrower).approve(cUSDT.address, depositUSDTAmount);  // give cToken permission to swap USDC for cUSDC
  await approveDepositorTxUSDT.wait()
  const depositUSDTTx = await cUSDT.connect(borrower).mint(depositUSDTAmount)
  await depositUSDTTx.wait()
  console.log(`${borrower.address} just deposited ${ethers.utils.formatEther(depositUSDTAmount)} USDT`)

  const accountLiquidityBefore = await unitroller.getAccountLiquidity(borrower.address);
  console.log(`[Borrower] Account Liquidity before borrow: ${ethers.utils.formatEther(accountLiquidityBefore[1])}`);


  console.log("-------------Borrowing-USDC--------------");
  const borrowUSDCAmount = ethers.utils.parseUnits("3.1415", await usdt.decimals());
  const collateralTx = await unitroller.connect(borrower).enterMarkets([cUSDT.address])
  await collateralTx.wait()
  console.log(`${borrower.address} just activated cUSDT to be a collateral`)
  const approveTx = await usdc.connect(borrower).approve(cUSDC.address, borrowUSDCAmount);  // give cToken permission to swap USDC for cUSDC
  await approveTx.wait();
  console.log(`${borrower.address} just approved cUSDT to borrow USDT`)
  const borrowStaticTx = await cUSDC.connect(borrower).callStatic.borrow(borrowUSDCAmount)   // borrow some usdc dust (borrow usdc backed by USDC)
  // print error codes from callStatic
  console.log("borrowStaticTx: ", borrowStaticTx)
  const borrowTx = await cUSDC.connect(borrower).borrow(borrowUSDCAmount)   // borrow some usdc dust (borrow usdc backed by USDC)
  await borrowTx.wait()
  console.log(`${borrower.address} just borrowed ${ethers.utils.formatUnits(borrowUSDCAmount, await usdc.decimals())} USDC`)

  const actualBorrowerUSDCBalance = await usdc.balanceOf(borrower.address);
  console.log(`Actual borrower USDC Balance: ${ethers.utils.formatUnits(actualBorrowerUSDCBalance, await usdc.decimals())}`);


  const accountLiquidityAfter = await unitroller.getAccountLiquidity(borrower.address);
  console.log(`[Borrower] Account Liquidity after borrow: ${ethers.utils.formatEther(accountLiquidityAfter[1])}`);


  // print balance of borrower and deployer for cUSDC and USDC / cUSDT and USDT
  console.log("-------------Balances--------------");
  console.log(`deployer USDC Balance: ${ethers.utils.formatUnits(await usdc.balanceOf(deployer.address), await usdc.decimals())}`);
  console.log(`deployer cUSDC Balance: ${ethers.utils.formatUnits(await cUSDC.balanceOf(deployer.address), await cUSDC.decimals())}`);
  console.log(`borrower USDC Balance: ${ethers.utils.formatUnits(await usdc.balanceOf(borrower.address), await usdc.decimals())}`);
  console.log(`borrower cUSDC Balance: ${ethers.utils.formatUnits(await cUSDC.balanceOf(borrower.address), await cUSDC.decimals())}`);
  console.log(`borrower USDT Balance: ${ethers.utils.formatUnits(await usdt.balanceOf(borrower.address), await usdt.decimals())}`);
  console.log(`borrower cUSDT Balance: ${ethers.utils.formatUnits(await cUSDT.balanceOf(borrower.address), await cUSDT.decimals())}`);
}


main().then(() => process.exit(0)).catch((error) => {
    console.error(error);
    process.exit(1);
});
