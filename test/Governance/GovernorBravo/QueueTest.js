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

describe('GovernorBravo#queue/1', () => {
  let root, a1, a2, accounts;
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

      const Gov = await ethers.getContractFactory('GovernorBravoImmutable');
      gov = await Gov.deploy(timelock.address, comp.address, root.address, 240, 1, "100000000000000000000000");
      await gov.deployed();
      await gov['_initiate()']();
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

      await gov.connect(a1).castVote(proposalId1, 1);
      for (var i = 0; i < votingPeriod; i++) {
        await mineBlock();
      }
      await expect(gov.queue(proposalId1)).to.be.revertedWith("GovernorBravo::queueOrRevertInternal: identical proposal action already queued at eta");
    });

    it("reverts on queueing overlapping actions in different proposals, works if waiting", async () => {
      const Timelock = await ethers.getContractFactory('TimelockHarness');
      const timelock = await Timelock.deploy(root.address, 86400 * 2);
      await timelock.deployed();

      const Comp = await ethers.getContractFactory('Comp');
      comp = await Comp.deploy(root.address);
      await comp.deployed();

      const Gov = await ethers.getContractFactory('GovernorBravoImmutable');
      gov = await Gov.deploy(timelock.address, comp.address, root.address, 240, 1, "100000000000000000000000");
      await gov.deployed();
      await gov['_initiate()']();
      votingPeriod = (await gov.votingPeriod()).toNumber();
      const txAdmin =  await timelock.harnessSetAdmin(gov.address);

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

      const txVote1 = await gov.connect(a1).castVote(proposalId1, 1);
      const txVote2 = await gov.connect(a2).castVote(proposalId2, 1);
      for (var i = 0; i < votingPeriod; i++) {
        await mineBlock();
      }

      await ethers.provider.send("evm_setAutomine", [false]);
      await gov.queue(proposalId1);
      await gov.queue(proposalId2);
      await ethers.provider.send("evm_setAutomine", [true]);
      await expect(gov.queue(proposalId2)).to.be.revertedWith("GovernorBravo::queueOrRevertInternal: identical proposal action already queued at eta");
      await gov.queue(proposalId2);
    });
  });
});
