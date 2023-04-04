const { expect } = require('chai');

const { address, both, etherMantissa } = require('../Utils/Ethereum');
const { makeComptroller, makeCToken } = require('../Utils/Compound');

const { ComptrollerErr } = require('../Errors');

describe('Comptroller', () => {
  let comptroller, cToken;
  let root, accounts;

  beforeEach(async () => {
    [root, ...accounts] = await ethers.getSigners();
  });

  describe("_setPauseGuardian", () => {
    beforeEach(async () => {
      comptroller = await makeComptroller();
    });

    describe("failing", () => {
      it("emits a failure log if not sent by admin", async () => {
        let result = await comptroller.connect(accounts[1])._setPauseGuardian(root.address);
        expect(result).to.emit(comptroller, 'Failure').withArgs(ComptrollerErr.Error.UNAUTHORIZED, ComptrollerErr.FailureInfo.SET_PAUSE_GUARDIAN_OWNER_CHECK, 0);
      });

      it("does not change the pause guardian", async () => {
        let pauseGuardian = await comptroller.pauseGuardian();
        expect(pauseGuardian).to.be.equal(address(0));
        await comptroller.connect(accounts[1])._setPauseGuardian(root.address);

        pauseGuardian = await comptroller.pauseGuardian();
        expect(pauseGuardian).to.be.equal(address(0));
      });
    });

    describe('succesfully changing pause guardian', () => {
      let result;

      beforeEach(async () => {
        comptroller = await makeComptroller();

        result = await comptroller._setPauseGuardian(accounts[1].address);
      });

      it('emits new pause guardian event', async () => {
        expect(result).to.emit(comptroller, 'NewPauseGuardian')
          .withArgs(address(0), accounts[1].address);
      });

      it('changes pending pause guardian', async () => {
        let pauseGuardian = await comptroller.pauseGuardian();
        expect(pauseGuardian).to.be.equal(accounts[1].address);
      });
    });
  });

  describe('setting paused', () => {
    beforeEach(async () => {
      cToken = await makeCToken({supportMarket: true});
      comptroller = cToken.helperComptroller;
    });

    let globalMethods = ["Transfer", "Seize"];
    describe('succeeding', () => {
      let pauseGuardian;
      beforeEach(async () => {
        pauseGuardian = accounts[1];
        await comptroller.connect(root)._setPauseGuardian(accounts[1].address);
      });

      globalMethods.forEach(async (method) => {
        it(`only pause guardian or admin can pause ${method}`, async () => {

          await expect(
            comptroller.connect(accounts[2])[`_set${method}Paused`](true)
          ).to.be.revertedWith("only pause guardian and admin can pause");

          await expect(
            comptroller.connect(accounts[2])[`_set${method}Paused`](false)
          ).to.be.revertedWith("only pause guardian and admin can pause");
        });

        it(`PauseGuardian can pause of ${method}GuardianPaused`, async () => {
          result = comptroller.connect(pauseGuardian)[`_set${method}Paused`](true);
          var receipt = await ((await result).wait());
          var eventName = receipt.events[0].event;
          var eventEmmitions = receipt.events[0].args;
          expect(eventName).equals("ActionPaused");
          expect(eventEmmitions[0]).equals(method);
          expect(eventEmmitions[1]).equals(true);
          expect(receipt.events.length).equals(1)

          let camelCase = method.charAt(0).toLowerCase() + method.substring(1);

          state = await comptroller[`${camelCase}GuardianPaused`]();
          expect(state).to.be.equal(true);

          await expect(comptroller.connect(pauseGuardian)[`_set${method}Paused`](false))
            .to.be.revertedWith("only pause guardian and admin can pause");
          result = comptroller[`_set${method}Paused`](false);


          // TODO: Make this code block and 3 others DRY
          receipt = await ((await result).wait());
          eventName = receipt.events[0].event;
          eventEmmitions = receipt.events[0].args;
          expect(eventName).equals("ActionPaused");
          expect(eventEmmitions[0]).equals(method);
          expect(eventEmmitions[1]).equals(false);
          expect(receipt.events.length).equals(1)

          state = await comptroller[`${camelCase}GuardianPaused`]();
          expect(state).to.be.equal(false);
        });

        it(`pauses ${method}`, async() => {
          await comptroller.connect(pauseGuardian)[`_set${method}Paused`](true);
          switch (method) {
          case "Transfer":
            await expect(
              comptroller.transferAllowed(address(1), address(2), address(3), 1)
            ).to.be.revertedWith(`${method.toLowerCase()} is paused`);
            break;

          case "Seize":
            await expect(
              comptroller.seizeAllowed(address(1), address(2), address(3), address(4), 1)
            ).to.be.revertedWith(`${method.toLowerCase()} is paused`);
            break;

          default:
            break;
          }
        });
      });
    });

    let marketMethods = ["Borrow", "Mint"];
    describe('succeeding', () => {
      let pauseGuardian;
      beforeEach(async () => {
        pauseGuardian = accounts[1];
        await comptroller.connect(root)._setPauseGuardian(accounts[1].address);
      });

      marketMethods.forEach(async (method) => {
        it(`only pause guardian or admin can pause ${method}`, async () => {
          await expect(
            comptroller.connect(accounts[2])[`_set${method}Paused`](cToken.address, true)
          ).to.be.revertedWith("only pause guardian and admin can pause");
          await expect(
            comptroller.connect(accounts[2])[`_set${method}Paused`](cToken.address, false)
          ).to.be.revertedWith("only pause guardian and admin can pause");
        });

        it(`PauseGuardian can pause of ${method}GuardianPaused`, async () => {
          result = comptroller.connect(pauseGuardian)[`_set${method}Paused`](cToken.address, true);

          // There should be 1 event, ActionPaused, that gets raised in the decoded bloomFilter
          var receipt = await ((await result).wait());
          var eventName = receipt.events[0].event;
          var eventEmmitions = receipt.events[0].args;
          expect(eventName).equals("ActionPaused");
          expect(eventEmmitions[0]).equals(cToken.address);
          expect(eventEmmitions[1]).equals(method);
          expect(eventEmmitions[2]).equals(true);
          expect(receipt.events.length).equals(1)


          //await expect(result).to.emit(comptroller, "ActionPaused").withArgs(cToken.address, method, true);

          let camelCase = method.charAt(0).toLowerCase() + method.substring(1);

          state = await comptroller[`${camelCase}GuardianPaused`](cToken.address);
          expect(state).to.be.equal(true);

          await expect(comptroller.connect(pauseGuardian)[`_set${method}Paused`](cToken.address, false)).to.be.revertedWith("only pause guardian and admin can pause");
          result = await comptroller[`_set${method}Paused`](cToken.address, false);


          // This code block is wet
          receipt = await ((await result).wait());
          eventName = receipt.events[0].event;
          eventEmmitions = receipt.events[0].args;
          expect(eventName).equals("ActionPaused");
          expect(eventEmmitions[0]).equals(cToken.address);
          expect(eventEmmitions[1]).equals(method);
          expect(eventEmmitions[2]).equals(false);
          expect(receipt.events.length).equals(1)

          state = await comptroller[`${camelCase}GuardianPaused`](cToken.address);
          expect(state).to.be.equal(false);
        });

        it(`pauses ${method}`, async() => {
          await comptroller.connect(pauseGuardian)[`_set${method}Paused`](cToken.address, true);
          switch (method) {
          case "Mint":
            const mintAllowedTx = await comptroller.callStatic.mintAllowed(address(1), address(2), 1)
            expect(mintAllowedTx.toString()).equals(ComptrollerErr.Error.MARKET_NOT_LISTED)
            await expect(
              comptroller.mintAllowed(cToken.address, address(2), 1)
            ).to.be.revertedWith(`${method.toLowerCase()} is paused`);
            break;

          case "Borrow":
            const tx = await comptroller.callStatic.borrowAllowed(address(1), address(2), 1);
            expect(tx.toString()).equals(ComptrollerErr.Error.MARKET_NOT_LISTED);
            await expect(
              comptroller.borrowAllowed(cToken.address, address(2), 1)
            ).to.be.revertedWith(`${method.toLowerCase()} is paused`);
            break;

          default:
            break;
          }
        });
      });
    });
  });
});
