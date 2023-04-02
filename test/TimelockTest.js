const { ethers } = require('hardhat');
const { expect } = require('chai');
const {
  encodeParameters,
  etherUnsigned,
  freezeTime,
  keccak256,
  toEBN,
  toBN,
  getCurrentBlock,
  hasEvent,
  mineBlock,
  getEvents,
  deepEqual
} = require('../test/Utils/Ethereum');
const exp = require('constants');

const oneWeekInSeconds = etherUnsigned(7 * 24 * 60 * 60);
const zero = etherUnsigned(0);
const gracePeriod = oneWeekInSeconds.multipliedBy(2);

describe('Timelock', () => {
  let root, notAdmin, newAdmin;
  let blockTimestamp;
  let timelock;
  let delay = oneWeekInSeconds;
  let newDelay = delay.multipliedBy(2);
  let target;
  let value = zero;
  let signature = 'setDelay(uint256)';
  let data = encodeParameters(['uint256'], [newDelay.toFixed()]);
  let revertData = encodeParameters(['uint256'], [etherUnsigned(60 * 60).toFixed()]);
  let eta;
  let queuedTxHash_delta0;
  let queuedTxHash_delta2; // delta represents change in seconds
  let queuedTxHash_delta3;

  beforeEach(async () => {
    timeAndMine.setTimeIncrease(1);
    blockTimestamp = toBN((await getCurrentBlock()).timestamp);
    [root, notAdmin, newAdmin] = await ethers.getSigners();;
    const Timelock = await ethers.getContractFactory('TimelockHarness');
    timelock = await Timelock.deploy(root.address, toEBN(delay));
    await timelock.deployed();

    target = timelock.address;
    eta = blockTimestamp.plus(delay);
    queuedTxHash_delta0 = keccak256(
      encodeParameters(
        ['address', 'uint256', 'string', 'bytes', 'uint256'],
        [target, value.toString(), signature, data, eta.toString()]
      )
    );

    queuedTxHash_delta2 = keccak256(
      encodeParameters(
        ['address', 'uint256', 'string', 'bytes', 'uint256'],
        [target, value.toString(), signature, data, eta.plus(2).toString()]
      )
    );

    queuedTxHash_delta3 = keccak256(
      encodeParameters(
        ['address', 'uint256', 'string', 'bytes', 'uint256'],
        [target, value.toString(), signature, data, eta.plus(3).toString()]
      )
    );
  });

  describe('constructor', () => {
    it('sets address of admin', async () => {
      let configuredAdmin = await timelock.admin();
      expect(configuredAdmin).equals(root.address);
    });
    it('sets delay', async () => {
      let configuredDelay = await timelock.delay();
      expect(configuredDelay).equals(toEBN(delay));
    });
  });

  describe('setDelay', () => {
    it('requires msg.sender to be Timelock', async () => {
      const txPromise = timelock.connect(root).setDelay(toEBN(delay));
      await expect(txPromise).to.be.revertedWith('Timelock::setDelay: Call must come from Timelock.');
    });
  });

  describe('setPendingAdmin', () => {
    it('requires msg.sender to be Timelock', async () => {
      const txPromise = timelock.connect(root).setPendingAdmin(newAdmin.address)
      await expect(txPromise).to.be.revertedWith('Timelock::setPendingAdmin: Call must come from Timelock.');
    });
  });

  describe('acceptAdmin', () => {
    afterEach(async () => {
      await timelock.connect(root).harnessSetAdmin(root.address);
    });

    it('requires msg.sender to be pendingAdmin', async () => {
      const txPromise = timelock.connect(notAdmin).acceptAdmin();
      await expect(txPromise).to.be.revertedWith('Timelock::acceptAdmin: Call must come from pendingAdmin.');
    });

    it('sets pendingAdmin to address 0 and changes admin', async () => {
      await timelock.connect(root).harnessSetPendingAdmin(newAdmin.address);
      const pendingAdminBefore = await timelock.pendingAdmin();
      expect(pendingAdminBefore).equals(newAdmin.address);

      const result = await timelock.connect(newAdmin).acceptAdmin();
      const pendingAdminAfter = await timelock.pendingAdmin();
      expect(pendingAdminAfter).equals(ethers.constants.AddressZero);

      const timelockAdmin = await timelock.admin();
      expect(timelockAdmin).equals(newAdmin.address);

      const test = await hasEvent(result, ['NewAdmin', newAdmin.address]);
      expect(test).equals(true);
    });
  });

  describe('queueTransaction', () => {
    it('requires admin to be msg.sender', async () => {
      const txPromise = timelock.connect(notAdmin).queueTransaction(target, toEBN(value), signature, data, toEBN(eta));
      await expect(txPromise).to.be.revertedWith('Timelock::queueTransaction: Call must come from admin.');
    });

    it('requires eta to exceed delay', async () => {
      const etaLessThanDelay = blockTimestamp.plus(delay).minus(1);
      const txPromise = timelock.connect(root).queueTransaction(target, toEBN(value), signature, data, toEBN(etaLessThanDelay));
      await expect(txPromise).to.be.revertedWith('Timelock::queueTransaction: Estimated execution block must satisfy delay.');
    });

    it('sets hash as true in queuedTransactions mapping', async () => {
      const queueTransactionsHashValueBefore = await timelock.callStatic.queuedTransactions(queuedTxHash_delta2)
      expect(queueTransactionsHashValueBefore).equals(false);
      await timelock.connect(root).queueTransaction(target, toEBN(value), signature, data, toEBN(eta.plus(2)));
      const queueTransactionsHashValueAfter = await timelock.callStatic.queuedTransactions(queuedTxHash_delta2)
      expect(queueTransactionsHashValueAfter).equals(true);
    });

    it('should emit QueueTransaction event', async () => {
      const result = await timelock.connect(root).queueTransaction(target, toEBN(value), signature, data, toEBN(eta.plus(2)));
      const events = await getEvents(result);
      expect(events.includes('QueueTransaction')).equals(true);
      expect(events.includes(data)).equals(true);
      expect(events.includes(signature)).equals(true);
      expect(events.includes(target)).equals(true);
      expect(events.some(e => deepEqual(e, toEBN(eta.plus(2))))).equals(true);
      expect(events.includes(queuedTxHash_delta2)).equals(true);
      expect(events.some(e => deepEqual(e, toEBN(value)))).equals(true);
    });
  });

  describe('cancelTransaction', () => {
    beforeEach(async () => {
      await timelock.connect(root).queueTransaction(target, toEBN(value), signature, data, toEBN(eta.plus(2)));

    });

    it('requires admin to be msg.sender', async () => {
      const txPromise = timelock.connect(notAdmin).cancelTransaction(target, toEBN(value), signature, data, toEBN(eta.plus(2)));
      await expect(txPromise).to.be.revertedWith('Timelock::cancelTransaction: Call must come from admin.');
    });

    it('sets hash from true to false in queuedTransactions mapping', async () => {
      const queueTransactionsHashValueBefore = await timelock.callStatic.queuedTransactions(queuedTxHash_delta2)
      expect(queueTransactionsHashValueBefore).equals(true);

      await timelock.connect(root).cancelTransaction(target, toEBN(value), signature, data, toEBN(eta.plus(2)));

      const queueTransactionsHashValueAfter = await timelock.callStatic.queuedTransactions(queuedTxHash_delta2)
      expect(queueTransactionsHashValueAfter).equals(false);
    });

    it('should emit CancelTransaction event', async () => {
      const result = await timelock.connect(root).cancelTransaction(target, toEBN(value), signature, data, toEBN(eta.plus(2)));
      const events = await getEvents(result);
      expect(events.includes('CancelTransaction')).equals(true);
      expect(events.includes(data)).equals(true);
      expect(events.includes(signature)).equals(true);
      expect(events.includes(target)).equals(true);
      expect(events.some(e => deepEqual(e, toEBN(eta.plus(2))))).equals(true);
      expect(events.includes(queuedTxHash_delta2)).equals(true);
      expect(events.some(e => deepEqual(e, toEBN(value)))).equals(true);
    });
  });

  describe('queue and cancel empty', () => {
    it('can queue and cancel an empty signature and data', async () => {
      const txHash = keccak256(
        encodeParameters(
          ['address', 'uint256', 'string', 'bytes', 'uint256'],
          [target, value.toString(), '', '0x', eta.plus(2).toString()] // delta 2 hash
        )
      );
      expect(await timelock.queuedTransactions(txHash)).equals(false);
      await timelock.queueTransaction(target, toEBN(value), '', '0x', toEBN(eta.plus(2)));
      expect(await timelock.queuedTransactions(txHash)).equals(true);
      await timelock.connect(root).cancelTransaction(target, toEBN(value), '', '0x', toEBN(eta.plus(2)));
      expect(await timelock.queuedTransactions(txHash)).equals(false);
    });
  });

  describe('executeTransaction (setDelay)', () => {
    beforeEach(async () => {
      // Queue transaction that will succeed (delta 3)
      await timelock.connect(root).queueTransaction(target, toEBN(value), signature, data, toEBN(eta.plus(3))) // delta 3

      // Queue transaction that will revert when executed
      await timelock.connect(root).queueTransaction(target, toEBN(value), signature, revertData, toEBN(eta.plus(3)))

    });

    it('requires admin to be msg.sender', async () => {
      const txPromise = timelock.connect(notAdmin).executeTransaction(target, toEBN(value), signature, data, toEBN(eta.plus(3)))

      await expect(txPromise).to.be.revertedWith('Timelock::executeTransaction: Call must come from admin.');
    });

    it('requires transaction to be queued', async () => {
      const differentEta = eta.plus(3 + 1); // delta 3 + another value
      const txPromise = timelock.connect(root).executeTransaction(target, toEBN(value), signature, data, toEBN(differentEta))

      await expect(txPromise).to.be.revertedWith("Timelock::executeTransaction: Transaction hasn't been queued.");
    });

    it('requires timestamp to be greater than or equal to eta', async () => {
      const txPromise = timelock.connect(root).executeTransaction(target, toEBN(value), signature, data, toEBN(eta.plus(3)))

      await expect(txPromise).to.be.revertedWith("Timelock::executeTransaction: Transaction hasn't surpassed time lock.");
    });

    it('requires timestamp to be less than eta plus gracePeriod', async () => {
      const seconds = delay.plus(gracePeriod).plus(1).toNumber(); // blockStamp already included in the sum
      timeAndMine.setTimeIncrease(`${seconds} second`);
      await mineBlock();
      const txPromise = timelock.connect(root).executeTransaction(target, toEBN(value), signature, data, toEBN(eta.plus(3)))

      await expect(txPromise).to.be.revertedWith('Timelock::executeTransaction: Transaction is stale.');
    });

    it('requires target.call transaction to succeed', async () => {
      timeAndMine.setTimeIncrease(`${delay} second`);
      await mineBlock();
      const txPromise = timelock.connect(root).executeTransaction(target, toEBN(value), signature, revertData, toEBN(eta.plus(3)))

      await expect(txPromise).to.be.revertedWith('Timelock::executeTransaction: Transaction execution reverted.');
    });

    it('sets hash from true to false in queuedTransactions mapping, updates delay, and emits ExecuteTransaction event', async () => {
      const configuredDelayBefore = await timelock.delay();
      expect(configuredDelayBefore).equals(toEBN(delay));

      const queueTransactionsHashValueBefore = await timelock.callStatic.queuedTransactions(queuedTxHash_delta3)
      expect(queueTransactionsHashValueBefore).equals(true);

      const newBlockTimestamp = delay.plus(1);
      timeAndMine.setTimeIncrease(`${newBlockTimestamp.toNumber()} second`);
      await mineBlock();
      const result = await timelock.connect(root).executeTransaction(target, toEBN(value), signature, data, toEBN(eta.plus(3)))
      const events = await getEvents(result);

      const queueTransactionsHashValueAfter = await timelock.callStatic.queuedTransactions(queuedTxHash_delta3)
      expect(queueTransactionsHashValueAfter).equals(false);

      const configuredDelayAfter = await timelock.delay();
      expect(configuredDelayAfter).equals(toEBN(newDelay));

      expect(events.includes('ExecuteTransaction')).equals(true);
      expect(events.includes(data)).equals(true);
      expect(events.includes(signature)).equals(true);
      expect(events.includes(target)).equals(true);
      expect(events.some(e => deepEqual(e, toEBN(eta.plus(3))))).equals(true);
      expect(events.includes(queuedTxHash_delta3)).equals(true);
      expect(events.some(e => deepEqual(e, toEBN(value)))).equals(true);

      expect(await hasEvent(result, ['NewDelay', toEBN(newDelay)])).equals(true)
    });
  });

  describe('executeTransaction (setPendingAdmin)', () => {
    beforeEach(async () => {
      const configuredDelay = toBN(await timelock.delay());

      delay = etherUnsigned(configuredDelay);
      signature = 'setPendingAdmin(address)';
      data = encodeParameters(['address'], [newAdmin.address]);
      eta = blockTimestamp.plus(delay);

      queuedTxHash_delta2 = keccak256(
        encodeParameters(
          ['address', 'uint256', 'string', 'bytes', 'uint256'],
          [target, value.toString(), signature, data, eta.plus(2).toString()]
        )
      );

      await timelock.connect(root).queueTransaction(target, toEBN(value), signature, data, toEBN(eta.plus(2)));
    });

    it('requires admin to be msg.sender', async () => {
      const txPromise = timelock.connect(notAdmin).executeTransaction(target, toEBN(value), signature, data, toEBN(eta.plus(2)));
      await expect(txPromise).to.be.revertedWith('Timelock::executeTransaction: Call must come from admin.');
    });

    it('requires transaction to be queued', async () => {
      const differentEta = eta.plus(2 + 1);
      const txPromise = timelock.connect(root).executeTransaction(target, toEBN(value), signature, data, toEBN(differentEta));

      await expect(txPromise).to.be.revertedWith("Timelock::executeTransaction: Transaction hasn't been queued.");
    });

    it('requires timestamp to be greater than or equal to eta', async () => {
      const txPromise = timelock.connect(root).executeTransaction(target, toEBN(value), signature, data, toEBN(eta.plus(2)));
      await expect(txPromise).to.be.revertedWith("Timelock::executeTransaction: Transaction hasn't surpassed time lock.");
    });

    it('requires timestamp to be less than eta plus gracePeriod', async () => {
      const seconds = delay.plus(gracePeriod).plus(1).toNumber();
      timeAndMine.setTimeIncrease(`${seconds} second`);
      await mineBlock();
      const txPromise = timelock.connect(root).executeTransaction(target, toEBN(value), signature, data, toEBN(eta.plus(2)));

      await expect(txPromise).to.be.revertedWith('Timelock::executeTransaction: Transaction is stale.');
    });

    it('sets hash from true to false in queuedTransactions mapping, updates admin, and emits ExecuteTransaction event', async () => {
      const configuredPendingAdminBefore = await timelock.pendingAdmin();
      expect(configuredPendingAdminBefore).equals(ethers.constants.AddressZero);

      const queueTransactionsHashValueBefore = await timelock.queuedTransactions(queuedTxHash_delta2);
      expect(queueTransactionsHashValueBefore).equals(true);

      const newBlockTimestamp = delay.plus(1);
      timeAndMine.setTimeIncrease(`${newBlockTimestamp.toNumber()} second`);
      await mineBlock();

      const result = await timelock.connect(root).executeTransaction(target, toEBN(value), signature, data, toEBN(eta.plus(2)));

      const queueTransactionsHashValueAfter = await timelock.queuedTransactions(queuedTxHash_delta2);
      expect(queueTransactionsHashValueAfter).equals(false);

      const configuredPendingAdminAfter = await timelock.pendingAdmin();
      expect(configuredPendingAdminAfter).equals(newAdmin.address);


      expect(await hasEvent(result, ['ExecuteTransaction', queuedTxHash_delta2,target, toEBN(value),signature, data, toEBN(eta.plus(2))])).equals(true)
      expect(await hasEvent(result, ['NewPendingAdmin', newAdmin.address])).equals(true)

    });
  });
});
