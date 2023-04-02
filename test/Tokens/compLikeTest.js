const { ethers } = require('hardhat');
const { expect } = require('chai');
const {
  makeCToken,
} = require('../Utils/Compound');


describe('CCompLikeDelegate', function () {
  describe("_delegateCompLikeTo", () => {
    it("does not delegate if not the admin", async () => {
      const [root, a1] = await ethers.getSigners();
      const cToken = await makeCToken({kind: 'ccomp'});
      const txPromise = cToken.connect(a1)._delegateCompLikeTo(a1.address);
      await expect(txPromise).to.be.revertedWith('only the admin may set the comp-like delegate');
    });

    it("delegates successfully if the admin", async () => {
      const [root, a1] = await ethers.getSigners(), amount = 1;
      const cCOMP = await makeCToken({kind: 'ccomp'}), COMP = cCOMP.helperUnderlying;
      const tx1 = await cCOMP._delegateCompLikeTo(a1.address);
      const tx2 = await COMP.transfer(cCOMP.address, amount);
      expect(await COMP.callStatic.getCurrentVotes(a1.address)).equals(amount);
    });
  });
});