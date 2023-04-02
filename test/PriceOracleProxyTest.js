const BigNumber = require('bignumber.js');
const { expect } = require('chai');
const { ethers } = require('hardhat');

const {
  address,
  etherMantissa,
  toEBN
} = require('../test/Utils/Ethereum');

const {
  makeCToken,
  makePriceOracle,
} = require('../test/Utils/Compound');

describe('PriceOracleProxy', () => {
  let root, accounts;
  let oracle, backingOracle, cEth, cUsdc, cSai, cDai, cUsdt, cOther;
  let address1 = ethers.utils.getAddress('0x0000000000000000000000000000000000000001');
  let address2 = ethers.utils.getAddress('0x0000000000000000000000000000000000000002');
  let daiOracleKey = address2;

  beforeEach(async () => {
    [root, ...accounts] = await ethers.getSigners();
    cEth = await makeCToken({ kind: "cether", comptrollerOpts: { kind: "v1-no-proxy" }, supportMarket: true });

    cUsdc = await makeCToken({ comptroller: cEth.helperComptroller, supportMarket: true });
    cSai = await makeCToken({ comptroller: cEth.helperComptroller, supportMarket: true });
    cDai = await makeCToken({ comptroller: cEth.helperComptroller, supportMarket: true });
    cUsdt = await makeCToken({ comptroller: cEth.helperComptroller, supportMarket: true });
    cOther = await makeCToken({ comptroller: cEth.helperComptroller, supportMarket: true });

    backingOracle = await makePriceOracle();
    const Oracle = await ethers.getContractFactory('PriceOracleProxy');
    oracle = await Oracle.deploy(root.address, backingOracle.address, cEth.address, cUsdc.address, cSai.address, cDai.address, cUsdt.address);
    await oracle.deployed();
  });

  describe("constructor", () => {
    it("sets address of guardian", async () => {
      let configuredGuardian = await oracle.guardian();
      expect(configuredGuardian).equals(root.address);
    });
    it("sets address of v1 oracle", async () => {
      let configuredOracle = await oracle.v1PriceOracle();
      expect(configuredOracle).equals(backingOracle.address);
    });

    it("sets address of cEth", async () => {
      let configuredCEther = await oracle.cEthAddress();
      expect(configuredCEther).equals(cEth.address);
    });

    it("sets address of cUSDC", async () => {
      let configuredCUSD = await oracle.cUsdcAddress();
      expect(configuredCUSD).equals(cUsdc.address);
    });

    it("sets address of cSAI", async () => {
      let configuredCSAI = await oracle.cSaiAddress();
      expect(configuredCSAI).equals(cSai.address);
    });

    it("sets address of cDAI", async () => {
      let configuredCDAI = await oracle.cDaiAddress();
      expect(configuredCDAI).equals(cDai.address);
    });

    it("sets address of cUSDT", async () => {
      let configuredCUSDT = await oracle.cUsdtAddress();
      expect(configuredCUSDT).equals(cUsdt.address);
    });
  });

  describe("getUnderlyingPrice", () => {

    let setAndVerifyBackingPrice = async (cToken, price) => {
      await backingOracle.setUnderlyingPrice(cToken.address, toEBN(etherMantissa(price)));

      let backingOraclePrice = await backingOracle.assetPrices(cToken.helperUnderlying.address);

      expect(backingOraclePrice).equals(toEBN(new BigNumber(price).times('1000000000000000000')));
    };

    let readAndVerifyProxyPrice = async (token, price) =>{
      let proxyPrice = await oracle.getUnderlyingPrice(token.address);
      expect(proxyPrice).equals(toEBN(new BigNumber(price).times('1000000000000000000')));
    };

    it("always returns 1e18 for cEth", async () => {
      await readAndVerifyProxyPrice(cEth, 1);
    });

    it("uses address(1) for USDC and address(2) for cdai", async () => {

      await backingOracle.setDirectPrice(address1, toEBN(etherMantissa(5e12)));
      await backingOracle.setDirectPrice(address2, toEBN(etherMantissa(8)));
      await readAndVerifyProxyPrice(cDai, 8);
      await readAndVerifyProxyPrice(cUsdc, 5e12);
      await readAndVerifyProxyPrice(cUsdt, 5e12);
    });

    it("proxies for whitelisted tokens", async () => {
      await setAndVerifyBackingPrice(cOther, 11);
      await readAndVerifyProxyPrice(cOther, 11);

      await setAndVerifyBackingPrice(cOther, 37);
      await readAndVerifyProxyPrice(cOther, 37);
    });

    it("returns 0 for token without a price", async () => {
      let unlistedToken = await makeCToken({comptroller: cEth.helperComptroller});

      await readAndVerifyProxyPrice(unlistedToken, 0);
    });

    it("correctly handle setting SAI price", async () => {
      await backingOracle.setDirectPrice(daiOracleKey, toEBN(etherMantissa(0.01)));

      await readAndVerifyProxyPrice(cDai, 0.01);
      await readAndVerifyProxyPrice(cSai, 0.01);

      await oracle.setSaiPrice(toEBN(etherMantissa(0.05)));

      await readAndVerifyProxyPrice(cDai, 0.01);
      await readAndVerifyProxyPrice(cSai, 0.05);

      await expect(oracle.setSaiPrice(1)).to.be.revertedWith('SAI price may only be set once');
    });

    it("only guardian may set the sai price", async () => {
      await expect(oracle.connect(accounts[0]).setSaiPrice(1)).to.be.revertedWith("only guardian may set the SAI price");
    });

    it("sai price must be bounded", async () => {
      await expect(oracle.setSaiPrice(toEBN(etherMantissa(10)))).to.be.revertedWith('SAI price must be < 0.1 ETH');
    });
  });
});
