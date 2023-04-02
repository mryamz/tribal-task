const { expect } = require("chai");
const {address} = require('../Utils/Ethereum');
const {hre} = require("hardhat")

describe('admin / _setPendingAdmin / _acceptAdmin', () => {
  let root, accounts;
  let comptroller, _comptroller;
  //  factory    , _instance;
  beforeEach(async () => {
    [root, ...accounts] = await ethers.getSigners();
    comptroller = await ethers.getContractFactory('Unitroller');
    comptroller.signer = root;
    _comptroller = await comptroller.deploy();
  });

  describe('admin()', () => {
    it('should return correct admin', async () => {

      _admin = await _comptroller.admin();
      expect(_admin).equal(root.address);
    });
  });

  describe('pendingAdmin()', () => {
    it('should return correct pending admin', async () => {
      _zero = await _comptroller.pendingAdmin();
      expect(_zero).equal(ethers.constants.AddressZero);
    });
  });
  
  describe('_setPendingAdmin()', () => {
    it('should only be callable by admin', async () => {
        _comptroller = _comptroller.connect(accounts[0]);
        await _comptroller._setPendingAdmin(accounts[0].address);
        
        // Check admin stays the same
        expect(await _comptroller.admin()).equal(root.address);
        expect(await _comptroller.pendingAdmin()).equal(ethers.constants.AddressZero);
      });
      
      it('should properly set pending admin', async () => {
        await _comptroller._setPendingAdmin(accounts[0].address);
        
        // Check admin stays the same
        expect(await _comptroller.admin()).equal(root.address);
        expect(await _comptroller.pendingAdmin()).equal(accounts[0].address);
      });
      
      it('should properly set pending admin twice', async () => {
        await _comptroller._setPendingAdmin(accounts[0].address);
        await _comptroller._setPendingAdmin(accounts[1].address);
        
        // Check admin stays the same
        expect(await _comptroller.admin()).equal(root.address);
        expect(await _comptroller.pendingAdmin()).equal(accounts[1].address);
      });
      
      it('should emit event', async () => {
        result = await _comptroller._setPendingAdmin(accounts[0].address);
        
        await expect(result).to.emit(_comptroller, "NewPendingAdmin").withArgs(ethers.constants.AddressZero, accounts[0].address);
    });
    
    describe('_acceptAdmin()', () => {
      it('should fail when pending admin is zero', async () => {
        await _comptroller._acceptAdmin();        
        // Check admin stays the same
        expect(await _comptroller.admin()).equal(root.address);
        expect(await _comptroller.pendingAdmin()).equal(ethers.constants.AddressZero);
      });
      
      it('should fail when called by another account (e.g. root)', async () => {
        await _comptroller._setPendingAdmin(accounts[0].address);
        await _comptroller._acceptAdmin();
        
        // Check admin stays the same
        expect(await _comptroller.admin()).equal(root.address);
        expect(await _comptroller.pendingAdmin()).equal(accounts[0].address);
      });
      
      it('should succeed and set admin and clear pending admin', async () => {
        await _comptroller._setPendingAdmin(accounts[0].address);
        
        _comptroller = _comptroller.connect(accounts[0]);
        _comptroller._acceptAdmin();
        
        // Check admin stays the same
        expect(await _comptroller.admin()).equal(accounts[0].address);
        expect(await _comptroller.pendingAdmin()).equal(ethers.constants.AddressZero);
      });
      
      it('should emit log on success', async () => {
        await _comptroller._setPendingAdmin(accounts[0].address);
  
        _comptroller = _comptroller.connect(accounts[0]);
        result = _comptroller._acceptAdmin();

        await expect(result).to.emit(_comptroller, "NewAdmin").withArgs(root.address, accounts[0].address);
        await expect(result).to.emit(_comptroller, "NewPendingAdmin").withArgs(accounts[0].address, ethers.constants.AddressZero);
      });
    });
  });
});
