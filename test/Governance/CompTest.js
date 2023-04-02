const EIP712 = require('../Utils/EIP712');
const { ethers } = require('hardhat');
const { expect } = require('chai');

const {
  address,
  minerStart,
  minerStop,
  mineBlock,
  toEBN,
  getReceipt
} = require('../Utils/Ethereum');



describe('Comp', () => {
  const name = 'Compound';
  const symbol = 'COMP';

  let root, a1, a2, accounts, chainId;
  let comp;

  beforeEach(async () => {
    [root,a2, ...accounts] = await ethers.getSigners();
    a1 = ethers.Wallet.createRandom().connect(root.provider);


    chainId = await root.getChainId();
    const Comp = await ethers.getContractFactory('Comp');
    comp = await Comp.deploy(root.address);
    await comp.deployed();
  });
  describe('metadata', () => {
    it('has given name', async () => {
      expect(await comp.callStatic.name()).equals(name);
    });

    it('has given symbol', async () => {
      expect(await comp.callStatic.symbol()).equals(symbol);
    });
  });

  describe('balanceOf', () => {
    it('grants to initial account', async () => {
      expect(await comp.callStatic.balanceOf(root.address)).equals(toEBN("10000000000000000000000000"));
    });
  });

  describe('delegateBySig', () => {
    const Domain = (comp) => ({ name, chainId, verifyingContract: comp.address });
    const Types = {
      Delegation: [
        { name: 'delegatee', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'expiry', type: 'uint256' }
      ]
    };

    it('reverts if the signatory is invalid', async () => {
      const delegatee = root, nonce = 0, expiry = 0;
      const tx = comp.delegateBySig(delegatee.address, nonce, expiry, 0, ethers.utils.formatBytes32String('0xbad'), ethers.utils.formatBytes32String('0xbad'));
      await expect(tx).to.be.revertedWith('Comp::delegateBySig: invalid signature');
    });

    it('reverts if the nonce is bad ', async () => {
      const delegatee = root.address, nonce = 1, expiry = 0;
      const { v, r, s } = EIP712.sign(Domain(comp), 'Delegation', { delegatee, nonce, expiry }, Types, a1.privateKey);
      const r_formatted = ethers.utils.hexlify(r.toJSON().data);
      const s_formatted = ethers.utils.hexlify(s.toJSON().data);
      const tx = comp.delegateBySig(root.address, nonce, expiry, v, r_formatted, s_formatted);
      await expect(tx).to.be.revertedWith("Comp::delegateBySig: invalid nonce");
    });

    it('reverts if the signature has expired', async () => {
      const delegatee = root.address, nonce = 0, expiry = 0;
      const { v, r, s } = EIP712.sign(Domain(comp), 'Delegation', { delegatee, nonce, expiry }, Types, a1.privateKey);
      const r_formatted = ethers.utils.hexlify(r.toJSON().data);
      const s_formatted = ethers.utils.hexlify(s.toJSON().data);
      const tx = comp.delegateBySig(root.address, nonce, expiry, v, r_formatted, s_formatted);
      await expect(tx).to.be.revertedWith("Comp::delegateBySig: signature expired");
    });

    it('delegates on behalf of the signatory', async () => {
      const delegatee = root.address, nonce = 0, expiry = 10e9;


      const { v, r, s } = EIP712.sign(Domain(comp), 'Delegation', { delegatee, nonce, expiry }, Types, a1.privateKey);
      const r_formatted = ethers.utils.hexlify(r.toJSON().data);
      const s_formatted = ethers.utils.hexlify(s.toJSON().data);

      expect(await comp.delegates(a1.address)).equals(ethers.constants.AddressZero);

      const tx = await comp.delegateBySig(root.address, nonce, expiry, v, r_formatted, s_formatted);

      expect(tx.gasUsed < 80000);
      expect(await comp.delegates(a1.address)).equals(delegatee);
    });
  });

  describe('numCheckpoints', () => {
    it('returns the number of checkpoints for a delegate', async () => {
      let guy = accounts[0];
      await comp.transfer(guy.address, 100);//give an account a few tokens for readability
      expect(await comp.numCheckpoints(a1.address)).equals(0);

      const t1 = await comp.connect(guy).delegate(a1.address);
      expect(await comp.callStatic.numCheckpoints(a1.address)).equals(1);

      const t2 = await comp.connect(guy).transfer(a2.address, 10);
      expect(await comp.numCheckpoints(a1.address)).equals(2);

      const t3 = await comp.connect(guy).transfer(a2.address, 10);
      expect(await comp.numCheckpoints(a1.address)).equals(3);

      const t4 = await comp.connect(root).transfer(guy.address, 20);
      expect(await comp.numCheckpoints(a1.address)).equals(4);


      expect((await comp.checkpoints(a1.address, 0)).slice(0, 2)).to.eql(([t1.blockNumber,toEBN(100)]));
      expect((await comp.checkpoints(a1.address, 1)).slice(0, 2)).to.eql(([t2.blockNumber,toEBN(90)]));
      expect((await comp.checkpoints(a1.address, 2)).slice(0, 2)).to.eql(([t3.blockNumber,toEBN(80)]));
      expect((await comp.checkpoints(a1.address, 3)).slice(0, 2)).to.eql(([t4.blockNumber,toEBN(100)]));
    });

    it('does not add more than one checkpoint in a block', async () => {
      let guy = accounts[0];

      await comp.transfer(guy.address, 100); //give an account a few tokens for readability
      expect(await comp.numCheckpoints(a1.address)).equals(0);

      await ethers.provider.send("evm_setAutomine", [false]);

      let t1 = comp.connect(guy).delegate(a1.address);
      let t2 = comp.connect(guy).transfer(a2.address, 10);
      let t3 = comp.connect(guy).transfer(a2.address, 10);

      // mine all txs into one block
      t1 = await t1;
      t2 = await t2;
      t3 = await t3;
      await ethers.provider.send("evm_mine");
      await ethers.provider.send("evm_setAutomine", [true]);


      expect(await comp.callStatic.numCheckpoints(a1.address)).equals(1);
      const receipt = await getReceipt(t1); // t1.blockNumber is null
      const blockNumber = receipt.logs[0].blockNumber;
      expect((await comp.callStatic.checkpoints(a1.address, 0)).slice(0, 2)).to.eql(([blockNumber,toEBN(80)]));
      expect((await comp.callStatic.checkpoints(a1.address, 1)).slice(0, 2)).to.eql(([0,toEBN(0)]));
      expect((await comp.callStatic.checkpoints(a1.address, 2)).slice(0, 2)).to.eql(([0,toEBN(0)]));


      const t4 = await comp.connect(root).transfer(guy.address, 20);

      expect(await comp.callStatic.numCheckpoints(a1.address)).equals(2);
      expect((await comp.callStatic.checkpoints(a1.address, 1)).slice(0, 2)).to.eql(([t4.blockNumber,toEBN(100)]));

    });
  });

  describe('getPriorVotes', () => {
    it('reverts if block number >= current block', async () => {
      await expect(comp.callStatic.getPriorVotes(a1.address, 5e10)).to.be.revertedWith("Comp::getPriorVotes: not yet determined");
    });

    it('returns 0 if there are no checkpoints', async () => {
      expect(await comp.callStatic.getPriorVotes(a1.address, 0)).equals(0);
    });

    it('returns the latest block if >= last checkpoint block', async () => {
      const t1 = await comp.connect(root).delegate(a1.address);
      await ethers.provider.send("evm_mine");
      await ethers.provider.send("evm_mine");

      expect(await comp.callStatic.getPriorVotes(a1.address, t1.blockNumber)).equals(toEBN('10000000000000000000000000'));
      expect(await comp.callStatic.getPriorVotes(a1.address, t1.blockNumber + 1)).equals(toEBN('10000000000000000000000000'));
    });

    it('returns zero if < first checkpoint block', async () => {
      await ethers.provider.send("evm_mine");
      const t1 = await comp.connect(root).delegate(a1.address);
      await ethers.provider.send("evm_mine");
      await ethers.provider.send("evm_mine");

      expect(await comp.callStatic.getPriorVotes(a1.address, t1.blockNumber - 1)).equals(toEBN('0'));
      expect(await comp.callStatic.getPriorVotes(a1.address, t1.blockNumber + 1)).equals(toEBN('10000000000000000000000000'));

    });

    it('generally returns the voting balance at the appropriate checkpoint', async () => {
      const t1 = await comp.connect(root).delegate(a1.address);
      await ethers.provider.send("evm_mine");
      await ethers.provider.send("evm_mine");
      const t2 = await comp.connect(root).transfer(a2.address, 10);
      await ethers.provider.send("evm_mine");
      await ethers.provider.send("evm_mine");
      const t3 = await comp.connect(root).transfer(a2.address, 10);
      await ethers.provider.send("evm_mine");
      await ethers.provider.send("evm_mine");
      const t4 = await comp.connect(a2).transfer(root.address, 20);
      await ethers.provider.send("evm_mine");
      await ethers.provider.send("evm_mine");

      expect(await comp.callStatic.getPriorVotes(a1.address, t1.blockNumber - 1)).equals(toEBN('0'));
      expect(await comp.callStatic.getPriorVotes(a1.address, t1.blockNumber)).equals(toEBN('10000000000000000000000000'));
      expect(await comp.callStatic.getPriorVotes(a1.address, t1.blockNumber+1)).equals(toEBN('10000000000000000000000000'));
      expect(await comp.callStatic.getPriorVotes(a1.address, t2.blockNumber)).equals(toEBN('9999999999999999999999990'));
      expect(await comp.callStatic.getPriorVotes(a1.address, t2.blockNumber+1)).equals(toEBN('9999999999999999999999990'));
      expect(await comp.callStatic.getPriorVotes(a1.address, t3.blockNumber)).equals(toEBN('9999999999999999999999980'));
      expect(await comp.callStatic.getPriorVotes(a1.address, t3.blockNumber+1)).equals(toEBN('9999999999999999999999980'));
      expect(await comp.callStatic.getPriorVotes(a1.address, t4.blockNumber)).equals(toEBN('10000000000000000000000000'));
      expect(await comp.callStatic.getPriorVotes(a1.address, t4.blockNumber+1)).equals(toEBN('10000000000000000000000000'));

    });
  });
});
