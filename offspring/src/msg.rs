use cosmwasm_std::{Binary, HumanAddr, Uint128};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct InitMsg {
    /// factory contract code hash and address
    pub factory: ContractInfo,
    /// label used when initializing offspring
    pub label: String,
    /// password to be used by factory
    pub password: [u8; 32],
    /// Optional text description of this offspring
    pub description: Option<String>,

    pub owner: HumanAddr,
    pub snip20: ContractInfo,
    pub withdraw_time: u64,
}

/// Handle messages
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum HandleMsg {
    Deactivate {},
    Receive {
        sender: HumanAddr,
        from: HumanAddr,
        amount: Uint128,
        #[serde(default)]
        msg: Option<Binary>,
    },
    Withdraw {},
}

/// Queries
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    GetFunds {
        /// address to authenticate as a viewer
        address: HumanAddr,
        /// viewer's viewing key
        viewing_key: String,
        /// the block time to check the remaining time
        block_time: u64,
    },
}

/// code hash and address of a contract
#[derive(Serialize, Deserialize, JsonSchema, Clone, PartialEq, Debug)]
pub struct ContractInfo {
    /// contract's code hash string
    pub code_hash: String,
    /// contract's address
    pub address: HumanAddr,
}

/// responses to queries
#[derive(Serialize, Deserialize, Debug, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryAnswer {
    FundsStatus {
        can_withdraw: bool,
        remaining_time: u64,
        withdrawn: bool,
        amount: Uint128,
        snip20: ContractInfo,
    },
}
