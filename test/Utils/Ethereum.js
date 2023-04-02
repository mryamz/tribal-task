"use strict";
const { ethers } = require('hardhat');
const BigNumber = require('bignumber.js');
const { Interface, FormatTypes, Logger } = require('ethers/lib/utils');
const { assert } = require('chai');
const provider = waffle.provider;



Logger.setLogLevel(Logger.levels.ERROR);

BigNumber.config({ EXPONENTIAL_AT: 78 })

function UInt256Max() {
  return ethers.constants.MaxUint256;
}

function address(n) {
  return `0x${n.toString(16).padStart(40, '0')}`;
}

function encodeParameters(types, values) {
  return ethers.utils.defaultAbiCoder.encode(types, values);
}

async function etherBalance(addr) {
  return await ethers.provider.getBalance(addr);
}

async function etherGasCost(transactionResponse) {
  const { cumulativeGasUsed, effectiveGasPrice } = await (await transactionResponse).wait();
  return cumulativeGasUsed.mul(effectiveGasPrice);
}

function etherExp(num) { return etherMantissa(num, 1e18) }

function etherDouble(num) { return etherMantissa(num, 1e36) }

function toEBN(num) {
  return ethers.BigNumber.from(toBN(num).toString())
}

function toBN(num) {
  return new BigNumber(typeof num.toString === "function" ? num.toString() : num)
}


function etherMantissa(num, scale = 1e18) {
  if (num < 0)
    return new BigNumber(2).pow(256).plus(num);
  return new BigNumber(num).times(scale);
}

function etherUnsigned(num) {
  return new BigNumber(num);
}

function mergeInterface(into, from) {
  // into and from: must be a contract with abi representable as json
  var intoJsonInterface = JSON.parse(into.interface.format(FormatTypes.json));
  var fromJsonInterface = JSON.parse(from.interface.format(FormatTypes.json));


  const key = (item) => item.inputs ? `${item.name}/${item.inputs.length}` : item.name;

  // create abi data with interfaces from @into
  // generate list of contract interfaces that are contained in @into
  const existing = intoJsonInterface.reduce((acc, item) => {
    acc[key(item)] = true;
    return acc;
  }, {});

  // if the @from abi data has an interface difference from @into, merge it.
  const extended = fromJsonInterface.reduce((acc, item) => {
    if (!(key(item) in existing)) {
      acc.push(item);
    }

    return acc;
  }, intoJsonInterface.slice());

  return new ethers.Contract(into.address, new Interface(extended), into.signer);
  //return 0;
}



function getContractDefaults() {
  return { gas: 20000000, gasPrice: 20000 };
}

function keccak256(values) {
  return ethers.utils.keccak256(values);
}


async function mineBlockNumber(blockNumber) {
  return rpc({ method: 'evm_mineBlockNumber', params: [blockNumber] });
}

async function mineBlock() {
  await ethers.provider.send("evm_mine");
}

async function increaseTime(seconds) {
  await rpc({ method: 'evm_increaseTime', params: [seconds] });
  return rpc({ method: 'evm_mine' });
}

async function setTime(seconds) {
  await rpc({ method: 'evm_setTime', params: [new Date(seconds * 1000)] });
}

async function freezeTime(seconds) {
  await rpc({ method: 'evm_freezeTime', params: [seconds] });
  return rpc({ method: 'evm_mine' });
}

async function advanceBlocks(blocks) {
  timeAndMine.setTimeIncrease(1);
  for (let i = 0; i < blocks; i++) {
    timeAndMine.mine();
  }
}

async function blockNumber() {
  let { result: num } = await rpc({ method: 'eth_blockNumber' });
  return parseInt(num);
}

async function minerStart() {
  return rpc({ method: 'miner_start' });
}

async function minerStop() {
  return rpc({ method: 'miner_stop' });
}

async function getReceipt(transactionResponse) {
  return (await (await transactionResponse).wait())
}

async function rpc(request) {
  return new Promise((okay, fail) => provider.send(JSON.stringify(request), JSON.stringify((err, res) => err ? fail(err) : okay(res))));
}

async function both(contract, method, args = [], opts = {}) {
  const reply = await contract.callStatic[method](args, opts);
  const receipt = await contract[method](args, opts);
  return { reply, receipt };
}

async function sendFallback(contract, minter, opts = {}) {
  const txData = {to: contract.address, ...Object.assign(opts)};
  const populatedTx = await minter.populateTransaction(txData)
  return minter.sendTransaction(populatedTx);
}

async function getEvents(tx) {
  const args = [];
  (await tx.wait()).events.forEach((e) => { args.push(e.event); args.push(e.args) });
  return args.flat(1);
}

async function hasEvent(tx, event) {
  const events = await getEvents(tx);
  return hasSubArray(events, event);
}

async function getCurrentBlock() {
  return ethers.provider.getBlock(await ethers.provider.getBlockNumber());
}

function hasSubArray(A, B) {
  var i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (deepEqual(A[i], B[j])) {

      i++;
      j++;

      if (j == B.length){
        return true

      }
    } else {
      i = i - j + 1;
      j = 0;
    }
  }

  return false;
}

function deepEqual(a, b) {
  try {
    assert.deepEqual(a, b);
  } catch (error) {
    if (error.name === "AssertionError") {
      return false;
    }
    throw error;
  }
  return true;
};

async function getEvents(tx) {
  const args = [];
  (await tx.wait()).events.forEach((e) => { args.push(e.event); args.push(e.args) });
  return args.flat(1);
}

module.exports = {
  address,
  encodeParameters,
  etherBalance,
  etherGasCost,
  etherExp,
  toEBN,
  getEvents,
  hasEvent,
  toBN,
  getEvents,
  getCurrentBlock,
  getReceipt,
  deepEqual,
  etherDouble,
  etherMantissa,
  etherUnsigned,
  mergeInterface,
  keccak256,

  advanceBlocks,
  blockNumber,
  freezeTime,
  increaseTime,
  mineBlock,
  mineBlockNumber,
  minerStart,
  minerStop,
  rpc,
  setTime,

  both,
  sendFallback,
  UInt256Max
};
