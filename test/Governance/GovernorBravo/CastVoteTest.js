const EIP712 = require('../../Utils/EIP712');
const BigNumber = require('bignumber.js');
const { ethers } = require('hardhat');
const { expect } = require('chai');
const {
  address,
  etherMantissa,
  encodeParameters,
  mineBlock,
  mergeInterface,
  toEBN
} = require('../../Utils/Ethereum');

async function enfranchise(comp, actor, amount) {
  await comp.transfer(actor.address, toEBN(etherMantissa(amount)));
  await comp.connect(actor).delegate(actor.address);
}

describe("governorBravo#castVote/2", () => {
  let comp, gov, root, a1, accounts, govDelegate;
  let targets, values, signatures, callDatas, proposalId;

  before(async () => {
    [root, walletProvider, ...accounts] = await ethers.getSigners();

    // top up wallet for eliptic curve sig testing
    a1 = ethers.Wallet.createRandom().connect(walletProvider.provider);
    const tr = await walletProvider.populateTransaction({ to: a1.address, value: ethers.utils.parseEther("50") });
    await walletProvider.sendTransaction(tr);


    const Comp = await ethers.getContractFactory('Comp');
    comp = await Comp.deploy(root.address);
    await comp.deployed();

    const GovDelegate = await ethers.getContractFactory('GovernorBravoDelegateHarness');
    govDelegate = await GovDelegate.deploy();

    const Gov = await ethers.getContractFactory('GovernorBravoDelegator');
    gov = await Gov.deploy(ethers.constants.AddressZero, comp.address, root.address, govDelegate.address, 17280, 1, '100000000000000000000000');

    gov = mergeInterface(gov, govDelegate);
    await gov['_initiate()']();

    targets = [a1.address];
    values = ["0"];
    signatures = ["getBalanceOf(address)"];
    callDatas = [encodeParameters(['address'], [a1.address])];
    await comp.delegate(root.address);
    await gov.propose(targets, values, signatures, callDatas, "do nothing")
    proposalId = await gov.callStatic.latestProposalIds(root.address);
  });

  describe("We must revert if:", () => {
    it("There does not exist a proposal with matching proposal id where the current block number is between the proposal's start block (exclusive) and end block (inclusive)", async () => {
      const tx = gov.castVote(proposalId, 1);
      await expect(tx).to.be.revertedWith("GovernorBravo::castVoteInternal: voting is closed");
    });

    it("Such proposal already has an entry in its voters set matching the sender", async () => {
      await mineBlock();
      await mineBlock();

      await gov.connect(accounts[4]).castVote(proposalId, 1);
      await gov.connect(accounts[3]).castVoteWithReason(proposalId, 1, "");
      await expect(gov.connect(accounts[4]).castVote(proposalId, 1)).to.be.revertedWith("GovernorBravo::castVoteInternal: voter already voted");

    });
  });

  describe("Otherwise", () => {
    it("we add the sender to the proposal's voters set", async () => {
      const reply = await gov.callStatic.getReceipt(proposalId, accounts[2].address);
      expect(!reply.hasVoted);
      await gov.connect(accounts[2]).castVote(proposalId, 1);
      const reply2 = await gov.callStatic.getReceipt(proposalId, accounts[2].address);
      expect(reply2.hasVoted);
    });

    describe("and we take the balance returned by GetPriorVotes for the given sender and the proposal's start block, which may be zero,", () => {
      let actor; // an account that will propose, receive tokens, delegate to self, and vote on own proposal

      it("and we add that ForVotes", async () => {
        actor = accounts[1];
        await enfranchise(comp, actor, 400001);
        await gov.connect(actor).propose(targets, values, signatures, callDatas, "do nothing");

        proposalId = await gov.callStatic.latestProposalIds(actor.address);

        let beforeFors = (await gov.callStatic.proposals(proposalId)).forVotes;
        await mineBlock();
        await gov.connect(actor).castVote(proposalId, 1);

        let afterFors = (await gov.callStatic.proposals(proposalId)).forVotes;
        expect(afterFors).equals(beforeFors.add(toEBN(etherMantissa(400001))));
      })

      it("or AgainstVotes corresponding to the caller's support flag.", async () => {
        actor = accounts[3];
        await enfranchise(comp, actor, 400001);

        await gov.connect(actor).propose(targets, values, signatures, callDatas, "do nothing");

        proposalId = await gov.callStatic.latestProposalIds(actor.address);

        let beforeAgainsts = (await gov.callStatic.proposals(proposalId)).againstVotes;
        await mineBlock();
        await gov.connect(actor).castVote(proposalId, 0);

        let afterAgainsts = (await gov.callStatic.proposals(proposalId)).againstVotes;
        expect(afterAgainsts).equals(beforeAgainsts.add(toEBN(etherMantissa(400001))));
      });
    });

    describe('castVoteBySig', () => {
      const Domain = (gov) => ({
        name: 'Compound Governor Bravo',
        chainId: 1337,
        verifyingContract: gov.address
      });
      const Types = {
        Ballot: [
          { name: 'proposalId', type: 'uint256' },
          { name: 'support', type: 'uint8' }
        ]
      };

      it('reverts if the signatory is invalid', async () => {
        const tx = gov.castVoteBySig(proposalId, 0, 0, ethers.utils.formatBytes32String('0xbad'), ethers.utils.formatBytes32String('0xbad'));
        await expect(tx).to.be.revertedWith("GovernorBravo::castVoteBySig: invalid signature");
      });

      it('casts vote on behalf of the signatory', async () => {
        await enfranchise(comp, a1, 400001);
        await gov.connect(a1).propose(targets, values, signatures, callDatas, "do nothing");

        id = await gov.callStatic.latestProposalIds(a1.address);
        const proposalId = id.toNumber();

        const { v, r, s } = EIP712.sign(Domain(gov), 'Ballot', { proposalId, support: 1 }, Types, a1.privateKey);
        const r_formatted = ethers.utils.hexlify(r.toJSON().data);
        const s_formatted = ethers.utils.hexlify(s.toJSON().data);
        let beforeFors = (await gov.callStatic.proposals(proposalId)).forVotes;
        await mineBlock();
        const tx = await gov.castVoteBySig(proposalId, 1, v, r_formatted, s_formatted);
        expect(tx.gasUsed < 80000);
        let afterFors = (await gov.callStatic.proposals(proposalId)).forVotes;
        expect(afterFors).equals(beforeFors.add(toEBN(etherMantissa(400001))));
      });
    });
  });
});