const { ethers } = require('hardhat');
const { expect } = require('chai');
const BigNumber = require('bignumber.js');

const { TokenErr } = require('../Errors');
const {
  etherMantissa,
  etherUnsigned,
  UInt256Max,
  toEBN,
} = require('../Utils/Ethereum');
const {
  makeCToken,
  setBorrowRate
} = require('../Utils/Compound');

const blockNumber = 2e7;
const borrowIndex = 1e18;
const borrowRate = .000001;

async function pretendBlock(cToken, accrualBlock = blockNumber, deltaBlocks = 1) {
  await cToken.harnessSetAccrualBlockNumber(toEBN(etherUnsigned(blockNumber)));
  await cToken.harnessSetBlockNumber(toEBN(etherUnsigned(etherUnsigned(blockNumber + deltaBlocks))));
  await cToken.harnessSetBorrowIndex(toEBN(etherUnsigned(borrowIndex)));
}

async function preAccrue(cToken) {
  await setBorrowRate(cToken, borrowRate);
  await cToken.helperInterestRateModel.setFailBorrowRate(false);
  await cToken.harnessExchangeRateDetails(0, 0, 0);
}

describe('CToken', () => {
  let root, accounts;
  let cToken;
  beforeEach(async () => {
    [root, ...accounts] = await ethers.getSigners();
    cToken = await makeCToken({comptrollerOpts: {kind: 'bool'}});
  });

  beforeEach(async () => {
    await preAccrue(cToken);
  });

  describe('accrueInterest', () => {
    it('reverts if the interest rate is absurdly high', async () => {
      await pretendBlock(cToken, blockNumber, 1);
      expect(await cToken.getBorrowRateMaxMantissa()).equals(toEBN(etherMantissa(0.000005))); // 0.0005% per block
      await setBorrowRate(cToken, 0.001e-2); // 0.0010% per block
      await expect(cToken.accrueInterest()).to.be.revertedWith("borrow rate is absurdly high");
    });

    it('fails if new borrow rate calculation fails', async () => {
      await pretendBlock(cToken, blockNumber, 1);
      await cToken.helperInterestRateModel.setFailBorrowRate(true);
      await expect(cToken.accrueInterest()).to.be.revertedWith("INTEREST_RATE_MODEL_ERROR");
    });

    it('fails if simple interest factor calculation fails', async () => {
      await pretendBlock(cToken, blockNumber, 5e70);
      const tx = cToken.accrueInterest();
      await expect(tx).to.emit(cToken, 'Failure').withArgs(TokenErr.Error.MATH_ERROR, TokenErr.FailureInfo.ACCRUE_INTEREST_SIMPLE_INTEREST_FACTOR_CALCULATION_FAILED, 2);
    });

    it('fails if new borrow index calculation fails', async () => {
      await pretendBlock(cToken, blockNumber, 5e60);
      await expect(await cToken.accrueInterest()).to.emit(cToken, 'Failure').withArgs(TokenErr.Error.MATH_ERROR, TokenErr.FailureInfo.ACCRUE_INTEREST_NEW_BORROW_INDEX_CALCULATION_FAILED, 2);
    });

    it('fails if new borrow interest index calculation fails', async () => {
      await pretendBlock(cToken)
      await cToken.harnessSetBorrowIndex(UInt256Max());
      await expect(await cToken.accrueInterest()).to.emit(cToken, 'Failure').withArgs(TokenErr.Error.MATH_ERROR, TokenErr.FailureInfo.ACCRUE_INTEREST_NEW_BORROW_INDEX_CALCULATION_FAILED, 2);
    });

    it('fails if interest accumulated calculation fails', async () => {
      await cToken.harnessExchangeRateDetails(0, UInt256Max(), 0);
      await pretendBlock(cToken);
      await expect(await cToken.accrueInterest()).to.emit(cToken, 'Failure').withArgs(TokenErr.Error.MATH_ERROR, TokenErr.FailureInfo.ACCRUE_INTEREST_ACCUMULATED_INTEREST_CALCULATION_FAILED, 2);
    });

    it('fails if new total borrows calculation fails', async () => {
      await setBorrowRate(cToken, 1e-18);
      await pretendBlock(cToken)
      await cToken.harnessExchangeRateDetails(0, UInt256Max(), 0);
      await expect(await cToken.accrueInterest()).to.emit(cToken, 'Failure').withArgs(TokenErr.Error.MATH_ERROR, TokenErr.FailureInfo.ACCRUE_INTEREST_NEW_TOTAL_BORROWS_CALCULATION_FAILED, 2);
    });

    it('fails if interest accumulated for reserves calculation fails', async () => {
      await setBorrowRate(cToken, .000001);
      await cToken.harnessExchangeRateDetails(0, toEBN(etherUnsigned(1e30)), toEBN(UInt256Max()));
      await cToken.harnessSetReserveFactorFresh(toEBN(etherUnsigned(1e10)))
      await pretendBlock(cToken, blockNumber, 5e20)
      await expect(await cToken.accrueInterest()).to.emit(cToken, 'Failure').withArgs(TokenErr.Error.MATH_ERROR, TokenErr.FailureInfo.ACCRUE_INTEREST_NEW_TOTAL_RESERVES_CALCULATION_FAILED, 2);
    });

    it('fails if new total reserves calculation fails', async () => {
      await setBorrowRate(cToken, 1e-18);
      await cToken.harnessExchangeRateDetails(0, toEBN(etherUnsigned(1e56)), UInt256Max());
      await cToken.harnessSetReserveFactorFresh(toEBN(etherUnsigned(1e17)));
      await pretendBlock(cToken)
      await expect(await cToken.accrueInterest()).to.emit(cToken, 'Failure').withArgs(TokenErr.Error.MATH_ERROR, TokenErr.FailureInfo.ACCRUE_INTEREST_NEW_TOTAL_RESERVES_CALCULATION_FAILED, 2);
    });

    it('succeeds and saves updated values in storage on success', async () => {
      const startingTotalBorrows = 1e22;
      const startingTotalReserves = 1e20;
      const reserveFactor = 1e17;

      await cToken.harnessExchangeRateDetails(0, toEBN(etherUnsigned(startingTotalBorrows)), toEBN(etherUnsigned(startingTotalReserves)));
      await cToken.harnessSetReserveFactorFresh(toEBN(etherUnsigned(reserveFactor)));
      await pretendBlock(cToken)

      const expectedAccrualBlockNumber = blockNumber + 1;
      const expectedBorrowIndex = borrowIndex + borrowIndex * borrowRate;
      const expectedTotalBorrows = startingTotalBorrows + startingTotalBorrows * borrowRate;
      const expectedTotalReserves = startingTotalReserves + startingTotalBorrows *  borrowRate * reserveFactor / 1e18;


      expect(await cToken.callStatic.accrueInterest()).equals(TokenErr.Error.NO_ERROR);
      expect(cToken.accrueInterest()).to.emit(cToken, 'AccrueInterest').withArgs(
        0,
        toEBN(etherUnsigned(expectedTotalBorrows).minus(etherUnsigned(startingTotalBorrows)).toFixed()),
        toEBN(etherUnsigned(expectedBorrowIndex).toFixed()),
        toEBN(etherUnsigned(expectedTotalBorrows).toFixed()));

      expect(await cToken.callStatic.accrualBlockNumber()).equals(expectedAccrualBlockNumber);
      expect(await cToken.callStatic.borrowIndex()).equals(toEBN(expectedBorrowIndex));
      expect((await cToken.callStatic.totalBorrows()).toString()).equals(new BigNumber(expectedTotalBorrows).toString());
      expect(await cToken.callStatic.totalReserves()).equals(toEBN(expectedTotalReserves));
    });
  });
});
