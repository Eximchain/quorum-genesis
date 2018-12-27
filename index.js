#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const utils = require('ethereumjs-util');
let template = require('./template.json');

const CONFIG_FILENAME = 'quorum-config.json';
const OUTPUT = 'quorum-genesis.json';
const BV_ADDR = '0x0000000000000000000000000000000000000020';
const WEYL_ADDR = '0x000000000000000000000000000000000000002A';

// Expected hashes per second that we expect the average maker to produce at network initialization
// Used to calculate the initial difficulty
const EXPECTED_MAKER_HASHRATE = 50000;

function padIndex(number, prefix) {
  if(prefix) {
    return utils.addHexPrefix(utils.setLengthLeft([number], 32, false).toString('hex'));
  }
  return utils.setLengthLeft([number], 32, false).toString('hex');
}

function padAddress(address) {
  return "000000000000000000000000" + utils.stripHexPrefix(address);
}

function storageKey(index, address) {
  let paddedAddress = padAddress(address);
  let paddedIndex = padIndex(index);
  let result = utils.sha3(new Buffer(paddedAddress+paddedIndex, 'hex')).toString('hex');
  return utils.addHexPrefix(result)
}

function mapAddressesAt(alloc, index, addresses) {
  let value = '0x01';
  for(let i=0; i<addresses.length; i++) {
    let key = storageKey(index, addresses[i]);
    template['alloc'][alloc].storage[key] = value;
  }
}

function buildBlockVotingStorage(input) {
  template['alloc'][BV_ADDR].storage[padIndex(1,true)] = utils.addHexPrefix(utils.setLengthLeft([0], 1, false).toString('hex'));
  template['alloc'][BV_ADDR].storage[padIndex(2,true)] = utils.addHexPrefix(utils.setLengthLeft([input.voters.length], 1, false).toString('hex'));
  mapAddressesAt(BV_ADDR, 3, input.voters);
  template['alloc'][BV_ADDR].storage[padIndex(4,true)] = utils.addHexPrefix(utils.setLengthLeft([input.makers.length], 1, false).toString('hex'));
  mapAddressesAt(BV_ADDR, 5,input.makers);
}

function buildGovernanceStorage(input){
  mapAddressesAt(WEYL_ADDR, 0, input.voters);
  template['alloc'][WEYL_ADDR].storage[padIndex(1, true)] = utils.addHexPrefix(utils.setLengthLeft([input.voters.length], 1, false).toString('hex'));
}

function fundAddresses(input) {
  let all = input.voters.concat(input.makers.concat(input.fundedObservers));
  for(let i=0; i<all.length; i++) {
    template['alloc'][utils.addHexPrefix(all[i])] = { balance: "1000000000000000000000000000"};
  }
  template['alloc'][BV_ADDR].balance = '0';
  template['alloc'][WEYL_ADDR].balance = '0'
}

function setGasLimit(input) {
    template['gasLimit'] = input.gasLimit;
}

function setDifficulty(input) {
  let desiredSecondsPerBlock = 10;
  template['difficulty'] = utils.intToHex(EXPECTED_MAKER_HASHRATE * desiredSecondsPerBlock * input.makers.length);
}

function setChainID(input) {
  template['config']['chainID'] = input.chainID;
}

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
  let input = loadConfig();
  buildBlockVotingStorage(input);
  buildGovernanceStorage(input);
  setGasLimit(input);
  setDifficulty(input);
  setChainID(input);
  fundAddresses(input)
  fs.writeFileSync(path.join(process.cwd(),OUTPUT), JSON.stringify(template, null, 2));
}

main();
