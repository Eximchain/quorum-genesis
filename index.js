#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
var uniq = require('lodash.uniq');
const utils = require('ethereumjs-util');
let template = require('./template.json');

const CONFIG_FILENAME = 'quorum-config.json';
const OUTPUT = 'quorum-genesis.json';

const VOTING_CONTRACT_ADDR = '0x0000000000000000000000000000000000000020';
const GOVERNANCE_CONTRACT_ADDR = '0x000000000000000000000000000000000000002a';

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

function mapAddresses(index, addresses, storageAddress) {
  let value = utils.intToHex(1);
  for(let i=0; i<addresses.length; i++) {
    let key = storageKey(index, addresses[i]);
    template['alloc'][storageAddress].storage[key] = value;
  }
}

function buildVotingStorage(input) {
  template['alloc'][VOTING_CONTRACT_ADDR].storage[padIndex(1,true)] = utils.intToHex(input.threshold);
  template['alloc'][VOTING_CONTRACT_ADDR].storage[padIndex(2,true)] = utils.intToHex(input.voters.length);
  mapAddresses(3, input.voters, VOTING_CONTRACT_ADDR);
  template['alloc'][VOTING_CONTRACT_ADDR].storage[padIndex(4,true)] = utils.intToHex(input.makers.length);
  mapAddresses(5,input.makers, VOTING_CONTRACT_ADDR);
}

function buildGovernanceStorage(input){
  mapAddresses(0, input.owners, GOVERNANCE_CONTRACT_ADDR);
  template['alloc'][GOVERNANCE_CONTRACT_ADDR].storage[padIndex(1,true)] = utils.intToHex(input.owners.length);
}

function fundAddresses(input) {
  let all = uniq(input.makers
    .concat(input.voters)
    .concat(input.fundedObservers)
    .concat(input.owners));
  for(let i=0; i<all.length; i++) {
    template['alloc'][utils.addHexPrefix(all[i])] = { balance: "1000000000000000000000000000"};
  }
  template['alloc'][VOTING_CONTRACT_ADDR].balance = "1000000000000000000000000000";
  template['alloc'][GOVERNANCE_CONTRACT_ADDR].balance = "1000000000000000000000000000";
}

function setGasLimit(input) {
    template['gasLimit'] = input.gasLimit;
}

function loadConfig() {
  let fn = path.join(process.cwd(),CONFIG_FILENAME);
  if(!fs.existsSync(fn)) {
    console.log(` > Missing config file '${CONFIG_FILENAME}' in the current directory`);
    process.exit(1);
  }

  let contents = fs.readFileSync(fn);
  let json = JSON.parse(contents);

  if(!json.threshold || json.threshold < 1) {
    console.log(" > Voting threshold missing or less than 1" );
    process.exit(1);
  }

  if(!json.voters || json.voters.length < json.threshold) {
    console.log(" > Voter addresses missing or less than the threshold" );
    process.exit(1);
  }

  if(!json.makers || json.makers.length < 1) {
    console.log(" > Maker addresses missing or less than 1" );
    process.exit(1);
  }

  if (!json.owners || json.owners.length < 1 ) {
    // Default to using all validators as governance owners
    json.owners = json.voters;
  }

  if (!json.fundedObservers) {
    // Default to empty observer array for backwards compatibility
    json.fundedObservers = []
  }

  return json;
}

function main() {
  let input = loadConfig();
  buildVotingStorage(input);
  buildGovernanceStorage(input);
  setGasLimit(input);
  fundAddresses(input)
  fs.writeFileSync(path.join(process.cwd(),OUTPUT), JSON.stringify(template, null, 2));
}

main();
