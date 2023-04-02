const { ethers } = require('hardhat');
const { expect } = require('chai');
const {
  etherGasCost,
  etherUnsigned,
  etherMantissa,
  UInt256Max,
  etherExp,
  toEBN,
  toBN,
  getEvents,
  hasEvent,
  deepEqual
} = require('../Utils/Ethereum');

const {
  makeCToken,
  fastForward,
  setBalance,
  getBalances,
  adjustBalances,
  pretendBorrow,
  preApprove,
  enterMarkets
} = require('../Utils/Compound');
const { ComptrollerErr, TokenErr, MathErr } = require('../Errors');

const repayAmount = etherExp(10);
const seizeTokens = repayAmount.multipliedBy(4); // forced

async function preLiquidate(cToken, liquidator, borrower, repayAmount, cTokenCollateral) {
  // setup for success in liquidating
  await cToken.helperComptroller.setLiquidateBorrowAllowed(true);
  await cToken.helperComptroller.setLiquidateBorrowVerify(true);
  await cToken.helperComptroller.setRepayBorrowAllowed(true);
  await cToken.helperComptroller.setRepayBorrowVerify(true);
  await cToken.helperComptroller.setSeizeAllowed(true);
  await cToken.helperComptroller.setSeizeVerify(true);
  await cToken.helperComptroller.setFailCalculateSeizeTokens(false);
  await cToken.helperUnderlying.harnessSetFailTransferFromAddress(liquidator.address, false);
  await cToken.helperInterestRateModel.setFailBorrowRate(false);
  await cToken.helperInterestRateModel.setFailBorrowRate(false);
  await cTokenCollateral.helperComptroller.setCalculatedSeizeTokens(toEBN(seizeTokens));
  await cTokenCollateral.harnessSetTotalSupply(toEBN(etherExp(10)));
  await setBalance(cTokenCollateral, liquidator, 0);
  await setBalance(cTokenCollateral, borrower, seizeTokens);
  await pretendBorrow(cTokenCollateral, borrower, 0, 1, 0);
  await pretendBorrow(cToken, borrower, 1, 1, repayAmount);
  await preApprove(cToken, liquidator, toEBN(repayAmount));
}

async function liquidateFresh(cToken, liquidator, borrower, repayAmount, cTokenCollateral) {
  return cToken.harnessLiquidateBorrowFresh(liquidator.address, borrower.address, toEBN(repayAmount), cTokenCollateral.address)
}

async function liquidate(cToken, liquidator, borrower, repayAmount, cTokenCollateral) {
  // make sure to have a block delta so we accrue interest
  await fastForward(cToken, 1);
  await fastForward(cTokenCollateral, 1);
  return cToken.connect(liquidator).liquidateBorrow(borrower.address, toEBN(repayAmount), cTokenCollateral.address)
}

async function seize(cToken, liquidator, borrower, seizeAmount) {
  return cToken.seize(liquidator.address, borrower.address, toEBN(seizeAmount));
}

describe('CToken', function () {
  let root, liquidator, borrower, accounts;
  let cToken, cTokenCollateral;

  const protocolSeizeShareMantissa = toBN('2.8e16'); // 2.8%
  const exchangeRate = etherExp(.2);

  const protocolShareTokens = seizeTokens.multipliedBy(protocolSeizeShareMantissa).dividedBy(etherExp(1));
  const liquidatorShareTokens = seizeTokens.minus(protocolShareTokens);

  const addReservesAmount = protocolShareTokens.multipliedBy(exchangeRate).dividedBy(etherExp(1));

  beforeEach(async () => {
    [root, liquidator, borrower, ...accounts] = await ethers.getSigners();
    cToken = await makeCToken({ comptrollerOpts: { kind: 'bool' } });
    cTokenCollateral = await makeCToken({ comptroller: cToken.helperComptroller });
    const tx = await cTokenCollateral.harnessSetExchangeRate(toEBN(exchangeRate));
    const events = await getEvents(tx);
    expect(!events.includes('Failure')).equals(true)
  });

  beforeEach(async () => {
    await preLiquidate(cToken, liquidator, borrower, repayAmount, cTokenCollateral);
  });

  describe('liquidateBorrowFresh', () => {
    it("fails if comptroller tells it to", async () => {
      await cToken.helperComptroller.setLiquidateBorrowAllowed(false);
      const tx = await liquidateFresh(cToken, liquidator, borrower, repayAmount, cTokenCollateral);
      const events = await getEvents(tx);
      const mathError = toEBN(ComptrollerErr.Error.MATH_ERROR);
      const otherError = toEBN(TokenErr.FailureInfo.LIQUIDATE_COMPTROLLER_REJECTION);

      expect(events.some(e => deepEqual(e, mathError))).equals(true)
      expect(events.some(e => deepEqual(e, otherError))).equals(true)
    });

    it("proceeds if comptroller tells it to", async () => {
      const tx = await liquidateFresh(cToken, liquidator, borrower, repayAmount, cTokenCollateral);
      const events = await getEvents(tx);
      expect(!events.includes('Failure')).equals(true)
    });

    it("fails if market not fresh", async () => {
      await fastForward(cToken);
      const tx = await liquidateFresh(cToken, liquidator, borrower, repayAmount, cTokenCollateral);
      const events = await getEvents(tx);
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.MARKET_NOT_FRESH)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.LIQUIDATE_FRESHNESS_CHECK)))).equals(true)
    });

    it("fails if collateral market not fresh", async () => {
      await fastForward(cToken);
      await fastForward(cTokenCollateral);
      await cToken.accrueInterest();
      const tx = await liquidateFresh(cToken, liquidator, borrower, repayAmount, cTokenCollateral);
      const events = await getEvents(tx);
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.MARKET_NOT_FRESH)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.LIQUIDATE_COLLATERAL_FRESHNESS_CHECK)))).equals(true)
    });

    it("fails if borrower is equal to liquidator", async () => {
      const tx = await liquidateFresh(cToken, borrower, borrower, repayAmount, cTokenCollateral);
      const events = await getEvents(tx);
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.INVALID_ACCOUNT_PAIR)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.LIQUIDATE_LIQUIDATOR_IS_BORROWER)))).equals(true)
    });

    it("fails if repayAmount = 0", async () => {
      const tx = await liquidateFresh(cToken, liquidator, borrower, 0, cTokenCollateral);
      const events = await getEvents(tx);
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.INVALID_CLOSE_AMOUNT_REQUESTED)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.LIQUIDATE_CLOSE_AMOUNT_IS_ZERO)))).equals(true)
    });

    it("fails if calculating seize tokens fails and does not adjust balances", async () => {
      const beforeBalances = await getBalances([cToken, cTokenCollateral], [liquidator, borrower]);
      await cToken.helperComptroller.setFailCalculateSeizeTokens(true);
      const tx = liquidateFresh(cToken, liquidator, borrower, repayAmount, cTokenCollateral);
      await expect(tx).to.be.revertedWith('LIQUIDATE_COMPTROLLER_CALCULATE_AMOUNT_SEIZE_FAILED');
      const afterBalances = await getBalances([cToken, cTokenCollateral], [liquidator, borrower]);
      expect(afterBalances).to.eql(beforeBalances);
    });

    it("fails if repay fails", async () => {
      await cToken.helperComptroller.setRepayBorrowAllowed(false);
      const tx = await liquidateFresh(cToken, liquidator, borrower, repayAmount, cTokenCollateral);
      const events = await getEvents(tx);
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.LIQUIDATE_REPAY_BORROW_FRESH_FAILED)))).equals(true)
    });

    it("reverts if seize fails", async () => {
      await cToken.helperComptroller.setSeizeAllowed(false);
      await expect(
        liquidateFresh(cToken, liquidator, borrower, repayAmount, cTokenCollateral)
      ).to.be.revertedWith("token seizure failed");
    });

    it("transfers the cash, borrows, tokens, and emits Transfer, LiquidateBorrow events", async () => {
      const beforeBalances = await getBalances([cToken, cTokenCollateral], [liquidator, borrower]);
      const result = await liquidateFresh(cToken, liquidator, borrower, repayAmount, cTokenCollateral);
      const afterBalances = await getBalances([cToken, cTokenCollateral], [liquidator, borrower]);
      const events = await getEvents(result);
      expect(!events.includes('Failure')).equals(true)

      expect(await hasEvent(result, ['LiquidateBorrow', liquidator.address, borrower.address, toEBN(repayAmount), cTokenCollateral.address, toEBN(seizeTokens)])).equals(true)
      expect(await hasEvent(result, ['Transfer', liquidator.address, cToken.address, toEBN(repayAmount)])).equals(true)
      expect(await hasEvent(result, ['Transfer', borrower.address, liquidator.address, toEBN(liquidatorShareTokens)])).equals(true)
      expect(await hasEvent(result, ['Transfer', borrower.address, cTokenCollateral.address, toEBN(protocolShareTokens)])).equals(true)
      const adjusted = await adjustBalances(beforeBalances,
        [
          [cToken.address, 'cash', repayAmount],
          [cToken.address, 'borrows', -repayAmount],
          [cToken.address, liquidator.address, 'cash', -repayAmount],
          [cTokenCollateral.address, liquidator.address, 'tokens', liquidatorShareTokens],
          [cToken.address, borrower.address, 'borrows', -repayAmount],
          [cTokenCollateral.address, borrower.address, 'tokens', -seizeTokens],
          [cTokenCollateral.address, cTokenCollateral.address, 'reserves', addReservesAmount],
          [cTokenCollateral.address, cTokenCollateral.address, 'tokens', -protocolShareTokens]
        ]);
      expect(afterBalances).to.eql(adjusted);
    });
  });

  describe('liquidateBorrow', () => {
    it("emits a liquidation failure if borrowed asset interest accrual fails", async () => {
      await cToken.helperInterestRateModel.setFailBorrowRate(true);
      await expect(liquidate(cToken, liquidator, borrower, repayAmount, cTokenCollateral)).to.be.reverted;
    });

    it("emits a liquidation failure if collateral asset interest accrual fails", async () => {
      await cTokenCollateral.helperInterestRateModel.setFailBorrowRate(true);
      await expect(liquidate(cToken, liquidator, borrower, repayAmount, cTokenCollateral)).to.be.revertedWith('INTEREST_RATE_MODEL_ERROR');

    });

    it("returns error from liquidateBorrowFresh without emitting any extra logs", async () => {
      const tx = await liquidate(cToken, liquidator, borrower, 0, cTokenCollateral);
      const events = await getEvents(tx);

      expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.INVALID_CLOSE_AMOUNT_REQUESTED)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.LIQUIDATE_CLOSE_AMOUNT_IS_ZERO)))).equals(true)
    });

    it("returns success from liquidateBorrowFresh and transfers the correct amounts", async () => {
      const beforeBalances = await getBalances([cToken, cTokenCollateral], [liquidator, borrower]);
      const result = await liquidate(cToken, liquidator, borrower, repayAmount, cTokenCollateral);
      const gasCost = await etherGasCost(result);
      const afterBalances = await getBalances([cToken, cTokenCollateral], [liquidator, borrower]);
      const events = await getEvents(result);
      expect(!events.includes('Failure')).equals(true)

      expect(afterBalances).to.eql(await adjustBalances(beforeBalances,
        [
          [cToken.address, 'cash', repayAmount],
          [cToken.address, 'borrows', -repayAmount],
          [cToken.address, liquidator.address, 'eth', -gasCost],
          [cToken.address, liquidator.address, 'cash', -repayAmount],
          [cTokenCollateral.address, liquidator.address, 'eth', -gasCost],
          [cTokenCollateral.address, liquidator.address, 'tokens', liquidatorShareTokens],
          [cTokenCollateral.address, cTokenCollateral.address, 'reserves', addReservesAmount],
          [cToken.address, borrower.address, 'borrows', -repayAmount],
          [cTokenCollateral.address, borrower.address, 'tokens', -seizeTokens],
          [cTokenCollateral.address, cTokenCollateral.address, 'tokens', -protocolShareTokens], // total supply decreases
        ]));
    });
  });

  describe('seize', () => {
    // XXX verify callers are properly checked

    it("fails if seize is not allowed", async () => {
      await cToken.helperComptroller.setSeizeAllowed(false);
      const tx = await seize(cTokenCollateral, liquidator, borrower, seizeTokens);
      const events = await getEvents(tx);
      expect(events.some(e => deepEqual(e, toEBN(ComptrollerErr.Error.MATH_ERROR)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.LIQUIDATE_SEIZE_COMPTROLLER_REJECTION)))).equals(true)
    });

    it("fails if cTokenBalances[borrower] < amount", async () => {
      await setBalance(cTokenCollateral, borrower, 1);
      const tx = await seize(cTokenCollateral, liquidator, borrower, seizeTokens);
      const events = await getEvents(tx);
      expect(events.some(e => deepEqual(e, toEBN(MathErr.Error.INTEGER_UNDERFLOW)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.LIQUIDATE_SEIZE_BALANCE_DECREMENT_FAILED)))).equals(true)
    });

    it("fails if cTokenBalances[liquidator] overflows", async () => {
      await setBalance(cTokenCollateral, liquidator, UInt256Max());
      const tx = await seize(cTokenCollateral, liquidator, borrower, seizeTokens);
      const events = await getEvents(tx);
      expect(events.some(e => deepEqual(e, toEBN(MathErr.Error.INTEGER_OVERFLOW)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.LIQUIDATE_SEIZE_BALANCE_INCREMENT_FAILED)))).equals(true)
    });

    it("succeeds, updates balances, adds to reserves, and emits Transfer and ReservesAdded events", async () => {
      const beforeBalances = await getBalances([cTokenCollateral], [liquidator, borrower]);
      const result = await seize(cTokenCollateral, liquidator, borrower, seizeTokens);
      const afterBalances = await getBalances([cTokenCollateral], [liquidator, borrower]);
      const events = await getEvents(result);
      expect(!events.includes('Failure')).equals(true)
      expect(await hasEvent(result, ['Transfer', borrower.address, liquidator.address, toEBN(liquidatorShareTokens)])).equals(true)
      expect(await hasEvent(result, ['Transfer', borrower.address, cTokenCollateral.address, toEBN(protocolShareTokens)])).equals(true)
      expect(await hasEvent(result, ['ReservesAdded', cTokenCollateral.address, toEBN(addReservesAmount), toEBN(addReservesAmount)])).equals(true)

      expect(afterBalances).to.eql(await adjustBalances(beforeBalances, [
        [cTokenCollateral.address, liquidator.address, 'tokens', liquidatorShareTokens],
        [cTokenCollateral.address, borrower.address, 'tokens', -seizeTokens],
        [cTokenCollateral.address, cTokenCollateral.address, 'reserves', addReservesAmount],
        [cTokenCollateral.address, cTokenCollateral.address, 'tokens', -protocolShareTokens], // total supply decreases
      ]));
    });
  });
});


describe('Comptroller', () => {
  it('liquidateBorrowAllowed allows deprecated markets to be liquidated', async () => {
    let [root, liquidator, borrower] = await ethers.getSigners();
    let collatAmount = 10;
    let borrowAmount = 2;
    const cTokenCollat = await makeCToken({ supportMarket: true, underlyingPrice: 1, collateralFactor: .5 });
    const cTokenBorrow = await makeCToken({ supportMarket: true, underlyingPrice: 1, comptroller: cTokenCollat.helperComptroller });
    const comptroller = cTokenCollat.helperComptroller;

    // borrow some tokens
    await cTokenCollat.helperUnderlying.harnessSetBalance(borrower.address, toEBN(collatAmount));
    await cTokenCollat.helperUnderlying.connect(borrower).approve(cTokenCollat.address, toEBN(collatAmount));
    await cTokenBorrow.helperUnderlying.harnessSetBalance(cTokenBorrow.address, toEBN(collatAmount));
    await cTokenBorrow.harnessSetTotalSupply(toEBN(collatAmount).mul(10));
    await cTokenBorrow.harnessSetExchangeRate(toEBN(etherExp(1)));

    expect(!(await getEvents(await enterMarkets([cTokenCollat], borrower))).includes('Failure')).equals(true)
    expect(!(await getEvents(await cTokenCollat.connect(borrower).mint(toEBN(collatAmount)))).includes('Failure')).equals(true)
    expect(!(await getEvents(await cTokenBorrow.connect(borrower).borrow(toEBN(borrowAmount)))).includes('Failure')).equals(true)

    // show the account is healthy
    await comptroller.liquidateBorrowAllowed(cTokenBorrow.address, cTokenCollat.address, liquidator.address, borrower.address, borrowAmount)
    expect(await comptroller.callStatic.liquidateBorrowAllowed(cTokenBorrow.address, cTokenCollat.address, liquidator.address, borrower.address, borrowAmount)).equals(ComptrollerErr.Error.INSUFFICIENT_SHORTFALL);

    // show deprecating a market works
    expect(!(await getEvents(await comptroller._setCollateralFactor(cTokenBorrow.address, toEBN(0)))).includes('Failure')).equals(true)
    expect(!(await getEvents(await comptroller._setBorrowPaused(cTokenBorrow.address, true))).includes('Failure')).equals(true)
    expect(!(await getEvents(await cTokenBorrow._setReserveFactor(toEBN(etherMantissa(1))))).includes('Failure')).equals(true)

    // show deprecated markets can be liquidated even if healthy
    expect(!(await getEvents(await comptroller.liquidateBorrowAllowed(cTokenBorrow.address, cTokenCollat.address, liquidator.address, borrower.address, toEBN(borrowAmount)))).includes('Failure')).equals(true)

  });
})
