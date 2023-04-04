"use strict";

const { dfn } = require('./JS');
const { ethers } = require('hardhat');
const { expect } = require('chai');
const { BigNumber } = require('bignumber.js');

const {
  encodeParameters,
  etherBalance,
  etherMantissa,
  etherUnsigned,
  toEBN,
  mergeInterface,
  getEvents
} = require('./Ethereum');

const { TokenErr } = require('../Errors');

async function makeComptroller(opts = {}) {
  const {
    root = (await ethers.getSigners())[0],
    kind = 'unitroller'
  } = opts || {};

  if (kind == 'bool') {
    const BoolComptroller = await ethers.getContractFactory('BoolComptroller');
    const boolComptroller = await BoolComptroller.deploy();
    await boolComptroller.deployed();
    return await boolComptroller;
  }

  if (kind == 'false-marker') {
    const FalseMarkerMethodComptroller = await ethers.getContractFactory('FalseMarkerMethodComptroller');
    const falseMarkerMethodComptroller = await FalseMarkerMethodComptroller.deploy();
    await falseMarkerMethodComptroller.deployed();
    return falseMarkerMethodComptroller;
  }

  if (kind == 'v1-no-proxy') {
    const Comptroller = await ethers.getContractFactory('ComptrollerHarness');
    const helperComptroller = await Comptroller.deploy();
    await helperComptroller.deployed();

    const priceOracle = opts.priceOracle || await makePriceOracle(opts.priceOracleOpts);
    const closeFactor = toEBN(etherMantissa(dfn(opts.closeFactor, .051)));

    await helperComptroller._setCloseFactor(closeFactor);
    await helperComptroller._setPriceOracle(priceOracle.address);

    return Object.assign(helperComptroller, { priceOracle });
  }

  if (kind == 'unitroller-g2') {
    const Unitroller = await ethers.getContractFactory('Unitroller');
    var unitroller = opts.unitroller || await Unitroller.deploy();
    if (!opts.unitroller) {
      await unitroller.deployed();;
    }

    var Comptroller = await ethers.getContractFactory("ComptrollerScenarioG2");
    const comptroller = await Comptroller.deploy();
    await comptroller.deployed();;

    const priceOracle = opts.priceOracle || await makePriceOracle(opts.priceOracleOpts);
    const closeFactor = ethers.BigNumber.from(etherMantissa(dfn(opts.closeFactor, .051)).toString());
    const maxAssets = ethers.BigNumber.from(etherUnsigned(dfn(opts.maxAssets, 10)).toString());
    const liquidationIncentive = ethers.BigNumber.from(etherMantissa(1).toString());

    await unitroller._setPendingImplementation(comptroller.address);
    await comptroller._become(unitroller.address);
    unitroller = mergeInterface(unitroller, comptroller);
    await unitroller._setLiquidationIncentive(liquidationIncentive);
    await unitroller._setCloseFactor(closeFactor);
    await unitroller._setMaxAssets(maxAssets);
    await unitroller._setPriceOracle(priceOracle.address);

    return Object.assign(unitroller, { priceOracle });
  }

  if (kind == 'unitroller-g3') {
    const Unitroller = await ethers.getContractFactory('Unitroller');
    var unitroller = opts.unitroller || await Unitroller.deploy();
    if (!opts.unitroller) {
      await unitroller.deployed();
    }
    var Comptroller = await ethers.getContractFactory("ComptrollerScenarioG3");
    const comptroller = await Comptroller.deploy();
    await comptroller.deployed();;

    const priceOracle = opts.priceOracle || await makePriceOracle(opts.priceOracleOpts);
    const closeFactor = ethers.BigNumber.from(etherMantissa(dfn(opts.closeFactor, .051)).toString());
    const maxAssets = ethers.BigNumber.from(etherUnsigned(dfn(opts.maxAssets, 10)).toString());
    const liquidationIncentive = ethers.BigNumber.from(etherMantissa(1).toString());
    const compRate = ethers.BigNumber.from(etherUnsigned(dfn(opts.compRate, 1e18)).toString());
    const compMarkets = opts.compMarkets || [];
    const otherMarkets = opts.otherMarkets || [];

    await unitroller._setPendingImplementation(comptroller.address);
    await comptroller._become(unitroller.address, compRate, compMarkets, otherMarkets);
    unitroller = mergeInterface(unitroller, comptroller);
    await unitroller._setLiquidationIncentive(liquidationIncentive);
    await unitroller._setCloseFactor(closeFactor);
    await unitroller._setMaxAssets(maxAssets);
    await unitroller._setPriceOracle(priceOracle.address);

    return Object.assign(unitroller, { priceOracle });
  }

  if (kind == 'unitroller') {

    // create unitroller instance
    var Unitroller = await ethers.getContractFactory('Unitroller');
    var unitroller = opts.unitroller || await Unitroller.deploy();
    if (!opts.unitroller) {
      await unitroller.deployed();;
    }

    // create comptroller instance
    var Comptroller = await ethers.getContractFactory("ComptrollerHarness");
    var comptroller = await Comptroller.deploy();
    await comptroller.deployed();
    /*
    */

    var priceOracle = opts.priceOracle || await makePriceOracle(opts.priceOracleOpts);
    var closeFactor = etherMantissa(dfn(opts.closeFactor, .051));
    var liquidationIncentive = etherMantissa(1);

    const compRate = etherUnsigned(dfn(opts.compRate, 1e18));

    await unitroller._setPendingImplementation(comptroller.address);
    await comptroller._become(unitroller.address);


    unitroller = mergeInterface(unitroller, comptroller)

    await unitroller._setLiquidationIncentive(ethers.BigNumber.from(liquidationIncentive.toString()));
    await unitroller._setCloseFactor(ethers.BigNumber.from(closeFactor.toString()));
    await unitroller._setPriceOracle(priceOracle.address);
    return Object.assign(unitroller, { priceOracle });
  }
}

async function makeCToken(opts = {}) {
  const {
    root = (await ethers.getSigners())[0],
    kind = 'cerc20'
  } = opts || {};

  const helperComptroller = opts.comptroller || await makeComptroller(opts.comptrollerOpts);
  const helperInterestRateModel = opts.interestRateModel || await makeInterestRateModel(opts.interestRateModelOpts);
  const exchangeRate = etherMantissa(dfn(opts.exchangeRate, 1));
  const decimals = etherUnsigned(dfn(opts.decimals, 8));
  const helperSymbol = opts.symbol || (kind === 'cether' ? 'cETH' : 'cOMG');
  const helperName = opts.name || `CToken ${helperSymbol}`;
  const admin = opts.admin || root;

  let cToken, helperUnderlying;
  let cDelegator, cDelegatee, cDaiMaker, CDelegatee, CDelegator;

  switch (kind) {
    case 'cether':
      const CToken = await ethers.getContractFactory('CEtherHarness');
      cToken = await CToken.deploy(helperComptroller.address, helperInterestRateModel.address, toEBN(exchangeRate), helperName, helperSymbol, toEBN(decimals), admin.address);
      break;

    case 'cdai':
      cDaiMaker = await deploy('CDaiDelegateMakerHarness');
      helperUnderlying = cDaiMaker;
      cDelegatee = await deploy('CDaiDelegateHarness');
      cDelegator = await deploy('CErc20Delegator',
        [
          helperUnderlying._address,
          helperComptroller._address,
          helperInterestRateModel._address,
          exchangeRate,
          helperName,
          helperSymbol,
          decimals,
          admin,
          cDelegatee._address,
          encodeParameters(['address', 'address'], [cDaiMaker._address, cDaiMaker._address])
        ]
      );
      cToken = await saddle.getContractAt('CDaiDelegateHarness', cDelegator._address);
      break;

    case 'ccomp':
      CDelegatee = await ethers.getContractFactory('CErc20DelegateHarness');
      cDelegatee = await CDelegatee.deploy();
      CDelegator = await ethers.getContractFactory('CErc20Delegator');
      cDelegator = await CDelegator.deploy(
        helperUnderlying.address,
        helperComptroller.address,
        helperInterestRateModel.address,
        toEBN(exchangeRate),
        helperName,
        helperSymbol,
        toEBN(decimals),
        admin.address,
        cDelegatee.address,
        ethers.constants.AddressZero);

      cToken = await ethers.getContractAt('CErc20DelegateHarness', cDelegator.address);
      break;

    case 'cerc20':
    default:
      helperUnderlying = opts.underlying || await makeToken(opts.underlyingOpts);
      CDelegatee = await ethers.getContractFactory('CErc20DelegateHarness');
      cDelegatee = await CDelegatee.deploy();
      await cDelegatee.deployed();

      CDelegator = await ethers.getContractFactory('CErc20Delegator');

      cDelegator = await CDelegator.deploy(
        helperUnderlying.address,
        helperComptroller.address,
        helperInterestRateModel.address,
        ethers.BigNumber.from(exchangeRate.toString()),
        helperName,
        helperSymbol,
        ethers.BigNumber.from(decimals.toString()),
        admin.address,
        cDelegatee.address,
        ethers.constants.AddressZero);

      await cDelegator.deployed();;


      cToken = await ethers.getContractAt('CErc20DelegateHarness', cDelegator.address);
      break;

  }

  if (opts.supportMarket) {
    await helperComptroller._supportMarket(cToken.address);
  }

  if (opts.underlyingPrice) {
    const price = ethers.BigNumber.from(etherMantissa(opts.underlyingPrice).toString());

    await helperComptroller.priceOracle.setUnderlyingPrice(cToken.address, price);
  }

  if (opts.collateralFactor) {
    const factor = ethers.BigNumber.from(etherMantissa(opts.collateralFactor).toString());
    const result = await helperComptroller._setCollateralFactor(cToken.address, factor);

    await expect(result).to.emit(helperComptroller, "NewCollateralFactor");
  }

  return Object.assign(cToken, { helperName, helperSymbol, helperUnderlying, helperComptroller, helperInterestRateModel });
}

async function makeInterestRateModel(opts = {}) {
  const {
    root = (await ethers.getSigners())[0],
    kind = 'harnessed'
  } = opts || {};


  // each block checking against kind must return a contract
  if (kind == 'harnessed') {
    const borrowRate = etherMantissa(dfn(opts.borrowRate, 0));
    const IntrestRateModel = await ethers.getContractFactory('InterestRateModelHarness');
    const intrestRateModel = await IntrestRateModel.deploy(toEBN(borrowRate));
    await intrestRateModel.deployed();
    return intrestRateModel;
  }

  if (kind == 'false-marker') {
    const FalseMarkerMethodInterestRateModel = await ethers.getContractFactory('FalseMarkerMethodInterestRateModel');
    const falseMarkerMethodIntrestRateModel = await FalseMarkerMethodInterestRateModel.deploy();
    await falseMarkerMethodIntrestRateModel.deployed();
    return falseMarkerMethodIntrestRateModel;
  }

  if (kind == 'white-paper') {
    const baseRate = etherMantissa(dfn(opts.baseRate, 0));
    const multiplier = etherMantissa(dfn(opts.multiplier, 1e-18));
    const WhitePaperInterestRateModel = await ethers.getContractFactory('WhitePaperInterestRateModel');
    const whitePaperIntrestRateModel = await WhitePaperInterestRateModel.deploy(toEBN(baseRate), toEBN(multiplier));
    await whitePaperIntrestRateModel.deployed();
    return whitePaperIntrestRateModel;
  }

  if (kind == 'jump-rate') {
    const baseRate = etherMantissa(dfn(opts.baseRate, 0));
    const multiplier = etherMantissa(dfn(opts.multiplier, 1e-18));
    const jump = etherMantissa(dfn(opts.jump, 0));
    const kink = etherMantissa(dfn(opts.kink, 0));
    const JumpRateModel = await ethers.getContractFactory('JumpRateModel');
    const jumpRateModel = await JumpRateModel.deploy(toEBN(baseRate), toEBN(multiplier), toEBN(jump), toEBN(kink));
    await jumpRateModel.deployed();
    return jumpRateModel;
  }
}

async function makePriceOracle(opts = {}) {
  const {
    root = (await ethers.getSigners())[0],
    kind = 'simple'
  } = opts || {};

  if (kind == 'simple') {

    const SimplePriceOracle = await ethers.getContractFactory('SimplePriceOracle');
    const simplePriceOracle = await SimplePriceOracle.deploy();
    await simplePriceOracle.deployed();;

    return simplePriceOracle;
  }
}

async function makeToken(opts = {}) {
  const {
    root = (await ethers.getSigners())[0],
    kind = 'erc20'
  } = opts || {};

  if (kind == 'erc20') {
    const quantity = etherUnsigned(dfn(opts.quantity, 1e25));
    const decimals = etherUnsigned(dfn(opts.decimals, 18));
    const symbol = opts.symbol || 'OMG';
    const name = opts.name || `Erc20 ${symbol}`;

    const ERC20Harness = await ethers.getContractFactory('ERC20Harness');
    const erc20Harness = await ERC20Harness.deploy(ethers.BigNumber.from(quantity.toString()), name, ethers.BigNumber.from(decimals.toString()), symbol);

    return erc20Harness;
  }
}

async function balanceOf(token, account) {
  return etherUnsigned((await token.balanceOf(account.address)).toString());
}

async function totalSupply(token) {
  return etherUnsigned((await token.totalSupply()).toString());
}

async function borrowSnapshot(cToken, account) {
  const result = (await cToken.callStatic.harnessAccountBorrows(account.address));
  const principal = result[0];
  const interestIndex = result[1];
  return { principal: etherUnsigned(principal.toString()), interestIndex: etherUnsigned(interestIndex.toString()) };
}

async function totalBorrows(cToken) {
  return etherUnsigned((await cToken.totalBorrows()).toString());
}

async function totalReserves(cToken) {
  return etherUnsigned((await cToken.totalReserves()).toString());
}

async function enterMarkets(cTokens, from) {
  const signed = cTokens[0].helperComptroller.connect(from);
  return (await signed.enterMarkets(cTokens.map(c => c.address)));
}

async function fastForward(cToken, blocks = 5) {
  return await cToken.harnessFastForward(blocks);
}

async function setBalance(cToken, account, balance) {
  return await cToken.harnessSetBalance(account.address, toEBN(balance));
}

async function setEtherBalance(cEther, balance) {
  const current = await etherBalance(cEther.address);
  const root = (await ethers.getSigners())[0];
  const tx1 = await cEther.harnessDoTransferOut(root.address, toEBN(current));
  const events1 = await getEvents(tx1);
  expect(!events1.includes('Failure')).equals(true)
  const tx2 = await cEther.harnessDoTransferIn(root.address, toEBN(balance), {value: toEBN(balance)});
  const events2 = await getEvents(tx2);
  expect(!events2.includes('Failure')).equals(true)
}

async function getBalances(cTokens, accounts) {
  const balances = {};
  for (let cToken of cTokens) {
    const cBalances = balances[cToken.address] = {};
    for (let account of accounts) {
      cBalances[account.address] = {
        eth: (await etherBalance(account.address)).toString(),
        cash: cToken.helperUnderlying && (await balanceOf(cToken.helperUnderlying, account)).toString(),
        tokens: (await balanceOf(cToken, account)).toString(),
        borrows: ((await borrowSnapshot(cToken, account)).principal).toString()
      };
    }
    cBalances[cToken.address] = {
      eth: (await etherBalance(cToken.address)).toString(),
      cash: cToken.helperUnderlying && (await balanceOf(cToken.helperUnderlying, cToken)).toString(),
      tokens: (await totalSupply(cToken)).toString(),
      borrows: (await totalBorrows(cToken)).toString(),
      reserves: (await totalReserves(cToken)).toString()
    };
  }
  return balances;
}

async function adjustBalances(balances, deltas) {
  for (let delta of deltas) {
    let cToken, account, key, diff;
    if (delta.length == 4) {
      ([cToken, account, key, diff] = delta);
    } else {
      ([cToken, key, diff] = delta);
      account = cToken;
    }
    const init = new BigNumber(balances[cToken][account][key].toString());
    const result = init.plus(diff);
    balances[cToken][account][key] = result.toString();
  }
  return balances;
}


async function preApprove(cToken, from, amount, opts = {}) {
  if (dfn(opts.faucet, true)) {

    var signature = cToken.helperUnderlying.connect(from);
    const transaction = (await signature.harnessSetBalance(from.address, amount));

    const receipt = await ethers.provider.getTransactionReceipt(transaction.hash);

    expect(receipt.status).equals(1);
  }

  signature = cToken.helperUnderlying.connect(from);
  return signature.approve(cToken.address, amount);
}

async function quickMint(cToken, minter, mintAmount, opts = {}) {
  // make sure to accrue interest
  await fastForward(cToken, 1);

  if (dfn(opts.approve, true)) {
    const transaction = await preApprove(cToken, minter, mintAmount, opts);
    const receipt = await ethers.provider.getTransactionReceipt(transaction.hash);
    expect(receipt.status).equals(1);

  }
  if (dfn(opts.exchangeRate)) {
    const result = await cToken.harnessSetExchangeRate(ethers.BigNumber.from(etherMantissa(opts.exchangeRate).toString()))
    expect(await send(cToken, 'harnessSetExchangeRate', [etherMantissa(opts.exchangeRate)])).toSucceed();
  }

  return cToken.connect(minter).mint(toEBN(mintAmount));
  // return send(cToken, 'mint', [mintAmount], { from: minter });
}


async function preSupply(cToken, account, tokens, opts = {}) {
  if (dfn(opts.total, true)) {
    const tx = await cToken.harnessSetTotalSupply(toEBN(tokens));
    const events = await getEvents(tx);
    expect(!events.includes('Failure')).equals(true)
  }

  return cToken.harnessSetBalance(account.address, toEBN(tokens));
}

async function quickRedeem(cToken, redeemer, redeemTokens, opts = {}) {
  await fastForward(cToken, 1);

  if (dfn(opts.supply, true)) {
    const tx = await preSupply(cToken, redeemer, redeemTokens, opts);
    const events = await getEvents(tx);
    expect(!events.includes('Failure')).equals(true)
  }
  if (dfn(opts.exchangeRate)) {
    const tx =  await cToken.harnessSetExchangeRate(toEBN(etherMantissa(opts.exchangeRate)));
    const events = await getEvents(tx);
    expect(!events.includes('Failure')).equals(true)
  }
  return cToken.connect(redeemer).redeem(toEBN(redeemTokens));
}

async function quickRedeemUnderlying(cToken, redeemer, redeemAmount, opts = {}) {
  await fastForward(cToken, 1);

  if (dfn(opts.exchangeRate)) {
    const tx = await cToken.harnessSetExchangeRate(toEBN(etherMantissa(opts.exchangeRate)));
    const events = await getEvents(tx);
    expect(!events.includes('Failure')).equals(true)
  }
  return cToken.connect(redeemer).redeemUnderlying(toEBN(redeemAmount));
}

async function setOraclePrice(cToken, price) {
  return cToken.helperComptroller.priceOracle.setUnderlyingPrice(cToken.address, ethers.BigNumber.from(etherMantissa(new BigNumber(price.toString())).toString()));;
}

async function setBorrowRate(cToken, rate) {
  return cToken.helperInterestRateModel.setBorrowRate(toEBN(etherMantissa(rate)));
}

async function getBorrowRate(interestRateModel, cash, borrows, reserves) {
  return interestRateModel.getBorrowRate(toEBN(cash), toEBN(borrows), toEBN(reserves));
}

async function getSupplyRate(interestRateModel, cash, borrows, reserves, reserveFactor) {
  return interestRateModel.getSupplyRate(toEBN(cash), toEBN(borrows), toEBN(reserves), toEBN(reserveFactor));
}

async function pretendBorrow(cToken, borrower, accountIndex, marketIndex, principalRaw, blockNumber = 2e7) {
  await cToken.harnessSetTotalBorrows(ethers.BigNumber.from(etherUnsigned(principalRaw.toString()).toString()));
  await cToken.harnessSetAccountBorrows(borrower.address,
    ethers.BigNumber.from(etherUnsigned(principalRaw.toString()).toString()),
    ethers.BigNumber.from(etherMantissa(accountIndex.toString()).toString()));

  await cToken.harnessSetBorrowIndex(ethers.BigNumber.from(etherMantissa(marketIndex.toString()).toString()));
  await cToken.harnessSetAccrualBlockNumber(ethers.BigNumber.from(etherUnsigned(blockNumber.toString()).toString()));
  await cToken.harnessSetBlockNumber(ethers.BigNumber.from(etherUnsigned(blockNumber.toString()).toString()));
}

module.exports = {
  makeComptroller,
  makeCToken,
  makeInterestRateModel,
  makePriceOracle,
  makeToken,

  balanceOf,
  totalSupply,
  borrowSnapshot,
  totalBorrows,
  totalReserves,
  enterMarkets,
  fastForward,
  setBalance,
  setEtherBalance,
  getBalances,
  adjustBalances,

  preApprove,
  quickMint,

  preSupply,
  quickRedeem,
  quickRedeemUnderlying,

  setOraclePrice,
  setBorrowRate,
  getBorrowRate,
  getSupplyRate,
  pretendBorrow
};
