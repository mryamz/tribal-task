const {
  makeComptroller,
  makeCToken,
  balanceOf,
  fastForward,
  pretendBorrow,
  quickMint
} = require('../Utils/Compound');
const {
  etherExp,
  etherDouble,
  etherUnsigned,
  etherMantissa,
  toEBN,
  address
} = require('../Utils/Ethereum');

const { ComptrollerErr } = require('../Errors');
const { expect } = require('chai');
const { ethers } = require('hardhat');

const compRate = etherUnsigned(1e18);

async function compAccrued(comptroller, user) {
  return await comptroller.compAccrued(user.address);
}

async function compBalance(comptroller, user) {
  return await comptroller.comp.balanceOf(user.address);
}

async function totalCompAccrued(comptroller, user) {
  return (await compAccrued(comptroller, user)).add(await compBalance(comptroller, user));
}

describe('Flywheel upgrade', () => {
  describe('becomes the comptroller', () => {
    it('adds the comp markets', async () => {
      let root = (await ethers.getSigners())[0];
      let unitroller = await makeComptroller({ kind: 'unitroller-g2' });
      let compMarkets = await Promise.all([1, 2, 3].map(async _ => {
        return makeCToken({ comptroller: unitroller, supportMarket: true });
      }));
      compMarkets = compMarkets.map(c => c.address);
      unitroller = await makeComptroller({ kind: 'unitroller-g3', unitroller, compMarkets });
      const reply = await unitroller.getCompMarkets();
      expect(reply).to.eql(compMarkets);
    });


    it('adds the other markets', async () => {
      let root = (await ethers.getSigners())[0];
      let unitroller = await makeComptroller({ kind: 'unitroller-g2' });
      let allMarkets = await Promise.all([1, 2, 3].map(async _ => {
        return makeCToken({ comptroller: unitroller, supportMarket: true });
      }));
      allMarkets = allMarkets.map(c => c.address);
      unitroller = await makeComptroller({
        kind: 'unitroller-g3',
        unitroller,
        compMarkets: allMarkets.slice(0, 1),
        otherMarkets: allMarkets.slice(1)
      });
      expect(await unitroller.getAllMarkets()).to.eql(allMarkets);
      expect(await unitroller.getCompMarkets()).to.eql(allMarkets.slice(0, 1));
    });

    it('_supportMarket() adds to all markets, and only once', async () => {
      let root = (await ethers.getSigners())[0];
      let unitroller = await makeComptroller({ kind: 'unitroller-g3' });
      let allMarkets = [];
      for (let _ of Array(10)) {
        allMarkets.push(await makeCToken({ comptroller: unitroller, supportMarket: true }));
      }
      expect(await unitroller.getAllMarkets()).to.eql(allMarkets.map(c => c.address));
      await expect(
        makeComptroller({
          kind: 'unitroller-g3',
          unitroller,
          otherMarkets: [allMarkets[0].address]
        })
      ).to.be.revertedWith('market already added');
    });
  });
});

describe('Flywheel', () => {
  let root, a1, a2, a3, accounts;
  let comptroller, cLOW, cREP, cZRX, cEVIL;
  beforeEach(async () => {
    let interestRateModelOpts = { borrowRate: 0.000001 };
    [root, a1, a2, a3, ...accounts] = await ethers.getSigners();
    comptroller = await makeComptroller();
    cLOW = await makeCToken({ comptroller, supportMarket: true, underlyingPrice: 1, interestRateModelOpts });
    cREP = await makeCToken({ comptroller, supportMarket: true, underlyingPrice: 2, interestRateModelOpts });
    cZRX = await makeCToken({ comptroller, supportMarket: true, underlyingPrice: 3, interestRateModelOpts });
    cEVIL = await makeCToken({ comptroller, supportMarket: false, underlyingPrice: 3, interestRateModelOpts });
  });

  describe('_grantComp()', () => {
    beforeEach(async () => {
      await comptroller.comp.connect(root).transfer(comptroller.address, ethers.BigNumber.from(etherUnsigned(50e18).toString()));
    });

    it('should award comp if called by admin', async () => {
      const tx = comptroller._grantComp(a1.address, 100);
      await expect(tx).to.emit(comptroller, 'CompGranted').withArgs(a1.address, 100);
    });



    it('should revert if not called by admin', async () => {
      const tx = comptroller.connect(a1)._grantComp(a1.address, 100);
      await expect(tx).to.be.revertedWith('only admin can grant comp');
    });

    it('should revert if insufficient comp', async () => {
      await expect(comptroller._grantComp(a1.address, ethers.BigNumber.from(etherUnsigned(1e20).toString()))).to.be.revertedWith('insufficient comp for grant');
    });


  });

  describe('getCompMarkets()', () => {
    it('should return the comp markets', async () => {
      for (let mkt of [cLOW, cREP, cZRX]) {
        await comptroller._setCompSpeed(mkt.address, ethers.BigNumber.from(etherExp(0.5).toString()));
      }

      const tx = await comptroller.getCompMarkets();
      expect(tx).to.eql([cLOW, cREP, cZRX].map((c) => c.address));
    });
  });

  describe('_setCompSpeed()', () => {
    it('should update market index when calling setCompSpeed', async () => {
      const mkt = cREP;

      await comptroller.setBlockNumber(0);
      await mkt.harnessSetTotalSupply(ethers.BigNumber.from(etherUnsigned(10e18).toString()));

      await comptroller._setCompSpeed(mkt.address, ethers.BigNumber.from(etherExp(0.5).toString()));
      await fastForward(comptroller, 20);
      await comptroller._setCompSpeed(mkt.address, ethers.BigNumber.from(etherExp(1).toString()));

      const { index, block } = await comptroller.compSupplyState(mkt.address);
      expect(index.toString()).equals('2000000000000000000000000000000000000');
      expect(block.toString()).equals('20');
    });

    it('should correctly drop a comp market if called by admin', async () => {
      for (let mkt of [cLOW, cREP, cZRX]) {
        await comptroller._setCompSpeed(mkt.address, ethers.BigNumber.from(etherExp(0.5).toString()));
      }

      const tx = comptroller._setCompSpeed(cLOW.address, 0);


      expect(await comptroller.getCompMarkets()).to.eql([cREP, cZRX].map((c) => c.address));

      await expect(tx).to.emit(comptroller, 'CompSpeedUpdated').withArgs(cLOW.address, 0);

    });

    it('should correctly drop a comp market from middle of array', async () => {
      for (let mkt of [cLOW, cREP, cZRX]) {
        await comptroller._setCompSpeed(mkt.address, ethers.BigNumber.from(etherExp(0.5).toString()));
      }
      await comptroller._setCompSpeed(cREP.address, 0);

      expect(await comptroller.getCompMarkets()).to.eql([cLOW, cZRX].map((c) => c.address));

    });

    it('should not drop a comp market unless called by admin', async () => {
      for (let mkt of [cLOW, cREP, cZRX]) {
        await comptroller._setCompSpeed(mkt.address, ethers.BigNumber.from(etherExp(0.5).toString()));
      }

      const tx = comptroller.connect(a1)._setCompSpeed(cLOW.address, 0);
      await expect(tx).to.be.revertedWith('only admin can set comp speed');
    });

    it('should not add non-listed markets', async () => {
      const cBAT = await makeCToken({ comptroller, supportMarket: false });
      const tx = comptroller.harnessAddCompMarkets([cBAT.address]);
      await expect(tx).to.be.revertedWith('comp market is not listed');

      expect(await comptroller.getCompMarkets()).to.eql([]);
    });
  });

  describe('updateCompBorrowIndex()', () => {
    it('should calculate comp borrower index correctly', async () => {
      const mkt = cREP;
      await comptroller._setCompSpeed(mkt.address, ethers.BigNumber.from(etherExp(0.5).toString()));
      await comptroller.setBlockNumber(100);
      await mkt.harnessSetTotalBorrows(ethers.BigNumber.from(etherUnsigned(11e18).toString()));
      await comptroller.harnessUpdateCompBorrowIndex(mkt.address, ethers.BigNumber.from(etherExp(1.1).toString()));
      /*
      100 blocks, 10e18 origin total borrows, 0.5e18 borrowSpeed
      
      borrowAmt   = totalBorrows * 1e18 / borrowIdx
      = 11e18 * 1e18 / 1.1e18 = 10e18
      compAccrued = deltaBlocks * borrowSpeed
      = 100 * 0.5e18 = 50e18
      newIndex   += 1e36 + compAccrued * 1e36 / borrowAmt
      = 1e36 + 50e18 * 1e36 / 10e18 = 6e36
      
      */

      const { index, block } = await comptroller.compBorrowState(mkt.address);
      expect(index.toString()).equals('6000000000000000000000000000000000000'); //6e36 as a string
      expect(block).equals(100);
    });

    it('should not revert or update compBorrowState index if cToken not in COMP markets', async () => {
      const mkt = await makeCToken({
        comptroller: comptroller,
        supportMarket: true,
        addCompMarket: false,
      });
      await comptroller.setBlockNumber(100);
      await comptroller.harnessUpdateCompBorrowIndex(mkt.address, ethers.BigNumber.from(etherExp(1.1).toString()));

      const { index, block } = await comptroller.compBorrowState(mkt.address);
      expect(index).equals(0);
      expect(block).equals(100);
      const speed = await comptroller.compSpeeds(mkt.address);
      expect(speed).equals(0);
    });

    it('should not update index if no blocks passed since last accrual', async () => {
      const mkt = cREP;
      await comptroller._setCompSpeed(mkt.address, ethers.BigNumber.from(etherExp(0.5).toString()));
      await comptroller.harnessUpdateCompBorrowIndex(mkt.address, ethers.BigNumber.from(etherExp(1.1).toString()));

      const { index, block } = await comptroller.compBorrowState(mkt.address);
      expect(index.toString()).equals('1000000000000000000000000000000000000'); //1e36 as a string
      expect(block).equals(0);
    });

    it('should not update index if comp speed is 0', async () => {
      const mkt = cREP;
      await comptroller._setCompSpeed(mkt.address, ethers.BigNumber.from(etherExp(0.5).toString()));
      await comptroller.setBlockNumber(100);
      await comptroller._setCompSpeed(mkt.address, ethers.BigNumber.from(etherExp(0).toString()))
      await comptroller.harnessUpdateCompBorrowIndex(mkt.address, ethers.BigNumber.from(etherExp(1.1).toString()));

      const { index, block } = await comptroller.compBorrowState(mkt.address);
      expect(index.toString()).equals('1000000000000000000000000000000000000');
      expect(block).equals(100);
    });


  });

  describe('updateCompSupplyIndex()', () => {
    it('should calculate comp supplier index correctly', async () => {
      const mkt = cREP;

      await comptroller._setCompSpeed(mkt.address, ethers.BigNumber.from(etherExp(0.5).toString()));
      await comptroller.setBlockNumber(100);
      await mkt.harnessSetTotalSupply(ethers.BigNumber.from(etherUnsigned(10e18).toString()));
      await comptroller.harnessUpdateCompSupplyIndex(mkt.address);
      /*
      suppyTokens = 10e18
      compAccrued = deltaBlocks * supplySpeed
      = 100 * 0.5e18 = 50e18
      newIndex   += compAccrued * 1e36 / supplyTokens
      = 1e36 + 50e18 * 1e36 / 10e18 = 6e36
      */
      const { index, block } = await comptroller.compSupplyState(mkt.address);
      expect(index.toString()).equals('6000000000000000000000000000000000000');
      expect(block).equals(100);
    });

    it('should not update index on non-COMP markets', async () => {
      const mkt = await makeCToken({
        comptroller: comptroller,
        supportMarket: true,
        addCompMarket: false
      });
      await comptroller.setBlockNumber(100);
      await comptroller.harnessUpdateCompSupplyIndex(mkt.address);

      const { index, block } = await comptroller.compSupplyState(mkt.address);
      expect(index).equals(0);
      expect(block).equals(100);
      const speed = await comptroller.compSpeeds(mkt.address);
      expect(speed).equals(0);
      // ctoken could have no comp speed or comp supplier state if not in comp markets
      // this logic could also possibly be implemented in the allowed hook
    });

    it('should not update index if no blocks passed since last accrual', async () => {
      const mkt = cREP;
      await comptroller.setBlockNumber(0);
      await mkt.harnessSetTotalSupply(etherUnsigned(10e18).toString());
      await comptroller._setCompSpeed(mkt.address, etherExp(0.5).toString());
      await comptroller.harnessUpdateCompSupplyIndex(mkt.address);

      const { index, block } = await comptroller.compSupplyState(mkt.address);
      expect(index.toString()).equals('1000000000000000000000000000000000000'); // 1e36 as a string
      expect(block).equals(0);
    });

    it('should not matter if the index is updated multiple times', async () => {
      const compRemaining = ethers.BigNumber.from(compRate.multipliedBy(100).toString());
      await comptroller.harnessAddCompMarkets([cLOW.address]);
      await comptroller.comp.connect(root).transfer(comptroller.address, compRemaining);

      await pretendBorrow(cLOW, a1, 1, 1, 100);
      await comptroller.harnessRefreshCompSpeeds();

      await quickMint(cLOW, a2, ethers.BigNumber.from(etherUnsigned(10e18).toString()));
      await quickMint(cLOW, a3, ethers.BigNumber.from(etherUnsigned(15e18).toString()));

      const a2Accrued0 = await totalCompAccrued(comptroller, a2);
      const a3Accrued0 = await totalCompAccrued(comptroller, a3);
      const a2Balance0 = ethers.BigNumber.from((await balanceOf(cLOW, a2)).toString());
      const a3Balance0 = ethers.BigNumber.from((await balanceOf(cLOW, a3)).toString());

      await fastForward(comptroller, 20);

      const txT1 = await cLOW.connect(a3).transfer(a2.address, a3Balance0.sub(a2Balance0));

      const a2Accrued1 = await totalCompAccrued(comptroller, a2);
      const a3Accrued1 = await totalCompAccrued(comptroller, a3);
      const a2Balance1 = ethers.BigNumber.from((await balanceOf(cLOW, a2)).toString());
      const a3Balance1 = ethers.BigNumber.from((await balanceOf(cLOW, a3)).toString());

      await fastForward(comptroller, 10);
      await comptroller.harnessUpdateCompSupplyIndex(cLOW.address);
      await fastForward(comptroller, 10);

      const txT2 = await cLOW.connect(a2).transfer(a3.address, a2Balance1.sub(a3Balance1))

      const a2Accrued2 = await totalCompAccrued(comptroller, a2);
      const a3Accrued2 = await totalCompAccrued(comptroller, a3);

      expect(a2Accrued0).equals(0);
      expect(a3Accrued0).equals(0);
      expect(a2Accrued1).not.equals(0);
      expect(a3Accrued1).not.equals(0);
      expect(a2Accrued1).equals(a3Accrued2.sub(a3Accrued1));
      expect(a3Accrued1).equals(a2Accrued2.sub(a2Accrued1));

      const txT1Receipt = await txT1.wait();
      const txT2Receipt = await txT2.wait();

      expect(txT1Receipt.gasUsed.toNumber()).lessThan(200000);
      expect(txT1Receipt.gasUsed.toNumber()).greaterThan(140000);
      expect(txT2Receipt.gasUsed.toNumber()).lessThan(150000);
      expect(txT2Receipt.gasUsed.toNumber()).greaterThan(100000);
    });
  });

  describe('distributeBorrowerComp()', () => {

    it('should update borrow index checkpoint but not compAccrued for first time user', async () => {
      const mkt = cREP;
      await comptroller.setCompBorrowState(mkt.address, ethers.BigNumber.from(etherDouble(6).toString()), 10)
      await comptroller.setCompBorrowerIndex(mkt.address, root.address, ethers.BigNumber.from('0'));

      await comptroller.harnessDistributeBorrowerComp(mkt.address, root.address, ethers.BigNumber.from(etherExp(1.1).toString()));
      expect(await comptroller.compAccrued(root.address)).equals(0);
      expect(await comptroller.compBorrowerIndex(mkt.address, root.address)).equals(ethers.BigNumber.from('6000000000000000000000000000000000000'));
    });

    it('should transfer comp and update borrow index checkpoint correctly for repeat time user', async () => {
      const mkt = cREP;
      await comptroller.comp.connect(root).transfer(comptroller.address, ethers.BigNumber.from('50000000000000000000'))
      await mkt.harnessSetAccountBorrows(a1.address, ethers.BigNumber.from(etherUnsigned(5.5e18).toString()), ethers.BigNumber.from(etherExp(1).toString()))
      await comptroller.setCompBorrowState(mkt.address, ethers.BigNumber.from(etherDouble(6).toString()), 10)
      await comptroller.setCompBorrowerIndex(mkt.address, a1.address, ethers.BigNumber.from(etherDouble(1).toString()));

      /*
      * 100 delta blocks, 10e18 origin total borrows, 0.5e18 borrowSpeed => 6e18 compBorrowIndex
      * this tests that an acct with half the total borrows over that time gets 25e18 COMP
      borrowerAmount = borrowBalance * 1e18 / borrow idx
             = 5.5e18 * 1e18 / 1.1e18 = 5e18
      deltaIndex     = marketStoredIndex - userStoredIndex
             = 6e36 - 1e36 = 5e36
      borrowerAccrued= borrowerAmount * deltaIndex / 1e36
             = 5e18 * 5e36 / 1e36 = 25e18
             */


      const tx = comptroller.harnessDistributeBorrowerComp(mkt.address, a1.address, ethers.BigNumber.from(etherUnsigned(1.1e18).toString()));

      expect((await compAccrued(comptroller, a1)).toString()).equals(ethers.BigNumber.from('25000000000000000000'));
      expect(await compBalance(comptroller, a1)).equals(0);
      await expect(tx).to.emit(comptroller, 'DistributedBorrowerComp')
        .withArgs(mkt.address, a1.address, ethers.BigNumber.from(etherUnsigned(25e18).toFixed().toString()), ethers.BigNumber.from(etherDouble(6).toFixed().toString()));

    });

    it('should not transfer comp automatically', async () => {
      const mkt = cREP;
      await comptroller.comp.connect(root).transfer(comptroller.address, ethers.BigNumber.from(etherUnsigned(50e18).toString()));
      await mkt.harnessSetAccountBorrows(a1.address, ethers.BigNumber.from(etherUnsigned(5.5e17).toString()), ethers.BigNumber.from(etherExp(1).toString()));
      await comptroller.setCompBorrowState(mkt.address, toEBN(etherDouble(1.0019)), 10)
      await comptroller.setCompBorrowerIndex(mkt.address, a1.address, toEBN(etherDouble(1)));
      /*
      borrowerAmount = borrowBalance * 1e18 / borrow idx
      = 5.5e17 * 1e18 / 1.1e18 = 5e17
      deltaIndex     = marketStoredIndex - userStoredIndex
      = 1.0019e36 - 1e36 = 0.0019e36
      borrowerAccrued= borrowerAmount * deltaIndex / 1e36
      = 5e17 * 0.0019e36 / 1e36 = 0.00095e18
      0.00095e18 < compClaimThreshold of 0.001e18
      */
      await comptroller.harnessDistributeBorrowerComp(mkt.address, a1.address, toEBN(etherExp(1.1)));
      expect(await compAccrued(comptroller, a1)).equals(0.00095e18);
      expect(await compBalance(comptroller, a1)).equals(0);
    });

    it('should not revert or distribute when called with non-COMP market', async () => {
      const mkt = await makeCToken({
        comptroller: comptroller,
        supportMarket: true,
        addCompMarket: false,
      });

      await comptroller.harnessDistributeBorrowerComp(mkt.address, a1.address, toEBN(etherExp(1.1)));
      expect(await compAccrued(comptroller, a1)).equals(0);
      expect(await compBalance(comptroller, a1)).equals(0);
      expect(await comptroller.compBorrowerIndex(mkt.address, a1.address)).equals(0);
    });
  });

  describe('distributeSupplierComp()', () => {
    it('should transfer comp and update supply index correctly for first time user', async () => {
      const mkt = cREP;
      await comptroller.comp.connect(root).transfer(comptroller.address, toEBN(etherUnsigned(50e18)));

      await mkt.harnessSetBalance(a1.address, toEBN(etherUnsigned(5e18)));
      await comptroller.setCompSupplyState(mkt.address, toEBN(etherDouble(6)), 10);
      /*
      * 100 delta blocks, 10e18 total supply, 0.5e18 supplySpeed => 6e18 compSupplyIndex
      * confirming an acct with half the total supply over that time gets 25e18 COMP:
      supplierAmount  = 5e18
      deltaIndex      = marketStoredIndex - userStoredIndex
      = 6e36 - 1e36 = 5e36
      suppliedAccrued+= supplierTokens * deltaIndex / 1e36
      = 5e18 * 5e36 / 1e36 = 25e18
      */

      const tx = comptroller.harnessDistributeAllSupplierComp(mkt.address, a1.address);

      expect(await compAccrued(comptroller, a1)).equals(0);
      expect(await compBalance(comptroller, a1)).equals(toEBN(etherUnsigned(25e18)));
      await expect(tx).to.emit(comptroller, 'DistributedSupplierComp').withArgs(mkt.address, a1.address, toEBN(etherUnsigned(25e18).toFixed()), toEBN(etherDouble(6).toFixed()));
    });

    it('should update comp accrued and supply index for repeat user', async () => {
      const mkt = cREP;
      await comptroller.comp.connect(root).transfer(comptroller.address, toEBN(etherUnsigned(50e18)));

      await mkt.harnessSetBalance(a1.address, toEBN(etherUnsigned(5e18)));
      await comptroller.setCompSupplyState(mkt.address, toEBN(etherDouble(6)), 10);
      await comptroller.setCompSupplierIndex(mkt.address, a1.address, toEBN(etherDouble(2)));
      /*
      supplierAmount  = 5e18
      deltaIndex      = marketStoredIndex - userStoredIndex
      = 6e36 - 2e36 = 4e36
      suppliedAccrued+= supplierTokens * deltaIndex / 1e36
      = 5e18 * 4e36 / 1e36 = 20e18\*/

      await comptroller.harnessDistributeAllSupplierComp(mkt.address, a1.address);
      expect(await compAccrued(comptroller, a1)).equals(0);
      expect(await compBalance(comptroller, a1)).equals(toEBN(etherUnsigned(20e18)));
    });

    it('should not transfer when compAccrued below threshold', async () => {
      const mkt = cREP;
      await comptroller.comp.connect(root).transfer(comptroller.address, toEBN(etherUnsigned(50e18)));

      await mkt.harnessSetBalance(a1.address, toEBN(etherUnsigned(5e17)));
      await comptroller.setCompSupplyState(mkt.address, toEBN(etherDouble(1.0019)), 10);
      /*
      supplierAmount  = 5e17
      deltaIndex      = marketStoredIndex - userStoredIndex
      = 1.0019e36 - 1e36 = 0.0019e36
      suppliedAccrued+= supplierTokens * deltaIndex / 1e36
      = 5e17 * 0.0019e36 / 1e36 = 0.00095e18
      */

      await comptroller.harnessDistributeSupplierComp(mkt.address, a1.address);
      expect(await compAccrued(comptroller, a1)).equals(0.00095e18);
      expect(await compBalance(comptroller, a1)).equals(0);
    });

    it('should not revert or distribute when called with non-COMP market', async () => {
      const mkt = await makeCToken({
        comptroller: comptroller,
        supportMarket: true,
        addCompMarket: false,
      });

      await comptroller.harnessDistributeSupplierComp(mkt.address, a1.address);
      expect(await compAccrued(comptroller, a1)).equals(0);
      expect(await compBalance(comptroller, a1)).equals(0);
      expect(await comptroller.compBorrowerIndex(mkt.address, a1.address)).equals(0);

    });

  });

  describe('transferComp', () => {
    it('should transfer comp accrued when amount is above threshold', async () => {
      const compRemaining = 1000, a1AccruedPre = 100, threshold = 1;
      const compBalancePre = await compBalance(comptroller, a1);
      const tx0 = await comptroller.comp.connect(root).transfer(comptroller.address, compRemaining);
      const tx1 = await comptroller.setCompAccrued(a1.address, a1AccruedPre);
      const tx2 = await comptroller.harnessTransferComp(a1.address, a1AccruedPre, threshold);

      const a1AccruedPost = await compAccrued(comptroller, a1);
      const compBalancePost = await compBalance(comptroller, a1);
      expect(compBalancePre).equals(0);
      expect(compBalancePost).equals(a1AccruedPre);
    });

    it('should not transfer when comp accrued is below threshold', async () => {
      const compRemaining = 1000, a1AccruedPre = 100, threshold = 101;
      const compBalancePre = await comptroller.comp.balanceOf(a1.address);

      await comptroller.comp.connect(root).transfer(comptroller.address, compRemaining);
      await comptroller.setCompAccrued(a1.address, a1AccruedPre);
      await comptroller.harnessTransferComp(a1.address, a1AccruedPre, threshold);

      const a1AccruedPost = await compAccrued(comptroller, a1);
      const compBalancePost = await compBalance(comptroller, a1);
      expect(compBalancePre).equals(0);
      expect(compBalancePost).equals(0);
    });

    it('should not transfer comp if comp accrued is greater than comp remaining', async () => {
      const compRemaining = 99, a1AccruedPre = 100, threshold = 1;
      const compBalancePre = await compBalance(comptroller, a1);
      await comptroller.comp.connect(root).transfer(comptroller.address, compRemaining);
      await comptroller.setCompAccrued(a1.address, a1AccruedPre);
      await comptroller.harnessTransferComp(a1.address, a1AccruedPre, threshold);
      const a1AccruedPost = await compAccrued(comptroller, a1);
      const compBalancePost = await compBalance(comptroller, a1);
      expect(compBalancePre).equals(0);
      expect(compBalancePost).equals(0);
    });
  });

  describe('claimComp', () => {
    it('should accrue comp and then transfer comp accrued', async () => {
      const compRemaining = compRate.multipliedBy(100), mintAmount = etherUnsigned(12e18), deltaBlocks = 10;
      await comptroller.comp.connect(root).transfer(comptroller.address, toEBN(compRemaining));
      await pretendBorrow(cLOW, a1, 1, 1, 100);
      await comptroller._setCompSpeed(cLOW.address, toEBN(etherExp(0.5)));
      await comptroller.harnessRefreshCompSpeeds();
      const speed = await comptroller.compSpeeds(cLOW.address);
      const a2AccruedPre = await compAccrued(comptroller, a2);
      const compBalancePre = await compBalance(comptroller, a2);
      await quickMint(cLOW, a2, toEBN(mintAmount));
      await fastForward(comptroller, toEBN(deltaBlocks));
      const tx = await comptroller.functions['claimComp(address)'](a2.address);
      const a2AccruedPost = await compAccrued(comptroller, a2);
      const compBalancePost = await compBalance(comptroller, a2);

      expect((await tx.wait()).gasUsed.toNumber()).lessThan(400000);
      expect(speed).equals(toEBN(compRate));
      expect(a2AccruedPre).equals(0);
      expect(a2AccruedPost).equals(0);
      expect(toEBN(compBalancePre)).equals(0);
      expect(toEBN(compBalancePost)).equals(toEBN(compRate.multipliedBy(deltaBlocks).minus(1))); // index is 8333...
    });

    it('should accrue comp and then transfer comp accrued in a single market', async () => {
      const compRemaining = compRate.multipliedBy(100), mintAmount = etherUnsigned(12e18), deltaBlocks = 10;
      await comptroller.comp.connect(root).transfer(comptroller.address, toEBN(compRemaining));
      await pretendBorrow(cLOW, a1, 1, 1, 100);
      await comptroller.harnessAddCompMarkets([cLOW.address]);
      await comptroller.harnessRefreshCompSpeeds();
      const speed = await comptroller.compSpeeds(cLOW.address);
      const a2AccruedPre = await compAccrued(comptroller, a2);
      const compBalancePre = await compBalance(comptroller, a2);
      await quickMint(cLOW, a2, toEBN(mintAmount));
      await fastForward(comptroller, deltaBlocks);
      const tx = await comptroller.functions['claimComp(address,address[])'](a2.address, [cLOW.address]);
      const a2AccruedPost = await compAccrued(comptroller, a2);
      const compBalancePost = await compBalance(comptroller, a2);

      expect((await tx.wait()).gasUsed.toNumber()).lessThan(170000);
      expect(speed).equals(toEBN(compRate));
      expect(a2AccruedPre).equals(0);
      expect(a2AccruedPost).equals(0);
      expect(compBalancePre).equals(0);
      expect(compBalancePost).equals(toEBN(compRate.multipliedBy(deltaBlocks).minus(1))); // index is 8333...
    });

    it('should claim when comp accrued is below threshold', async () => {
      const compRemaining = etherExp(1), accruedAmt = etherUnsigned(0.0009e18)
      await comptroller.comp.connect(root).transfer(comptroller.address, toEBN(compRemaining));

      await comptroller.setCompAccrued(a1.address, toEBN(accruedAmt));
      await comptroller.functions['claimComp(address,address[])'](a1.address, [cLOW.address]);

      expect(await compAccrued(comptroller, a1)).equals(0);
      expect(await compBalance(comptroller, a1)).equals(toEBN(accruedAmt));
    });

    it('should revert when a market is not listed', async () => {
      const cNOT = await makeCToken({ comptroller });
      const tx = comptroller.functions['claimComp(address,address[])'](a1.address, [cNOT.address]);
      await expect(tx).to.be.revertedWith('market must be listed');
    });
  });

  describe('claimComp batch', () => {
    it('should revert when claiming comp from non-listed market', async () => {
      const compRemaining = toEBN(compRate.multipliedBy(100)), deltaBlocks = 10, mintAmount = toEBN(etherExp(10));

      await comptroller.comp.connect(root).transfer(comptroller.address, compRemaining);
      let [_, __, ...claimAccts] = await ethers.getSigners();

      for (let from of claimAccts) {
        const tx = await cLOW.helperUnderlying.connect(from).harnessSetBalance(from.address, mintAmount);
        const receipt = await tx.wait();
        const events = receipt.events;
        expect(events.some(e => e.event === "Failure")).equals(false);

        await cLOW.helperUnderlying.connect(from).approve(cLOW.address, mintAmount);
        await cLOW.connect(from).mint(mintAmount);
      }
      await pretendBorrow(cLOW, root, 1, 1, etherExp(10));
      await comptroller.harnessRefreshCompSpeeds();

      await fastForward(comptroller, deltaBlocks);
      addresses = [];
      claimAccts.forEach(e => addresses.push(e.address));

      const unsignedTx = await comptroller.populateTransaction['claimComp(address[],address[],bool,bool)'](addresses, [cLOW.address, cEVIL.address], true, true);
      await expect(comptroller.signer.call(unsignedTx)).to.be.revertedWith('market must be listed');
    });

    it('should claim the expected amount when holders and ctokens arg is duplicated', async () => {
      const compRemaining = toEBN(compRate.multipliedBy(100)), deltaBlocks = 10, mintAmount = toEBN(etherExp(10));
      let [_, __, ...claimAccts] = (await ethers.getSigners()).slice(0, 10);

      await comptroller.comp.connect(root).transfer(comptroller.address, compRemaining);
      for (let from of claimAccts) {
        const tx = await cLOW.helperUnderlying.connect(from).harnessSetBalance(from.address, mintAmount);
        const receipt = await tx.wait();
        const events = receipt.events;
        expect(events.some(e => e.event === "Failure")).equals(false);

        await cLOW.helperUnderlying.connect(from).approve(cLOW.address, mintAmount);
        await cLOW.connect(from).mint(mintAmount);
      }


      await pretendBorrow(cLOW, root, 1, 1, etherExp(10));
      await comptroller.harnessAddCompMarkets([cLOW.address]);
      await comptroller.harnessRefreshCompSpeeds();

      await fastForward(comptroller, deltaBlocks);


      const addresses = [];
      [...claimAccts, ...claimAccts].forEach(e => addresses.push(e.address));
      const result = await comptroller['claimComp(address[],address[],bool,bool)'](addresses, [cLOW.address, cLOW.address], false, true);
      // comp distributed => 10e18
      for (let acct of claimAccts) {
        expect(await comptroller.compSupplierIndex(cLOW.address, acct.address)).equals(toEBN(etherDouble(1.125)));
        expect(await compBalance(comptroller, acct)).equals(toEBN(etherExp(1.25)));
      }
    });

    it('claims comp for multiple suppliers only', async () => {
      const compRemaining = toEBN(compRate.multipliedBy(100)), deltaBlocks = 10, mintAmount = toEBN(etherExp(10));
      await comptroller.comp.connect(root).transfer(comptroller.address, compRemaining);
      let [_, __, ...claimAccts] = (await ethers.getSigners()).slice(0, 10);
      for (let from of claimAccts) {
        const tx = await cLOW.helperUnderlying.connect(from).harnessSetBalance(from.address, mintAmount);
        const receipt = await tx.wait();
        const events = receipt.events;
        expect(events.some(e => e.event === "Failure")).equals(false);

        await cLOW.helperUnderlying.connect(from).approve(cLOW.address, mintAmount);
        await cLOW.connect(from).mint(mintAmount);
      }
      await pretendBorrow(cLOW, root, 1, 1, etherExp(10));
      await comptroller.harnessAddCompMarkets([cLOW.address]);
      await comptroller.harnessRefreshCompSpeeds();


      await fastForward(comptroller, deltaBlocks);


      const addresses = [];
      claimAccts.forEach(e => addresses.push(e.address));
      await comptroller['claimComp(address[],address[],bool,bool)'](addresses, [cLOW.address], false, true);
      // comp distributed => 10e18
      for (let acct of claimAccts) {
        expect(await comptroller.compSupplierIndex(cLOW.address, acct.address)).equals(toEBN(etherDouble(1.125)));
        expect(await compBalance(comptroller, acct)).equals(toEBN(etherExp(1.25)));
      }
    });

    it('claims comp for multiple borrowers only, primes uninitiated', async () => {
      const compRemaining = toEBN(compRate.multipliedBy(100)), deltaBlocks = 10, mintAmount = toEBN(etherExp(10)), borrowAmt = toEBN(etherExp(1)), borrowIdx = toEBN(etherExp(1))
      await comptroller.comp.connect(root).transfer(comptroller.address, compRemaining);
      let [_, __, ...claimAccts] = (await ethers.getSigners()).slice(0, 10);

      for (let acct of claimAccts) {
        await cLOW.harnessIncrementTotalBorrows(borrowAmt);
        await cLOW.harnessSetAccountBorrows(acct.address, borrowAmt, borrowIdx);
      }
      await comptroller.harnessAddCompMarkets([cLOW.address]);
      await comptroller.harnessRefreshCompSpeeds();

      await comptroller.harnessFastForward(10);

      await comptroller['claimComp(address[],address[],bool,bool)'](addresses, [cLOW.address], true, false);
      for (let acct of claimAccts) {
        expect(await comptroller.compBorrowerIndex(cLOW.address, acct.address)).equals(toEBN(etherDouble(2.25)));
        expect(await comptroller.compSupplierIndex(cLOW.address, acct.address)).equals(toEBN(0));

      }
    });

    it('should revert when a market is not listed', async () => {
      const cNOT = await makeCToken({ comptroller });
      const tx = comptroller.functions['claimComp(address[],address[],bool,bool)']([a1.address, a2.address], [cNOT.address], true, true);
      await expect(tx).to.be.revertedWith('market must be listed');
    });
  });

  describe('harnessRefreshCompSpeeds', () => {
    it('should start out 0', async () => {
      await comptroller.harnessRefreshCompSpeeds();
      const speed = await comptroller.compSpeeds(cLOW.address);
      expect(speed).equals(0);
    });

    it('should get correct speeds with borrows', async () => {
      await pretendBorrow(cLOW, a1, 1, 1, 100);
      await comptroller.harnessAddCompMarkets([cLOW.address]);
      const tx = comptroller.harnessRefreshCompSpeeds();
      const speed = await comptroller.compSpeeds(cLOW.address);
      expect(speed).equals(toEBN(compRate));
      await expect(tx).to.emit(comptroller, 'CompSpeedUpdated').withArgs(cLOW.address, speed);
    });

    it('should get correct speeds for 2 assets', async () => {
      await pretendBorrow(cLOW, a1, 1, 1, 100);
      await pretendBorrow(cZRX, a1, 1, 1, 100);
      await comptroller.harnessAddCompMarkets([cLOW.address, cZRX.address]);
      await comptroller.harnessRefreshCompSpeeds();
      const speed1 = await comptroller.compSpeeds(cLOW.address);
      const speed2 = await comptroller.compSpeeds(cREP.address);
      const speed3 = await comptroller.compSpeeds(cZRX.address);
      expect(speed1).equals(toEBN(compRate.dividedBy(4)));
      expect(speed2).equals(0);
      expect(speed3).equals(toEBN(compRate.dividedBy(4).multipliedBy(3)));
    });
  });

  describe('harnessAddCompMarkets', () => {
    it('should correctly add a comp market if called by admin', async () => {
      const cBAT = await makeCToken({ comptroller, supportMarket: true });
      await comptroller.harnessAddCompMarkets([cLOW.address, cREP.address, cZRX.address]);
      const tx2 = comptroller.harnessAddCompMarkets([cBAT.address]);

      const markets = await comptroller.getCompMarkets();
      expect(markets).to.eql([cLOW, cREP, cZRX, cBAT].map((c) => c.address));
      await expect(tx2).to.emit(comptroller, 'CompSpeedUpdated').withArgs(cBAT.address, 1);
    });

    it('should not write over a markets existing state', async () => {
      const mkt = cLOW.address;
      const bn0 = 10, bn1 = 20;
      const idx = etherUnsigned(1.5e36);

      await comptroller.harnessAddCompMarkets([mkt]);
      await comptroller.setCompSupplyState(mkt, toEBN(idx), bn0);
      await comptroller.setCompBorrowState(mkt, toEBN(idx), bn0);
      await comptroller.setBlockNumber(bn1);
      await comptroller._setCompSpeed(mkt, 0);
      await comptroller.harnessAddCompMarkets([mkt]);

      const supplyState = await comptroller.compSupplyState(mkt);
      expect(supplyState.block.toString()).equals(bn1.toString());
      expect(supplyState.index.toString()).equals(toEBN(idx.toFixed()));

      const borrowState = await comptroller.compBorrowState(mkt);
      expect(borrowState.block.toString()).equals(bn1.toString());
      expect(borrowState.index).equals(toEBN(idx.toFixed()));
    });
  });


  describe('updateContributorRewards', () => {
    it('should not fail when contributor rewards called on non-contributor', async () => {
      await comptroller.updateContributorRewards(a1.address);
    });

    it('should accrue comp to contributors', async () => {
      await comptroller._setContributorCompSpeed(a1.address, 2000);
      await fastForward(comptroller, 50);

      const a1Accrued = await compAccrued(comptroller, a1);
      expect(a1Accrued).equals(0);

      await comptroller.connect(a1).updateContributorRewards(a1.address);
      const a1Accrued2 = await compAccrued(comptroller, a1);
      expect(a1Accrued2).equals(50 * 2000);
    });

    it('should accrue comp with late set', async () => {
      await fastForward(comptroller, 1000);
      await comptroller._setContributorCompSpeed(a1.address, 2000);
      await fastForward(comptroller, 50);

      await comptroller.connect(a1).updateContributorRewards(a1.address);
      const a1Accrued2 = await compAccrued(comptroller, a1);
      expect(a1Accrued2).equals(50 * 2000);
    });
  });

  describe('_setContributorCompSpeed', () => {
    it('should revert if not called by admin', async () => {
      const tx = comptroller.connect(a1)._setContributorCompSpeed(a1.address, 1000);
      await expect(tx).to.be.revertedWith('only admin can set comp speed');
    });

    it('should start comp stream if called by admin', async () => {
      const tx = comptroller._setContributorCompSpeed(a1.address, 1000);
      await expect(tx).to.emit(comptroller, 'ContributorCompSpeedUpdated').withArgs(a1.address, 1000);
    });

    it('should reset comp stream if set to 0', async () => {
      await comptroller._setContributorCompSpeed(a1.address, 2000);
      await fastForward(comptroller, 50);

      await comptroller._setContributorCompSpeed(a1.address, 0);
      await fastForward(comptroller, 50);

      await comptroller.connect(a1).updateContributorRewards(a1.address);
      const a1Accrued = await compAccrued(comptroller, a1);
      expect(a1Accrued).equals(50 * 2000);
    });
  });
});
