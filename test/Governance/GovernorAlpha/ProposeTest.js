const EIP712 = require('../../Utils/EIP712');
const BigNumber = require('bignumber.js');
const { ethers } = require('hardhat');
const { expect } = require('chai');
const {
  address,
  etherMantissa,
  encodeParameters,
  mineBlock,
  toEBN,
  getReceipt
} = require('../../Utils/Ethereum');

describe('GovernorAlpha#propose/5', () => {
  let gov, root, acct, startingBlock;

  before(async () => {
    [root, acct, ...accounts] = await ethers.getSigners();
    startingBlock = await ethers.provider.getBlockNumber();

    const Comp = await ethers.getContractFactory('Comp');
    comp = await Comp.deploy(root.address);
    await comp.deployed();

    const Gov = await ethers.getContractFactory('contracts/Governance/GovernorAlpha.sol:GovernorAlpha');
    gov = await Gov.deploy(ethers.constants.AddressZero, comp.address, ethers.constants.AddressZero);
    await gov.deployed();
  });

  let trivialProposal, targets, values, signatures, callDatas;
  let proposalBlock;
  before(async () => {

    targets = [root.address];
    values = [toEBN(0)];
    signatures = ["getBalanceOf(address)"];
    callDatas = [encodeParameters(['address'], [acct.address])];
    await comp.delegate(root.address);
    await gov.propose(targets, values, signatures, callDatas, "do nothing");

    proposalBlock = +(await ethers.provider.getBlockNumber());
    proposalId = await gov.callStatic.latestProposalIds(root.address);
    trivialProposal = await gov.callStatic.proposals(proposalId);


  });

  describe("if there exists a pending or active proposal from the same proposer, we must revert.", () => {
      it("reverts with pending", async () => {

        await expect(
          gov.callStatic.propose(targets, values, signatures, callDatas, "do nothing")
        ).to.be.revertedWith("GovernorAlpha::propose: one live proposal per proposer, found an already pending proposal");
      });

      it("reverts with active", async () => {
        await mineBlock();
        await mineBlock();

        await expect(
          gov.callStatic.propose(targets, values, signatures, callDatas, "do nothing")

        ).to.be.revertedWith("GovernorAlpha::propose: one live proposal per proposer, found an already active proposal");
      });
    });

  describe("simple initialization", () => {
    it("ID is set to a globally unique identifier", async () => {
      expect(trivialProposal[0]).equals(proposalId);
    });

    it("Proposer is set to the sender", async () => {

      expect(trivialProposal[1]).equals(root.address);
    });

    it("Start block is set to the current block number plus vote delay", async () => {
      expect(trivialProposal[3]).equals(proposalBlock + 1);
    });

    it("End block is set to the current block number plus the sum of vote delay and vote period", async () => {
      expect(trivialProposal[4]).equals(proposalBlock + 1 + 17280);
    });

    it("ForVotes and AgainstVotes are initialized to zero", async () => {
      expect(trivialProposal[5]).equals(0);
      expect(trivialProposal[6]).equals(0);
    });


    it("Executed and Canceled flags are initialized to false", async () => {
      expect(trivialProposal[7]).equals(false);
      expect(trivialProposal[8]).equals(false);
    });

    it("ETA is initialized to zero", async () => {
      expect(trivialProposal[2]).equals(0);
    });

    it("Targets, Values, Signatures, Calldatas are set according to parameters", async () => {
      let dynamicFields = await gov.callStatic.getActions(trivialProposal[0]);
      expect(dynamicFields[0]).to.eql(targets);
      expect(dynamicFields[1]).to.eql(values);
      expect(dynamicFields[2]).to.eql(signatures);
      expect(dynamicFields[3]).to.eql(callDatas);
    });


    describe("This function must revert if", () => {
      it("the length of the values, signatures or calldatas arrays are not the same length,", async () => {

        await expect(
          gov.callStatic.propose(targets.concat(root.address), values, signatures, callDatas, "do nothing")
        ).to.be.revertedWith("GovernorAlpha::propose: proposal function information arity mismatch");

        await expect(
          gov.callStatic.propose(targets, values.concat(values), signatures, callDatas, "do nothing")
        ).to.be.revertedWith("GovernorAlpha::propose: proposal function information arity mismatch");

        await expect(
          gov.callStatic.propose(targets, values, signatures.concat(signatures), callDatas, "do nothing")
        ).to.be.revertedWith("GovernorAlpha::propose: proposal function information arity mismatch");

        await expect(
          gov.callStatic.propose(targets, values, signatures, callDatas.concat(callDatas), "do nothing")
        ).to.be.revertedWith("GovernorAlpha::propose: proposal function information arity mismatch");

      });

      it("or if that length is zero or greater than Max Operations.", async () => {
        await expect(
          gov.callStatic.propose([], [], [], [], "do nothing")
        ).to.be.revertedWith("GovernorAlpha::propose: must provide actions");
      });


    });

    it("This function returns the id of the newly created proposal. # proposalId(n) = succ(proposalId(n-1))", async () => {
      await comp.transfer(accounts[2].address, toEBN(etherMantissa(400001)));
      await comp.connect(accounts[2]).delegate(accounts[2].address)

      await mineBlock();
      let nextProposalId = await gov.connect(accounts[2]).callStatic.propose(targets, values, signatures, callDatas, "yoot");


      expect(+nextProposalId).equals(+trivialProposal.id + 1);
    });

    it("emits log with id and description", async () => {
      await comp.transfer(accounts[3].address, toEBN(etherMantissa(400001)))
      await comp.connect(accounts[3]).delegate(accounts[3].address);
      await mineBlock();
      let nextProposalId = await gov.connect(accounts[3]).callStatic.propose(targets, values, signatures, callDatas, "yoot");
      const tx = gov.connect(accounts[3]).propose(targets, values, signatures, callDatas, "second proposal");
      const receipt = await getReceipt(tx);
      receipt.events.forEach((e) => {
        expect(e.args['id']).equals(nextProposalId);
        expect(e.args['targets']).to.eql(targets);
        expect(e.args['vals']).to.eql(values);
        expect(e.args['signatures']).to.eql(signatures);
        expect(e.args['calldatas']).to.eql(callDatas);
        expect(e.args['startBlock']).equals(14 + startingBlock);
        expect(e.args['endBlock']).equals(17294 + startingBlock + '');
        expect(e.args['description']).equals('second proposal');
        expect(e.args['proposer']).equals(accounts[3].address);

      });
    });
  });
});
