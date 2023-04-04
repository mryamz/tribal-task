const { ethers } = require('hardhat');
const { mergeInterface } = require('../../../test/Utils/Ethereum');

async function deployLegacyJumpRateModelV2(deployer) {
  const baseRate = ethers.utils.parseEther("0");
  const multiplier = ethers.utils.parseEther("0.04");
  const kink = ethers.utils.parseEther("0.8");
  const jump = ethers.utils.parseEther("1.09")
  const Model = await ethers.getContractFactory('JumpRateModelV2');
  const model = await Model.connect(deployer).deploy(baseRate, multiplier, jump, kink, deployer.address);

  await model.deployed();
  console.log("Deployed JumpRateModelV2:", model.address)
  return model;
}

async function deployUSDC(deployer) {
  const USDC = await ethers.getContractFactory('StandardToken')
  const usdc = await USDC.connect(deployer).deploy(ethers.utils.parseEther("1000000000"), "Test USDC", 6, "USDC")
  await usdc.deployed();
  console.log("USDC Deployed:", usdc.address)
  return usdc;
}

async function deployUSDT(deployer) {
  const USDT = await ethers.getContractFactory('StandardToken')
  const usdt = await USDT.connect(deployer).deploy(ethers.utils.parseEther("1000000000"), "Test USDT", 6, "USDT")
  await usdt.deployed();
  console.log("USDT Deployed:", usdt.address)
  return usdt;
}

async function deploycUSDC(deployer, unitroller, usdc) {
  // Create InterestModel
  return await deployErc20Delegator(deployer, usdc.address, unitroller, "cUSDC", "Quadrata USDC");
}

async function deploycUSDT(deployer, unitroller, usdt) {
  // Create InterestModel
  return await deployErc20Delegator(deployer, usdt.address, unitroller, "cUSDT", "Quadrata USDT");
}

async function deployErc20Delegator(deployer, tokenAddr, unitroller, symbol, name) {
  const model = await deployLegacyJumpRateModelV2(deployer);
  // create delegate
  const CDelegate = await ethers.getContractFactory('CErc20Delegate');
  const cDelegate = await CDelegate.connect(deployer).deploy();
  await cDelegate.deployed();
  console.log("Deployed Delegate:", cDelegate.address);
  // create delegator
  const CDelegator = await ethers.getContractFactory('CErc20Delegator');
  const exchangeRate = ethers.utils.parseEther("0.0002");
  const decimals = 8;

  // print all constructor params
  if (!ethers.utils.isAddress(tokenAddr)) {
    throw new Error('Invalid token address');
  }

  if (!ethers.utils.isAddress(unitroller.address)) {
    throw new Error('Invalid unitroller address');
  }

  if (!ethers.utils.isAddress(deployer.address)) {
    throw new Error('Invalid deployer address');
  }

  if (!ethers.utils.isAddress(cDelegate.address)) {
    throw new Error('Invalid cDelegate address');
  }

  const cDelegator = await CDelegator.connect(deployer).deploy(
    tokenAddr,
    unitroller.address,
    model.address,
    exchangeRate,
    name,
    symbol,
    decimals,
    deployer.address,
    cDelegate.address,
    ethers.constants.AddressZero);

  console.log("%s Deployed Delegator: " + cDelegator.address, symbol);
  await cDelegator.deployed();

  await cDelegator._setReserveFactor(ethers.utils.parseUnits("0.075"));
  console.log('%s Setting Reserve Factor to 7.5%', symbol);
  return cDelegator;
}

async function deployPriceOracle(deployer) {
  // create price oracle
  const PriceOracle = await ethers.getContractFactory('SimplePriceOracle');
  const priceOracle = await PriceOracle.connect(deployer).deploy();
  await priceOracle.deployed()
  console.log("[PriceOracle] Deployed Price Oracle: " + priceOracle.address);
  return priceOracle
}

async function deployComptroller(deployer, oracle) {
 /**
 * Create Comptroller
 */
  // create unitroller instance
  const Unitroller = await ethers.getContractFactory('Unitroller');
  var unitroller = await Unitroller.connect(deployer).deploy();
  await unitroller.deployed();
  console.log("[Unitroller] Deployed Unitroller: " + unitroller.address);

  // create comptroller instance
  const Comptroller = await ethers.getContractFactory("ComptrollerG7");
  const comptroller = await Comptroller.connect(deployer).deploy();
  await comptroller.deployed();
  console.log("[Unitroller] Deployed Comptroller: " + comptroller.address);

  const closeFactor = ethers.utils.parseEther("0.5");
  const liquidationIncentive = ethers.utils.parseEther("1.08");

  // upgrading brains
  await unitroller._setPendingImplementation(comptroller.address);
  await comptroller._become(unitroller.address);

  unitroller = mergeInterface(unitroller, comptroller)

  // setting inital params
  // Set Liquidation Incentive
  // liquidator will receive a 5% bonus on the exchange of collateral during a liquidation
  await unitroller._setLiquidationIncentive(ethers.BigNumber.from(liquidationIncentive.toString()));
  console.log("[Unitroller] Set liquidation Incentive to 8%")
  // Set Close Factor (% of how much of the outstanding borrow can be repay in a liquidation event)
  await unitroller._setCloseFactor(ethers.BigNumber.from(closeFactor.toString())); // 50%
  console.log("[Unitroller] Set close Factor to 50%")
  await unitroller._setPriceOracle(oracle.address);
  console.log("[Unitroller] Setting Price Oracle")
  return unitroller
}


module.exports = {
  deployComptroller,
  deployPriceOracle,
  deploycUSDC,
  deployUSDC,
  deployUSDT,
  deploycUSDT
}
