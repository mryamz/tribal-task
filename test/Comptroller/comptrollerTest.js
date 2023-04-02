const { expect } = require("chai");

const {
  etherMantissa,
  both
} = require('../Utils/Ethereum');

const {
  makeComptroller,
  makePriceOracle,
  makeCToken,
  makeToken
} = require('../Utils/Compound');
const { default: BigNumber } = require("bignumber.js");

const {ComptrollerErr} = require('../Errors');

describe('Comptroller', () => {
  let root, accounts;

  beforeEach(async () => {
    [root, ...accounts] = await ethers.getSigners();
  });

  describe('constructor', () => {
    it("on success it sets admin to creator and pendingAdmin is unset", async () => {
      const comptroller = await makeComptroller();

      const admin = await comptroller.callStatic.admin();
      expect(admin).equals(root.address);

      const pendingAdmin = await comptroller.callStatic.pendingAdmin();
      expect(pendingAdmin).equals(ethers.constants.AddressZero);
    });

    it("on success it sets closeFactor as specified", async () => {
      const comptroller = await makeComptroller();
      const mantissaFactor = await comptroller.closeFactorMantissa();
      expect(mantissaFactor.toString()).equals(new BigNumber(0.051e18).toString());
    });
  });

  describe('_setLiquidationIncentive', () => {
    const initialIncentive = ethers.BigNumber.from(etherMantissa(1.0).toString());
    const validIncentive = ethers.BigNumber.from(etherMantissa(1.1).toString());
    const tooSmallIncentive = ethers.BigNumber.from(etherMantissa(0.99999).toString());
    const tooLargeIncentive = ethers.BigNumber.from(etherMantissa(1.50000001).toString());

    let comptroller;
    beforeEach(async () => {
      comptroller = await makeComptroller();
    });

    it("fails if called by non-admin", async () => {
      const reply = await comptroller.connect(accounts[0]).callStatic._setLiquidationIncentive(initialIncentive);
      const transaction = await comptroller.connect(accounts[0])._setLiquidationIncentive(initialIncentive);


      expect(reply.toNumber()).equals(1);
      await expect(transaction).to.emit(comptroller, "Failure").withArgs(ComptrollerErr.Error.UNAUTHORIZED, ComptrollerErr.FailureInfo.SET_LIQUIDATION_INCENTIVE_OWNER_CHECK, 0);

      const liquidationIncentive = await comptroller.liquidationIncentiveMantissa();
      expect(liquidationIncentive).equals(initialIncentive);
    });

    it("accepts a valid incentive and emits a NewLiquidationIncentive event", async () => {

      const reply = await comptroller.callStatic._setLiquidationIncentive(validIncentive);
      const transaction = await comptroller._setLiquidationIncentive(validIncentive);

      expect(reply.toNumber()).equals(0);
      await expect(transaction).to.emit(comptroller, 'NewLiquidationIncentive').withArgs(initialIncentive.toString(), validIncentive.toString());


      expect(await comptroller.liquidationIncentiveMantissa()).equals(validIncentive);
    });
  });

  describe('_setPriceOracle', () => {
    let comptroller, oldOracle, newOracle;
    beforeEach(async () => {
      comptroller = await makeComptroller();
      oldOracle = comptroller.priceOracle;
      newOracle = await makePriceOracle();
    });

    it("fails if called by non-admin", async () => {
      const contract = comptroller.connect(accounts[0]);
      const transaction = await contract._setPriceOracle(newOracle.address);

      await expect(transaction).to.emit(contract, "Failure").withArgs(ComptrollerErr.Error.UNAUTHORIZED, ComptrollerErr.FailureInfo.SET_PRICE_ORACLE_OWNER_CHECK, 0);

      const oracle = await comptroller.callStatic.oracle();

      expect(oracle).equals(oldOracle.address);

    });

    it("accepts a valid price oracle and emits a NewPriceOracle event", async () => {


      const result = await comptroller._setPriceOracle(newOracle.address);
      expect(result).to.emit(comptroller, "NewPriceOracle").withArgs(oldOracle.address, newOracle.address);
      expect(await comptroller.callStatic.oracle()).equals(newOracle.address);
    });
  });

  describe('_setCloseFactor', () => {
    it("fails if not called by admin", async () => {
      const cToken = await makeCToken();

      const transaction = cToken.helperComptroller.connect(accounts[0])._setCloseFactor(1);

      await expect(transaction).to.be.revertedWith('only admin can set close factor');
    });
  });

  describe('_setCollateralFactor', () => {
    const half = ethers.BigNumber.from(etherMantissa(0.5).toString());

    it("fails if not called by admin", async () => {
      const cToken = await makeCToken();
      const transaction = await cToken.helperComptroller.connect(accounts[0])._setCollateralFactor(cToken.address, half);
      await expect(transaction).to.emit(cToken.helperComptroller, 'Failure').withArgs(ComptrollerErr.Error.UNAUTHORIZED, ComptrollerErr.FailureInfo.SET_COLLATERAL_FACTOR_OWNER_CHECK, 0);
    });

    it("fails if asset is not listed", async () => {
      const cToken = await makeCToken();
      const transaction = cToken.helperComptroller._setCollateralFactor(cToken.address, half);
      await expect(transaction).to.emit(cToken.helperComptroller, 'Failure').withArgs(ComptrollerErr.Error.MARKET_NOT_LISTED, ComptrollerErr.FailureInfo.SET_COLLATERAL_FACTOR_NO_EXISTS, 0)
    });

    it("fails if factor is set without an underlying price", async () => {
      const cToken = await makeCToken({ supportMarket: true });
      const transaction = cToken.helperComptroller._setCollateralFactor(cToken.address, half);
      await expect(transaction).to.emit(cToken.helperComptroller, 'Failure').withArgs(ComptrollerErr.Error.PRICE_ERROR, ComptrollerErr.FailureInfo.SET_COLLATERAL_FACTOR_WITHOUT_PRICE, 0);
    });

    it("succeeds and sets market", async () => {
      const cToken = await makeCToken({ supportMarket: true, underlyingPrice: 1 });
      const result = cToken.helperComptroller._setCollateralFactor(cToken.address, half);

      await expect(result).to.emit(cToken.helperComptroller, 'NewCollateralFactor').withArgs(cToken.address, '0', half.toString());

    });
  });

  describe('_supportMarket', () => {
    it("fails if not called by admin", async () => {
      const cToken = await makeCToken(root);
      const transaction = cToken.helperComptroller.connect(accounts[0])._supportMarket(cToken.address);
      await expect(transaction).to.emit(cToken.helperComptroller, 'Failure').withArgs(ComptrollerErr.Error.UNAUTHORIZED, ComptrollerErr.FailureInfo.SUPPORT_MARKET_OWNER_CHECK, 0);
    });

    it("fails if asset is not a CToken", async () => {
      const comptroller = await makeComptroller()
      const asset = await makeToken(root);
      await expect(comptroller._supportMarket(asset.address)).to.be.reverted;
    });

    it("succeeds and sets market", async () => {
      const cToken = await makeCToken();

      const result = cToken.helperComptroller._supportMarket(cToken.address);
      await expect(result).to.emit(cToken.helperComptroller, 'MarketListed').withArgs(cToken.address);
    });

    it("cannot list a market a second time", async () => {
      const cToken = await makeCToken();
      const result1 = cToken.helperComptroller._supportMarket(cToken.address);
      const result2 = cToken.helperComptroller._supportMarket(cToken.address);
      await expect(result1).to.emit(cToken.helperComptroller, 'MarketListed').withArgs(cToken.address);
      await expect(result2).to.emit(cToken.helperComptroller, 'Failure').withArgs(ComptrollerErr.Error.MARKET_ALREADY_LISTED, ComptrollerErr.FailureInfo.SUPPORT_MARKET_EXISTS, 0);
    });

    it("can list two different markets", async () => {
      const cToken1 = await makeCToken();
      const cToken2 = await makeCToken({ comptroller: cToken1.helperComptroller });
      const result1 = cToken1.helperComptroller._supportMarket(cToken1.address);
      const result2 = cToken1.helperComptroller._supportMarket(cToken2.address);
      await expect(result1).to.emit(cToken1.helperComptroller, 'MarketListed').withArgs(cToken1.address);
      await expect(result2).to.emit(cToken1.helperComptroller, 'MarketListed').withArgs(cToken2.address);
    });
  });

  describe('redeemVerify', () => {
    it('should allow you to redeem 0 underlying for 0 tokens', async () => {
      const comptroller = await makeComptroller();
      const cToken = await makeCToken({ comptroller: comptroller });
      await comptroller.redeemVerify(cToken.address, accounts[0].address, 0, 0);
    });

    it('should allow you to redeem 5 underlyig for 5 tokens', async () => {
      const comptroller = await makeComptroller();
      const cToken = await makeCToken({ comptroller: comptroller });
      await comptroller.redeemVerify(cToken.address, accounts[0].address, 5, 5);
    });

    it('should not allow you to redeem 5 underlying for 0 tokens', async () => {
      const comptroller = await makeComptroller();
      const cToken = await makeCToken({ comptroller: comptroller });
      const transaction = comptroller.redeemVerify(cToken.address, accounts[0].address, 5, 0);
      await expect(transaction).to.revertedWith("redeemTokens zero");
    });
  })
});
