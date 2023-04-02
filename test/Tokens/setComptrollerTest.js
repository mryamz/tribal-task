const { expect } = require('chai');
const { ethers } = require('hardhat');
const { TokenErr } = require('../Errors');
const {
  makeComptroller,
  makeCToken
} = require('../Utils/Compound');
const { getEvents, deepEqual, toEBN } = require('../Utils/Ethereum');

describe('CToken', function () {
  let root, accounts;
  let cToken, oldComptroller, newComptroller;
  beforeEach(async () => {
    [root, ...accounts] = await ethers.getSigners();
    cToken = await makeCToken();
    oldComptroller = cToken.helperComptroller;
    newComptroller = await makeComptroller();
    expect(newComptroller.address).not.equal(oldComptroller.address);
  });

  describe('_setComptroller', () => {
    it("should fail if called by non-admin", async () => {
      const tx = await cToken.connect(accounts[0])._setComptroller(newComptroller.address);
      const events = await getEvents(tx);
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.UNAUTHORIZED)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.SET_COMPTROLLER_OWNER_CHECK)))).equals(true)
      expect(await cToken.comptroller()).equals(oldComptroller.address);
    });

    it("reverts if passed a contract that doesn't implement isComptroller", async () => {
      await expect(cToken._setComptroller(cToken.helperUnderlying.address)).to.be.reverted;
      expect(await cToken.comptroller()).equals(oldComptroller.address);
    });

    it("reverts if passed a contract that implements isComptroller as false", async () => {
      // extremely unlikely to occur, of course, but let's be exhaustive
      const badComptroller = await makeComptroller({ kind: 'false-marker' });
      await expect(cToken._setComptroller(badComptroller.address)).to.be.revertedWith("marker method returned false");
      expect(await cToken.comptroller()).equals(oldComptroller.address);
    });

    it("updates comptroller and emits log on success", async () => {
      const result = await cToken._setComptroller(newComptroller.address);
      const events = await getEvents(result);

      expect(!events.includes('Failure')).equals(true)
      expect(events.includes('NewComptroller')).equals(true)
      expect(events.includes(oldComptroller.address)).equals(true)
      expect(events.includes(newComptroller.address)).equals(true)

      expect(await cToken.comptroller()).equals(newComptroller.address);
    });
  });
});
