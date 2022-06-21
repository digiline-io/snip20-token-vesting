import {SecretNetworkClient, Tx} from "secretjs";
import {ViewingKeyResponse} from "./types";

export function cryptographicallySecureRandomString(length: number): string {
  const array = new Uint8Array(length);
  window.crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array));
}

export function getResponseData<T>(tx: Tx) {
  return JSON.parse(
    new TextDecoder("utf8").decode(tx.data[0])
  ) as T;
}

export async function getOrCreateViewingKey(secretjs: SecretNetworkClient, myAddress: string, factoryContractAddress: string, factoryCodeHash: string): Promise<String> {
  let viewingKey = localStorage.getItem("viewingKey");
  if (viewingKey)
    return viewingKey;
  const viewingKeyCreation = await secretjs.tx.compute.executeContract(
    {
      sender: myAddress,
      contractAddress: factoryContractAddress,
      codeHash: factoryCodeHash, // optional but way faster
      msg: {
        "create_viewing_key": {"entropy": cryptographicallySecureRandomString(32)}
      },
    },
    {
      gasLimit: 100_000,
    },
  );
  if (viewingKeyCreation.code !== 0)
    throw new Error(`Error creating viewing key: ${viewingKeyCreation.code}. ${viewingKeyCreation.rawLog}`);
  const viewingKeyCreationResponse = getResponseData<ViewingKeyResponse>(viewingKeyCreation);
  viewingKey = viewingKeyCreationResponse.viewing_key.key;
  localStorage.setItem("viewingKey", viewingKey);
  return viewingKey;
}

export async function addLocalSecretToKeplr() {
  await window.keplr.experimentalSuggestChain({
    chainId: "secretdev-1",
    chainName: "localsecret",
    rpc: "http://localhost:26657",
    rest: "http://localhost:1317",
    bip44: {
      coinType: 529,
    },
    bech32Config: {
      bech32PrefixAccAddr: "secret",
      bech32PrefixAccPub: "secret" + "pub",
      bech32PrefixValAddr: "secret" + "valoper",
      bech32PrefixValPub: "secret" + "valoperpub",
      bech32PrefixConsAddr: "secret" + "valcons",
      bech32PrefixConsPub: "secret" + "valconspub",
    },
    currencies: [
      {
        coinDenom: "SCRT",
        coinMinimalDenom: "uscrt",
        coinDecimals: 6,
        coinGeckoId: "secret",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "SCRT",
        coinMinimalDenom: "uscrt",
        coinDecimals: 6,
        coinGeckoId: "secret",
      },
    ],
    stakeCurrency: {
      coinDenom: "SCRT",
      coinMinimalDenom: "uscrt",
      coinDecimals: 6,
      coinGeckoId: "secret",
    },
    coinType: 118,
    gasPriceStep: {
      low: 0.01,
      average: 0.025,
      high: 0.03,
    },
  });
}
