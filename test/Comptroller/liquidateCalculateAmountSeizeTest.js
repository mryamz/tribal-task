const { expect } = require("chai");

const { etherUnsigned, UInt256Max } = require('../Utils/Ethereum');

const {ComptrollerErr} = require('../Errors');

const {
  makeComptroller,
  makeCToken,
  setOraclePrice
} = require('../Utils/Compound');

const borrowedPrice = ethers.BigNumber.from("20000000000");
const collateralPrice = ethers.BigNumber.from("1000000000000000000");
const repayAmount = ethers.BigNumber.from(etherUnsigned(1e18).toString());

async function calculateSeizeTokens(comptroller, cTokenBorrowed, cTokenCollateral, repayAmount) {
  const reply = comptroller.liquidateCalculateSeizeTokens(cTokenBorrowed.address, cTokenCollateral.address, repayAmount);
  return reply;
}

function rando(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

describe('Comptroller', () => {
  let root, accounts;
  let comptroller, cTokenBorrowed, cTokenCollateral;

  beforeEach(async () => {
    [root, ...accounts] = await ethers.getSigners();
    comptroller = await makeComptroller();
    cTokenBorrowed = await makeCToken({ comptroller: comptroller, underlyingPrice: 0 });
    cTokenCollateral = await makeCToken({ comptroller: comptroller, underlyingPrice: 0 });
  });
  beforeEach(async () => {
    await setOraclePrice(cTokenBorrowed, borrowedPrice);
    await setOraclePrice(cTokenCollateral, collateralPrice);
    await cTokenCollateral.harnessExchangeRateDetails(8e10, 4e10, 0);
  });

  describe('liquidateCalculateAmountSeize', () => {
    it("fails if either asset price is 0", async () => {
      await setOraclePrice(cTokenBorrowed, 0);

      const reply1 = await calculateSeizeTokens(comptroller, cTokenBorrowed, cTokenCollateral, repayAmount);
      expect(reply1[0].toString()).equals(ComptrollerErr.Error.PRICE_ERROR);
      expect(reply1[1].toString()).equals(ComptrollerErr.Error.NO_ERROR);
      await setOraclePrice(cTokenCollateral, 0);

      const reply2 = await calculateSeizeTokens(comptroller, cTokenBorrowed, cTokenCollateral, repayAmount)
      expect(reply2[0].toString()).equals(ComptrollerErr.Error.PRICE_ERROR); 
      expect(reply2[1].toString ()).equals(ComptrollerErr.Error.NO_ERROR); 
    });

    it("fails if the repayAmount causes overflow ", async () => {
      const reply = calculateSeizeTokens(comptroller, cTokenBorrowed, cTokenCollateral, UInt256Max());
      await expect(reply).to.be.revertedWith("multiplication overflow");
    });

    it("fails if the borrowed asset price causes overflow ", async () => {
      await setOraclePrice(cTokenBorrowed, -1);
      await expect(calculateSeizeTokens(comptroller, cTokenBorrowed, cTokenCollateral, repayAmount)).to.be.revertedWith("multiplication overflow");
    });

    it("reverts if it fails to calculate the exchange rate", async () => {
      await cTokenCollateral.harnessExchangeRateDetails(1, 0, 10); // (1 - 10) -> underflow
      await expect(comptroller.liquidateCalculateSeizeTokens(cTokenBorrowed.address, cTokenCollateral.address, repayAmount)).to.be.revertedWith("exchangeRateStored: exchangeRateStoredInternal failed");

    });

    [
      [1e18, 1e18, 1e18, 1e18, 1e18],
      [2e18, 1e18, 1e18, 1e18, 1e18],
      [2e18, 2e18, 1.42e18, 1.3e18, 2.45e18],
      [2.789e18, 5.230480842e18, 771.32e18, 1.3e18, 10002.45e18],
      [7.009232529961056e+24, 2.5278726317240445e+24, 2.6177112093242585e+23, 1179713989619784000, 7.790468414639561e+24],
      [rando(0, 1e25), rando(0, 1e25), rando(1, 1e25), rando(1e18, 1.5e18), rando(0, 1e25)]
    ].forEach((testCase) => {
      it(`returns the correct value for ${testCase}`, async () => {
        var [exchangeRate, borrowedPrice, collateralPrice, liquidationIncentive, repayAmount] = testCase.map(etherUnsigned);

        exchangeRate = ethers.BigNumber.from(exchangeRate.toString());
        borrowedPrice = ethers.BigNumber.from(borrowedPrice.toString());
        collateralPrice = ethers.BigNumber.from(collateralPrice.toString());
        liquidationIncentive = ethers.BigNumber.from(liquidationIncentive.toString());
        repayAmount = ethers.BigNumber.from(repayAmount.toString());

        await setOraclePrice(cTokenCollateral, ethers.BigNumber.from(collateralPrice.toString()));
        await setOraclePrice(cTokenBorrowed, ethers.BigNumber.from(borrowedPrice.toString()));

        await comptroller._setLiquidationIncentive(ethers.BigNumber.from(liquidationIncentive.toString()));
        await cTokenCollateral.harnessSetExchangeRate(ethers.BigNumber.from(exchangeRate.toString()));

        const seizeAmount = repayAmount.mul(liquidationIncentive).mul(borrowedPrice).div(collateralPrice);
        const seizeTokens = seizeAmount.div(exchangeRate);


        const result = await calculateSeizeTokens(comptroller, cTokenBorrowed, cTokenCollateral, repayAmount);

        expect(result[0].toNumber()).equals(0); 

        expect(Math.abs(Number(result[1]) - Number(seizeTokens))).lessThan(1e7);

      });
    });
  });
});
