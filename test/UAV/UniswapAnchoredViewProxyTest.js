const { expect } = require('chai');
const { keccak256, toUtf8Bytes, parseEther, parseUnits } = require('ethers/lib/utils');
const { ethers } = require('hardhat');
const { address } = require('../Utils/Ethereum');

describe.skip('UniswapAnchorViewProxyTest', () => {
  let root, accounts
  let uav, uavProxy;

  beforeEach(async () => {
    [root, ...accounts] = await ethers.getSigners();

    // dummy data for Mock UAV
    const cToken = {XTZ: address(1), HDAO: address(2)};
    const tokenConfigs = [
        {cToken: cToken.XTZ,  underlying: address(5), symbolHash: keccak256(toUtf8Bytes('XTZ')),  baseUnit: parseEther("1"), priceSource: 2, fixedPrice: 0, uniswapMarket: address(3), reporter: address(7), reporterMultiplier: parseUnits("1", 16), isUniswapReversed: false},
        {cToken: cToken.HDAO, underlying: address(6), symbolHash: keccak256(toUtf8Bytes('HDAO')), baseUnit: parseEther("1"), priceSource: 2, fixedPrice: 0, uniswapMarket: address(4), reporter: address(7), reporterMultiplier: parseUnits("1", 16), isUniswapReversed: false},
      ];

    const UAV = await ethers.getContractFactory("MockUniswapAnchoredView")
    uav = await UAV.deploy(tokenConfigs)
    await uav.deployed()

    const UAVProxy = await ethers.getContractFactory("UniswapAnchoredViewProxy")
    uavProxy = await UAVProxy.deploy(uav.address);
    await uavProxy.deployed()

  });

  describe('Read Prices Correctly', () => {
    it('succeeds at pointing to correct UAV', async () => {
        expect(await uavProxy.uav()).equals(uav.address)
    });
  });
});
