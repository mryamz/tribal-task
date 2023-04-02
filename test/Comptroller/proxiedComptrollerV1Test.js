const { address, etherMantissa } = require('../Utils/Ethereum');

const { makeComptroller, makeCToken, makePriceOracle } = require('../Utils/Compound');
const { ComptrollerErr } = require('../Errors');
const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('ComptrollerV1', function () {
  let root, accounts;
  let unitroller;
  let brains;
  let oracle;

  beforeEach(async () => {
    [root, ...accounts] = await ethers.getSigners();
    oracle = await makePriceOracle();
    const Brains = await ethers.getContractFactory('ComptrollerG1');
    brains = await Brains.deploy();
    await brains.deployed();

    const Unitroller = await ethers.getContractFactory('Unitroller')
    unitroller = await Unitroller.deploy();
    await unitroller.deployed();
  });

  let initializeBrains = async (priceOracle, closeFactor, maxAssets) => {
    await unitroller._setPendingImplementation(brains.address);
    await brains._become(unitroller.address, priceOracle.address, closeFactor, maxAssets, false);
    return await ethers.getContractAt('ComptrollerG1', unitroller.address);
  };

  let reinitializeBrains = async () => {
    await unitroller._setPendingImplementation(brains.address);
    await brains._become(unitroller.address, ethers.constants.AddressZero, 0, 0, true);
    return await ethers.getContractAt('ComptrollerG1', unitroller.address);
  };

  describe('delegating to comptroller v1', () => {
    const closeFactor = ethers.BigNumber.from(etherMantissa(0.051).toString());
    const maxAssets = 10;
    let unitrollerAsComptroller, cToken;
    beforeEach(async () => {
      unitrollerAsComptroller = await initializeBrains(oracle, ethers.BigNumber.from(etherMantissa(0.06).toString()), 30);
      cToken = await makeCToken({ comptroller: unitrollerAsComptroller });
    });

    describe('becoming brains sets initial state', () => {
      it('reverts if this is not the pending implementation', async () => {

        const transaction = brains._become(unitroller.address, oracle.address, 0, 10, false);
        await expect(transaction).to.be.revertedWith("change not authorized");
      });

      it('on success it sets admin to caller of constructor', async () => {
        const result1 = await unitrollerAsComptroller.admin();
        expect(result1).equals(root.address);
        const result2 = await unitrollerAsComptroller.pendingAdmin();
        expect(result2).equals(ethers.constants.AddressZero);
      });

      it('on success it sets closeFactor and maxAssets as specified', async () => {
        const comptroller = await initializeBrains(oracle, closeFactor, maxAssets);

        expect(await comptroller.closeFactorMantissa()).equals(closeFactor);
        expect(await comptroller.maxAssets()).equals(maxAssets);
      });

      it("on reinitialization success, it doesn't set closeFactor or maxAssets", async () => {
        let comptroller = await initializeBrains(oracle, closeFactor, maxAssets);

        expect(await unitroller.comptrollerImplementation()).equals(brains.address);
        expect(await comptroller.closeFactorMantissa()).equals(closeFactor);
        expect(await comptroller.maxAssets()).equals(maxAssets);

        // Create new brains
        const Brains = await ethers.getContractFactory('ComptrollerG1');
        brains = await Brains.deploy();
        await brains.deployed();
        comptroller = await reinitializeBrains();

        expect(await unitroller.comptrollerImplementation()).equals(brains.address);
        expect(await comptroller.closeFactorMantissa()).equals(closeFactor);
        expect(await comptroller.maxAssets()).equals(maxAssets);
      });

      it('reverts on invalid closeFactor', async () => {
        await unitroller._setPendingImplementation(brains.address);
        const transaction = brains._become(unitroller.address, oracle.address, 0, maxAssets, false);
        await expect(transaction).to.be.revertedWith('set close factor error');
      });

      it('allows 0 maxAssets', async () => {
        const comptroller = await initializeBrains(oracle, closeFactor, 0);
        expect(await comptroller.maxAssets()).equals(0);
      });

      it('allows 5000 maxAssets', async () => {
        // 5000 is an arbitrary number larger than what we expect to ever actually use
        const comptroller = await initializeBrains(oracle, closeFactor, 5000);
        expect(await comptroller.maxAssets()).equals(5000);
      });
    });

    describe('_setCollateralFactor', () => {
      const half = ethers.BigNumber.from(etherMantissa(0.5).toString()),
        one = ethers.BigNumber.from(etherMantissa(1).toString());

      it('fails if not called by admin', async () => {
        const transaction = unitrollerAsComptroller.connect(accounts[1])._setCollateralFactor(cToken.address, half);
        expect(transaction).to.emit(unitrollerAsComptroller, 'Failure').withArgs(ComptrollerErr.Error.UNAUTHORIZED, ComptrollerErr.FailureInfo.SET_COLLATERAL_FACTOR_OWNER_CHECK, 0);
      });

      it('fails if asset is not listed', async () => {
        const transaction = unitrollerAsComptroller._setCollateralFactor(cToken.address, half);
        expect(transaction).to.emit(unitrollerAsComptroller, 'Failure').withArgs(ComptrollerErr.Error.MARKET_NOT_LISTED, ComptrollerErr.FailureInfo.SET_COLLATERAL_FACTOR_NO_EXISTS, 0);
      });

      it('fails if factor is too high', async () => {
        const cToken = await makeCToken({ supportMarket: true, comptroller: unitrollerAsComptroller });
        const transaction = unitrollerAsComptroller._setCollateralFactor(cToken.address, one);
        expect(transaction).to.emit(unitrollerAsComptroller, 'Failure').withArgs(ComptrollerErr.Error.INVALID_COLLATERAL_FACTOR, ComptrollerErr.FailureInfo.SET_COLLATERAL_FACTOR_VALIDATION, 0);
      });

      it('fails if factor is set without an underlying price', async () => {
        const cToken = await makeCToken({ supportMarket: true, comptroller: unitrollerAsComptroller });
        const transaction = unitrollerAsComptroller._setCollateralFactor(cToken.address, half);
        expect(transaction).to.emit(unitrollerAsComptroller, 'Failure').withArgs(ComptrollerErr.Error.PRICE_ERROR, ComptrollerErr.FailureInfo.SET_COLLATERAL_FACTOR_WITHOUT_PRICE, 0);
      });

      it('succeeds and sets market', async () => {
        const cToken = await makeCToken({ supportMarket: true, comptroller: unitrollerAsComptroller });
        await oracle.setUnderlyingPrice(cToken.address, 1);
        const transaction = unitrollerAsComptroller._setCollateralFactor(cToken.address, half);
        expect(transaction).to.emit(unitrollerAsComptroller, 'NewCollateralFactor').withArgs(cToken.address, '0', half.toString());

      });
    });

    describe('_supportMarket', () => {
      it('fails if not called by admin', async () => {
        const transaction = unitrollerAsComptroller.connect(accounts[0])._supportMarket(cToken.address);
        await expect(transaction).to.emit(unitrollerAsComptroller, "Failure").withArgs(ComptrollerErr.Error.UNAUTHORIZED, ComptrollerErr.FailureInfo.SUPPORT_MARKET_OWNER_CHECK, 0);
      });

      it('fails if asset is not a CToken', async () => {
        const notACToken = await makePriceOracle();
        const transaction = unitrollerAsComptroller._supportMarket(notACToken.address);
        await expect(transaction).to.be.reverted;
      });

      it('succeeds and sets market', async () => {
        const result = await unitrollerAsComptroller._supportMarket(cToken.address);
        expect(result).to.emit(unitrollerAsComptroller, 'MarketListed').withArgs(cToken.address);
      });

      it('cannot list a market a second time', async () => {
        const result1 = await unitrollerAsComptroller._supportMarket(cToken.address);
        const result2 = await unitrollerAsComptroller._supportMarket(cToken.address);
        expect(result1).to.emit(unitrollerAsComptroller, 'MarketListed').withArgs(cToken.address);
        expect(result2).to.emit(unitrollerAsComptroller, 'Failure').withArgs(ComptrollerErr.Error.MARKET_ALREADY_LISTED, ComptrollerErr.FailureInfo.SUPPORT_MARKET_EXISTS, 0);
      });

      it('can list two different markets', async () => {
        const cToken1 = await makeCToken({ comptroller: unitroller });
        const cToken2 = await makeCToken({ comptroller: unitroller });
        const result1 = await unitrollerAsComptroller._supportMarket(cToken1.address); 
        const result2 = await unitrollerAsComptroller._supportMarket(cToken2.address);
        expect(result1).to.emit(unitrollerAsComptroller, 'MarketListed').withArgs(cToken1.address);
        expect(result2).to.emit(unitrollerAsComptroller, 'MarketListed').withArgs(cToken2.address);
      });
    });
  });
});
