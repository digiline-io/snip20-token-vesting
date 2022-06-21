import {SecretNetworkClient, Tx, Wallet} from "secretjs";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import {executeShell, getLastModifiedInRustProject} from "./utils";

if (!fs.existsSync("./cache"))
  fs.mkdirSync("./cache");
if (!fs.existsSync("./build"))
  fs.mkdirSync("./build");

async function updateContractIfNeeded(secretjs, myAddress, contractName, contractPath, initArgs = null) {
  const lastModifiedCache = fs.existsSync(`./cache/${contractName}.json`) ? fs.statSync(`./cache/${contractName}.json`).mtimeMs : 0;
  const lastModified = await getLastModifiedInRustProject(contractPath);

  const lastModifiedData = fs.existsSync(`./cache/${contractName}.json`) ?
    JSON.parse(
      fs.readFileSync(`./cache/${contractName}.json`).toString()
    ) : {};
  const lastModifiedArgs = fs.existsSync(`./cache/${contractName}_args.json`) ? fs.readFileSync(`./cache/${contractName}_args.json`).toString() : "";

  if (lastModified > lastModifiedCache || JSON.stringify(initArgs) !== lastModifiedArgs) {
    console.log(`${contractName} has been updated, rebuilding...`);
    const [output, exitCode] = await executeShell("make", ["build"], contractPath);
    if (exitCode !== 0) {
      console.error(`Error while rebuilding ${contractName}, please check the logs`);
      console.error(output);
      process.exit(exitCode);
    }
    fs.writeFileSync(`./build/${contractName}.wasm`, fs.readFileSync(path.join(contractPath, `contract.wasm`)));
    const contract = await secretjs.tx.compute.storeCode({
      sender: myAddress,
      wasmByteCode: fs.readFileSync(`./build/${contractName}.wasm`),
      source: "",
      builder: ""
    }, {
      gasLimit: 5_000_000
    })
    if (contract.code !== 0) {
      console.error(`Error while storing ${contractName}`);
      console.error(contract.rawLog, contract.jsonLog);
      process.exit(contract.code);
    }
    const contractCodeId = Number(contract.arrayLog.find(log => log.key === "code_id" && log.type === "message").value)
    const contractCodeHash = await secretjs.query.compute.codeHash(contractCodeId);
    console.log(`${contractName} contract code id: ${contractCodeId}`);
    let instanceOut = null;
    let address = "";
    if (initArgs !== null) {
      instanceOut = await secretjs.tx.compute.instantiateContract({
        sender: myAddress,
        codeId: contractCodeId,
        codeHash: contractCodeHash,
        label: `${contractName} ${new Date().toISOString()}`,
        initMsg: initArgs,
      }, {
        gasLimit: 5_000_000
      })
      if (instanceOut.code !== 0) {
        console.error(`Error while instantiating ${contractName}, please check the logs`);
        console.error(instanceOut.rawLog, instanceOut.jsonLog);
        process.exit(instanceOut.code);
      }
      address = instanceOut.arrayLog.find(log => log.type === "message" && log.key === "contract_address",).value;
    }
    fs.writeFileSync(`./cache/${contractName}.json`, JSON.stringify({
      lastModified: lastModifiedCache,
      codeId: contractCodeId,
      codeHash: contractCodeHash,
      address,
      buildOutput: output,
      exitCode: exitCode,
      instanceOut
    }));
    fs.writeFileSync(`./cache/${contractName}_args.json`, JSON.stringify(initArgs));
    return [contractCodeId, contractCodeHash, address];
  }
  return [lastModifiedData.codeId, lastModifiedData.codeHash, lastModifiedData.address];
}

async function queryTimebox(secretjs: SecretNetworkClient, contractAddress: string, codeHash: string, user_address: string, viewing_key: string) {
  return await secretjs.query.compute.queryContract({
    contractAddress,
    query: {
      get_funds: {
        address: user_address,
        viewing_key,
        block_time: ~~(new Date().getTime() / 1000)
      }
    },
    codeHash,
  });
}

async function querySnip20(secretjs: SecretNetworkClient, contractAddress: string, codeHash: string, user_address: string, viewing_key: string) {
  return await secretjs.query.compute.queryContract({
    contractAddress,
    query: {
      balance: {
        address: user_address,
        key: viewing_key
      }
    },
    codeHash,
  });
}

const wallet = new Wallet(
  "grant rice replace explain federal release fix clever romance raise often wild taxi quarter soccer fiber love must tape steak together observe swap guitar",
);
const myAddress = wallet.address;

const grpcWebUrl = "http://localhost:9091";

// To create a signer secret.js client, also pass in a wallet
const secretjs = await SecretNetworkClient.create({
  grpcWebUrl,
  chainId: "secretdev-1",
  wallet: wallet,
  walletAddress: myAddress,
});

const [snip20CodeId, snip20CodeHash, snip20Address] = await updateContractIfNeeded(secretjs, myAddress, "snip20", "../snip20/", {
  name: "local-sscrt",
  symbol: "SSCRT",
  admin: myAddress,
  decimals: 6,
  prng_seed: "eW8=",
  initial_balances: [{
    address: myAddress,
    amount: "100000000000000000"
  }],
  config: {
    public_total_supply: true,
    enable_deposit: true,
    enable_redeem: true,
    enable_mint: false,
    enable_burn: false,
  },
  supported_denoms: ["uscrt"],
});
const [timeboxCodeId, timeboxCodeHash] = await updateContractIfNeeded(secretjs, myAddress, "timebox", "../offspring/");
const [factoryCodeId, factoryCodeHash, factoryAddress] = await updateContractIfNeeded(secretjs, myAddress, "factory", "../factory/", {
  entropy: "~TEST~",
  offspring_contract: {
    code_id: timeboxCodeId,
    code_hash: timeboxCodeHash,
  }
});

const viewingKeyCreationResponse = await secretjs.tx.compute.executeContract({
  sender: myAddress,
  codeHash: factoryCodeHash,
  contractAddress: factoryAddress,
  msg: {
    create_viewing_key: {
      entropy: `~TEST~`,
    }
  },
  sentFunds: []
}, {
  gasLimit: 5_000_000
});

function getResponseData(tx: Tx) {
  return JSON.parse(
    new TextDecoder("utf8").decode(tx.data[0])
  );
}

const viewing_key: string = getResponseData(viewingKeyCreationResponse).viewing_key.key;
await secretjs.tx.compute.executeContract({
  sender: myAddress,
  codeHash: snip20CodeHash,
  contractAddress: snip20Address,
  msg: {
    set_viewing_key: {
      key: viewing_key,
    }
  }
}, {
  gasLimit: 5_000_000
});

const initialBalance = await querySnip20(secretjs, snip20Address, snip20CodeHash, myAddress, viewing_key);

console.log(initialBalance)

const withdraw_time = Math.round(new Date().getTime() / 1000) + 10; // 10s from now

const instantiateResponse = await secretjs.tx.compute.executeContract({
  sender: myAddress,
  codeHash: factoryCodeHash,
  msg: {
    create_offspring: {
      label: `Offspring 0x${crypto.randomBytes(32).toString("hex")}`,
      entropy: "~TEST~",
      owner: myAddress,
      snip20: {
        code_hash: snip20CodeHash,
        address: snip20Address,
      },
      withdraw_time
    },
  },
  contractAddress: factoryAddress,
  sentFunds: []
}, {
  gasLimit: 5_000_000
});

const timebox12sAddress = instantiateResponse.arrayLog.find(log => log.type === "wasm" && log.key == "offspring_address").value;

const timebox12sFirstQuery = await queryTimebox(secretjs, timebox12sAddress, timeboxCodeHash, myAddress, viewing_key);

console.log(timebox12sFirstQuery);

const timebox12sFundingResponse = await secretjs.tx.compute.executeContract({
  contractAddress: snip20Address,
  sender: myAddress,
  sentFunds: [],
  msg: {
    send: {
      recipient: timebox12sAddress,
      recipient_code_hash: timeboxCodeHash,
      amount: "1000",
      msg: undefined,
      memo: "",
    }
  },
  codeHash: snip20CodeHash,
}, {
  gasLimit: 5_000_000
})

console.log(getResponseData(timebox12sFundingResponse));

const balanceAfterFunding = await querySnip20(secretjs, snip20Address, snip20CodeHash, myAddress, viewing_key);

console.log(balanceAfterFunding);

const timebox12sSecondQuery = await queryTimebox(secretjs, timebox12sAddress, timeboxCodeHash, myAddress, viewing_key);

console.log(timebox12sSecondQuery);

const timebox12sWithdrawResponse = await secretjs.tx.compute.executeContract({
  contractAddress: timebox12sAddress,
  codeHash: timeboxCodeHash,
  sender: myAddress,
  sentFunds: [],
  msg: {
    withdraw: {}
  }
}, {
  gasLimit: 5_000_000
});

console.log(timebox12sWithdrawResponse.jsonLog);

const balanceAfterWithdraw = await querySnip20(secretjs, snip20Address, snip20CodeHash, myAddress, viewing_key);

console.log(balanceAfterWithdraw);

const timebox12sThirdQuery = await queryTimebox(secretjs, timebox12sAddress, timeboxCodeHash, myAddress, viewing_key);

console.log(timebox12sThirdQuery);
