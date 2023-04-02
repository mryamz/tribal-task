const { ethers } = require('hardhat');
const { expect } = require('chai');
const BigNumber = require('bignumber.js');

const {
  etherUnsigned,
  etherMantissa,
  UInt256Max,
  getEvents,
  toEBN,
  deepEqual
} = require('../Utils/Ethereum');

const {
  makeCToken,
  balanceOf,
  borrowSnapshot,
  totalBorrows,
  fastForward,
  setBalance,
  preApprove,
  pretendBorrow
} = require('../Utils/Compound');

const { TokenErr, ComptrollerErr } = require('../Errors');

const borrowAmount = etherUnsigned(10e3);
const repayAmount = etherUnsigned(10e2);

async function preBorrow(cToken, borrower, borrowAmount) {
  await cToken.helperComptroller.setBorrowAllowed(true);
  await cToken.helperComptroller.setBorrowVerify(true);
  await cToken.helperInterestRateModel.setFailBorrowRate(false);
  await cToken.helperUnderlying.harnessSetBalance(cToken.address, borrowAmount);
  await cToken.harnessSetFailTransferToAddress(borrower.address, false);
  await cToken.harnessSetAccountBorrows(borrower.address, 0, 0);
  await cToken.harnessSetTotalBorrows(0);
}

async function borrowFresh(cToken, borrower, borrowAmount) {
  return cToken.connect(borrower).harnessBorrowFresh(borrower.address, borrowAmount);
}

async function borrow(cToken, borrower, borrowAmount, opts = {}) {
  await cToken.harnessFastForward(1);
  return cToken.connect(borrower).borrow(borrowAmount);
}

async function preRepay(cToken, benefactor, borrower, repayAmount) {
  // setup either benefactor OR borrower for success in repaying
  await cToken.helperComptroller.setRepayBorrowAllowed(true);
  await cToken.helperComptroller.setRepayBorrowVerify(true);
  await cToken.helperInterestRateModel.setFailBorrowRate(false);
  await cToken.helperUnderlying.harnessSetFailTransferFromAddress(benefactor.address, false);
  await cToken.helperUnderlying.harnessSetFailTransferFromAddress(borrower.address, false);
  await pretendBorrow(cToken, borrower, 1, 1, repayAmount);
  await preApprove(cToken, benefactor, repayAmount);
  await preApprove(cToken, borrower, repayAmount);
}


async function repayBorrowFresh(cToken, payer, borrower, repayAmount) {
  const txPromise = cToken.connect(payer).harnessRepayBorrowFresh(payer.address, borrower.address, repayAmount);
  return txPromise;
}

async function repayBorrow(cToken, borrower, repayAmount) {
  // make sure to have a block delta so we accrue interest
  await send(cToken, 'harnessFastForward', [1]);
  return send(cToken, 'repayBorrow', [repayAmount], {from: borrower});
}

async function repayBorrow(cToken, borrower, repayAmount) {
  await cToken.harnessFastForward(1);
  const txPromise = cToken.connect(borrower).repayBorrow(repayAmount);
  return txPromise;
}

async function repayBorrowBehalf(cToken, payer, borrower, repayAmount) {
  await cToken.harnessFastForward(1);
  const txPromise = cToken.connect(payer).repayBorrowBehalf(borrower.address, repayAmount);
  return txPromise;
}

describe('CToken', function () {
  let cToken, root, borrower, benefactor, accounts;
  beforeEach(async () => {
    [root, borrower, benefactor, ...accounts] = await ethers.getSigners();
    cToken = await makeCToken({comptrollerOpts: {kind: 'bool'}});
  });

  describe('borrowFresh', () => {
    beforeEach(async () => await preBorrow(cToken, borrower, toEBN(borrowAmount)));

    it("fails if comptroller tells it to", async () => {
      await cToken.helperComptroller.setBorrowAllowed(false);
      const tx = await borrowFresh(cToken, borrower, toEBN(borrowAmount));
      const events = await getEvents(tx);
      expect(events.includes('Failure')).equals(true);
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.BORROW_COMPTROLLER_REJECTION)))).equals(true);
    });

    it("proceeds if comptroller tells it to", async () => {
      const tx = await borrowFresh(cToken, borrower, toEBN(borrowAmount));
      events = await getEvents(tx);
      expect(!events.includes('Failure')).equals(true);;
    });

    it("fails if market not fresh", async () => {
      await fastForward(cToken);
      const tx = await borrowFresh(cToken, borrower, toEBN(borrowAmount));
      const events = await getEvents(tx);
      expect(events.includes('Failure')).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.MARKET_NOT_FRESH)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.BORROW_FRESHNESS_CHECK)))).equals(true);
    });

    it("continues if fresh", async () => {
      const tx1 = await cToken.accrueInterest();
      const events1 = await getEvents(tx1);
      expect(!events1.includes('Failure')).equals(true);
      const tx2 = await borrowFresh(cToken, borrower, toEBN(borrowAmount));
      const events2 = await getEvents(tx2);
      expect(!events2.includes('Failure')).equals(true);
    });

    it("fails if error if protocol has less than borrowAmount of underlying", async () => {
      const tx = await borrowFresh(cToken, borrower, toEBN(borrowAmount.plus(1)));
      const events = await getEvents(tx);
      expect(events.includes('Failure')).equals(true);
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.TOKEN_INSUFFICIENT_CASH)))).equals(true);
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.BORROW_CASH_NOT_AVAILABLE)))).equals(true);
    });

    it("fails if borrowBalanceStored fails (due to non-zero stored principal with zero account index)", async () => {
      await pretendBorrow(cToken, borrower, 0, 3e18, 5e18);
      const tx = await borrowFresh(cToken, borrower, toEBN(borrowAmount));
      const events = await getEvents(tx);
      expect(events.includes('Failure')).equals(true);
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.MATH_ERROR)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.BORROW_ACCUMULATED_BALANCE_CALCULATION_FAILED)))).equals(true)
    });

    it("fails if calculating account new total borrow balance overflows", async () => {
      await pretendBorrow(cToken, borrower, 1e-18, 1e-18, UInt256Max().toString());
      const tx = await borrowFresh(cToken, borrower, toEBN(borrowAmount));
      const events = await getEvents(tx);
      expect(events.includes('Failure')).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.MATH_ERROR)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.BORROW_NEW_ACCOUNT_BORROW_BALANCE_CALCULATION_FAILED)))).equals(true)
    });

    it("fails if calculation of new total borrow balance overflows", async () => {
      await cToken.harnessSetTotalBorrows(UInt256Max());
      const tx = await borrowFresh(cToken, borrower, toEBN(borrowAmount));
      const events = await getEvents(tx);
      expect(events.includes('Failure')).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.MATH_ERROR)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.BORROW_NEW_TOTAL_BALANCE_CALCULATION_FAILED)))).equals(true)
    });

    it("reverts if transfer out fails", async () => {
      await cToken.harnessSetFailTransferToAddress(borrower.address, true);
      await expect(borrowFresh(cToken, borrower, toEBN(borrowAmount))).to.be.revertedWith("TOKEN_TRANSFER_OUT_FAILED");
    });

    it("transfers the underlying cash, tokens, and emits Transfer, Borrow events", async () => {
      const beforeProtocolCash = await balanceOf(cToken.helperUnderlying, cToken);
      const beforeProtocolBorrows = await totalBorrows(cToken);
      const beforeAccountCash = await balanceOf(cToken.helperUnderlying, borrower);
      const result = borrowFresh(cToken, borrower, toEBN(borrowAmount));
      const events = await getEvents(await result);


      expect(toEBN(await balanceOf(cToken.helperUnderlying, borrower))).equals(toEBN(beforeAccountCash.plus(borrowAmount)));
      expect(toEBN(await balanceOf(cToken.helperUnderlying, cToken))).equals(toEBN(beforeProtocolCash.minus(borrowAmount)));
      expect(toEBN(await totalBorrows(cToken))).equals(toEBN(beforeProtocolBorrows.plus(borrowAmount)));

      expect(events).to.eql(
      [
      'Transfer', cToken.address  , borrower.address    , toEBN(borrowAmount),
       'Borrow' , borrower.address, toEBN(borrowAmount) , toEBN(borrowAmount), toEBN(beforeProtocolBorrows.plus(borrowAmount))
      ]);
    });

    it("stores new borrow principal and interest index", async () => {
      const beforeProtocolBorrows = toEBN(await totalBorrows(cToken));
      await pretendBorrow(cToken, borrower, 0, 3, 0);
      await borrowFresh(cToken, borrower, toEBN(borrowAmount));
      const borrowSnap = await borrowSnapshot(cToken, borrower);
      expect(toEBN(borrowSnap.principal)).equals(toEBN(borrowAmount));
      expect(toEBN(borrowSnap.interestIndex)).equals(toEBN(etherMantissa(3)));
      expect(toEBN(await totalBorrows(cToken))).equals(beforeProtocolBorrows.add(toEBN(borrowAmount)));
    });
  });

  describe('borrow', () => {
    beforeEach(async () => await preBorrow(cToken, borrower, toEBN(borrowAmount)));

    it("emits a borrow failure if interest accrual fails", async () => {
      await cToken.helperInterestRateModel.setFailBorrowRate(true);
      await cToken.harnessFastForward(1);
      await expect(borrow(cToken, borrower, toEBN(borrowAmount))).to.be.revertedWith("INTEREST_RATE_MODEL_ERROR");
    });

    it("returns error from borrowFresh without emitting any extra logs", async () => {
      const tx = await borrow(cToken, borrower, toEBN(borrowAmount.plus(1)));
      const events = await getEvents(tx);
      expect(events.includes('Failure')).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.TOKEN_INSUFFICIENT_CASH)))).equals(true)
      expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.BORROW_CASH_NOT_AVAILABLE)))).equals(true)
    });

    it("returns success from borrowFresh and transfers the correct amount", async () => {
      const beforeAccountCash = await balanceOf(cToken.helperUnderlying, borrower);
      await fastForward(cToken);
      const tx = await borrow(cToken, borrower, toEBN(borrowAmount));
      const events = await getEvents(tx);
      expect(!events.includes('Failure')).equals(true)
      expect(toEBN(await balanceOf(cToken.helperUnderlying, borrower))).equals(toEBN(beforeAccountCash.plus(borrowAmount)));
    });
  });

  describe('repayBorrowFresh', () => {
    [true, false].forEach((benefactorIsPayer) => {
      let payer;
      const label = benefactorIsPayer ? "benefactor paying" : "borrower paying";
      describe(label, () => {
        beforeEach(async () => {
          payer = benefactorIsPayer ? benefactor : borrower;
          await preRepay(cToken, payer, borrower, toEBN(repayAmount));
        });

        it("fails if repay is not allowed", async () => {
          await cToken.helperComptroller.setRepayBorrowAllowed(false);
          const tx = await repayBorrowFresh(cToken, payer, borrower, toEBN(repayAmount));
          const events = await getEvents(tx);
          expect(events.includes('Failure')).equals(true);
          expect(events.some(e => deepEqual(e, toEBN(ComptrollerErr.Error.MATH_ERROR)))).equals(true)
          expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.REPAY_BORROW_COMPTROLLER_REJECTION)))).equals(true)
        });

        it("fails if block number ≠ current block number", async () => {
          await fastForward(cToken);
          const tx = await repayBorrowFresh(cToken, payer, borrower, toEBN(repayAmount));
          const events = await getEvents(tx);
          expect(events.includes('Failure')).equals(true)
          expect(events.some(e => deepEqual(e, toEBN(TokenErr.Error.MARKET_NOT_FRESH)))).equals(true)
          expect(events.some(e => deepEqual(e, toEBN(TokenErr.FailureInfo.REPAY_BORROW_FRESHNESS_CHECK)))).equals(true)
        });

        it("fails if insufficient approval", async() => {
          await preApprove(cToken, payer, 1);
          await expect(repayBorrowFresh(cToken, payer, borrower, toEBN(repayAmount))).to.be.revertedWith('Insufficient allowance');
        });

        it("fails if insufficient balance", async() => {
          await setBalance(cToken.helperUnderlying, payer, 1);
          await expect(repayBorrowFresh(cToken, payer, borrower, toEBN(repayAmount))).to.be.revertedWith('Insufficient balance');
        });


        it("returns an error if calculating account new account borrow balance fails", async () => {
          await pretendBorrow(cToken, borrower, 1, 1, 1);
          await expect(repayBorrowFresh(cToken, payer, borrower, toEBN(repayAmount))).to.be.revertedWith("REPAY_BORROW_NEW_ACCOUNT_BORROW_BALANCE_CALCULATION_FAILED");
        });

        it("returns an error if calculation of new total borrow balance fails", async () => {
          await cToken.harnessSetTotalBorrows(1);
          await expect(repayBorrowFresh(cToken, payer, borrower, toEBN(repayAmount))).to.be.revertedWith("REPAY_BORROW_NEW_TOTAL_BALANCE_CALCULATION_FAILED");
        });


        it("reverts if doTransferIn fails", async () => {
          await cToken.helperUnderlying.harnessSetFailTransferFromAddress(payer.address, true);
          await expect(repayBorrowFresh(cToken, payer, borrower, toEBN(repayAmount))).to.be.revertedWith("TOKEN_TRANSFER_IN_FAILED");
        });

        it("transfers the underlying cash, and emits Transfer, RepayBorrow events", async () => {
          const beforeProtocolCash = await balanceOf(cToken.helperUnderlying, cToken);
          const result = await repayBorrowFresh(cToken, payer, borrower, toEBN(repayAmount));
          expect(toEBN(await balanceOf(cToken.helperUnderlying, cToken))).equals(toEBN(beforeProtocolCash.plus(repayAmount)));

          expect(await getEvents(result)).to.eql([
            'Transfer', payer.address, cToken.address, toEBN(repayAmount),
            'RepayBorrow', payer.address, borrower.address, toEBN(repayAmount), toEBN(0), toEBN(0)
          ]);
        });

        it("stores new borrow principal and interest index", async () => {
          const beforeProtocolBorrows = await totalBorrows(cToken);
          const beforeAccountBorrowSnap = await borrowSnapshot(cToken, borrower);
          const tx = await repayBorrowFresh(cToken, payer, borrower, toEBN(repayAmount));
          const events = getEvents(tx);
          expect(!(await events).includes('Failure')).equals(true)
          const afterAccountBorrows = await borrowSnapshot(cToken, borrower);
          expect(toEBN(afterAccountBorrows.principal)).equals(toEBN(beforeAccountBorrowSnap.principal.minus(repayAmount)));
          expect(toEBN(afterAccountBorrows.interestIndex)).equals(toEBN(etherMantissa(1)));
          expect(toEBN(await totalBorrows(cToken))).equals(toEBN(beforeProtocolBorrows.minus(repayAmount)));
        });
      });
    });
  });

  describe('repayBorrow', () => {
    beforeEach(async () => {
      await preRepay(cToken, borrower, borrower, toEBN(repayAmount));
    });

    it("emits a repay borrow failure if interest accrual fails", async () => {
      await cToken.helperInterestRateModel.setFailBorrowRate(true);
      await expect(repayBorrow(cToken, borrower, toEBN(repayAmount))).to.be.revertedWith("INTEREST_RATE_MODEL_ERROR");
    });

    it("returns error from repayBorrowFresh without emitting any extra logs", async () => {
      await setBalance(cToken.helperUnderlying, borrower, 1);
      await expect(repayBorrow(cToken, borrower, toEBN(repayAmount))).to.be.revertedWith('Insufficient balance');
    });

    it("returns success from repayBorrowFresh and repays the right amount", async () => {
      await fastForward(cToken);
      const beforeAccountBorrowSnap = await borrowSnapshot(cToken, borrower);

      const tx = await repayBorrow(cToken, borrower, toEBN(repayAmount));
      const events = await getEvents(tx);
      expect(!events.includes('Failure')).equals(true)

      const afterAccountBorrowSnap = await borrowSnapshot(cToken, borrower);
      expect(toEBN(afterAccountBorrowSnap.principal)).equals(toEBN(beforeAccountBorrowSnap.principal.minus(repayAmount)));
    });

    it("repays the full amount owed if payer has enough", async () => {
      await fastForward(cToken);
      const tx = await repayBorrow(cToken, borrower, UInt256Max());
      const events = getEvents(tx);
      expect(!(await events).includes('Failure')).equals(true)
      const afterAccountBorrowSnap = await borrowSnapshot(cToken, borrower);
      expect(toEBN(afterAccountBorrowSnap.principal)).equals(0);
    });

    it("fails gracefully if payer does not have enough", async () => {
      await setBalance(cToken.helperUnderlying, borrower, 3);
      await fastForward(cToken);
      await expect(repayBorrow(cToken, borrower, UInt256Max())).to.be.revertedWith('Insufficient balance');
    });
  });

  describe('repayBorrowBehalf', () => {
    let payer;

    beforeEach(async () => {
      payer = benefactor;
      await preRepay(cToken, payer, borrower, toEBN(repayAmount));
    });

    it("emits a repay borrow failure if interest accrual fails", async () => {
      await cToken.helperInterestRateModel.setFailBorrowRate(true);
      await expect(repayBorrowBehalf(cToken, payer, borrower, toEBN(repayAmount))).to.be.revertedWith("INTEREST_RATE_MODEL_ERROR");
    });

    it("returns error from repayBorrowFresh without emitting any extra logs", async () => {
      await setBalance(cToken.helperUnderlying, payer, 1);
      await expect(repayBorrowBehalf(cToken, payer, borrower, toEBN(repayAmount))).to.be.revertedWith('Insufficient balance');
    });

    it("returns success from repayBorrowFresh and repays the right amount", async () => {
      await fastForward(cToken);
      const beforeAccountBorrowSnap = await borrowSnapshot(cToken, borrower);
      const tx = await repayBorrowBehalf(cToken, payer, borrower, toEBN(repayAmount));
      const events = await getEvents(tx);
      expect(!events.includes('Failure')).equals(true)
      const afterAccountBorrowSnap = await borrowSnapshot(cToken, borrower);
      expect(toEBN(afterAccountBorrowSnap.principal)).equals(toEBN(beforeAccountBorrowSnap.principal.minus(repayAmount)));
    });
  });
});
