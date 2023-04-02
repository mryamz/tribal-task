const {both} = require('../Utils/Ethereum');
const { expect } = require("chai");

const {
  makeComptroller,
  makeCToken
} = require('../Utils/Compound');

describe('assetListTest', () => {
  let root, customer, accounts;
  let comptroller;
  let allTokens, OMG, ZRX, BAT, REP, DAI, SKT;

  beforeEach(async () => {
    [root, customer, ...accounts] = await ethers.getSigners();
    comptroller = await makeComptroller({maxAssets: 10});
    allTokens = [OMG, ZRX, BAT, REP, DAI, SKT] = await Promise.all(
      ['OMG', 'ZRX', 'BAT', 'REP', 'DAI', 'sketch']
        .map(async (name) => makeCToken({comptroller, name, symbol: name, supportMarket: name != 'sketch', underlyingPrice: 0.5}))
    );

  });

  async function checkMarkets(expectedTokens) {
    for (let token of allTokens) {
      const isExpected = expectedTokens.some(e => e.symbol == token.symbol);
      const result = await comptroller.checkMembership(customer.address, token.address);
      expect(result).equals(isExpected);
    }
  }

  async function enterAndCheckMarkets(enterTokens, expectedTokens, expectedErrors = null) {

    args = enterTokens.map(t => t.address);
    const reply = await comptroller.connect(customer).callStatic.enterMarkets(args);
    const transaction = await comptroller.connect(customer).enterMarkets(args);
    const receipt = await ethers.provider.getTransactionReceipt(transaction.hash);

    await comptroller.getAssetsIn(customer.address);
    const assetsIn = await comptroller.callStatic.getAssetsIn(customer.address);
    expectedErrors = expectedErrors || enterTokens.map(_ => 0);
    // expected error to be represented as integer
    // see contracts/ErrorReporter.sol for enum value error codes
    
    reply.forEach((tokenReply, i) => {
      expect(tokenReply.toNumber()).equals(expectedErrors[i]);
    });
    
    expect(receipt.status).equals(1);
    expect(assetsIn).to.eql(expectedTokens.map(t => t.address));
    
    await checkMarkets(expectedTokens);
    
    return transaction;
  };
  
  async function exitAndCheckMarkets(exitToken, expectedTokens, expectedError = 0) {

    const args = exitToken.address;
    const reply = await comptroller.connect(customer).callStatic.exitMarket(args);
    const transaction = await comptroller.connect(customer).exitMarket(args);
    const receipt = await ethers.provider.getTransactionReceipt(transaction.hash);

    const assetsIn = await comptroller.getAssetsIn(customer.address);
    expect(reply.toNumber()).equals(expectedError);
    //assert.trollSuccess(receipt); XXX enterMarkets cannot fail, but exitMarket can - kind of confusing
    expect(assetsIn).to.eql(expectedTokens.map(t => t.address));
    await checkMarkets(expectedTokens);
    return receipt;
  };
  
  describe('enterMarkets', () => {
    it("properly emits events", async () => {
      const result1 = await enterAndCheckMarkets([OMG], [OMG]);
      const result2 = await enterAndCheckMarkets([OMG], [OMG]);
      await expect(result1).to.emit(comptroller, "MarketEntered").withArgs(OMG.address, customer.address);
      const result2Receipt = await ethers.provider.getTransactionReceipt(result2.hash);
      // An empty Bloom filter is a bit array of m bits, all set to 0.
      expect(ethers.BigNumber.from(result2Receipt.logsBloom)).to.equal(0);
    });
    
    it("adds to the asset list only once", async () => {
      await enterAndCheckMarkets([OMG], [OMG]);
      await enterAndCheckMarkets([OMG], [OMG]);
      await enterAndCheckMarkets([ZRX, BAT, OMG], [OMG, ZRX, BAT]);
      await enterAndCheckMarkets([ZRX, OMG], [OMG, ZRX, BAT]);
      await enterAndCheckMarkets([ZRX], [OMG, ZRX, BAT]);
      await enterAndCheckMarkets([OMG], [OMG, ZRX, BAT]);
      await enterAndCheckMarkets([ZRX], [OMG, ZRX, BAT]);
      await enterAndCheckMarkets([BAT], [OMG, ZRX, BAT]);
    });
    
    it("the market must be listed for add to succeed", async () => {
      // Error Code 9 is 'MARKET_NOT_LISTED'
      await enterAndCheckMarkets([SKT], [], [9]);
      await comptroller._supportMarket(SKT.address);
      await enterAndCheckMarkets([SKT], [SKT]);
    });
    
    it("returns a list of codes mapping to user's ultimate membership in given addresses", async () => {
      await enterAndCheckMarkets([OMG, ZRX, BAT], [OMG, ZRX, BAT], [0, 0, 0], "success if can enter markets");
      await enterAndCheckMarkets([OMG, SKT], [OMG, ZRX, BAT], [0, 9], "error for unlisted markets");
    });
  });
  
  describe('exitMarket', () => {
    it("doesn't let you exit if you have a borrow balance", async () => {
      await enterAndCheckMarkets([OMG], [OMG]);
      await OMG.harnessSetAccountBorrows(customer.address, 1, 1);
      // NONZERO_BORROW_BALANCE Error code is 12
      await exitAndCheckMarkets(OMG, [OMG], 12);
    });
    
    it("rejects unless redeem allowed", async () => {
      await enterAndCheckMarkets([OMG, BAT], [OMG, BAT]);

      await BAT.harnessSetAccountBorrows(customer.address, 1, 1);
      
      // BAT has a negative balance and there's no supply, thus account should be underwater
      // REJECTION Error code is 14
      await exitAndCheckMarkets(OMG, [OMG, BAT], 14);
    });
    
    it("accepts when you're not in the market already", async () => {
      await enterAndCheckMarkets([OMG, BAT], [OMG, BAT]);
      
      // Not in ZRX, should exit fine
      await exitAndCheckMarkets(ZRX, [OMG, BAT], 0);
    });
    
    it("properly removes when there's only one asset", async () => {
      await enterAndCheckMarkets([OMG], [OMG]);
      await exitAndCheckMarkets(OMG, [], 0);
    });
    
    it("properly removes when there's only two assets, removing the first", async () => {
      await enterAndCheckMarkets([OMG, BAT], [OMG, BAT]);
      await exitAndCheckMarkets(OMG, [BAT], 0);
    });
    
    it("properly removes when there's only two assets, removing the second", async () => {
      await enterAndCheckMarkets([OMG, BAT], [OMG, BAT]);
      await exitAndCheckMarkets(BAT, [OMG], 0);
    });
    
    it("properly removes when there's only three assets, removing the first", async () => {
      await enterAndCheckMarkets([OMG, BAT, ZRX], [OMG, BAT, ZRX]);
      await exitAndCheckMarkets(OMG, [ZRX, BAT], 0);
    });
    
    it("properly removes when there's only three assets, removing the second", async () => {
      await enterAndCheckMarkets([OMG, BAT, ZRX], [OMG, BAT, ZRX]);
      await exitAndCheckMarkets(BAT, [OMG, ZRX], 0);
    });
    
    it("properly removes when there's only three assets, removing the third", async () => {
      await enterAndCheckMarkets([OMG, BAT, ZRX], [OMG, BAT, ZRX]);
      await exitAndCheckMarkets(ZRX, [OMG, BAT], 0);
    });
  });
  
  describe('entering from borrowAllowed', () => {
    it("enters when called by a ctoken", async () => {
      BAT.connect(customer).harnessCallBorrowAllowed(1);      
      const assetsIn = await comptroller.callStatic.getAssetsIn(customer.address);
      expect([BAT.address]).to.eql(assetsIn);
      await checkMarkets([BAT]);
    });
    
    it("reverts when called by not a ctoken", async () => {

      const transaction = comptroller.connect(customer).borrowAllowed(BAT.address, customer.address, 1);
      await expect(transaction).to.be.revertedWith("sender must be cToken");
        
      const assetsIn = await comptroller.getAssetsIn(customer.address);
        
      expect([]).to.eql(assetsIn);
        
      await checkMarkets([]);
      });
      
      it("adds to the asset list only once", async () => {
        await BAT.connect(customer).harnessCallBorrowAllowed(1);        
        await enterAndCheckMarkets([BAT], [BAT]);
        
        await BAT.connect(customer).harnessCallBorrowAllowed(1);
        const assetsIn = await comptroller.callStatic.getAssetsIn(customer.address);
        expect([BAT.address]).to.eql(assetsIn);
      });
  });
});
