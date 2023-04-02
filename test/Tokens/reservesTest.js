const { ethers } = require('hardhat');
const { expect } = require('chai');

const {
  etherUnsigned,
  etherMantissa,
  both,
  etherExp,
  toEBN,
  getEvents,
  hasEvent,
  toBN,
  deepEqual
} = require('../Utils/Ethereum');

const { ComptrollerErr, TokenErr } = require('../Errors');
const {fastForward, makeCToken, getBalances, adjustBalances} = require('../Utils/Compound');

const factor = etherMantissa(.02);

const reserves = etherUnsigned(3e12);
const cash = etherUnsigned(reserves.multipliedBy(2));
const reduction = etherUnsigned(2e12);

describe('CToken', function () {
  let root, accounts;
  beforeEach(async () => {
    [root, ...accounts] = await ethers.getSigners();
  });

  describe('_setReserveFactorFresh', () => {
    let cToken;
    beforeEach(async () => {
      cToken = await makeCToken();
    });

    it("rejects change by non-admin", async () => {
      const tx = await cToken.connect(accounts[0]).harnessSetReserveFactorFresh(toEBN(factor));
      const events = await getEvents(tx);
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.UNAUTHORIZED)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.SET_RESERVE_FACTOR_ADMIN_CHECK)))).equals(true)

      expect(await cToken.reserveFactorMantissa()).equals(0);
    });

    it("rejects change if market not fresh", async () => {
      const tx1 = await cToken.harnessFastForward(5);
      const events1 = await getEvents(tx1);
      expect(!events1.includes('Failure')).equals(true)

      const tx2 = await cToken.harnessSetReserveFactorFresh(toEBN(factor));
      const events2 = await getEvents(tx2);
      expect(events2.some(e => deepEqual(e, toEBN(TokenErr.Error.MARKET_NOT_FRESH)))).equals(true)
      expect(events2.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.SET_RESERVE_FACTOR_FRESH_CHECK)))).equals(true)
      expect(await cToken.reserveFactorMantissa()).equals(0);
    });

    it("rejects newReserveFactor that descales to 1", async () => {
      const tx = await cToken.harnessSetReserveFactorFresh(toEBN(etherMantissa(1.01)));
      const events = await getEvents(tx);
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.BAD_INPUT)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.SET_RESERVE_FACTOR_BOUNDS_CHECK)))).equals(true)
      expect(await cToken.reserveFactorMantissa()).equals(0);
    });

    it("accepts newReserveFactor in valid range and emits log", async () => {
      const result = await cToken.harnessSetReserveFactorFresh(toEBN(factor));
      const events = await getEvents(result);
      expect(!events.includes('Failure')).equals(true)
      expect(await cToken.reserveFactorMantissa()).equals(toEBN(factor));
      expect(await hasEvent(result, ["NewReserveFactor", toEBN(0), toEBN(factor)])).equals(true)
    });

    it("accepts a change back to zero", async () => {
      const result1 = await cToken.harnessSetReserveFactorFresh(toEBN(factor));
      const events1 = await getEvents(result1);

      const result2 = await cToken.harnessSetReserveFactorFresh(0);
      const events2 = await getEvents(result2);

      expect(!events1.includes('Failure')).equals(true)
      expect(!events2.includes('Failure')).equals(true)

      expect(await hasEvent(result2, ["NewReserveFactor", toEBN(factor), toEBN(0)])).equals(true)
      expect(await cToken.reserveFactorMantissa()).equals(0);
    });
  });

  describe('_setReserveFactor', () => {
    let cToken;
    beforeEach(async () => {
      cToken = await makeCToken();
    });

    beforeEach(async () => {
      await cToken.helperInterestRateModel.setFailBorrowRate(false);
      await cToken._setReserveFactor(0);
    });

    it("emits a reserve factor failure if interest accrual fails", async () => {
      await cToken.helperInterestRateModel.setFailBorrowRate(true);
      await fastForward(cToken, 1);
      await expect(cToken._setReserveFactor(toEBN(factor))).to.be.revertedWith("INTEREST_RATE_MODEL_ERROR");
      expect(await cToken.reserveFactorMantissa()).equals(0);
    });

    it("returns error from setReserveFactorFresh without emitting any extra logs", async () => {
      const reply = await cToken.callStatic._setReserveFactor(toEBN(etherMantissa(2)));
      const tx = await cToken._setReserveFactor(toEBN(etherMantissa(2)));
      const events = await getEvents(tx);

      expect(reply).equals(TokenErr.Error.BAD_INPUT);
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.BAD_INPUT)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.SET_RESERVE_FACTOR_BOUNDS_CHECK)))).equals(true)
      expect(await cToken.reserveFactorMantissa()).equals(0);
    });

    it("returns success from setReserveFactorFresh", async () => {
      expect(await cToken.reserveFactorMantissa()).equals(0);

      const tx1 = await cToken.harnessFastForward(5);
      const events1 = await getEvents(tx1);
      expect(!events1.includes('Failure')).equals(true)

      const tx2 = await cToken._setReserveFactor(toEBN(factor));
      const events2 = await getEvents(tx2);
      expect(!events2.includes('Failure')).equals(true)

      expect(await cToken.reserveFactorMantissa()).equals(toEBN(factor));
    });
  });

  describe("_reduceReservesFresh", () => {
    let cToken;
    beforeEach(async () => {
      cToken = await makeCToken();
      const tx1 = await cToken.harnessSetTotalReserves(toEBN(reserves));
      const events1 = await getEvents(tx1);
      expect(!events1.includes('Failure')).equals(true)

      const tx2 = await cToken.helperUnderlying.harnessSetBalance(cToken.address, toEBN(cash));
      const events2 = await getEvents(tx2);
      expect(!events2.includes('Failure')).equals(true)
    });

    it("fails if called by non-admin", async () => {

      const tx = await cToken.connect(accounts[0]).harnessReduceReservesFresh(toEBN(reduction));
      const events = await getEvents(tx);

      expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.UNAUTHORIZED)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.REDUCE_RESERVES_ADMIN_CHECK)))).equals(true)

      expect(await cToken.totalReserves()).equals(toEBN(reserves));
    });

    it("fails if market not fresh", async () => {
      const tx1 = await cToken.harnessFastForward(5);
      const events1 = await getEvents(tx1);
      expect(!events1.includes('Failure')).equals(true)

      const tx2 = await cToken.harnessReduceReservesFresh(toEBN(reduction));
      const events2 = await getEvents(tx2);
      expect(events2.some(e => deepEqual(e, toEBN(TokenErr.Error.MARKET_NOT_FRESH)))).equals(true)
      expect(events2.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.REDUCE_RESERVES_FRESH_CHECK)))).equals(true)

      expect(await cToken.totalReserves()).equals(toEBN(reserves));
    });

    it("fails if amount exceeds reserves", async () => {
      const tx = await cToken.harnessReduceReservesFresh(toEBN(reserves.plus(1)));
      const events = await getEvents(tx);
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.BAD_INPUT)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.REDUCE_RESERVES_VALIDATION)))).equals(true)
      expect(await cToken.totalReserves()).equals(toEBN(reserves));
    });

    it("fails if amount exceeds available cash", async () => {
      const cashLessThanReserves = reserves.minus(2);
      await cToken.helperUnderlying.harnessSetBalance(cToken.address, toEBN(cashLessThanReserves));
      const tx = await cToken.harnessReduceReservesFresh(toEBN(reserves));
      const events = await getEvents(tx);
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.TOKEN_INSUFFICIENT_CASH)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.REDUCE_RESERVES_CASH_NOT_AVAILABLE)))).equals(true)
      expect(await cToken.totalReserves()).equals(toEBN(reserves));
    });

    it("increases admin balance and reduces reserves on success", async () => {
      const balance = etherUnsigned(toBN(await cToken.helperUnderlying.balanceOf(root.address)));
      const tx = await cToken.harnessReduceReservesFresh(toEBN(reserves));
      const events = await getEvents(tx);
      expect(!events.includes('Failure')).equals(true)
      expect(toEBN(await cToken.helperUnderlying.balanceOf(root.address))).equals(toEBN(balance.plus(reserves)));
      expect(await cToken.totalReserves()).equals(0);
    });

    it("emits an event on success", async () => {
      await expect(cToken.harnessReduceReservesFresh(toEBN(reserves))).to.emit(cToken, 'ReservesReduced').withArgs(root.address, toEBN(reserves), 0);
    });
  });

  describe("_reduceReserves", () => {
    let cToken;
    beforeEach(async () => {
      cToken = await makeCToken();
      await cToken.helperInterestRateModel.setFailBorrowRate(false);
      const tx1 = await cToken.harnessSetTotalReserves(toEBN(reserves));
      const events1 = await getEvents(tx1);
      expect(!events1.includes('Failure')).equals(true)

      const tx2 = await cToken.helperUnderlying.harnessSetBalance(cToken.address, toEBN(cash));
      const events2 = await getEvents(tx2);
      expect(!events2.includes('Failure')).equals(true)
    });

    it("emits a reserve-reduction failure if interest accrual fails", async () => {
      await cToken.helperInterestRateModel.setFailBorrowRate(true);
      await fastForward(cToken, 1);
      await expect(cToken._reduceReserves(toEBN(reduction))).to.be.revertedWith("INTEREST_RATE_MODEL_ERROR");
    });

    it("returns error from _reduceReservesFresh without emitting any extra logs", async () => {
      const reply =  await cToken.callStatic.harnessReduceReservesFresh(toEBN(reserves.plus(1)));
      const tx = await cToken.harnessReduceReservesFresh(toEBN(reserves.plus(1)));
      const events = await getEvents(tx);

      expect(reply).equals(TokenErr.Error.BAD_INPUT);
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.BAD_INPUT)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.REDUCE_RESERVES_VALIDATION)))).equals(true)
    });

    it("returns success code from _reduceReservesFresh and reduces the correct amount", async () => {
      expect(await cToken.totalReserves()).equals(toEBN(reserves));

      const tx1 = await cToken.harnessFastForward(5);
      const events1 = await getEvents(tx1);
      expect(!events1.includes('Failure')).equals(true)

      const tx2 = await cToken._reduceReserves(toEBN(reduction));
      const events2 = await getEvents(tx2);
      expect(!events2.includes('Failure')).equals(true)
    });
  });

  describe("CEther addReserves", () => {
    let cToken;
    beforeEach(async () => {
      cToken = await makeCToken({kind: 'cether'});
    });

    it("add reserves for CEther", async () => {
      const balanceBefore = await getBalances([cToken], [])
      const reservedAdded = toEBN(etherExp(1));
      const result = await cToken._addReserves({value: reservedAdded})  //assert no erro
      const events = await getEvents(result);
      expect(!events.includes('Failure')).equals(true)

      expect(await hasEvent(result, ['ReservesAdded', root.address, reservedAdded, reservedAdded])).equals(true)
      const balanceAfter = await getBalances([cToken], []);
      const adjust = await adjustBalances(balanceBefore, [
        [cToken.address, cToken.address, 'eth', toBN(reservedAdded)],
        [cToken.address, cToken.address, 'reserves', toBN(reservedAdded)]
      ]);
      expect(balanceAfter).to.eql(adjust);
    });
  });
});
