#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const utils = require('ethereumjs-util');
let template = require('./template.json');

const CONFIG_FILENAME = 'quorum-config.json';
const OUTPUT = 'quorum-genesis.json';

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

function mapAddresses(index, addresses) {
  let value = '0x01';
  for(let i=0; i<addresses.length; i++) {
    let key = storageKey(index, addresses[i]);
    template['alloc']['0x0000000000000000000000000000000000000020'].storage[key] = value;
  }
}

function buildStorage(input) {
  template['alloc']['0x0000000000000000000000000000000000000020'].storage[padIndex(1,true)] = utils.intToHex(0);
  template['alloc']['0x0000000000000000000000000000000000000020'].storage[padIndex(2,true)] = utils.intToHex(input.voters.length);
  mapAddresses(3, input.voters);
  template['alloc']['0x0000000000000000000000000000000000000020'].storage[padIndex(4,true)] = utils.intToHex(input.makers.length);
  mapAddresses(5,input.makers);
}

function fundAddresses(input) {
  let all = input.voters.concat(input.makers.concat(input.fundedObservers.concat(['0x0000000000000000000000000000000000000020'])));
  for(let i=0; i<all.length; i++) {
    template['alloc'][utils.addHexPrefix(all[i])] = { balance: "1000000000000000000000000000"};
  }
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

  if(!json.makers || json.makers.length < 1) {
    console.log(" > BlockMaker addresses missing or less than 1" );
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
  buildStorage(input);
  setGasLimit(input);
  fundAddresses(input)
  fs.writeFileSync(path.join(process.cwd(),OUTPUT), JSON.stringify(template, null, 2));
}

main();
