const { expect } = require('chai');
const { ethers } = require('hardhat');
const { ComptrollerErr, TokenErr } = require('../Errors');
const {makeCToken} = require('../Utils/Compound');
const { getEvents, deepEqual, toEBN } = require('../Utils/Ethereum');

describe('CToken', function () {
  let root, accounts;
  beforeEach(async () => {
    [root, ...accounts] = await ethers.getSigners();
  });

  describe('transfer', () => {
    it("cannot transfer from a zero balance", async () => {
      const cToken = await makeCToken({supportMarket: true});
      expect(await cToken.balanceOf(root.address)).equals(0);
      const tx = await cToken.transfer(accounts[0].address, 100);
      const events = await getEvents(tx);
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.MATH_ERROR)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.TRANSFER_NOT_ENOUGH)))).equals(true)
    });

    it("transfers 50 tokens", async () => {
      const cToken = await makeCToken({supportMarket: true});
      await cToken.harnessSetBalance(root.address, 100);
      expect(await cToken.balanceOf(root.address)).equals(100);
      await cToken.transfer(accounts[0].address, 50);
      expect(await cToken.balanceOf(root.address)).equals(50);
      expect(await cToken.balanceOf(accounts[0].address)).equals(50);
    });

    it("doesn't transfer when src == dst", async () => {
      const cToken = await makeCToken({supportMarket: true});
      await cToken.harnessSetBalance(root.address, 100);
      expect(await cToken.balanceOf(root.address)).equals(100);
      const tx = await cToken.transfer(root.address, 50);
      const events = await getEvents(tx);
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.BAD_INPUT)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.TRANSFER_NOT_ALLOWED)))).equals(true)
    });

    it("rejects transfer when not allowed and reverts if not verified", async () => {
      const cToken = await makeCToken({comptrollerOpts: {kind: 'bool'}});
      await cToken.harnessSetBalance(root.address, 100);
      expect(await cToken.balanceOf(root.address)).equals(100);

      await cToken.helperComptroller.setTransferAllowed(false);
      const tx = await cToken.transfer(root.address, 50);
      const events = await getEvents(tx);
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.TRANSFER_COMPTROLLER_REJECTION)))).equals(true)

      await cToken.helperComptroller.setTransferAllowed(true);
      await cToken.helperComptroller.setTransferVerify(false);
      // no longer support verifyTransfer on cToken end
      // await expect(send(cToken, 'transfer', [accounts[0], 50])).rejects.toRevert("revert transferVerify rejected transfer");
    });
  });
});