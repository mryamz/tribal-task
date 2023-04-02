const {
  address,
  encodeParameters,
  toEBN,
} = require('../Utils/Ethereum');
const {
  makeComptroller,
  makeCToken,
} = require('../Utils/Compound');

const { ethers } = require('hardhat');
const { BigNumber } = require('bignumber.js');
const { expect } = require('chai');

function cullTuple(tuple) {
  return Object.keys(tuple).reduce((acc, key) => {
    if (Number.isNaN(Number(key))) {
      return {
        ...acc,
        [key]: tuple[key]
      };
    } else {
      return acc;
    }
  }, {});
}

describe('CompoundLens', () => {
  let compoundLens;
  let acct;

  beforeEach(async () => {
    CompoundLens = await ethers.getContractFactory('CompoundLens');
    compoundLens = await CompoundLens.deploy();
    await compoundLens.deployed();

    acct = (await ethers.getSigners())[0];
  });

  describe('cTokenMetadata', () => {
    it('is correct for a cErc20', async () => {
      let cErc20 = await makeCToken();
      const result = await compoundLens.callStatic.cTokenMetadata(cErc20.address);
      expect(
        cullTuple(result)
      ).to.eql(
        {
          cToken: cErc20.address,
          exchangeRateCurrent: toEBN("1000000000000000000"),
          supplyRatePerBlock: toEBN("0"),
          borrowRatePerBlock: toEBN("0"),
          reserveFactorMantissa: toEBN("0"),
          totalBorrows: toEBN("0"),
          totalReserves: toEBN("0"),
          totalSupply: toEBN("0"),
          totalCash: toEBN("0"),
          isListed: false,
          collateralFactorMantissa: toEBN("0"),
          underlyingAssetAddress: (await cErc20.underlying()).toString(),
          cTokenDecimals: toEBN("8"),
          underlyingDecimals: toEBN("18")
        }
      );
    });

    it('is correct for cEth', async () => {
      let cEth = await makeCToken({ kind: 'cether' });
      const result = await compoundLens.callStatic.cTokenMetadata(cEth.address);
      expect(
        cullTuple(result)
      ).to.eql({
        borrowRatePerBlock: toEBN("0"),
        cToken: cEth.address,
        cTokenDecimals: toEBN("8"),
        collateralFactorMantissa: toEBN("0"),
        exchangeRateCurrent: toEBN("1000000000000000000"),
        isListed: false,
        reserveFactorMantissa: toEBN("0"),
        supplyRatePerBlock: toEBN("0"),
        totalBorrows: toEBN("0"),
        totalCash: toEBN("0"),
        totalReserves: toEBN("0"),
        totalSupply: toEBN("0"),
        underlyingAssetAddress: "0x0000000000000000000000000000000000000000",
        underlyingDecimals: toEBN("18"),
      });
    });
  });

  describe('cTokenMetadataAll', () => {
    it('is correct for a cErc20 and cEther', async () => {
      let cErc20 = await makeCToken();
      let cEth = await makeCToken({ kind: 'cether' });
      const result = (await compoundLens.callStatic.cTokenMetadataAll([cErc20.address, cEth.address])).map(cullTuple);
      expect(result).to.eql(
        [
          {
            cToken: cErc20.address,
            exchangeRateCurrent: toEBN("1000000000000000000"),
            supplyRatePerBlock: toEBN("0"),
            borrowRatePerBlock: toEBN("0"),
            reserveFactorMantissa: toEBN("0"),
            totalBorrows: toEBN("0"),
            totalReserves: toEBN("0"),
            totalSupply: toEBN("0"),
            totalCash: toEBN("0"),
            isListed: false,
            collateralFactorMantissa: toEBN("0"),
            underlyingAssetAddress: (await cErc20.underlying()).toString(),
            cTokenDecimals: toEBN("8"),
            underlyingDecimals: toEBN("18")
          },
          {
            cToken: cEth.address,
            exchangeRateCurrent: toEBN("1000000000000000000"),
            supplyRatePerBlock: toEBN("0"),
            borrowRatePerBlock: toEBN("0"),
            reserveFactorMantissa: toEBN("0"),
            totalBorrows: toEBN("0"),
            totalReserves: toEBN("0"),
            totalSupply: toEBN("0"),
            totalCash: toEBN("0"),
            isListed: false,
            collateralFactorMantissa: toEBN("0"),
            underlyingAssetAddress: ethers.constants.AddressZero.toString(),
            cTokenDecimals: toEBN("8"),
            underlyingDecimals: toEBN("18"),
          }
        ]
      );
    });

  });

  describe('cTokenBalances', () => {
    it('is correct for cERC20', async () => {
      let cErc20 = await makeCToken();
      const result = await compoundLens.callStatic.cTokenBalances(cErc20.address, acct.address);
      expect(
        cullTuple(result)
      ).to.eql(
        {
          balanceOf: toEBN("0"),
          balanceOfUnderlying: toEBN("0"),
          borrowBalanceCurrent: toEBN("0"),
          cToken: cErc20.address,
          tokenAllowance: toEBN("0"),
          tokenBalance: toEBN("10000000000000000000000000"),
        }
      );
    });

    it('is correct for cETH', async () => {
      let cEth = await makeCToken({ kind: 'cether' });
      let ethBalance = await acct.getBalance();
      const result = cullTuple(await compoundLens.callStatic.cTokenBalances(cEth.address, acct.address));
      expect(result).to.eql(
        {
          balanceOf: toEBN("0"),
          balanceOfUnderlying: toEBN("0"),
          borrowBalanceCurrent: toEBN("0"),
          cToken: cEth.address,
          tokenAllowance: ethBalance,
          tokenBalance: ethBalance,
        }
      );
    });

  });

  describe('cTokenBalancesAll', () => {
    it('is correct for cEth and cErc20', async () => {
      let cErc20 = await makeCToken();
      let cEth = await makeCToken({ kind: 'cether' });
      let ethBalance = await acct.getBalance();

      const result = (await compoundLens.callStatic.cTokenBalancesAll([cErc20.address, cEth.address], acct.address)).map(cullTuple);

      expect(result).to.eql(
        [
          {
            balanceOf: toEBN("0"),
            balanceOfUnderlying: toEBN("0"),
            borrowBalanceCurrent: toEBN("0"),
            cToken: cErc20.address,
            tokenAllowance: toEBN("0"),
            tokenBalance: toEBN("10000000000000000000000000"),
          },
          {
            balanceOf: toEBN("0"),
            balanceOfUnderlying: toEBN("0"),
            borrowBalanceCurrent: toEBN("0"),
            cToken: cEth.address,
            tokenAllowance: ethBalance,
            tokenBalance: ethBalance,
          }
        ]
      );
    });
  });

  describe('cTokenUnderlyingPrice', () => {
    it('gets correct price for cErc20', async () => {
      let cErc20 = await makeCToken();
      const result = cullTuple(await compoundLens.callStatic.cTokenUnderlyingPrice(cErc20.address));
      expect(result).to.eql(
        {
          cToken: cErc20.address,
          underlyingPrice: toEBN("0")
        }
      );
    });

    it('gets correct price for cEth', async () => {
      let cEth = await makeCToken({ kind: 'cether' });
      const result = cullTuple(await compoundLens.callStatic.cTokenUnderlyingPrice(cEth.address));
      expect(result).to.eql(
        {
          cToken: cEth.address,
          underlyingPrice: toEBN("1000000000000000000"),
        }
      );



    });
  });

  describe('cTokenUnderlyingPriceAll', () => {
    it('gets correct price for both', async () => {
      let cErc20 = await makeCToken();
      let cEth = await makeCToken({ kind: 'cether' });
      const result = (await compoundLens.callStatic.cTokenUnderlyingPriceAll([cErc20.address, cEth.address])).map(cullTuple);
      expect(result).to.eql(
        [
          {
            cToken: cErc20.address,
            underlyingPrice: toEBN("0"),
          },
          {
            cToken: cEth.address,
            underlyingPrice: toEBN("1000000000000000000"),
          }
        ]
      )
    });
  });

  describe('getAccountLimits', () => {
    it('gets correct values', async () => {
      let comptroller = await makeComptroller();
      const result = cullTuple(await compoundLens.callStatic.getAccountLimits(comptroller.address, acct.address));
      expect(result).to.eql(
        {
          liquidity: toEBN("0"),
          markets: [],
          shortfall: toEBN("0")
        });
    });
  });

  describe('governance', () => {
    let comp, gov;
    let targets, values, signatures, callDatas;
    let proposalBlock, proposalId;

    beforeEach(async () => {
      const Comp = await ethers.getContractFactory('Comp');
      comp = await Comp.deploy(acct.address);
      await comp.deployed();

      const Gov = await ethers.getContractFactory('contracts/Governance/GovernorAlpha.sol:GovernorAlpha');
      gov = await Gov.deploy(ethers.constants.AddressZero, comp.address, ethers.constants.AddressZero);
      gov.deployed();

      targets = [acct.address];
      values = ["0"];
      signatures = ["getBalanceOf(address)"];
      callDatas = [encodeParameters(['address'], [acct.address])];

      await comp.delegate(acct.address);
      await gov.propose(targets, values, signatures, callDatas, "do nothing");

      proposalBlock = +(await ethers.provider.getBlockNumber());
      proposalId = await gov.latestProposalIds(acct.address);
    });

    describe('getGovReceipts', () => {
      it('gets correct values', async () => {
        const result = (await compoundLens.getGovReceipts(gov.address, acct.address, [proposalId])).map(cullTuple);
        expect(result).to.eql(
          [
            {
              hasVoted: false,
              proposalId: proposalId,
              support: false,
              votes: toEBN("0"),
            }
          ]
        );
      })
    });

    describe('getGovProposals', () => {
      it('gets correct values', async () => {
        const result = (await compoundLens.callStatic.getGovProposals(gov.address, [proposalId])).map(cullTuple);
        expect(result).to.eql(
          [
            {
              proposalId: proposalId,
              proposer: acct.address,
              targets: targets,
              eta: toEBN("0"),
              signatures: signatures,
              calldatas: callDatas,
              startBlock: toEBN(proposalBlock + 1),
              endBlock: toEBN(proposalBlock + 17281),
              forVotes: toEBN("0"),
              againstVotes: toEBN("0"),
              canceled: false,
              executed: false
            }
          ]
        );
      })
    });
  });

  describe('comp', () => {
    let comp, currentBlock;

    beforeEach(async () => {
      currentBlock = +(await ethers.provider.getBlockNumber());
      const Comp = await ethers.getContractFactory('Comp');
      comp = await Comp.deploy(acct.address);
      await comp.deployed();
    });

    describe('getCompBalanceMetadata', () => {
      it('gets correct values', async () => {
        const result = cullTuple(await compoundLens.callStatic.getCompBalanceMetadata(comp.address, acct.address));
        expect(result).to.eql(
          {
            balance: toEBN("10000000000000000000000000"),
            delegate: ethers.constants.AddressZero.toString(),
            votes: toEBN("0"),
          }
        );
      });
    });

    describe('getCompBalanceMetadataExt', () => {
      it('gets correct values', async () => {
        let comptroller = await makeComptroller();
        await comptroller.setCompAccrued(acct.address, 5);
        const result = cullTuple(await compoundLens.callStatic.getCompBalanceMetadataExt(comp.address, comptroller.address, acct.address));
        expect(result).to.eql({
          balance: toEBN("10000000000000000000000000"),
          delegate: ethers.constants.AddressZero.toString(),
          votes: toEBN("0"),
          allocated: toEBN("5")
        });
      });
    });

    describe('getCompVotes', () => {
      it('gets correct values', async () => {
        const result = (await compoundLens.callStatic.getCompVotes(comp.address, acct.address, [currentBlock, currentBlock - 1])).map(cullTuple);
        expect(result).to.eql(
        [
          {
            blockNumber: toEBN(currentBlock),
            votes: toEBN("0"),
          },
          {
            blockNumber: toEBN(currentBlock - 1),
            votes: toEBN("0"),
          }
        ]);
      });

      it('reverts on future value', async () => {
        const result = compoundLens.getCompVotes(comp.address, acct.address, [currentBlock + 1]);
        await expect(result).to.be.revertedWith('Comp::getPriorVotes: not yet determined')
      });
    });

  });
});
