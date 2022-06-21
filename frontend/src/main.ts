import {SecretNetworkClient} from "secretjs";
import {cryptographicallySecureRandomString, getOrCreateViewingKey} from "./utils";
import {offspringsResponse, offspringStatus} from "./types";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const showLoading = () => document.getElementById("loading")!.style.opacity = "1";
const hideLoading = () => document.getElementById("loading")!.style.opacity = "0";

let keplrCheckCount = 0;

while (
  !window.keplr ||
  !window.getEnigmaUtils ||
  !window.getOfflineSignerOnlyAmino
  ) {
  if (keplrCheckCount > 10) {
    alert("Keplr is not loaded");
    throw new Error("Keplr is not loaded");
  }
  await sleep(100);
  keplrCheckCount++;
}

const CHAIN_ID = import.meta.env.VITE_CHAIN_ID;

// await addLocalSecretToKeplr();

const keplrOfflineSigner = window.getOfflineSignerOnlyAmino(CHAIN_ID);
const [{address: myAddress}] = await keplrOfflineSigner.getAccounts();

const grpcWebUrl = import.meta.env.VITE_GRPC_WEB_URL;

const secretjs = await SecretNetworkClient.create({
  grpcWebUrl,
  chainId: CHAIN_ID,
  wallet: keplrOfflineSigner,
  walletAddress: myAddress,
  encryptionUtils: window.getEnigmaUtils(CHAIN_ID),
});

const factoryCodeHash = import.meta.env.VITE_FACTORY_CODE_HASH;
const offspringCodeHash = import.meta.env.VITE_OFFSPRING_CODE_HASH;
const factoryAddress = import.meta.env.VITE_FACTORY_ADDRESS;

let viewingKey = await getOrCreateViewingKey(secretjs, myAddress, factoryAddress, factoryCodeHash);

const offsprings = await secretjs.query.compute.queryContract<object, offspringsResponse>({
  contractAddress: factoryAddress,
  codeHash: factoryCodeHash,
  query: {
    list_my_offspring: {
      address: myAddress,
      viewing_key: viewingKey,
      filter: "active",
      page_size: 50
    }
  }
});

const offspringsSelect = document.getElementById("offsprings")! as HTMLSelectElement;
offspringsSelect.innerHTML = offsprings.list_my_offspring.active.map(x => `<option value="${x.address}">${x.label}</option>`).join("\n");
const offspringInfoDiv = document.getElementById("offspringInfo")! as HTMLDivElement;
const newOffspringButton = document.getElementById("newOffspring")! as HTMLButtonElement;
const newOffspringForm = document.getElementById("newOffspringForm")! as HTMLFormElement;

newOffspringButton.onclick = () => {
  newOffspringButton.disabled = true;
  newOffspringForm.style.display = "block";
}

newOffspringForm.onsubmit = async (e) => {
  e.preventDefault();
  const newOffspringDescription = newOffspringForm.querySelector("#newOffspringDescription") as HTMLInputElement;
  const newOffspringSnip20Addr = newOffspringForm.querySelector("#newOffspringSnip20Addr") as HTMLInputElement;
  const newOffspringLockPeriod = newOffspringForm.querySelector("#newOffspringLockPeriod") as HTMLInputElement;

  if (!newOffspringDescription.value || !newOffspringSnip20Addr.value || !newOffspringLockPeriod.value) {
    alert("Please fill out all fields");
    return;
  }

  newOffspringForm.style.display = "none";
  try {
    showLoading();
    const newOffspringSnip20Info = await secretjs.query.compute.contractInfo(newOffspringSnip20Addr.value);
    const newOffspringSnip20CodeId = newOffspringSnip20Info.ContractInfo.codeId;
    const newOffspringSnip20Label = newOffspringSnip20Info.ContractInfo.label;
    const newOffspringSnip20CodeHash = await secretjs.query.compute.codeHash(parseInt(newOffspringSnip20CodeId));

    const newOffspringMsg = await secretjs.tx.compute.executeContract({
      sender: myAddress,
      contractAddress: factoryAddress,
      codeHash: factoryCodeHash,
      msg: {
        create_offspring: {
          label: `${newOffspringSnip20Label} VestingContract - ${newOffspringDescription.value} (${new Date().toISOString()})`,
          entropy: cryptographicallySecureRandomString(32),
          owner: myAddress,
          snip20: {
            code_hash: newOffspringSnip20CodeHash,
            address: newOffspringSnip20Addr.value
          },
          withdraw_time: ~~(new Date().getTime() / 1000) + parseInt(newOffspringLockPeriod.value),
          description: newOffspringDescription.value
        }
      },
    }, {
      gasLimit: 100_000,
    })
    console.log(newOffspringMsg)
  } catch (e) {
    newOffspringForm.style.display = "block";
  } finally {
    newOffspringButton.disabled = false;
    await reloadOffspringInfo()
    hideLoading();
  }
}

offspringsSelect.onchange = reloadOffspringInfo;

async function reloadOffspringInfo() {
  offspringsSelect.disabled = true;
  showLoading()
  try {
    const offspringAddress = offspringsSelect.value;
    const offspringLabel = offsprings.list_my_offspring.active.find(x => x.address === offspringAddress)!.label;
    const offspringStatus = await secretjs.query.compute.queryContract<object, offspringStatus>({
      contractAddress: offspringAddress,
      codeHash: offspringCodeHash,
      query: {
        get_funds: {
          address: myAddress,
          viewing_key: viewingKey,
          block_time: ~~(Date.now() / 1000)
        }
      }
    })
    const offspringSnip20Info = await secretjs.query.snip20.getSnip20Params({
      contract: {
        address: offspringStatus.funds_status.snip20.address,
        codeHash: offspringStatus.funds_status.snip20.code_hash
      }
    });
    let remainingTime = "";
    if (offspringStatus.funds_status.remaining_time > 60 * 60 * 24 * 365)
      remainingTime = `${(offspringStatus.funds_status.remaining_time / (60 * 60 * 24 * 365)).toFixed(2)} years`;
    else if (offspringStatus.funds_status.remaining_time > 60 * 60 * 24 * 30)
      remainingTime = `${(offspringStatus.funds_status.remaining_time / (60 * 60 * 24 * 30)).toFixed(2)} months`
    else if (offspringStatus.funds_status.remaining_time > 60 * 60 * 24)
      remainingTime = `${(offspringStatus.funds_status.remaining_time / (60 * 60 * 24)).toFixed(2)} days`
    else if (offspringStatus.funds_status.remaining_time > 60 * 60)
      remainingTime = `${(offspringStatus.funds_status.remaining_time / (60 * 60)).toFixed(2)} hours`
    else if (offspringStatus.funds_status.remaining_time > 60)
      remainingTime = `${(offspringStatus.funds_status.remaining_time / 60).toFixed(2)} minutes`
    else
      remainingTime = `${offspringStatus.funds_status.remaining_time} seconds`
    console.log(offspringStatus)
    offspringInfoDiv.innerHTML = `
      <p><b>Label</b>: <i>${offspringLabel}</i></p>
      <p><b>Contract Address</b>: <i>${offspringAddress}</i></p>
      <p><b>Withdrawn: </b> <i>${offspringStatus.funds_status.withdrawn}</i></p>
      <p><b>Can withdraw: </b> <i>${offspringStatus.funds_status.can_withdraw ? offspringStatus.funds_status.withdrawn ? 'no' : `yes (<button id="withdrawButton">withdraw</button>)` : `${remainingTime} remaining`}</i></p>
      <p><b>Balance: </b> <i>${offspringStatus.funds_status.amount} (u${offspringSnip20Info.token_info.symbol})</i></p>
      ${offspringStatus.funds_status.withdrawn ? "" : `<button id="addFunds">Add funds</button>`}
    `;
    const addFundsButton = offspringInfoDiv.querySelector("#addFunds")! as HTMLButtonElement;
    addFundsButton.onclick = async () => {
      addFundsButton.disabled = true;
      try {
        let amount = 0;
        while (amount <= 0)
          amount = parseInt(prompt("Amount to add") || "");
        const addFundsMsg = await secretjs.tx.compute.executeContract({
          sender: myAddress,
          contractAddress: offspringStatus.funds_status.snip20.address,
          codeHash: offspringStatus.funds_status.snip20.code_hash,
          msg: {
            send: {
              recipient: offspringAddress,
              recipient_code_hash: offspringCodeHash,
              amount: amount.toString(),
              msg: undefined,
              memo: "Lock funds",
            }
          }
        }, {
          gasLimit: 100_000,
        });
        console.log(addFundsMsg)
        await reloadOffspringInfo();
      } catch (e) {
        console.error(e)
      } finally {
        addFundsButton.disabled = false;
      }
    }
    const withdrawButton = offspringInfoDiv.querySelector("#withdrawButton")! as HTMLButtonElement;
    withdrawButton.onclick = async () => {
      withdrawButton.disabled = true;
      try {
        const withdrawMsg = await secretjs.tx.compute.executeContract({
          sender: myAddress,
          contractAddress: offspringAddress,
          codeHash: offspringCodeHash,
          msg: {
            withdraw: {}
          }
        }, {
          gasLimit: 100_000,
        });
        console.log(withdrawMsg)
        await reloadOffspringInfo()
      } catch (e) {
        console.error(e)
      } finally {
        withdrawButton.disabled = false;
      }
    }
  } finally {
    offspringsSelect.disabled = false;
    hideLoading()
  }
}

console.log(secretjs)
