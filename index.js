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

// This fork is for testing how the mobile client works with the
// network, going to prefund its address.  Just in case somebody
// else wants to test using the same account, here's the key info
// for regenerating the test wallet.
//
// seed: "dial worth chase zebra hip art copper upgrade right asset earn caution"
// pass: "password"
const MOBILE_ADDR = '0x53fd44c705473ee2d780fe8f5278076f2171ca65';

function toWei(ethAmount) {
  return ethAmount.toString() + "000000000000000000"
}
const TOKENSUPPLY = 150000000;
const EXIMCHAINESCROWAMOUNT = TOKENSUPPLY*0.4
const EXIMCHAINESCROW = {"addresses": 
  [
    "0x5ffd8B1031b97f7b23FA0D0BF5faf594FC15dED8",
    "0x05EbBD539cf3E017B86c33E83a904a669e6d3F68",
    "0xE106755E59A26a0C87E83B6A507C1a456787bFd0",
    "0xDd85F8Fe23F6b054Bce18Df725a07Cb24bb1e2FE",
    "0xd919E37AF7cC1eA169dF9ea21215C2f5B5A215a6"
  ]
}
//INCLUDES OUR BONUS ACCOUNT
const TOKENSWAPESCROWAMOUNT = TOKENSUPPLY*0.5 
const TOKENSWAPESCROW = {"addresses": 
  [
    "0x3E32c75e53bcbE5EA694Df7aDAe88D24Ce5dd52c",
    "0x179445629addE906A9AC2f3710ff9BEa2F7A41Ad",
    "0xcFc19f53bb1C0289a2B9296e9eC1968F045f542F"
  ]
}
//TO BE DISTRIBUTED TO VALIDATORS AND OWNERS TO ADMINISTER THE NETWORK
const RESERVEESCROWAMOUNT = TOKENSUPPLY*0.1
const RESERVEESCROW = {"addresses": 
  [
    "0x7c8c01532d15Ce0BEa5cdff2A752188Ffa3C0079"
  ]
}


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

  //DISTRIBUTE OPERATIONAL RESERVES
  let reserveAddresses = uniq(input.voters
    .concat(input.owners)
    .concat(RESERVEESCROW.addresses));
  reserveAddresses.push(MOBILE_ADDR);
  let reserveAmount = Math.ceil(RESERVEESCROWAMOUNT/reserveAddresses.length)
  for(let i=0; i<reserveAddresses.length; i++) {
    template['alloc'][utils.addHexPrefix(reserveAddresses[i])] = { balance: toWei(reserveAmount)};
  }

  //DISTRIBUTE EXIMCHAIN ESCROW
  let eximchainAddresses = uniq(EXIMCHAINESCROW.addresses);
  let eximchainAmount = Math.ceil(EXIMCHAINESCROWAMOUNT/eximchainAddresses.length)
  for(let i=0; i<eximchainAddresses.length; i++) {
    template['alloc'][utils.addHexPrefix(eximchainAddresses[i])] = { balance: toWei(eximchainAmount)};
  }

  //DISTRIBUTE TOKENSWAP ESCROW
  let tokenswapAddresses =  uniq(TOKENSWAPESCROW.addresses)
  let shardedAmount = Math.ceil(TOKENSWAPESCROWAMOUNT/tokenswapAddresses.length)
  for(let i=0; i<tokenswapAddresses.length; i++) {
    template['alloc'][utils.addHexPrefix(tokenswapAddresses[i])] = { balance: toWei(shardedAmount)};
  }

  template['alloc'][VOTING_CONTRACT_ADDR].balance = "1";
  template['alloc'][GOVERNANCE_CONTRACT_ADDR].balance = "1";
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
    json.owners = uniq(json.voters.concat(RESERVEESCROW.addresses));
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
