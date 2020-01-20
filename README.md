Quorum-Genesis
==============

Very simple utility for [Quorum](https://github.com/jpmorganchase/quorum) to help
populate the genesis file with voters and blockmakers. Runs from the commandline

Setup
-----
 * Install Node.js
 * Install this package globally `npm install -g`


Use
---

 1. Create a `quorum-config.json` file
 2. Run `quorum-genesis` from a terminal in the same directory as the config file
 3. It will output `quorum-genesis.json`


The `quorum-config.json` should be in the following format:

```json
{
  "chainID": 1,
  "makers": ["0xca843569e3427144cead5e4d5999a3d0ccf92b8e"],
  "voters": [
    "0x0fbdc686b912d7722dc86510934589e0aaf3b55a",
    "0x9186eb3d20cbd1f5f992a950d808c4495153abd5",
    "0x0638e1574728b6d862dd5d3a3e0942c3be47d996"
  ]
}
```

Where:
* `chainID` is mandatory & will be the block's `chainID`
* `makers` is mandatory & will be used to set the blockmakers on the BlockVoting contract.  The number of makers is also used to calculate the initial difficulty (`EXPECTED_HASHRATE * numMakers * DESIRED_SECONDS_PER_BLOCK`).
* `voters` is optional. They will be set as voters on the BlockMaking contract, but in the POW model, voters are unnecessary.  If specified, they will be included among the owners of the WeylGov contract.
* `gasLimit` is optional, and if specified, will be included as the block's `gasLimit`.

How Does EVM Storage Work
---

Fundamentally, this script uses a template and the above config to lay out initial storage values for our two governance smart contracts.  Its functions make more sense if you understand how Ethereum represents contract storage.  The genesis block has an `alloc` key which allows us to give any address some `code`, `storage`, or a `balance`.  `code` is for contract bytecode, `balance` is initial gas.  `storage` allows you to create initial values for the state variables declared in the smart contract's source.

The genesis block represents state in a flat object.  Each state variable is referenced in the order it was declared in the source code; take a look at the sample contract below:

```sol
contract WeylExample {

  uint public numOwners;
  mapping(address => bool) private owners;

  // Rest of contract...
}
```

The first state variable is a uint, or more importantly, a simple [Value Type](https://solidity.readthedocs.io/en/v0.4.24/types.html#value-types).  Its key in the storage object will be `0` -- state variables are zero-indexed -- but converted into a padded hex string: `0x0...0`.  Its uint value is stored as an un-padded, `0x`-prefixed hex string, so with one owner, the Weyl contract's storage shape starts out like this: 

```
{
  "alloc": {
    "0x0...02A" : {
      "code": "0x...",
      "storage": {
        "0x0000000000000000000000000000000000000000000000000000000000000000": "0x1"
      }
    }
  }
}
```

The second state variable is a [Mapping](https://solidity.readthedocs.io/en/v0.4.24/types.html#mappings).  The storage object is flat, so each value stored in the map gets its own key.  This key is calculated with the following steps:

1. Pad the address which will be used to key into the map and the index of the variable (for our `owners` variable, `1`).
2. Make a hex Buffer which is the address followed by the index.
3. Return the `sha3` hash of this Buffer as a `0x`-prefixed hex string.

Written in pseudocode, setting one address key in a map to `true` looks something like:
```
storage[ '0x' + sha3( pad(addressKey) + pad(mapIndex) )] = '0x1';
```
Where `addressKey` is the key on the map and `mapIndex` is that map's index in the list of state variables as declared in the sourcecode (in the sample case, `mapIndex = 1`).  Put this all together, and in the one-owner case, you end up with the following `storage` object:

```
{
  "storage": {
    "0x0000000000000000000000000000000000000000000000000000000000000000": "0x1",
    "0xe9b6e9843417f0ea3a8ed4ff9903fd0b05391abe8cff9eae43d392f2221aefe9": "0x1"
  }
}
```
Similar procedures are used for initializing arrays, except with array indices instead of map keys.  

Make sure to do extensive tests with any new genesis block, as misformatted memory will make functions return garbage values.  This script is only responsible for setting the variables shown above.  If we wanted to import governance history into a new genesis block, we would also need to set initial values for the other assorted state variables.

So We Want to Hardfork...
---

The syntax described above was all we needed to know when we were initializing the BlockVoting & EximGov contracts.  The mappings we needed to set only stored booleans, but we have some mappings which store structs.  If we wanted to do a hard fork where we imported the full current state of the governance contract, we'd need to do research on how those are represented.

One strategy to rebuild `storage` would be manually querying all of the locations where there are values.  `web3` provides a function to fetch the value at any specific index.  In practice, this means we would need to calculate all `map` and `array` indices ourselves, potentially using the transaction history, and then fetch the value stored in each one.  It's technically possible, but a significant amount of legwork on our end.  Definitely worth thinking through whether we really need to import *all* of this contract's historical state.