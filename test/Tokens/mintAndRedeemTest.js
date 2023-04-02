const { ethers, changeNetwork } = require('hardhat');
const { expect } = require('chai');

const {
  etherUnsigned,
  etherMantissa,
  UInt256Max,
  toEBN,
  getEvents,
  hasEvent,
  deepEqual
} = require('../Utils/Ethereum');

const {
  makeCToken,
  balanceOf,
  fastForward,
  setBalance,
  getBalances,
  adjustBalances,
  preApprove,
  quickMint,
  preSupply,
  quickRedeem,
  quickRedeemUnderlying
} = require('../Utils/Compound');


const { ComptrollerErr, TokenErr } = require('../Errors');

const exchangeRate = 50e3;
const mintAmount = etherUnsigned(10e4);
const mintTokens = mintAmount.dividedBy(exchangeRate);
const redeemTokens = etherUnsigned(10e3);
const redeemAmount = redeemTokens.multipliedBy(exchangeRate);

async function preMint(cToken, minter, mintAmount, mintTokens, exchangeRate) {
  await preApprove(cToken, minter, toEBN(mintAmount));
  await cToken.helperComptroller.setMintAllowed(true);
  await cToken.helperComptroller.setMintVerify(true);
  await cToken.helperInterestRateModel.setFailBorrowRate(false);
  await cToken.helperUnderlying.harnessSetFailTransferFromAddress(minter.address, false);
  await cToken.harnessSetBalance(minter.address, 0);
  await cToken.harnessSetExchangeRate(toEBN(etherMantissa(exchangeRate)));
}

async function mintFresh(cToken, minter, mintAmount) {
  return cToken.harnessMintFresh(minter.address, toEBN(mintAmount));
}

async function preRedeem(cToken, redeemer, redeemTokens, redeemAmount, exchangeRate) {
  await preSupply(cToken, redeemer, redeemTokens);
  await cToken.helperComptroller.setRedeemAllowed(true);
  await cToken.helperComptroller.setRedeemVerify(true);
  await cToken.helperInterestRateModel.setFailBorrowRate(false);
  await cToken.helperUnderlying.harnessSetBalance(cToken.address, toEBN(redeemAmount));
  await cToken.helperUnderlying.harnessSetBalance(redeemer.address, 0);
  await cToken.helperUnderlying.harnessSetFailTransferToAddress(redeemer.address, false);
  await cToken.harnessSetExchangeRate(toEBN(etherMantissa(exchangeRate)));
}

async function redeemFreshTokens(cToken, redeemer, redeemTokens, redeemAmount) {
  return cToken.harnessRedeemFresh(redeemer.address, toEBN(redeemTokens), 0);
}

async function redeemFreshAmount(cToken, redeemer, redeemTokens, redeemAmount) {
  return cToken.harnessRedeemFresh(redeemer.address, 0, toEBN(redeemAmount));
}

describe('CToken', function () {
  let root, minter, redeemer, accounts;
  let cToken;
  beforeEach(async () => {
    [root, minter, redeemer, ...accounts] = await ethers.getSigners();
    cToken = await makeCToken({comptrollerOpts: {kind: 'bool'}, exchangeRate});
  });

  describe('mintFresh', () => {
    beforeEach(async () => {
      await preMint(cToken, minter, mintAmount, mintTokens, exchangeRate);
    });

    it("fails if comptroller tells it to", async () => {
      await cToken.helperComptroller.setMintAllowed(false);
      const tx = await mintFresh(cToken, minter, mintAmount);
      const events = await getEvents(tx);
      expect(events.some(e => deepEqual(e, toEBN(ComptrollerErr.Error.MATH_ERROR)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.MINT_COMPTROLLER_REJECTION)))).equals(true)
    });

    it("proceeds if comptroller tells it to", async () => {
      const tx = await mintFresh(cToken, minter, mintAmount);
      const events = await getEvents(tx);
      expect(!events.includes('Failure')).equals(true)
    });

    it("fails if not fresh", async () => {
      await fastForward(cToken);
      const tx = await mintFresh(cToken, minter, mintAmount);
      const events = await getEvents(tx);
      const freshMarket = toEBN(TokenErr.Error.MARKET_NOT_FRESH);
      expect(events.some(e => deepEqual(e, freshMarket))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.MINT_FRESHNESS_CHECK)))).equals(true)
    });

    it("continues if fresh", async () => {
      const tx1 = await cToken.accrueInterest();
      const events1 = await getEvents(tx1);
      expect(!events1.includes('Failure')).equals(true)

      const tx2 = await mintFresh(cToken, minter, mintAmount);
      const events2 = await getEvents(tx2);
      expect(!events2.includes('Failure')).equals(true)
    });

    it("fails if insufficient approval", async () => {
      const tx = await cToken.helperUnderlying.connect(minter).approve(cToken.address, 1);
      const events = await getEvents(tx);
      expect(!events.includes('Failure')).equals(true)
      await expect(mintFresh(cToken, minter, mintAmount)).to.be.revertedWith('Insufficient allowance');
    });

    it("fails if insufficient balance", async() => {
      await setBalance(cToken.helperUnderlying, minter, 1);
      await expect(mintFresh(cToken, minter, mintAmount)).to.be.revertedWith('Insufficient balance');
    });

    it("proceeds if sufficient approval and balance", async () =>{
      const tx = await mintFresh(cToken, minter, mintAmount);
      const events = await getEvents(tx);
      expect(!events.includes('Failure')).equals(true)
    });

    it("fails if exchange calculation fails", async () => {
      const tx = await cToken.harnessSetExchangeRate(0);
      const events = await getEvents(tx);
      expect(!events.includes('Failure')).equals(true)
      await expect(mintFresh(cToken, minter, mintAmount)).to.be.revertedWith('MINT_EXCHANGE_CALCULATION_FAILED');
    });

    it("fails if transferring in fails", async () => {
      await cToken.helperUnderlying.harnessSetFailTransferFromAddress(minter.address, true);
      await expect(mintFresh(cToken, minter, mintAmount)).to.be.revertedWith('TOKEN_TRANSFER_IN_FAILED');
    });

    it("transfers the underlying cash, tokens, and emits Mint, Transfer events", async () => {
      const beforeBalances = await getBalances([cToken], [minter]);
      const result = await mintFresh(cToken, minter, mintAmount);
      const afterBalances = await getBalances([cToken], [minter]);
      const events = await getEvents(result);
      expect(!events.includes('Failure')).equals(true)
      expect(await hasEvent(result, ['Mint', minter.address, toEBN(mintAmount), toEBN(mintTokens)])).equals(true)
      expect(await hasEvent(result, ['Transfer', cToken.address, minter.address, toEBN(mintTokens)])).equals(true)
      expect(afterBalances).to.eql(await adjustBalances(beforeBalances, [
        [cToken.address, minter.address, 'cash', -mintAmount],
        [cToken.address, minter.address, 'tokens', mintTokens],
        [cToken.address, 'cash', mintAmount],
        [cToken.address, 'tokens', mintTokens]
      ]));
    });
  });

  describe('mint', () => {
    beforeEach(async () => {
      await preMint(cToken, minter, mintAmount, mintTokens, exchangeRate);
    });

    it("emits a mint failure if interest accrual fails", async () => {
      await cToken.helperInterestRateModel.setFailBorrowRate(true);
      await expect(quickMint(cToken, minter, toEBN(mintAmount))).to.be.revertedWith("INTEREST_RATE_MODEL_ERROR");
    });

    it("returns error from mintFresh without emitting any extra logs", async () => {
      await cToken.helperUnderlying.harnessSetBalance(minter.address, 1);
      await expect(mintFresh(cToken, minter, mintAmount)).to.be.revertedWith('Insufficient balance');
    });

    it("returns success from mintFresh and mints the correct number of tokens", async () => {
      const tx = await quickMint(cToken, minter, toEBN(mintAmount));
      const events = await getEvents(tx);
      expect(!events.includes('Failure')).equals(true)
      expect(toEBN(mintTokens)).not.equals(0);
      expect(toEBN(await balanceOf(cToken, minter))).equals(toEBN(mintTokens));
    });

    it("emits an AccrueInterest event", async () => {
      const tx = await quickMint(cToken, minter, toEBN(mintAmount));
      expect(await hasEvent(tx, ['AccrueInterest', toEBN(0), toEBN(0), toEBN('1000000000000000000'), toEBN(0)])).equals(true)
    });
  });

  [redeemFreshTokens, redeemFreshAmount].forEach((redeemFresh) => {
    describe(redeemFresh.name, () => {
      beforeEach(async () => {
        await preRedeem(cToken, redeemer, redeemTokens, redeemAmount, exchangeRate);
      });

      it("fails if comptroller tells it to", async () =>{
        await cToken.helperComptroller.setRedeemAllowed(false);
        const tx = await redeemFresh(cToken, redeemer, redeemTokens, redeemAmount);
        const events = await getEvents(tx);
        expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.REDEEM_COMPTROLLER_REJECTION)))).equals(true)
      });

      it("fails if not fresh", async () => {
        await fastForward(cToken);
        const tx = await redeemFresh(cToken, redeemer, redeemTokens, redeemAmount);
        const events = await getEvents(tx);
        expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.MARKET_NOT_FRESH)))).equals(true)
        expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.REDEEM_FRESHNESS_CHECK)))).equals(true)
      });

      it("continues if fresh", async () => {
        const tx1 = await cToken.accrueInterest();
        const events1 = await getEvents(tx1);
        expect(!events1.includes('Failure')).equals(true)


        const tx2 = await redeemFresh(cToken, redeemer, redeemTokens, redeemAmount);
        const events2 = await getEvents(tx2);
        expect(!events2.includes('Failure')).equals(true)
      });

      it("fails if insufficient protocol cash to transfer out", async() => {
        await cToken.helperUnderlying.harnessSetBalance(cToken.address, 1);
        const tx = await redeemFresh(cToken, redeemer, redeemTokens, redeemAmount);
        const events = await getEvents(tx);

        expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.TOKEN_INSUFFICIENT_CASH)))).equals(true)
        expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.REDEEM_TRANSFER_OUT_NOT_POSSIBLE)))).equals(true)
      });

      it("fails if exchange calculation fails", async () => {
        if (redeemFresh == redeemFreshTokens) {
          const tx1 = await cToken.harnessSetExchangeRate(UInt256Max());
          const events1 = await getEvents(tx1);
          expect(!events1.includes('Failure')).equals(true)

          const tx2 = await redeemFresh(cToken, redeemer, redeemTokens, redeemAmount);
          const events2 = await getEvents(tx2);
          expect(events2.some(e => deepEqual(e, toEBN(TokenErr.Error.MATH_ERROR)))).equals(true)
          expect(events2.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.REDEEM_EXCHANGE_TOKENS_CALCULATION_FAILED)))).equals(true)
        } else {
          const tx1 = await cToken.harnessSetExchangeRate(0);
          const events1 = await getEvents(tx1);
          expect(!events1.includes('Failure')).equals(true)

          const tx2 = await redeemFresh(cToken, redeemer, redeemTokens, redeemAmount);
          const events2 = await getEvents(tx2);
          expect(events2.some(e => deepEqual(e, toEBN(TokenErr.Error.MATH_ERROR)))).equals(true)
          expect(events2.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.REDEEM_EXCHANGE_AMOUNT_CALCULATION_FAILED)))).equals(true)
        }
      });

      it("fails if transferring out fails", async () => {
        await cToken.helperUnderlying.harnessSetFailTransferToAddress(redeemer.address, true);
        await expect(redeemFresh(cToken, redeemer, redeemTokens, redeemAmount)).to.be.revertedWith("TOKEN_TRANSFER_OUT_FAILED");
      });

      it("fails if total supply < redemption amount", async () => {
        await cToken.harnessExchangeRateDetails(0, 0, 0);
        const tx = await redeemFresh(cToken, redeemer, redeemTokens, redeemAmount);
        const events = await getEvents(tx);
        expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.MATH_ERROR)))).equals(true)
        expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.REDEEM_NEW_TOTAL_SUPPLY_CALCULATION_FAILED)))).equals(true)
      });

      it("reverts if new account balance underflows", async () => {
        await cToken.harnessSetBalance(redeemer.address, 0);
        const tx = await redeemFresh(cToken, redeemer, redeemTokens, redeemAmount);
        const events = await getEvents(tx);
        expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.MATH_ERROR)))).equals(true)
        expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.REDEEM_NEW_ACCOUNT_BALANCE_CALCULATION_FAILED)))).equals(true)
      });

      it("transfers the underlying cash, tokens, and emits Redeem, Transfer events", async () => {
        const beforeBalances = await getBalances([cToken], [redeemer]);
        const result = await redeemFresh(cToken, redeemer, redeemTokens, redeemAmount);
        const afterBalances = await getBalances([cToken], [redeemer]);
        const events = await getEvents(result);
        expect(!events.includes('Failure')).equals(true)
        expect(await hasEvent(result, ['Redeem', redeemer.address, toEBN(redeemAmount), toEBN(redeemTokens)])).equals(true)
        expect(await hasEvent(result, ['Transfer', redeemer.address, cToken.address, toEBN(redeemTokens)])).equals(true)
        expect(afterBalances).to.eql(await adjustBalances(beforeBalances, [
          [cToken.address, redeemer.address, 'cash', redeemAmount],
          [cToken.address, redeemer.address, 'tokens', -redeemTokens],
          [cToken.address, 'cash', -redeemAmount],
          [cToken.address, 'tokens', -redeemTokens]
        ]));
      });
    });
  });

  describe('redeem', () => {
    beforeEach(async () => {
      await preRedeem(cToken, redeemer, redeemTokens, redeemAmount, exchangeRate);
    });

    it("emits a redeem failure if interest accrual fails", async () => {
      await cToken.helperInterestRateModel.setFailBorrowRate(true);
      await expect(quickRedeem(cToken, redeemer, redeemTokens)).to.be.revertedWith("INTEREST_RATE_MODEL_ERROR");
    });

    it("returns error from redeemFresh without emitting any extra logs", async () => {
      await setBalance(cToken.helperUnderlying, cToken, 0);
      const tx = await quickRedeem(cToken, redeemer, redeemTokens, {exchangeRate});
      const events = await getEvents(tx);
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.TOKEN_INSUFFICIENT_CASH)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.REDEEM_TRANSFER_OUT_NOT_POSSIBLE)))).equals(true)
    });

    it("returns success from redeemFresh and redeems the right amount", async () => {
      const tx1 = await cToken.helperUnderlying.harnessSetBalance(cToken.address, toEBN(redeemAmount));
      const events1 = await getEvents(tx1);
      expect(!events1.includes('Failure')).equals(true)
      const tx2 = await quickRedeem(cToken, redeemer, redeemTokens, {exchangeRate});
      const events2 = await getEvents(tx2);
      expect(!events2.includes('Failure')).equals(true)
      expect(toEBN(redeemAmount)).not.equals(0);
      expect(toEBN(await balanceOf(cToken.helperUnderlying, redeemer))).equals(toEBN(redeemAmount));
    });

    it("returns success from redeemFresh and redeems the right amount of underlying", async () => {
      const tx = await cToken.helperUnderlying.harnessSetBalance(cToken.address, toEBN(redeemAmount));
      const events = await getEvents(tx);
      expect(!events.includes('Failure')).equals(true)

      const otherTx = await quickRedeemUnderlying(cToken, redeemer, redeemAmount, {exchangeRate});
      const moreEvents = await getEvents(otherTx);
      expect(!moreEvents.includes('Failure')).equals(true)

      expect(toEBN(redeemAmount)).not.equals(0);
      expect(toEBN(await balanceOf(cToken.helperUnderlying, redeemer))).equals(toEBN(redeemAmount));
    });

    it("emits an AccrueInterest event", async () => {
      const tx = await quickMint(cToken, minter, toEBN(mintAmount));
      expect(await hasEvent(tx, ['AccrueInterest', toEBN('500000000'), toEBN(0), toEBN('1000000000000000000'), toEBN(0)])).equals(true)
    });
  });
});
