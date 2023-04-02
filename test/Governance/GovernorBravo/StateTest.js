const { ethers } = require('hardhat');
const { expect } = require('chai');
const {
  advanceBlocks,
  etherUnsigned,
  both,
  encodeParameters,
  etherMantissa,
  mineBlock,
  freezeTime,
  increaseTime,
  toEBN,
  getEvents
} = require('../../Utils/Ethereum');

const path = require('path');
const solparse = require('solparse');

const governorBravoPath = path.join(__dirname, '../../..', 'contracts', 'Governance/GovernorBravoInterfaces.sol');
const statesInverted = solparse
  .parseFile(governorBravoPath)
  .body
  .find(k => k.name === 'GovernorBravoDelegateStorageV1')
  .body
  .find(k => k.name == 'ProposalState')
  .members

const states = Object.entries(statesInverted).reduce((obj, [key, value]) => ({ ...obj, [value]: key }), {});

describe('GovernorBravo#state/1', () => {
  let comp, gov, root, acct, delay, timelock, votingPeriod;

  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [],
    });

    [root, acct, ...accounts] = await ethers.getSigners();
    const Comp = await ethers.getContractFactory('Comp');
    comp = await Comp.deploy(root.address);
    await comp.deployed();

    delay = etherUnsigned(2 * 24 * 60 * 60).multipliedBy(2)
    const Timelock = await ethers.getContractFactory('TimelockHarness');
    const timelock = await Timelock.deploy(root.address, toEBN(delay));
    await timelock.deployed();
    const Gov = await ethers.getContractFactory('GovernorBravoImmutable');
    gov = await Gov.deploy(timelock.address, comp.address, root.address, 240, 1, "100000000000000000000000");
    await gov.deployed();
    await gov['_initiate()']();
    votingPeriod = (await gov.votingPeriod()).toNumber();


    // enfranchising code
    await timelock.harnessSetAdmin(gov.address);
    await comp.transfer(acct.address, toEBN(etherMantissa(4000000)));
    await comp.connect(acct).delegate(acct.address);
  });

  let trivialProposal, targets, values, signatures, callDatas;
  before(async () => {
    targets = [root.address];
    values = [toEBN(0)];
    signatures = ["getBalanceOf(address)"];
    callDatas = [encodeParameters(['address'], [acct.address])];
    await comp.delegate(root.address);
    await gov.propose(targets, values, signatures, callDatas, "do nothing");

    proposalId = await gov.callStatic.latestProposalIds(root.address);
    trivialProposal = await gov.callStatic.proposals(proposalId);
    // start the mempool
    await ethers.provider.send("evm_setAutomine", [false]);
  })

  it("Invalid for proposal not found", async () => {
    await expect(gov.callStatic.state(5)).to.be.revertedWith("GovernorBravo::state: invalid proposal id");

  })

  it("Pending", async () => {
    const reply = await gov.callStatic.state(trivialProposal.id);
    expect(reply).equals(toEBN(states["Pending"]))
  })

  it("Active", async () => {
    await mineBlock()
    await mineBlock()
    const reply = await gov.callStatic.state(trivialProposal.id);
    expect(reply).equals(toEBN(states["Active"]))
  })

  it("Canceled", async () => {
    await ethers.provider.send("evm_setAutomine", [true]);
    // this is enfranchising code
    await comp.transfer(accounts[0].address, toEBN(etherMantissa(4000000)));
    await comp.connect(accounts[0]).delegate(accounts[0].address);
    await gov.connect(accounts[0]).propose(targets, values, signatures, callDatas, "do nothing");
    let newProposalId = await gov.callStatic.proposalCount();

    // send away the delegates
    await comp.connect(accounts[0]).delegate(root.address);
    await gov.cancel(newProposalId);

    expect(await gov.callStatic.state(+newProposalId)).equals(toEBN(states["Canceled"]))
    await ethers.provider.send("evm_setAutomine", [false]);
  })

  it("Defeated", async () => {
    // travel to end block
    for (var i = 0; i < votingPeriod; i++) {
      await mineBlock();
    }

    expect(await gov.callStatic.state(trivialProposal.id)).equals(toEBN(states["Defeated"]))
  })

  it("Succeeded", async () => {
    await ethers.provider.send("evm_setAutomine", [true]);
    await mineBlock()

    const newProposalId = await gov.connect(acct).callStatic.propose(targets, values, signatures, callDatas, "do nothing");
    await gov.connect(acct).propose(targets, values, signatures, callDatas, "do nothing");
    await mineBlock()
    await gov.connect(acct).castVote(newProposalId, 1);
    for (var i = 0; i < votingPeriod; i++) {
      await mineBlock();
    }

    expect(await gov.callStatic.state(newProposalId)).equals(toEBN(states["Succeeded"]))
    await ethers.provider.send("evm_setAutomine", [false]);
  })

  it("Queued", async () => {
    await ethers.provider.send("evm_setAutomine", [true]);
    await mineBlock()
    const newProposalId = await gov.connect(acct).callStatic.propose(targets, values, signatures, callDatas, "do nothing");
    await gov.connect(acct).propose(targets, values, signatures, callDatas, "do nothing");

    await mineBlock()
    await gov.connect(acct).castVote(newProposalId, 1);
    for (var i = 0; i < votingPeriod; i++) {
      await mineBlock();
    }

    await gov.connect(acct).queue(newProposalId);
    expect(await gov.callStatic.state(newProposalId)).equals(toEBN(states["Queued"]))
    await ethers.provider.send("evm_setAutomine", [false]);
  })

  it("Expired", async () => {
    await ethers.provider.send("evm_setAutomine", [true]);
    await mineBlock()
    const newProposalId = await gov.connect(acct).callStatic.propose(targets, values, signatures, callDatas, "do nothing");
    await gov.connect(acct).propose(targets, values, signatures, callDatas, "do nothing");

    await mineBlock()
    await gov.castVote(newProposalId, 1);
    for (var i = 0; i < votingPeriod; i++) {
      await mineBlock();
    }

    await gov.connect(acct).queue(newProposalId);

    let p = await gov.proposals(newProposalId);
    let eta = etherUnsigned(p.eta)

    expect(await gov.callStatic.state(newProposalId)).equals(toEBN(states["Queued"]))
    timeAndMine.increaseTime("52 week"); // need to mine past the grace period
    for (var i = 0; i < 10; i++) {
      await mineBlock(); // 10 years should do it. actual grace period is 16 days
    }

    expect(await gov.callStatic.state(newProposalId)).equals(toEBN(states["Expired"]))

    await ethers.provider.send("evm_setAutomine", [false]);
  })

  it("Executed", async () => {
    await ethers.provider.send("evm_setAutomine", [true]);
    await mineBlock()
    const newProposalId = await gov.connect(acct).callStatic.propose(targets, values, signatures, callDatas, "do nothing");
    await gov.connect(acct).propose(targets, values, signatures, callDatas, "do nothing");
    await mineBlock()
    await gov.castVote(newProposalId, 1);
    for (var i = 0; i < votingPeriod; i++) {
      await mineBlock();
    }
    timeAndMine.increaseTime(1)

    await gov.connect(acct).queue(newProposalId);

    let p = await gov.proposals(newProposalId);
    let eta = etherUnsigned(p.eta)

    expect(await gov.callStatic.state(newProposalId)).equals(toEBN(states["Queued"]))
    timeAndMine.increaseTime("15 day"); // one minus the grace period
    await gov.connect(acct).execute(newProposalId);
    timeAndMine.increaseTime(1);
    expect(await gov.callStatic.state(newProposalId)).equals(toEBN(states["Executed"]))

    // still executed even though would be expired

    expect(await gov.callStatic.state(newProposalId)).equals(toEBN(states["Executed"]))
    await ethers.provider.send("evm_setAutomine", [true]);
  })

})