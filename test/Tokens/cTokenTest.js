const { ethers } = require('hardhat');
const { expect } = require('chai');
const BigNumber = require('bignumber.js');

const {
  etherUnsigned,
  etherMantissa,
  UInt256Max,
  toEBN,
  getEvents
} = require('../Utils/Ethereum');

const {
  makeCToken,
  setBorrowRate,
  pretendBorrow
} = require('../Utils/Compound');

describe('CToken', function () {
  let root, admin, accounts;
  beforeEach(async () => {
    [root, admin, ...accounts] = await ethers.getSigners();
  });

  describe('constructor', () => {
    it("fails when non erc-20 underlying", async () => {
      await expect(makeCToken({ underlying: { address: root } })).to.be.reverted;
    });
    it("fails when 0 initial exchange rate", async () => {
      await expect(makeCToken({ exchangeRate: 0 })).to.be.revertedWith("initial exchange rate must be greater than zero.");
    });

    it("succeeds with erc-20 underlying and non-zero exchange rate", async () => {
      const cToken = await makeCToken();
      expect(await cToken.underlying()).equals(cToken.helperUnderlying.address);
      expect(await cToken.admin()).equals(root.address);
    });

    it("succeeds when setting admin to contructor argument", async () => {
      const cToken = await makeCToken({ admin: admin });
      expect(await cToken.admin()).equals(admin.address);
    });
  });

  describe('name, symbol, decimals', () => {
    let cToken;

    beforeEach(async () => {
      cToken = await makeCToken({ name: "CToken Foo", symbol: "cFOO", decimals: 10 });
    });

    it('should return correct name', async () => {
      expect(await cToken.name()).equals("CToken Foo");
    });

    it('should return correct symbol', async () => {
      expect(await cToken.symbol()).equals("cFOO");
    });

    it('should return correct decimals', async () => {
      expect(await cToken.decimals()).equals(10);
    });
  });

  describe('balanceOfUnderlying', () => {
    it("has an underlying balance", async () => {
      const cToken = await makeCToken({ supportMarket: true, exchangeRate: 2 });
      await cToken.harnessSetBalance(root.address, 100);
      expect(await cToken.callStatic.balanceOfUnderlying(root.address)).equals(200);
    });
  });

  describe('borrowRatePerBlock', () => {
    it("has a borrow rate", async () => {
      const cToken = await makeCToken({ supportMarket: true, interestRateModelOpts: { kind: 'jump-rate', baseRate: .05, multiplier: 0.45, kink: 0.95, jump: 5 } });
      const perBlock = await cToken.borrowRatePerBlock();
      const result = perBlock.mul(2102400).sub('50000000000000000').abs();
      expect(result.lte('100000000'));
    });
  });

  describe('supplyRatePerBlock', () => {
    it("returns 0 if there's no supply", async () => {
      const cToken = await makeCToken({ supportMarket: true, interestRateModelOpts: { kind: 'jump-rate', baseRate: .05, multiplier: 0.45, kink: 0.95, jump: 5 } });
      const perBlock = await cToken.supplyRatePerBlock();
      expect(perBlock).equals(0);
    });

    it("has a supply rate", async () => {
      const baseRate = 0.05;
      const multiplier = 0.45;
      const kink = 0.95;
      const jump = 5 * multiplier;
      const cToken = await makeCToken({ supportMarket: true, interestRateModelOpts: { kind: 'jump-rate', baseRate, multiplier, kink, jump } });
      await cToken.harnessSetReserveFactorFresh(toEBN(etherMantissa(.01)));
      await cToken.harnessExchangeRateDetails(1, 1, 0);
      await cToken.harnessSetExchangeRate(toEBN(etherMantissa(1)));
      // Full utilization (Over the kink so jump is included), 1% reserves
      const borrowRate = baseRate + multiplier * kink + jump * .05;
      const expectedSuplyRate = borrowRate * .99;

      const perBlock = await cToken.supplyRatePerBlock();
      expect(Math.abs(perBlock * 2102400 - expectedSuplyRate * 1e18)).lessThanOrEqual(1e8);
    });
  });

  describe("borrowBalanceCurrent", () => {
    let borrower;
    let cToken;

    beforeEach(async () => {
      borrower = accounts[0];
      cToken = await makeCToken();
    });

    beforeEach(async () => {
      await setBorrowRate(cToken, .001)
      await cToken.helperInterestRateModel.setFailBorrowRate(false);
    });

    it("reverts if interest accrual fails", async () => {
      await cToken.helperInterestRateModel.setFailBorrowRate(true);
      // make sure we accrue interest
      await cToken.harnessFastForward(1);
      await expect(cToken.borrowBalanceCurrent(borrower.address)).to.be.revertedWith("INTEREST_RATE_MODEL_ERROR");
    });

    it("returns successful result from borrowBalanceStored with no interest", async () => {
      await setBorrowRate(cToken, 0);
      await pretendBorrow(cToken, borrower, 1, 1, 5e18);
      expect(await cToken.callStatic.borrowBalanceCurrent(borrower.address)).equals(toEBN(5).mul(ethers.constants.WeiPerEther))
    });

    it("returns successful result from borrowBalanceCurrent with no interest", async () => {
      await setBorrowRate(cToken, 0);
      await pretendBorrow(cToken, borrower, 1, 3, 5e18);
      const tx = await cToken.harnessFastForward(5);
      const events = await getEvents(tx);
      expect(!events.includes('Failure')).equals(true)
      expect(await cToken.callStatic.borrowBalanceCurrent(borrower.address)).equals(toEBN(5).mul(ethers.constants.WeiPerEther).mul(3))
    });
  });

  describe("borrowBalanceStored", () => {
    let borrower;
    let cToken;

    beforeEach(async () => {
      borrower = accounts[0];
      cToken = await makeCToken({ comptrollerOpts: { kind: 'bool' } });
    });

    it("returns 0 for account with no borrows", async () => {
      expect(await cToken.borrowBalanceStored(borrower.address)).equals(0)
    });

    it("returns stored principal when account and market indexes are the same", async () => {
      await pretendBorrow(cToken, borrower, 1, 1, 5e18);
      expect(await cToken.borrowBalanceStored(borrower.address)).equals(toEBN(5).mul(ethers.constants.WeiPerEther));
    });

    it("returns calculated balance when market index is higher than account index", async () => {
      await pretendBorrow(cToken, borrower, 1, 3, 5e18);
      expect(await cToken.borrowBalanceStored(borrower.address)).equals(toEBN(5).mul(ethers.constants.WeiPerEther).mul(3));
    });

    it("reverts on overflow of principal", async () => {
      await pretendBorrow(cToken, borrower, 1, 3, UInt256Max());
      await expect(cToken.borrowBalanceStored(borrower.address)).to.be.revertedWith("borrowBalanceStored: borrowBalanceStoredInternal failed");
    });

    it("reverts on non-zero stored principal with zero account index", async () => {
      await pretendBorrow(cToken, borrower, 0, 3, 5);
      await expect(cToken.borrowBalanceStored(borrower.address)).to.be.revertedWith("borrowBalanceStored: borrowBalanceStoredInternal failed");
    });
  });

  describe('exchangeRateStored', () => {
    let cToken, exchangeRate = 2;

    beforeEach(async () => {
      cToken = await makeCToken({ exchangeRate });
    });

    it("returns initial exchange rate with zero cTokenSupply", async () => {
      const result = await cToken.exchangeRateStored();
      expect(result).equals(toEBN(etherMantissa(exchangeRate)));
    });

    it("calculates with single cTokenSupply and single total borrow", async () => {
      const cTokenSupply = 1, totalBorrows = 1, totalReserves = 0;
      await cToken.harnessExchangeRateDetails(toEBN(cTokenSupply), toEBN(totalBorrows), toEBN(totalReserves))
      const result = await cToken.exchangeRateStored();
      expect(result).equals(toEBN(etherMantissa(1)));
    });

    it("calculates with cTokenSupply and total borrows", async () => {
      const cTokenSupply = toEBN(100).mul(ethers.constants.WeiPerEther), totalBorrows = toEBN(10).mul(ethers.constants.WeiPerEther), totalReserves = 0;
      await cToken.harnessExchangeRateDetails(cTokenSupply, totalBorrows, toEBN(totalReserves));
      const result = await cToken.exchangeRateStored();
      expect(result).equals(toEBN(etherMantissa(.1)));
    });

    it("calculates with cash and cTokenSupply", async () => {
      const cTokenSupply = toEBN(5).mul(ethers.constants.WeiPerEther), totalBorrows = 0, totalReserves = 0;
      const tx = await cToken.helperUnderlying.transfer(cToken.address, toEBN(etherMantissa(500)));
      const events = await getEvents(tx);
      expect(!events.includes('Failure')).equals(true)
      await cToken.harnessExchangeRateDetails(cTokenSupply, totalBorrows, totalReserves);
      const result = await cToken.exchangeRateStored();
      expect(result).equals(toEBN(etherMantissa(100)));
    });

    it("calculates with cash, borrows, reserves and cTokenSupply", async () => {
      const cTokenSupply = toEBN(500).mul(ethers.constants.WeiPerEther), totalBorrows = toEBN(500).mul(ethers.constants.WeiPerEther), totalReserves = toEBN(5).mul(ethers.constants.WeiPerEther);
      const tx = await cToken.helperUnderlying.transfer(cToken.address, toEBN(etherMantissa(500)))
      const events = await getEvents(tx);
      expect(!events.includes('Failure')).equals(true)

      await cToken.harnessExchangeRateDetails(cTokenSupply, totalBorrows, totalReserves);

      const result = await cToken.exchangeRateStored();
      expect(result).equals(toEBN(etherMantissa(1.99)));
    });
  });

  describe('getCash', () => {
    it("gets the cash", async () => {
      const cToken = await makeCToken();
      const result = await cToken.getCash();
      expect(result).equals(0);
    });
  });
});
