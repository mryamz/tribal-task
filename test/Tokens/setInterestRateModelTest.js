const {both, getEvents, deepEqual, toEBN} = require('../Utils/Ethereum');
const {
  fastForward,
  makeCToken,
  makeInterestRateModel
} = require('../Utils/Compound');
const { ethers } = require('hardhat');
const { expect } = require('chai');
const { TokenErr } = require('../Errors');

describe('CToken', function () {
  let root, accounts;
  let newModel;
  beforeEach(async () => {
    [root, ...accounts] = await ethers.getSigners();;
    newModel = await makeInterestRateModel();
  });

  describe("_setInterestRateModelFresh", () => {
    let cToken, oldModel;
    beforeEach(async () => {
      cToken = await makeCToken();
      oldModel = cToken.helperInterestRateModel;
      expect(oldModel.address).not.equal(newModel.address);
    });

    it("fails if called by non-admin", async () => {
      const tx = await cToken.connect(accounts[0]).harnessSetInterestRateModelFresh(newModel.address);
      const events = await getEvents(tx);
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.UNAUTHORIZED)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.SET_INTEREST_RATE_MODEL_OWNER_CHECK)))).equals(true)
      expect(await cToken.interestRateModel()).equals(oldModel.address);
    });

    it("fails if market not fresh", async () => {
      const tx1 = await cToken.harnessFastForward(5);
      const events1 = await getEvents(tx1);
      expect(!events1.includes('Failure')).equals(true)

      const tx2 = await cToken.harnessSetInterestRateModelFresh(newModel.address);
      const events2 = await getEvents(tx2);
      expect(events2.includes('Failure')).equals(true)
      expect(events2.some(e => deepEqual(e, toEBN(TokenErr.Error.MARKET_NOT_FRESH)))).equals(true)
      expect(events2.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.SET_INTEREST_RATE_MODEL_FRESH_CHECK)))).equals(true)
      expect(await cToken.interestRateModel()).equals(oldModel.address);
    });

    it("reverts if passed a contract that doesn't implement isInterestRateModel", async () => {
      await expect(cToken.harnessSetInterestRateModelFresh(cToken.helperUnderlying.address)).to.be.reverted;
      expect(await cToken.interestRateModel()).equals(oldModel.address);
    });

    it("reverts if passed a contract that implements isInterestRateModel as false", async () => {
      // extremely unlikely to occur, of course, but let's be exhaustive
      const badModel = await makeInterestRateModel({kind: 'false-marker'});
      await expect(cToken.harnessSetInterestRateModelFresh(badModel.address)).to.be.revertedWith("marker method returned false");
      expect(await cToken.interestRateModel()).equals(oldModel.address);
    });

    it("accepts new valid interest rate model", async () => {
      const tx = await cToken.harnessSetInterestRateModelFresh(newModel.address);
      const events = await getEvents(tx);
      expect(!events.includes('Failure')).equals(true)
      expect(await cToken.interestRateModel()).equals(newModel.address);
    });

    it("emits expected log when accepting a new valid interest rate model", async () => {
      const result = await cToken.harnessSetInterestRateModelFresh(newModel.address);
      const events = await getEvents(result);
      expect(!events.includes('Failure')).equals(true)
      expect(events).to.eql(['NewMarketInterestRateModel', oldModel.address, newModel.address])
      expect(await cToken.interestRateModel()).equals(newModel.address);
    });
  });

  describe("_setInterestRateModel", () => {
    let cToken;
    beforeEach(async () => {
      cToken = await makeCToken();
    });

    beforeEach(async () => {
      await cToken.helperInterestRateModel.setFailBorrowRate(false);
    });

    it("emits a set market interest rate model failure if interest accrual fails", async () => {
      await cToken.helperInterestRateModel.setFailBorrowRate(true);
      await fastForward(cToken, 1);
      await expect(cToken._setInterestRateModel(newModel.address)).to.be.revertedWith("INTEREST_RATE_MODEL_ERROR");
    });

    it("returns error from _setInterestRateModelFresh without emitting any extra logs", async () => {

      // call
      const reply = await cToken.connect(accounts[0]).callStatic._setInterestRateModel(newModel.address);
      expect(reply).equal(TokenErr.Error.UNAUTHORIZED);

      // send
      const tx = await cToken.connect(accounts[0])._setInterestRateModel(newModel.address);
      const events = await getEvents(tx);

      expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.UNAUTHORIZED)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.SET_INTEREST_RATE_MODEL_OWNER_CHECK)))).equals(true)
    });

    it("reports success when _setInterestRateModelFresh succeeds", async () => {

      // call
      const reply = await cToken.callStatic._setInterestRateModel(newModel.address);
      expect(reply).equals(TokenErr.Error.NO_ERROR);

      // send
      const tx = await cToken._setInterestRateModel(newModel.address);
      const events = await getEvents(tx);
      expect(!events.includes('Failure')).equals(true)

      expect(await cToken.interestRateModel()).equals(newModel.address);
    });
  });
});
