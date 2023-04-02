const { ethers } = require('hardhat');
const { expect } = require('chai');
const BigNumber = require('bignumber.js');
const { TokenErr } = require('../Errors');
const {address} = require('../Utils/Ethereum');
const {makeCToken} = require('../Utils/Compound');

describe('admin / _setPendingAdmin / _acceptAdmin', () => {
  let cToken, root, accounts;

  beforeEach(async () => {
    [root, ...accounts] = await ethers.getSigners();
    cToken = await makeCToken();
  });

  describe('admin()', () => {
    it('should return correct admin', async () => {
      expect(await cToken.admin()).equals(root.address);
    });
  });

  describe('pendingAdmin()', () => {
    it('should return correct pending admin', async () => {
      expect(await cToken.pendingAdmin()).equals(ethers.constants.AddressZero);
    });
  });

  describe('_setPendingAdmin()', () => {
    it('should only be callable by admin', async () => {
      const tx = cToken.connect(accounts[0])._setPendingAdmin(accounts[0].address);
      await expect(tx).to.emit(cToken, 'Failure').withArgs(TokenErr.Error.UNAUTHORIZED, TokenErr.FailureInfo.SET_PENDING_ADMIN_OWNER_CHECK, 0);
      // Check admin stays the same
      expect(await cToken.admin()).equals(root.address);
      expect(await cToken.pendingAdmin()).equals(ethers.constants.AddressZero);
    });

    it('should properly set pending admin', async () => {
      expect(await cToken.callStatic._setPendingAdmin(accounts[0].address)).equals(TokenErr.Error.NO_ERROR);
      await cToken._setPendingAdmin(accounts[0].address);
      // Check admin stays the same
      expect(await cToken.admin()).equals(root.address);
      expect(await cToken.pendingAdmin()).equals(accounts[0].address);
    });

    it('should properly set pending admin twice', async () => {
      expect(await cToken.callStatic._setPendingAdmin(accounts[0].address)).equals(TokenErr.Error.NO_ERROR);
      expect(await cToken.callStatic._setPendingAdmin(accounts[1].address)).equals(TokenErr.Error.NO_ERROR);
      await cToken._setPendingAdmin(accounts[0].address);
      await cToken._setPendingAdmin(accounts[1].address);

      // Check admin stays the same
      expect(await cToken.admin()).equals(root.address);
      expect(await cToken.pendingAdmin()).equals(accounts[1].address);
    });

    it('should emit event', async () => {
      const tx = await cToken._setPendingAdmin(accounts[0].address);
      await expect(tx).to.emit(cToken, 'NewPendingAdmin').withArgs(ethers.constants.AddressZero, accounts[0].address);
    });
  });

  describe('_acceptAdmin()', () => {
    it('should fail when pending admin is zero', async () => {
      const txPromise = cToken._acceptAdmin();
      await expect(txPromise).to.emit(cToken, 'Failure').withArgs(TokenErr.Error.UNAUTHORIZED, TokenErr.FailureInfo.ACCEPT_ADMIN_PENDING_ADMIN_CHECK, 0);

      // Check admin stays the same
      expect(await cToken.admin()).equals(root.address);
      expect(await cToken.pendingAdmin()).equals(ethers.constants.AddressZero);
    });

    it('should fail when called by another account (e.g. root)', async () => {
      expect(await cToken.callStatic._setPendingAdmin(accounts[0].address)).equals(TokenErr.Error.NO_ERROR);
      await cToken._setPendingAdmin(accounts[0].address);
      await expect(cToken._acceptAdmin()).to.emit(cToken, 'Failure').withArgs(TokenErr.Error.UNAUTHORIZED, TokenErr.FailureInfo.ACCEPT_ADMIN_PENDING_ADMIN_CHECK, 0);


      // Check admin stays the same
      expect(await cToken.admin()).equals(root.address);
      expect(await cToken.pendingAdmin()).equals(accounts[0].address);
    });

    it('should succeed and set admin and clear pending admin', async () => {
      expect(await cToken.callStatic._setPendingAdmin(accounts[0].address)).equals(TokenErr.Error.NO_ERROR);
      await cToken._setPendingAdmin(accounts[0].address);

      expect(await cToken.connect(accounts[0]).callStatic._acceptAdmin()).equals(TokenErr.Error.NO_ERROR);
      await cToken.connect(accounts[0])._acceptAdmin();

      // Check admin stays the same
      expect(await cToken.admin()).equals(accounts[0].address);
      expect(await cToken.pendingAdmin()).equals(ethers.constants.AddressZero);
    });

    it('should emit log on success', async () => {
      await cToken._setPendingAdmin(accounts[0].address);
      expect(await cToken.callStatic._setPendingAdmin(accounts[0].address)).equals(TokenErr.Error.NO_ERROR);

      const txPromise = cToken.connect(accounts[0])._acceptAdmin();
      await expect(txPromise).to.emit(cToken, 'NewAdmin').withArgs(root.address, accounts[0].address);
      await expect(txPromise).to.emit(cToken, 'NewPendingAdmin').withArgs(accounts[0].address, ethers.constants.AddressZero);
    });
  });
});
