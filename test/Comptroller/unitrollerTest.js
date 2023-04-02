const { ComptrollerErr } = require('../Errors');
const { expect } = require('chai');
const { ethers } = require('hardhat');

const {
  address,
  etherMantissa
} = require('../Utils/Ethereum');

const {
  makeComptroller,
  makePriceOracle
} = require('../Utils/Compound');

describe('Unitroller', () => {
  let root, accounts;
  let unitroller;
  let brains;
  let oracle;

  beforeEach(async () => {
    [root, ...accounts] =   await ethers.getSigners();
    oracle              =   await makePriceOracle();
    const Brains        =   await ethers.getContractFactory('ComptrollerG1');
    brains              =   await Brains.deploy();
    const Unitroller    =   await ethers.getContractFactory('Unitroller');
    unitroller          =   await Unitroller.deploy();
  });

  let setPending = (implementation, from) => {
    return unitroller.connect(from)._setPendingImplementation(implementation.address);
  };

  describe("constructor", () => {
    it("sets admin to caller and addresses to 0", async () => {
      expect(await unitroller.admin()).equals(root.address);
      expect(await unitroller.pendingAdmin()).equals(ethers.constants.AddressZero);
      expect(await unitroller.pendingComptrollerImplementation()).equals(ethers.constants.AddressZero);
      expect(await unitroller.comptrollerImplementation()).equals(ethers.constants.AddressZero);
    });
  });

  describe("_setPendingImplementation", () => {
    describe("Check caller is admin", () => {
      let result;
      beforeEach(async () => {
        result = await setPending(brains, accounts[1]);
      });

      it("emits a failure log", async () => {
        const eventEmmitions = (await result.wait()).events;
        const eventArgs = eventEmmitions[0].args;
        expect(eventEmmitions[0].event).equals('Failure');
        expect(eventArgs[0]).equals(ComptrollerErr.Error.UNAUTHORIZED);
        expect(eventArgs[1]).equals(ComptrollerErr.FailureInfo.SET_PENDING_IMPLEMENTATION_OWNER_CHECK);
        expect(eventEmmitions.length).equals(1);
      });

      it("does not change pending implementation address", async () => {
        expect(await unitroller.pendingComptrollerImplementation()).equals(ethers.constants.AddressZero);
      });
    });

    describe("succeeding", () => {
      it("stores pendingComptrollerImplementation with value newPendingImplementation", async () => {
        await setPending(brains, root);
        expect(await unitroller.pendingComptrollerImplementation()).equals(brains.address);
      });

      it("emits NewPendingImplementation event", async () => {

        const transaction = unitroller._setPendingImplementation(brains.address);

        await expect(transaction).to.emit(unitroller, 'NewPendingImplementation').withArgs(ethers.constants.AddressZero, brains.address);

        
      });
    });
  });

  describe("_acceptImplementation", () => {
    describe("Check caller is pendingComptrollerImplementation  and pendingComptrollerImplementation ≠ address(0) ", () => {
      let result;
      beforeEach(async () => {
        await setPending(unitroller, root);
        result = unitroller._acceptImplementation();
      });

      it("emits a failure log", async () => {
        await expect(result).to.emit(unitroller, 'Failure').withArgs(ComptrollerErr.Error.UNAUTHORIZED, ComptrollerErr.FailureInfo.ACCEPT_PENDING_IMPLEMENTATION_ADDRESS_CHECK, 0);
      });

      it("does not change current implementation address", async () => {
        expect(await unitroller.comptrollerImplementation()).not.equals(unitroller.address);
      });
    });


    describe("the brains must accept the responsibility of implementation", () => {
      let result;
      beforeEach(async () => {
        await setPending(brains, root);
        
        result = brains._become(unitroller.address, oracle.address, ethers.BigNumber.from(etherMantissa(.051).toString()), 10, false);
        await expect(result).to.not.emit(brains, 'Failure');
      });

      it("Store comptrollerImplementation with value pendingComptrollerImplementation", async () => {
        expect(await unitroller.comptrollerImplementation()).equals(brains.address);
      });

      it("Unset pendingComptrollerImplementation", async () => {
        expect(await unitroller.pendingComptrollerImplementation()).equals(ethers.constants.AddressZero);
      });


    });

    describe("fallback delegates to brains", () => {
      let troll;
      beforeEach(async () => {
        const Unitroller = await ethers.getContractFactory('Unitroller');
        unitroller = await Unitroller.deploy();
        await unitroller.deployed();
        
        const Troll = await ethers.getContractFactory('EchoTypesComptroller');
        troll = await Troll.deploy();

        await setPending(troll, root);
        await troll.becomeBrains(unitroller.address);
      });

      it("forwards reverts", async () => {
        const result = troll.reverty();
        await expect(result).to.be.revertedWith("gotcha sucka");
      });

      it("gets addresses", async () => {
        expect(await troll.addresses(troll.address)).equals(troll.address);
      });

      it("gets strings", async () => {
        expect(await troll.stringy('yeet')).equals("yeet");
      });

      it("gets bools", async () => {
        expect(await troll.booly(true)).equals(true);
      });

      it("gets list of ints", async () => {
        expect(await troll.listOInts([1,2,3])).to.eql([ethers.BigNumber.from("1"), ethers.BigNumber.from("2"), ethers.BigNumber.from("3")]);
      });
    });
  });
});
