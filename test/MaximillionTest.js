const { ethers } = require('hardhat');
const { expect } = require('chai');

const {
  etherBalance,
  etherGasCost,
  getContract,
  toEBN
} = require('../test/Utils/Ethereum');

const {
  makeComptroller,
  makeCToken,
  makePriceOracle,
  pretendBorrow,
  borrowSnapshot
} = require('../test/Utils/Compound');

describe('Maximillion', () => {
  let root, borrower;
  let maximillion, cEther;
  beforeEach(async () => {
    [root, borrower] = await ethers.getSigners();
    cEther = await makeCToken({ kind: "cether", supportMarket: true });
    const Maximillion = await ethers.getContractFactory('Maximillion');
    maximillion = await Maximillion.deploy(cEther.address);
    await maximillion.deployed();
  });

  describe("constructor", () => {
    it("sets address of cEther", async () => {
      expect(await maximillion.cEther()).equals(cEther.address);
    });
  });

  describe("repayBehalf", () => {
    it("refunds the entire amount with no borrows", async () => {
      const beforeBalance = await etherBalance(root.address);
      const result = maximillion.connect(root).repayBehalf(borrower.address, { value: 100 });
      await expect(result).to.not.be.reverted;
      const afterBalance = await etherBalance(root.address);
      const gasCost = await etherGasCost(result);
      expect(afterBalance).equals(beforeBalance.sub(gasCost));
    });
    it("repays part of a borrow", async () => {
      await pretendBorrow(cEther, borrower, 1, 1, 150);
      const beforeBalance = await etherBalance(root.address);
      const result = maximillion.repayBehalf(borrower.address, { value: 100 });

      const gasCost = await etherGasCost(result);
      const afterBalance = await etherBalance(root.address);
      const afterBorrowSnap = await borrowSnapshot(cEther, borrower);

      await expect(result).to.not.be.reverted;
      expect(afterBalance).equals((beforeBalance.sub(gasCost).sub(100)));
      expect(toEBN(afterBorrowSnap.principal)).equals(50);
    });

    it("repays a full borrow and refunds the rest", async () => {
      await pretendBorrow(cEther, borrower, 1, 1, 90);
      const beforeBalance = await etherBalance(root.address);
      const result = maximillion.repayBehalf(borrower.address, { value: 100 });

      const gasCost = await etherGasCost(result);
      const afterBalance = await etherBalance(root.address);
      const afterBorrowSnap = await borrowSnapshot(cEther, borrower);
      await expect(result).to.not.be.reverted;
      expect(afterBalance).equals(beforeBalance.sub(gasCost).sub(90));
      expect(toEBN(afterBorrowSnap.principal)).equals(0);
    });
  });
});
