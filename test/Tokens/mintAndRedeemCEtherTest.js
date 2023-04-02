const { ethers } = require('hardhat');
const { expect } = require('chai');

const {
  etherGasCost,
  etherMantissa,
  etherUnsigned,
  sendFallback,
  toEBN,
  getEvents,
  toBN,
  deepEqual
} = require('../Utils/Ethereum');

const {
  makeCToken,
  balanceOf,
  fastForward,
  setBalance,
  setEtherBalance,
  getBalances,
  adjustBalances,
} = require('../Utils/Compound');

const { ComptrollerErr, TokenErr } = require('../Errors');
const { inc } = require('semver');

const exchangeRate = 5;
const mintAmount = etherUnsigned(1e5);
const mintTokens = mintAmount.dividedBy(exchangeRate);
const redeemTokens = etherUnsigned(10e3);
const redeemAmount = redeemTokens.multipliedBy(exchangeRate);

async function preMint(cToken, minter, mintAmount, mintTokens, exchangeRate) {
  await cToken.helperComptroller.setMintAllowed(true);
  await cToken.helperComptroller.setMintVerify(true);
  await cToken.helperInterestRateModel.setFailBorrowRate(false);
  await cToken.harnessSetExchangeRate(toEBN(etherMantissa(exchangeRate)));
}

async function mintExplicit(cToken, minter, mintAmount) {
  return cToken.connect(minter).mint({value: mintAmount});
}

async function mintFallback(cToken, minter, mintAmount) {
  return sendFallback(cToken, minter, {from: minter.address, value: toEBN(mintAmount)});
}

async function preRedeem(cToken, redeemer, redeemTokens, redeemAmount, exchangeRate) {
  await cToken.helperComptroller.setRedeemAllowed(true);
  await cToken.helperComptroller.setRedeemVerify(true);
  await cToken.helperInterestRateModel.setFailBorrowRate(false);
  await cToken.harnessSetExchangeRate(toEBN(etherMantissa(exchangeRate)));
  await setEtherBalance(cToken, redeemAmount);
  await cToken.harnessSetTotalSupply(toEBN(redeemTokens));
  await setBalance(cToken, redeemer, redeemTokens);
}

async function redeemCTokens(cToken, redeemer, redeemTokens, redeemAmount) {
  return cToken.connect(redeemer).redeem(toEBN(redeemTokens));
}

async function redeemUnderlying(cToken, redeemer, redeemTokens, redeemAmount) {
  return cToken.connect(redeemer).redeemUnderlying(toEBN(redeemAmount));
}

describe('CEther', () => {
  let root, minter, redeemer, accounts;
  let cToken;

  beforeEach(async () => {
    [root, minter, redeemer, ...accounts] = await ethers.getSigners();
    cToken = await makeCToken({kind: 'cether', comptrollerOpts: {kind: 'bool'}});
    await fastForward(cToken, 1);
  });

  [mintExplicit, mintFallback].forEach((mint) => {
    describe(mint.name, () => {
      beforeEach(async () => {
        await preMint(cToken, minter, mintAmount, mintTokens, exchangeRate);
      });

      it("reverts if interest accrual fails", async () => {
        await cToken.helperInterestRateModel.setFailBorrowRate(true);
        await expect(mint(cToken, minter, toEBN(mintAmount))).to.be.revertedWith("INTEREST_RATE_MODEL_ERROR");
      });

      it("returns success from mintFresh and mints the correct number of tokens", async () => {
        const beforeBalances = await getBalances([cToken], [minter]);
        const tx = mint(cToken, minter, toEBN(mintAmount));
        await expect(tx).to.not.be.reverted;
        const afterBalances = await getBalances([cToken], [minter]);;

        expect(toEBN(mintTokens)).not.equals(0);
        expect(afterBalances).to.eql(await adjustBalances(beforeBalances, [
          [cToken.address, 'eth', mintAmount],
          [cToken.address, 'tokens', mintTokens],
          [cToken.address, minter.address, 'eth', -mintAmount.plus(toBN(await etherGasCost(tx)))],
          [cToken.address, minter.address, 'tokens', mintTokens]
        ]));
      });
    });
  });

  [redeemCTokens, redeemUnderlying].forEach((redeem) => {
    describe(redeem.name, () => {
      beforeEach(async () => {
        await preRedeem(cToken, redeemer, redeemTokens, redeemAmount, exchangeRate);
      });

      it("emits a redeem failure if interest accrual fails", async () => {
        await cToken.helperInterestRateModel.setFailBorrowRate(true);
        await expect(redeem(cToken, redeemer, redeemTokens, redeemAmount)).to.be.revertedWith("INTEREST_RATE_MODEL_ERROR");
      });

      it("returns error from redeemFresh without emitting any extra logs", async () => {
        const tx = await redeem(cToken, redeemer, redeemTokens.multipliedBy(5), redeemAmount.multipliedBy(5));
        const events = await getEvents(tx);

        expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.MATH_ERROR)))).equals(true)
        expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.REDEEM_NEW_TOTAL_SUPPLY_CALCULATION_FAILED)))).equals(true)
      });

      it("returns success from redeemFresh and redeems the correct amount", async () => {
        await fastForward(cToken);
        const beforeBalances = await getBalances([cToken], [redeemer]);
        const receipt = await redeem(cToken, redeemer, redeemTokens, redeemAmount);
        const events = await getEvents(receipt);
        expect(!events.includes('Failure')).equals(true)
        const afterBalances = await getBalances([cToken], [redeemer]);
        expect(toEBN(redeemTokens)).not.equals(0);
        expect(afterBalances).to.eql(await adjustBalances(beforeBalances, [
          [cToken.address, 'eth', -redeemAmount],
          [cToken.address, 'tokens', -redeemTokens],
          [cToken.address, redeemer.address, 'eth', redeemAmount.minus(toBN(await etherGasCost(receipt)))],
          [cToken.address, redeemer.address, 'tokens', -redeemTokens]
        ]));
      });
    });
  });
});
