const { expect } = require('chai');
const { ethers } = require('hardhat');

const {
  etherMantissa,
  minerStart,
  minerStop,
  UInt256Max,
  toEBN
} = require('./Utils/Ethereum');

const {
  makeCToken,
  balanceOf,
  borrowSnapshot,
  enterMarkets
} = require('./Utils/Compound');

describe('Spinarama', () => {
  let root, from, accounts;

  beforeEach(async () => {
    [root, from, ...accounts] = await ethers.getSigners();
  });

  describe('#mintMint', () => {
    it('should succeed', async () => {
      const cToken = await makeCToken({supportMarket: true});
      await cToken.helperUnderlying.connect(from).harnessSetBalance(from.address, 100);
      await cToken.helperUnderlying.connect(from).approve(cToken.address, UInt256Max());


      await ethers.provider.send("evm_setAutomine", [false]);
      const p1 = cToken.connect(from).mint(1);
      const p2 = cToken.connect(from).mint(2);

      await ethers.provider.send("evm_setAutomine", [true]);
      await expect(p1).to.not.be.reverted;
      await expect(p2).to.not.be.reverted;
      expect((await balanceOf(cToken, from)).toString()).equals('3');
    });
    it('should partial succeed', async () => {
      const cToken = await makeCToken({supportMarket: true});
      await cToken.helperUnderlying.connect(from).harnessSetBalance(from.address, 100);
      await cToken.helperUnderlying.connect(from).approve(cToken.address, 10);
      await ethers.provider.send("evm_setAutomine", [false]);
      const p1 = cToken.connect(from).mint(10);
      const p2 = cToken.connect(from).mint(11);
      await ethers.provider.send("evm_setAutomine", [true]);
      await p1;
      await expect(p2).to.be.revertedWith("Insufficient allowance");
      expect(toEBN(await balanceOf(cToken, from))).equals(10);
    });
  });

  describe('#mintRedeem', () => {
    it('should succeed', async () => {
      const cToken = await makeCToken({supportMarket: true});
      await cToken.helperUnderlying.connect(from).harnessSetBalance(from.address, 100);
      await cToken.helperUnderlying.connect(from).approve(cToken.address, 10);
      await ethers.provider.send("evm_setAutomine", [false]);
      const p1 = cToken.connect(from).mint(10);
      const p2 = cToken.connect(from).redeemUnderlying(10);
      await ethers.provider.send("evm_setAutomine", [true]);
      await expect(p1).to.not.be.reverted;
      await expect(p2).to.not.be.reverted;
      expect(toEBN(await balanceOf(cToken, from))).equals(0);
    });
  });

  describe('#redeemMint', () => {
    it('should succeed', async () => {
      const cToken = await makeCToken({supportMarket: true});
      await cToken.harnessSetTotalSupply(10);
      await cToken.harnessSetExchangeRate(toEBN(etherMantissa(1)))
      await cToken.harnessSetBalance(from.address, 10);
      await cToken.helperUnderlying.harnessSetBalance(cToken.address, 10);
      await cToken.helperUnderlying.connect(from).approve(cToken.address, 10);

      await ethers.provider.send("evm_setAutomine", [false]);
      const p1 = cToken.connect(from).redeem(10);
      const p2 = cToken.connect(from).mint(10);
      await ethers.provider.send("evm_setAutomine", [true]);

      await expect(p1).to.not.be.reverted;
      await expect(p2).to.not.be.reverted;
      expect(toEBN(await balanceOf(cToken, from))).equals(10);
    });
  });

  describe('#repayRepay', () => {
    it('should succeed', async () => {
      const cToken1 = await makeCToken({supportMarket: true, underlyingPrice: 1, collateralFactor: .5});
      const cToken2 = await makeCToken({supportMarket: true, underlyingPrice: 1, comptroller: cToken1.helperComptroller});

      await cToken1.helperUnderlying.harnessSetBalance(from.address, 10);
      await cToken1.helperUnderlying.connect(from).approve(cToken1.address, 10);
      await cToken2.helperUnderlying.harnessSetBalance(cToken2.address, 10);
      await cToken2.harnessSetTotalSupply(100);
      await cToken2.helperUnderlying.connect(from).approve(cToken2.address, 10);
      await cToken2.harnessSetExchangeRate(toEBN(etherMantissa(1)));

      await expect(enterMarkets([cToken1, cToken2], from)).to.not.be.reverted;
      await expect(cToken1.connect(from).mint(10)).to.not.be.reverted;
      await expect(cToken2.connect(from).borrow(2)).to.not.be.reverted;

      await ethers.provider.send("evm_setAutomine", [false]);
      const p1 = cToken2.connect(from).repayBorrow(1);
      const p2 = cToken2.connect(from).repayBorrow(1);
      await ethers.provider.send("evm_setAutomine", [true]);

      await expect(p1).to.not.be.reverted;
      await expect(p2).to.not.be.reverted;
      expect(toEBN((await borrowSnapshot(cToken2, from)).principal)).equals(0);
    });
  });
});
