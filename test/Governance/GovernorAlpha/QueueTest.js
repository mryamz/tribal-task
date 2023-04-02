const { ethers } = require('hardhat');
const { expect } = require('chai');
const {
  both,
  etherMantissa,
  encodeParameters,
  advanceBlocks,
  freezeTime,
  mineBlock,
  toEBN,
  getEvents,
} = require('../../Utils/Ethereum');

async function enfranchise(comp, actor, amount) {
  await comp.transfer(actor.address, toEBN(etherMantissa(amount)));
  await comp.connect(actor).delegate(actor.address);
}

describe('GovernorAlpha#queue/1', () => {
  let root, a1, a2, accounts, votingPeriod;
  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [],
    });

    [root, a1, a2, ...accounts] = await ethers.getSigners();


  });


  describe("overlapping actions", () => {
    it("reverts on queueing overlapping actions in same proposal", async () => {
      const Timelock = await ethers.getContractFactory('TimelockHarness');
      const timelock = await Timelock.deploy(root.address, 86400 * 2);
      await timelock.deployed();


      const Comp = await ethers.getContractFactory('Comp');
      comp = await Comp.deploy(root.address);
      await comp.deployed();

      const Gov = await ethers.getContractFactory('GovernorAlphaHarness');
      gov = await Gov.deploy(timelock.address, comp.address, root.address);
      await gov.deployed();
      votingPeriod = (await gov.votingPeriod()).toNumber();

      const txAdmin = await timelock.harnessSetAdmin(gov.address);

      await enfranchise(comp, a1, 3e6);
      await mineBlock();

      const targets = [comp.address, comp.address];
      const values = ["0", "0"];
      const signatures = ["getBalanceOf(address)", "getBalanceOf(address)"];
      const calldatas = [encodeParameters(['address'], [root.address]), encodeParameters(['address'], [root.address])];
      const proposalId1 = await gov.connect(a1).callStatic.propose(targets, values, signatures, calldatas, "do nothing");
      const tx = await gov.connect(a1).propose(targets, values, signatures, calldatas, "do nothing");

      await mineBlock();

      await gov.connect(a1).castVote(proposalId1, true);

      for (var i = 0; i < votingPeriod; i++) {
        await mineBlock();
      }

      await expect(gov.queue(proposalId1)).to.be.revertedWith("GovernorAlpha::_queueOrRevert: proposal action already queued at eta");
    });

    it("reverts on queueing overlapping actions in different proposals, works if waiting", async () => {
      const Timelock = await ethers.getContractFactory('TimelockHarness');
      const timelock = await Timelock.deploy(root.address, 86400 * 2);
      await timelock.deployed();

      const Comp = await ethers.getContractFactory('Comp');
      comp = await Comp.deploy(root.address);
      await comp.deployed();

      const Gov = await ethers.getContractFactory('GovernorAlphaHarness');
      gov = await Gov.deploy(timelock.address, comp.address, root.address);
      await gov.deployed();
      votingPeriod = (await gov.votingPeriod()).toNumber();

      const txAdmin = await timelock.harnessSetAdmin(gov.address);

      await enfranchise(comp, a1, 3e6);
      await enfranchise(comp, a2, 3e6);
      await mineBlock();

      const targets = [comp.address];
      const values = ["0"];
      const signatures = ["getBalanceOf(address)"];
      const calldatas = [encodeParameters(['address'], [root.address])];


      // a1
      const proposalId1 = await gov.connect(a1).callStatic.propose(targets, values, signatures, calldatas, "do nothing");
      const a1_tx = await gov.connect(a1).propose(targets, values, signatures, calldatas, "do nothing");
      // a2
      const proposalId2 = await gov.connect(a2).callStatic.propose(targets, values, signatures, calldatas, "do nothing");
      const a2_tx = await gov.connect(a2).propose(targets, values, signatures, calldatas, "do nothing");
      await mineBlock();

      const txVote1 = await gov.connect(a1).castVote(proposalId1, true);
      const txVote2 = await gov.connect(a2).castVote(proposalId2, true);
      for (var i = 0; i < votingPeriod; i++) {
        await mineBlock();
      }

      // in order to test akin to the ganache evm_freezeTime, we need ensure both of the queue transactions'
      // timestamp and block number are the same. This ensures that the proposal data + eta generates a hash
      // This hash is used to check if a proposal exists, we want a definition created upon first queue call, this
      // will ensure an error occures similar to what evm_freezeTime produces.

      /* create a mempool to effectively 'freezeTime' */
      // START MEMPOOL
      await ethers.provider.send("evm_setAutomine", [false]); // making sure new JavaScript calls aren't building txs
      await gov.queue(proposalId1);                           // should create definition with proposals + eta data when mined
      await gov.queue(proposalId2);                           // should be problematic since eta proposal data is the same
      await ethers.provider.send("evm_setAutomine", [true]);
      await expect(gov.queue(proposalId2)).to.be.revertedWith("GovernorAlpha::_queueOrRevert: proposal action already queued at eta");
      await gov.queue(proposalId2); // should pass now with unique eta data
    });
  });
});
