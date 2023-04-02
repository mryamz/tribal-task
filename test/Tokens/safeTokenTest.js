const { ethers } = require('hardhat');
const { expect } = require('chai');
const {
  makeCToken,
  getBalances,
  adjustBalances,
} = require('../Utils/Compound');
const { getEvents,toEBN, toBN } = require('../Utils/Ethereum');

const exchangeRate = 5;

describe('CEther', function () {
  let root, nonRoot, accounts;
  let cToken;
  beforeEach(async () => {
    [root, nonRoot, ...accounts] = await ethers.getSigners();
    cToken = await makeCToken({kind: 'cether', comptrollerOpts: {kind: 'bool'}});
  });

  describe("getCashPrior", () => {
    it("returns the amount of ether held by the cEther contract before the current message", async () => {
      expect(await cToken.callStatic.harnessGetCashPrior({value: 100})).equals(0);
    });
  });

  describe("doTransferIn", () => {
    it("succeeds if from is msg.nonRoot and amount is msg.value", async () => {

      expect(await cToken.callStatic.harnessDoTransferIn(root.address, 100, {value: 100})).equals(100);
    });

    it("reverts if from != msg.sender", async () => {
      await expect(cToken.harnessDoTransferIn(nonRoot.address, 100, {value: 100})).to.be.revertedWith("sender mismatch");
    });

    it("reverts if amount != msg.value", async () => {
      await expect(cToken.harnessDoTransferIn(root.address, 77, {value: 100})).to.be.revertedWith("value mismatch");
    });

    describe("doTransferOut", () => {
      it("transfers ether out", async () => {
        const beforeBalances = await getBalances([cToken], [nonRoot]);
        const tx = await cToken.harnessDoTransferOut(nonRoot.address, 77, {value: 77});
        const events = await getEvents(tx);
        expect(!events.includes('Failure')).equals(true);
        const afterBalances = await getBalances([cToken], [nonRoot]);
        const adjustedBalances = await adjustBalances(beforeBalances, [
          [cToken.address, nonRoot.address, 'eth', toBN(77)]
        ]);
        expect(afterBalances).to.eql(adjustedBalances)
      });

      it("reverts if it fails", async () => {
        await expect(cToken.harnessDoTransferOut(root.address, 77, {value: 0})).to.be.reverted;
      });
    });
  });
});
