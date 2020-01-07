#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const utils = require('ethereumjs-util');
const merge = require('lodash.merge');
const BigNum = require('bignumber.js');
let template = require('./template.json');
const saleAddresses = require('./eximSaleInput.json');
const CONFIG_FILENAME = 'quorum-config.json';
const OUTPUT = 'quorum-genesis.json';
const BV_ADDR = '0x0000000000000000000000000000000000000020';
const WEYL_ADDR = '0x000000000000000000000000000000000000002A';
const REMAINDER_ADDR = '0x9153A2a04cc57B486AB82bC0bE341DCa367B7934';

// Expected hashes per second that we expect the average maker to produce at network initialization
// Used to calculate the initial difficulty
const EXPECTED_MAKER_HASHRATE = 50000;

/**
 * Given an index (non-negative integer), return it as a
 * hex string left-padded to 32 chars. Pass prefix boolean
 * as `true` to get an '0x' prefix.
 * @param {number} index 
 * @param {boolean} prefix 
 */
function padIndex(index, prefix) {
  if(prefix) {
    return utils.addHexPrefix(utils.setLengthLeft([index], 32, false).toString('hex'));
  }
  return utils.setLengthLeft([index], 32, false).toString('hex');
}

/**
 * Given an Ethereum address (40 characters after removing '0x'),
 * left-pad with '0's to get a 64-char un-prefixed hex string.
 * @param {string} address 
 */
function padAddress(address) {
  return "000000000000000000000000" + utils.stripHexPrefix(address);
}

/**
 * Given a Mapping variable's index and a key to store, return
 * an '0x'-prefixed hex string for use in the "storage" object
 * @param {number} index 
 * @param {string} address 
 */
function storageKey(index, address) {
  let paddedAddress = padAddress(address);
  let paddedIndex = padIndex(index);
  let result = utils.sha3(new Buffer(paddedAddress+paddedIndex, 'hex')).toString('hex');
  return utils.addHexPrefix(result)
}

/**
 * Given a contract address, a variable index, and an array of
 * addresses, add all of the key-value pairs so each address
 * has a `true` value in that map.  Globally modifies the
 * `template` object.
 * 
 * @param {*} alloc 
 * @param {*} index 
 * @param {*} addresses 
 */
function mapAddressesAt(alloc, index, addresses) {
  let value = '0x01';
  for(let i=0; i<addresses.length; i++) {
    let key = storageKey(index, addresses[i]);
    template['alloc'][alloc].storage[key] = value;
  }
}

/**
 * Configure the BlockVoting contract. In the POW model,
 * the voting threshold is 0.  We use the `voters` key to set
 * `voterCount` & `canVote`, then the `makers` key to set
 * `canCreateBlocks` and `blockMakerCount`.
 * @param {*} config 
 */
function buildBlockVotingStorage(config) {
  template['alloc'][BV_ADDR].storage[padIndex(1,true)] = utils.addHexPrefix(utils.setLengthLeft([0], 1, false).toString('hex'));
  template['alloc'][BV_ADDR].storage[padIndex(2,true)] = utils.addHexPrefix(utils.setLengthLeft([config.voters.length], 1, false).toString('hex'));
  mapAddressesAt(BV_ADDR, 3, config.voters);
  template['alloc'][BV_ADDR].storage[padIndex(4,true)] = utils.addHexPrefix(utils.setLengthLeft([config.makers.length], 1, false).toString('hex'));
  mapAddressesAt(BV_ADDR, 5,config.makers);
}

/**
 * Set initial values for `owners` and `numOwners` in the
 * `WeylGovDeployable.sol` contract.  The contract is owned
 * by all of the addresses in the config's `voter` key, as 
 * well as the REMAINDER_ADDR which stores all excess EXC.
 * @param {*} config 
 */
function buildGovernanceStorage(config){
  const govOwners = config.voters.concat([REMAINDER_ADDR]);
  mapAddressesAt(WEYL_ADDR, 0, govOwners);
  template['alloc'][WEYL_ADDR].storage[padIndex(1, true)] = utils.addHexPrefix(utils.setLengthLeft([govOwners.length], 1, false).toString('hex'));
}

/**
 * Must be called after setting all initial balances.
 * 
 * Starting from a max initial supply of 150000000 EXC,
 * go through every address in initial storage and subtract
 * its balance from the initial total. Finally, give the
 * remaining value to the REMAINDER_ADDR above.
 */
function fundAddresses() {
  let allocatedBalance = new BigNum(0);
  template['alloc'][BV_ADDR].balance = '0';
  template['alloc'][WEYL_ADDR].balance = '0'
  template = merge(template, saleAddresses);
  for (var addr in template.alloc){
    if (template.alloc[addr].balance) allocatedBalance = allocatedBalance.plus(new BigNum(template.alloc[addr].balance))
  }
  const remainderVal = new BigNum(150000000).shiftedBy(18).minus(allocatedBalance)
  console.log(`Found we had allocated ${allocatedBalance.shiftedBy(-18).toString()} EXC, putting remaining ${remainderVal.shiftedBy(-18).toString()} into REMAINDER_ADDR.`)
  template.alloc[REMAINDER_ADDR] = { balance : remainderVal.toString(10) };
}

/**
 * Set the template's `gasLimit` to whatever is included in the config.
 * @param {*} config 
 */
function setGasLimit(config) {
    template['gasLimit'] = config.gasLimit;
}

/**
 * Given the block config, uses the number of makers to calculate
 * a difficulty for a desired 10 seconds per block.  Uses the
 * `EXPECTED_MAKER_HASHRATE` constant to calculate this estimate.
 * @param {*} config 
 */
function setDifficulty(config) {
  let desiredSecondsPerBlock = 10;
  template['difficulty'] = utils.intToHex(EXPECTED_MAKER_HASHRATE * desiredSecondsPerBlock * config.makers.length);
}

/**
 * Sets the template's `chainID` to whatever is included in the config
 * @param {*} config 
 */
function setChainID(config) {
  template['config']['chainID'] = config.chainID;
}

/**
 * Parse and return the genesis block config object.
 */
function loadConfig() {
  let fn = path.join(process.cwd(),CONFIG_FILENAME);
  if(!fs.existsSync(fn)) {
    console.log(` > Missing config file '${CONFIG_FILENAME}' in the current directory`);
    process.exit(1);
  }

  let contents = fs.readFileSync(fn);
  let json = JSON.parse(contents);

  if(!json.makers || json.makers.length < 1) {
    console.log(" > BlockMaker addresses missing or less than 1" );
    process.exit(1);
  }

  if(!json.chainID) {
    console.log(" > chainID not found in config");
    process.exit(1);
  }

  if(!json.voters) {
    // Voters no longer required
    json.voters = [];
  }

  if(!json.fundedObservers) {
    // Just use empty list for backwards compatibility
    json.fundedObservers = [];
  }

  return json;
}

function main() {
  let config = merge(loadConfig(), saleAddresses);
  buildBlockVotingStorage(config);
  buildGovernanceStorage(config);
  setGasLimit(config);
  setDifficulty(config);
  setChainID(config);
  fundAddresses()
  fs.writeFileSync(path.join(process.cwd(),OUTPUT), JSON.stringify(template, null, 2));
}

main();
