const { expect } = require("chai");

const {
  makeComptroller,
  makeCToken,
  enterMarkets,
  quickMint
} = require('../Utils/Compound');

describe('Comptroller', () => {
  let root, accounts;

  beforeEach(async () => {
    [root, ...accounts] = await ethers.getSigners();
  });
  describe('liquidity', () => {
    it("fails if a price has not been set", async () => {
      const cToken = await makeCToken({supportMarket: true});
      await enterMarkets([cToken], accounts[1]);

      // Notice: cToken properties are now prefixed with helperName: i.e cToken.helperComptroller
      
      let result = await cToken.helperComptroller.getAccountLiquidity(accounts[1].address);



      // TODO, make this test look readable
      // result[0] is the first of 3 values returned from calling the contract
      // It represents the return status
      // 13 is the enum value in ErrorReporter.sol It represents PRICE_ERROR
      expect(result[0].toString()).equal('13');
    });
    
    it("allows a borrow up to collateralFactor, but not more", async () => {
      const collateralFactor = 0.5, underlyingPrice = 1, user = accounts[1], amount = ethers.BigNumber.from(1e6);
      const cToken = await makeCToken({supportMarket: true, collateralFactor, underlyingPrice});
      
      let error, liquidity, shortfall;
      
      // not in market yet, hypothetical borrow should have no effect
      ({1: liquidity, 2: shortfall} = await cToken.helperComptroller.getHypotheticalAccountLiquidity(user.address, cToken.address, 0, amount));
      ({1: liquidity, 2: shortfall} = await cToken.helperComptroller.getHypotheticalAccountLiquidity(user.address, cToken.address, 0, amount));
      expect(liquidity).equal(0);
      expect(shortfall).equal(0);
      
      await enterMarkets([cToken], user);
      await quickMint(cToken, user, amount);
      
      // total account liquidity after supplying `amount`
      ({1: liquidity, 2: shortfall}  = await cToken.helperComptroller.getAccountLiquidity(user.address));
      expect(liquidity).equals(amount * collateralFactor);
      expect(shortfall).equals(0);
      
      // hypothetically borrow `amount`, should shortfall over collateralFactor
      ({1: liquidity, 2: shortfall} = await cToken.helperComptroller.getHypotheticalAccountLiquidity(user.address, cToken.address, 0, amount));
      expect(liquidity).equals(0);
      expect(shortfall).equals(amount * (1 - collateralFactor));
      
      // hypothetically redeem `amount`, should be back to even
      ({1: liquidity, 2: shortfall} = await cToken.helperComptroller.getHypotheticalAccountLiquidity(user.address, cToken.address, amount, 0));
      expect(liquidity).equals(0);
      expect(shortfall).equals(0);
    }, 20000);
    
    it("allows entering 3 markets, supplying to 2 and borrowing up to collateralFactor in the 3rd", async () => {
      const amount1 = 1e6, amount2 = 1e3, user = accounts[1];
      const cf1 = 0.5, cf2 = 0.666, cf3 = 0, up1 = 3, up2 = 2.718, up3 = 1;
      const c1 = amount1 * cf1 * up1, c2 = amount2 * cf2 * up2, collateral = Math.floor(c1 + c2);

      const cToken1 = await makeCToken({supportMarket: true, collateralFactor: cf1, underlyingPrice: up1});
      const cToken2 = await makeCToken({supportMarket: true, comptroller: cToken1.helperComptroller, collateralFactor: cf2, underlyingPrice: up2});
      const cToken3 = await makeCToken({supportMarket: true, comptroller: cToken1.helperComptroller, collateralFactor: cf3, underlyingPrice: up3});
      
      await enterMarkets([cToken1, cToken2, cToken3], user);
      await quickMint(cToken1, user, amount1);
      await quickMint(cToken2, user, amount2);
      
      let error, liquidity, shortfall;
      
      ({0: error, 1: liquidity, 2: shortfall} = await cToken3.helperComptroller.getAccountLiquidity(user.address));
      expect(error).equals(0);
      expect(liquidity).equals(collateral);
      expect(shortfall).equals(0);
      
      ({1: liquidity, 2: shortfall} = await cToken3.helperComptroller.getHypotheticalAccountLiquidity(user.address, cToken3.address, Math.floor(c2), 0));
      expect(liquidity).equals(collateral);
      expect(shortfall).equals(0);
      
      ({1: liquidity, 2: shortfall} = await cToken3.helperComptroller.getHypotheticalAccountLiquidity(user.address, cToken3.address, 0, Math.floor(c2)));
      expect(liquidity).equals(c1);
      expect(shortfall).equals(0);
      
      ({1: liquidity, 2: shortfall} = await cToken3.helperComptroller.getHypotheticalAccountLiquidity(user.address, cToken3.address, 0, collateral + c1));
      expect(liquidity).equals(0);
      expect(shortfall).equals(c1);
      
      ({1: liquidity, 2: shortfall} = await cToken1.helperComptroller.getHypotheticalAccountLiquidity(user.address, cToken1.address, amount1, 0));
      expect(liquidity).equals(Math.floor(c2));
      expect(shortfall).equals(0);
    });
  });
  
  describe("getAccountLiquidity", () => {
    it("returns 0 if not 'in' any markets", async () => {
      const comptroller = await makeComptroller();
      const {0: error, 1: liquidity, 2: shortfall} = await comptroller.getAccountLiquidity(accounts[0].address);
      expect(error).equals(0);
      expect(liquidity).equals(0);
      expect(shortfall).equals(0);
    });
  });
  
  describe("getHypotheticalAccountLiquidity", () => {
    it("returns 0 if not 'in' any markets", async () => {
      const cToken = await makeCToken();
      const {0: error, 1: liquidity, 2: shortfall} = await cToken.helperComptroller.getHypotheticalAccountLiquidity(accounts[0].address, cToken.address, 0, 0);
      expect(error).equals(0);
      expect(liquidity).equals(0);
      expect(shortfall).equals(0);
    });
    
    it("returns collateral factor times dollar amount of tokens minted in a single market", async () => {
      const collateralFactor = 0.5, exchangeRate = 1, underlyingPrice = 1;
      const cToken = await makeCToken({supportMarket: true, collateralFactor, exchangeRate, underlyingPrice});
      const from = accounts[0], balance = 1e7, amount = 1e6;
      await enterMarkets([cToken], from);
      await cToken.helperUnderlying.connect(from).harnessSetBalance(from.address, balance);
      await cToken.helperUnderlying.connect(from).approve(cToken.address, balance);
      await cToken.connect(from).mint(amount);
      const {0: error, 1: liquidity, 2: shortfall} = await cToken.helperComptroller.getHypotheticalAccountLiquidity(from.address, cToken.address, 0, 0);
      expect(error).equals(0);
      expect(liquidity).equals(amount * collateralFactor * exchangeRate * underlyingPrice);
      expect(shortfall).equals(0);
    });
  });
});
